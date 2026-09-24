/**
 * Marketplace: listings, applications and the public verified profiles that
 * make them trustworthy (business map §8, §16, §17) — Supabase-backed.
 *
 * Public pages work for anonymous visitors: published listings are readable
 * from `listings` (with the property / unit facts denormalised on the row),
 * the detail pages go through the `public_listing(_ref)` RPC, and provider
 * records combine `provider_public_profile` (identity) with
 * `provider_public_stats` (aggregate operating numbers). Operators read their
 * own rows directly so drafts show. Everything else is RLS-scoped.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { currentUserId, db, logAudit, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import {
  toApplication,
  toListing,
  toListingChannel,
  toProperty,
  toReview,
  toTenancy,
  toUnit,
} from "@/lib/db/mappers";
import {
  channelsForListings,
  computePipeline,
  ensureChannels,
  propagateListingChange,
  sortChannels,
  withdrawEverywhere,
} from "@/lib/services/syndication";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type {
  ApplicationStatus,
  ApplicationWithContext,
  Listing,
  LeadSource,
  ListingChannel,
  ListingStatus,
  ListingWithContext,
  Property,
  PropertyType,
  ProviderProfile,
  RentalApplication,
  Review,
  Tenancy,
  TenantPassport,
  Unit,
  UUID,
} from "@/lib/types";

/**
 * `provider_public_stats` was added by migration 20260915000720 and is not in
 * the generated `Database["public"]["Functions"]` yet (regenerate with
 * `bun run db:types`); until then the call goes through this untyped shim.
 */
const rpcUntyped = db.rpc.bind(db) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID_RE.test(value);
/** public_ref (8 hex chars) or a raw id — anything else never reaches a filter string. */
const isSafeRef = (value: string) => /^[A-Za-z0-9-]{1,64}$/.test(value);

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) =>
  b.created_at.localeCompare(a.created_at);

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

async function canOperateListing(listingId: UUID): Promise<boolean> {
  if (!(await currentUserId())) return false;
  return Boolean(unwrap(await db.rpc("can_operate_listing", { _listing_id: listingId })));
}

/* --------------------------- provider profiles ---------------------------- */

type ProviderStatsRow = {
  organization_id: string;
  verified_units: number;
  owners_served: number;
  median_first_response_hours: number | string;
  resolved_under_72h_pct: number;
  collection_rate_pct: number;
  tenant_rating: number | string | null;
  owner_rating: number | string | null;
  open_disputes: number;
};

/**
 * Public records for a set of organizations in three round-trips:
 * identity (`provider_public_profile`), aggregate operating numbers
 * (`provider_public_stats`) and the published reviews the viewer may read
 * (none for anonymous visitors — the reviews table is not public).
 */
export async function providerProfilesFor(orgIds: UUID[]): Promise<Map<UUID, ProviderProfile>> {
  const ids = [...new Set(orgIds)];
  const profiles = new Map<UUID, ProviderProfile>();
  if (ids.length === 0) return profiles;

  const viewer = await currentUserId();
  const [identityRes, statsRes, reviewsRes] = await Promise.all([
    Promise.all(ids.map((id) => db.rpc("provider_public_profile", { _org_id: id }))),
    rpcUntyped("provider_public_stats", { _org_ids: ids }),
    viewer
      ? db
          .from("reviews")
          .select("*")
          .in("organization_id", ids)
          .eq("status", "published")
          .order("created_at", { ascending: false })
      : Promise.resolve(null),
  ]);

  const stats = new Map(
    ((unwrap(statsRes) as ProviderStatsRow[] | null) ?? []).map((s) => [s.organization_id, s]),
  );
  const reviews = new Map<UUID, Review[]>();
  for (const row of reviewsRes ? unwrap(reviewsRes) : []) {
    const review = toReview(row);
    reviews.set(review.organization_id, [...(reviews.get(review.organization_id) ?? []), review]);
  }

  identityRes.forEach((res, index) => {
    const identity = unwrap(res)[0];
    const id = ids[index]!;
    if (!identity) return;
    const s = stats.get(id);
    const rating = (value: number | string | null | undefined) =>
      value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;
    profiles.set(id, {
      organization_id: identity.organization_id,
      name: identity.name,
      kind: identity.kind,
      verification_status: identity.verification_status,
      verified_properties: identity.verified_properties,
      verified_units: s?.verified_units ?? 0,
      owners_served: s?.owners_served ?? (identity.kind === "property_manager" ? 0 : 1),
      median_first_response_hours:
        Math.round(Number(s?.median_first_response_hours ?? 0) * 10) / 10,
      resolved_under_72h_pct: s?.resolved_under_72h_pct ?? 0,
      collection_rate_pct: s?.collection_rate_pct ?? 0,
      tenant_rating: rating(s?.tenant_rating),
      owner_rating: rating(s?.owner_rating),
      reviews: (reviews.get(id) ?? []).sort(byCreatedDesc),
      open_disputes: s?.open_disputes ?? 0,
    });
  });
  return profiles;
}

/**
 * Public landlord / property-manager profile. Every number derives from a
 * verified relationship or a recorded event — no invented scores.
 */
export async function getProviderProfile(orgId: UUID | null): Promise<ProviderProfile | null> {
  if (!orgId) return null;
  return buildProviderProfile(orgId);
}

export async function buildProviderProfile(orgId: UUID): Promise<ProviderProfile | null> {
  return (await providerProfilesFor([orgId])).get(orgId) ?? null;
}

/* ----------------------------- tenant passport ---------------------------- */

type PassportSubject = { userId?: UUID | null; email?: string | null };

type PassportPaymentRow = Pick<
  Tables<"payments">,
  "id" | "tenancy_id" | "status" | "verified" | "paid_at" | "due_date" | "created_at"
>;

type PassportRows = {
  tenancies: Tenancy[];
  payments: PassportPaymentRow[];
  reviews: Review[];
  openDisputeReviewIds: Set<UUID>;
};

const EMPTY_PASSPORT_ROWS: PassportRows = {
  tenancies: [],
  payments: [],
  reviews: [],
  openDisputeReviewIds: new Set(),
};

const cleanEmail = (email: string | null | undefined) => {
  const value = email?.trim().toLowerCase() ?? "";
  return value && !/[\s",()\\]/.test(value) ? value : null;
};

/**
 * Tenancies (and their payments / landlord reviews / open disputes) for the
 * given people, as far as RLS lets the viewer read them: a tenant sees their
 * own history, a landlord the history inside their own workspaces.
 */
async function loadPassportRows(subjects: PassportSubject[]): Promise<PassportRows> {
  const userIds = [
    ...new Set(subjects.map((s) => s.userId).filter((id): id is string => Boolean(id))),
  ];
  const emails = [
    ...new Set(subjects.map((s) => cleanEmail(s.email)).filter((e): e is string => Boolean(e))),
  ];
  const filters: string[] = [];
  if (userIds.length > 0) filters.push(`tenant_user_id.in.(${userIds.join(",")})`);
  if (emails.length > 0) filters.push(`tenant_email.in.(${emails.map((e) => `"${e}"`).join(",")})`);
  if (filters.length === 0) return EMPTY_PASSPORT_ROWS;

  const tenancyRows = unwrap(
    await db.from("tenancies").select("*").is("deleted_at", null).or(filters.join(",")),
  );
  const tenancies = tenancyRows.map(toTenancy).sort(byCreatedDesc);
  if (tenancies.length === 0) return EMPTY_PASSPORT_ROWS;
  const tenancyIds = tenancies.map((t) => t.id);

  const [paymentsRes, reviewsRes] = await Promise.all([
    db
      .from("payments")
      .select("id, tenancy_id, status, verified, paid_at, due_date, created_at")
      .in("tenancy_id", tenancyIds),
    db
      .from("reviews")
      .select("*")
      .in("tenancy_id", tenancyIds)
      .eq("direction", "landlord_to_tenant")
      .order("created_at", { ascending: false }),
  ]);
  const payments = unwrap(paymentsRes) as PassportPaymentRow[];
  const reviews = unwrap(reviewsRes).map(toReview);

  const openDisputeReviewIds = new Set<UUID>();
  if (reviews.length > 0) {
    const disputes = unwrap(
      await db
        .from("review_disputes")
        .select("review_id")
        .in(
          "review_id",
          reviews.map((r) => r.id),
        )
        .eq("status", "open"),
    );
    disputes.forEach((d) => openDisputeReviewIds.add(d.review_id));
  }
  return { tenancies, payments, reviews, openDisputeReviewIds };
}

/**
 * The passport arithmetic (mirrored by `tenant_passport_snapshot()` in SQL):
 * verified payments = `verified`; on time = paid on or before the due date;
 * late = status late / failed, or paid after the due date.
 */
function passportFromRows(rows: PassportRows, subject: PassportSubject): TenantPassport | null {
  const email = cleanEmail(subject.email);
  const tenancies = rows.tenancies.filter(
    (t) =>
      (subject.userId && t.tenant_user_id === subject.userId) ||
      (email && t.tenant_email?.toLowerCase() === email),
  );
  if (tenancies.length === 0) return null;
  const tenancyIds = new Set(tenancies.map((t) => t.id));

  const dueDate = (p: PassportPaymentRow) => p.due_date ?? p.created_at.slice(0, 10);
  const paidDate = (p: PassportPaymentRow) => (p.paid_at ? p.paid_at.slice(0, 10) : null);
  const payments = rows.payments.filter((p) => tenancyIds.has(p.tenancy_id));
  const isSettled = (p: PassportPaymentRow) => p.status === "paid" && p.verified;
  const isLate = (p: PassportPaymentRow) =>
    p.status === "late" ||
    p.status === "failed" ||
    (p.status === "paid" && paidDate(p) !== null && paidDate(p)! > dueDate(p));
  const settled = payments.filter(isSettled);
  const onTime = settled.filter((p) => paidDate(p) === null || paidDate(p)! <= dueDate(p));
  const late = payments.filter(isLate);
  const considered = payments.filter((p) => isSettled(p) || isLate(p));

  const todayStr = new Date().toISOString().slice(0, 10);
  const months = tenancies.reduce((sum, t) => {
    if (!t.start_date) return sum;
    const end = t.end_date && t.end_date < todayStr ? t.end_date : null;
    const endMs = end ? new Date(`${end}T00:00:00`).getTime() : Date.now();
    return (
      sum +
      Math.max(
        0,
        Math.round((endMs - new Date(`${t.start_date}T00:00:00`).getTime()) / 2_628_000_000),
      )
    );
  }, 0);

  const reviews = rows.reviews.filter((r) => tenancyIds.has(r.tenancy_id)).sort(byCreatedDesc);

  return {
    tenant_name: tenancies[0]!.tenant_name,
    verified_payments: settled.length,
    on_time_payments: onTime.length,
    on_time_pct:
      considered.length === 0 ? 0 : Math.round((onTime.length / considered.length) * 100),
    late_payments: late.length,
    verified_tenancies: tenancies.filter((t) => t.verified).length,
    months_of_history: months,
    average_rent: average(tenancies.map((t) => t.monthly_rent ?? 0).filter((n) => n > 0)),
    open_disputes: reviews.filter((r) => rows.openDisputeReviewIds.has(r.id)).length,
    reviews,
  };
}

/** Verified rental history for one tenant (RLS-scoped), keyed by user id or email. */
export async function getTenantPassport(input: PassportSubject): Promise<TenantPassport | null> {
  return buildTenantPassport(input);
}

export async function buildTenantPassport(input: PassportSubject): Promise<TenantPassport | null> {
  if (!input.userId && !cleanEmail(input.email)) return null;
  return passportFromRows(await loadPassportRows([input]), input);
}

/** A frozen passport as stored in `rental_applications.passport_snapshot`. */
function passportFromJson(value: unknown): TenantPassport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const int = (key: string) => Math.round(Number(v[key] ?? 0)) || 0;
  const reviews: Review[] = Array.isArray(v["reviews"])
    ? (v["reviews"] as Record<string, unknown>[]).map((r) => ({
        id: String(r["id"] ?? ""),
        organization_id: String(r["organization_id"] ?? ""),
        tenancy_id: String(r["tenancy_id"] ?? ""),
        direction: (r["direction"] as Review["direction"]) ?? "landlord_to_tenant",
        author_id: (r["author_id"] as string | null) ?? null,
        author_name: String(r["author_name"] ?? ""),
        rating: Number(r["rating"] ?? 0),
        body: String(r["body"] ?? ""),
        status: (r["status"] as Review["status"]) ?? "published",
        created_at: String(r["created_at"] ?? ""),
        updated_at: String(r["updated_at"] ?? ""),
      }))
    : [];
  return {
    tenant_name: String(v["tenant_name"] ?? ""),
    verified_payments: int("verified_payments"),
    on_time_payments: int("on_time_payments"),
    on_time_pct: int("on_time_pct"),
    late_payments: int("late_payments"),
    verified_tenancies: int("verified_tenancies"),
    months_of_history: int("months_of_history"),
    average_rent:
      v["average_rent"] === null || v["average_rent"] === undefined
        ? null
        : Number(v["average_rent"]),
    open_disputes: int("open_disputes"),
    reviews,
  };
}

/* --------------------------------- listings -------------------------------- */

const OPERATOR_LISTING_SELECT = "*, property:properties(*), unit:units(*)";

type OperatorListingRow = Tables<"listings"> & {
  property: Tables<"properties"> | null;
  unit: Tables<"units"> | null;
};

/** Shape of `public_listing(_ref)`: listing row (minus assigned_to), public property / unit facts, channels. */
type PublicListingPayload = {
  listing: Omit<Tables<"listings">, "assigned_to"> | null;
  property: {
    id: string;
    name: string;
    property_type: PropertyType;
    street_address: string;
    unit_label: string | null;
    city: string;
    state: string;
    zip: string;
    year_built: number | null;
  } | null;
  unit: {
    id: string;
    name: string;
    bedrooms: number | string | null;
    bathrooms: number | string | null;
    square_feet: number | null;
  } | null;
  channels: Tables<"listing_channels">[] | null;
};

/** Everything the listing read model needs beyond the row, fetched once per batch. */
type ListingContext = {
  providers: Map<UUID, ProviderProfile>;
  channels: Map<UUID, ListingChannel[]>;
  applications: Map<UUID, ApplicationStatus[]>;
  leads: Map<UUID, number>;
  ownerNames: Map<UUID, string>;
};

async function contextFor(
  listings: Listing[],
  options: { operator: boolean; channels?: Map<UUID, ListingChannel[]> },
): Promise<ListingContext> {
  const ids = listings.map((l) => l.id);
  const propertyIds = [...new Set(listings.map((l) => l.property_id))];
  const [providers, channels] = await Promise.all([
    providerProfilesFor(listings.map((l) => l.organization_id)),
    options.channels ?? channelsForListings(ids),
  ]);
  const applications = new Map<UUID, ApplicationStatus[]>();
  const leads = new Map<UUID, number>();
  const ownerNames = new Map<UUID, string>();

  if (options.operator && ids.length > 0) {
    const [appsRes, leadsRes, ownersRes] = await Promise.all([
      db.from("rental_applications").select("listing_id, status").in("listing_id", ids),
      db.from("listing_leads").select("listing_id").in("listing_id", ids),
      db
        .from("management_assignments")
        .select("property_id, owner:owner_accounts(name)")
        .in("property_id", propertyIds)
        .is("revoked_at", null),
    ]);
    for (const a of unwrap(appsRes))
      applications.set(a.listing_id, [...(applications.get(a.listing_id) ?? []), a.status]);
    for (const l of unwrap(leadsRes)) leads.set(l.listing_id, (leads.get(l.listing_id) ?? 0) + 1);
    for (const m of unwrap(ownersRes) as unknown as {
      property_id: string;
      owner: { name: string } | null;
    }[]) {
      if (m.owner?.name && !ownerNames.has(m.property_id))
        ownerNames.set(m.property_id, m.owner.name);
    }
  }
  return { providers, channels, applications, leads, ownerNames };
}

function hydrateListing(
  listing: Listing,
  property: Property | null,
  unit: Unit | null,
  ctx: ListingContext,
): ListingWithContext {
  const statuses = ctx.applications.get(listing.id) ?? [];
  return {
    ...listing,
    property,
    unit,
    provider: ctx.providers.get(listing.organization_id) ?? null,
    application_count: statuses.length,
    channels: ctx.channels.get(listing.id) ?? [],
    pipeline: computePipeline(
      listing.id,
      listing.view_count ?? 0,
      ctx.leads.get(listing.id) ?? 0,
      statuses,
    ),
    owner_name: ctx.ownerNames.get(listing.property_id) ?? null,
  };
}

async function hydrateOperatorRows(rows: OperatorListingRow[]): Promise<ListingWithContext[]> {
  const listings = rows.map(toListing);
  const ctx = await contextFor(listings, { operator: true });
  return listings.map((listing, i) => {
    const row = rows[i]!;
    return hydrateListing(
      listing,
      row.property && row.property.deleted_at === null ? toProperty(row.property) : null,
      row.unit ? toUnit(row.unit) : null,
      ctx,
    );
  });
}

/**
 * Anonymous visitors cannot read properties / units, so the public read
 * models carry the facts that are denormalised on the listing row (address,
 * beds, baths, size) in Property / Unit shape.
 */
function publicProperty(
  listing: Listing,
  facts: Partial<
    Pick<
      Property,
      | "id"
      | "name"
      | "property_type"
      | "street_address"
      | "unit_label"
      | "city"
      | "state"
      | "zip"
      | "year_built"
    >
  >,
): Property {
  return {
    id: facts.id ?? listing.property_id,
    organization_id: listing.organization_id,
    name: facts.name ?? listing.street_address ?? listing.headline,
    property_type: facts.property_type ?? listing.property_type ?? "other",
    management_category: "standard_residential",
    street_address: facts.street_address ?? listing.street_address ?? "",
    unit_label: facts.unit_label ?? null,
    city: facts.city ?? "",
    state: facts.state ?? "",
    zip: facts.zip ?? "",
    year_built: facts.year_built ?? null,
    notes: null,
    normalized_address: null,
    county: null,
    parcel_number: null,
    recording_jurisdiction: null,
    legal_description: null,
    created_at: listing.created_at,
    updated_at: listing.updated_at,
    deleted_at: null,
  };
}

function publicUnit(
  listing: Listing,
  facts: Partial<Pick<Unit, "id" | "name" | "bedrooms" | "bathrooms" | "square_feet">>,
): Unit {
  return {
    id: facts.id ?? listing.unit_id,
    organization_id: listing.organization_id,
    property_id: listing.property_id,
    name: facts.name ?? "",
    bedrooms: facts.bedrooms ?? listing.bedrooms ?? null,
    bathrooms: facts.bathrooms ?? listing.bathrooms ?? null,
    square_feet: facts.square_feet ?? listing.square_feet ?? null,
    monthly_rent: listing.monthly_rent,
    security_deposit: listing.security_deposit,
    rent_due_day: 1,
    occupancy_status: "vacant",
    created_at: listing.created_at,
    updated_at: listing.updated_at,
    deleted_at: null,
  };
}

const num = (v: number | string | null | undefined) =>
  v === null || v === undefined ? null : Number(v);

/** Public detail page by public_ref or id, through the `public_listing` RPC (published only). */
async function publicListing(ref: string): Promise<ListingWithContext | null> {
  const payload = unwrap(
    await db.rpc("public_listing", { _ref: ref }),
  ) as unknown as PublicListingPayload | null;
  if (!payload?.listing) return null;
  const listing = toListing({ ...payload.listing, assigned_to: null });
  const channels = new Map<UUID, ListingChannel[]>([
    [listing.id, sortChannels((payload.channels ?? []).map(toListingChannel))],
  ]);
  const ctx = await contextFor([listing], { operator: false, channels });
  const facts = payload.property;
  const unitFacts = payload.unit;
  return hydrateListing(
    listing,
    publicProperty(listing, {
      ...(facts ?? {}),
    }),
    publicUnit(listing, {
      ...(unitFacts?.id ? { id: unitFacts.id } : {}),
      ...(unitFacts?.name ? { name: unitFacts.name } : {}),
      bedrooms: num(unitFacts?.bedrooms) ?? listing.bedrooms ?? null,
      bathrooms: num(unitFacts?.bathrooms) ?? listing.bathrooms ?? null,
      square_feet: unitFacts?.square_feet ?? listing.square_feet ?? null,
    }),
    ctx,
  );
}

/**
 * Public marketplace search (no session required). Only published listings
 * from platform-verified providers, newest publication first. The row's own
 * denormalised facts stand in for property / unit, which visitors cannot read.
 */
export async function searchListings(filters?: {
  query?: string;
  minBeds?: number | null;
  maxRent?: number | null;
  city?: string | null;
}): Promise<ListingWithContext[]> {
  let query = db
    .from("listings")
    .select("*")
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false, nullsFirst: false });
  if (filters?.city) query = query.eq("city", filters.city);
  if (filters?.maxRent) query = query.lte("monthly_rent", filters.maxRent);
  if (filters?.minBeds) query = query.gte("bedrooms", filters.minBeds);
  const rows = unwrap(await query);
  const listings = rows.map(toListing);
  const ctx = await contextFor(listings, { operator: false });

  const q = filters?.query?.trim().toLowerCase();
  return listings
    .map((listing, i) => {
      const row = rows[i]!;
      return hydrateListing(
        listing,
        publicProperty(listing, {
          ...(row.street_address
            ? { name: row.street_address, street_address: row.street_address }
            : {}),
          ...(row.city ? { city: row.city } : {}),
          ...(row.state ? { state: row.state } : {}),
          ...(row.zip ? { zip: row.zip } : {}),
        }),
        publicUnit(listing, {}),
        ctx,
      );
    })
    .filter((l) => l.provider?.verification_status === "verified")
    .filter((l) => {
      if (!q) return true;
      const haystack = [l.headline, l.property?.name, l.property?.city, l.unit?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

/** One listing by id: operators get the master record (drafts too), everyone else the public snapshot. */
export async function getListing(listingId: UUID): Promise<ListingWithContext | null> {
  if (!isUuid(listingId)) return null;
  if (await canOperateListing(listingId)) {
    const row = unwrapMaybe<OperatorListingRow>(
      await db
        .from("listings")
        .select(OPERATOR_LISTING_SELECT)
        .eq("id", listingId)
        .is("deleted_at", null)
        .maybeSingle(),
    );
    if (row) return (await hydrateOperatorRows([row]))[0] ?? null;
  }
  return publicListing(listingId);
}

/** Every listing in an organization, including drafts (provider view), newest first. */
export async function getListings(orgId: UUID | null): Promise<ListingWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("listings")
      .select(OPERATOR_LISTING_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );
  return hydrateOperatorRows(rows as unknown as OperatorListingRow[]);
}

/**
 * A manager's leasing desk: its own listings plus every listing on a property
 * assigned to it, whichever owner organization the listing belongs to.
 */
export async function getManagedListings(pmOrgId: UUID | null): Promise<ListingWithContext[]> {
  if (!pmOrgId) return [];
  const assignments = unwrap(
    await db
      .from("management_assignments")
      .select("property_id")
      .eq("organization_id", pmOrgId)
      .is("revoked_at", null),
  );
  const propertyIds = [...new Set(assignments.map((a) => a.property_id))];
  let query = db.from("listings").select(OPERATOR_LISTING_SELECT).is("deleted_at", null);
  query =
    propertyIds.length > 0
      ? query.or(`organization_id.eq.${pmOrgId},property_id.in.(${propertyIds.join(",")})`)
      : query.eq("organization_id", pmOrgId);
  const rows = unwrap(await query.order("created_at", { ascending: false }));
  return hydrateOperatorRows(rows as unknown as OperatorListingRow[]);
}

/** Editable listing columns from a domain patch (ids, refs, timestamps and counters are never client-set). */
function listingColumns(patch: Partial<Listing>): TablesUpdate<"listings"> {
  const u: TablesUpdate<"listings"> = {};
  if (patch.headline !== undefined) u.headline = patch.headline.trim();
  if (patch.description !== undefined) u.description = patch.description?.trim() || null;
  if (patch.monthly_rent !== undefined) u.monthly_rent = patch.monthly_rent;
  if (patch.security_deposit !== undefined) u.security_deposit = patch.security_deposit;
  if (patch.available_on !== undefined) u.available_on = patch.available_on;
  if (patch.lease_term_months !== undefined) u.lease_term_months = patch.lease_term_months;
  if (patch.amenities !== undefined) u.amenities = patch.amenities;
  if (patch.screening_criteria !== undefined)
    u.screening_criteria = patch.screening_criteria?.trim() || null;
  if (patch.syndicated_to !== undefined) u.syndicated_to = patch.syndicated_to;
  if (patch.property_type !== undefined) u.property_type = patch.property_type;
  if (patch.street_address !== undefined) u.street_address = patch.street_address?.trim() || null;
  if (patch.bedrooms !== undefined) u.bedrooms = patch.bedrooms;
  if (patch.bathrooms !== undefined) u.bathrooms = patch.bathrooms;
  if (patch.square_feet !== undefined) u.square_feet = patch.square_feet;
  if (patch.photos !== undefined) u.photos = patch.photos;
  if (patch.utilities_included !== undefined) u.utilities_included = patch.utilities_included;
  if (patch.pet_policy !== undefined) u.pet_policy = patch.pet_policy?.trim() || null;
  if (patch.parking !== undefined) u.parking = patch.parking?.trim() || null;
  if (patch.application_requirements !== undefined)
    u.application_requirements = patch.application_requirements;
  if (patch.income_requirement !== undefined)
    u.income_requirement = patch.income_requirement?.trim() || null;
  if (patch.credit_requirement !== undefined)
    u.credit_requirement = patch.credit_requirement?.trim() || null;
  if (patch.occupancy_limit !== undefined) u.occupancy_limit = patch.occupancy_limit;
  if (patch.move_in_fees !== undefined) u.move_in_fees = patch.move_in_fees?.trim() || null;
  if (patch.application_fee !== undefined) u.application_fee = patch.application_fee;
  if (patch.contact_name !== undefined) u.contact_name = patch.contact_name?.trim() || null;
  if (patch.contact_email !== undefined)
    u.contact_email = patch.contact_email?.trim().toLowerCase() || null;
  if (patch.contact_phone !== undefined) u.contact_phone = patch.contact_phone?.trim() || null;
  if (patch.showing_instructions !== undefined)
    u.showing_instructions = patch.showing_instructions?.trim() || null;
  // listings.assigned_to references auth.users — only a user id can be stored (free text is dropped)
  if (patch.assigned_to !== undefined)
    u.assigned_to = patch.assigned_to && isUuid(patch.assigned_to) ? patch.assigned_to : null;
  return u;
}

export async function createListing(input: {
  organizationId: UUID;
  propertyId: UUID;
  unitId: UUID;
  headline: string;
  description?: string | null;
  monthlyRent: number;
  securityDeposit?: number | null;
  availableOn: string;
  leaseTermMonths?: number;
  amenities?: string[];
  screeningCriteria?: string | null;
  syndicatedTo?: string[];
  publish?: boolean;
  actorId?: UUID | null;
  detail?: Partial<Listing>;
  channels?: string[];
}): Promise<Listing> {
  void input.actorId; // the audit trail uses the session user
  // Address, beds, baths and size are copied onto the listing row so the public
  // marketplace can show them without reading the (private) property / unit rows.
  const [propertyRes, unitRes] = await Promise.all([
    db.from("properties").select("*").eq("id", input.propertyId).maybeSingle(),
    db.from("units").select("*").eq("id", input.unitId).maybeSingle(),
  ]);
  const property = unwrapMaybe<Tables<"properties">>(propertyRes);
  const unit = unwrapMaybe<Tables<"units">>(unitRes);
  const detail = listingColumns(input.detail ?? {});

  const insert: TablesInsert<"listings"> = {
    ...detail,
    organization_id: input.organizationId,
    property_id: input.propertyId,
    unit_id: input.unitId,
    status: input.publish ? "published" : "draft",
    headline: input.headline.trim(),
    description: input.description?.trim() || null,
    monthly_rent: input.monthlyRent,
    security_deposit: input.securityDeposit ?? null,
    available_on: input.availableOn,
    lease_term_months: input.leaseTermMonths ?? 12,
    amenities: input.amenities ?? [],
    screening_criteria: input.screeningCriteria?.trim() || null,
    syndicated_to: input.syndicatedTo ?? [],
    property_type: detail.property_type ?? property?.property_type ?? null,
    street_address: detail.street_address ?? property?.street_address ?? null,
    city: property?.city ?? null,
    state: property?.state ?? null,
    zip: property?.zip ?? null,
    bedrooms: detail.bedrooms ?? num(unit?.bedrooms),
    bathrooms: detail.bathrooms ?? num(unit?.bathrooms),
    square_feet: detail.square_feet ?? unit?.square_feet ?? null,
  };
  const row = unwrapOne(await db.from("listings").insert(insert).select("*").single(), "Listing");
  const listing = toListing(row);

  await ensureChannels(listing);
  if (input.channels && input.channels.length > 0) {
    unwrap(
      await db
        .from("listing_channels")
        .update({ enabled: true })
        .eq("listing_id", listing.id)
        .in("marketplace_id", input.channels),
    );
  }
  if (input.publish) await propagateListingChange(listing, "create");

  await logAudit({
    organization_id: input.organizationId,
    action: input.publish ? "listing.published" : "listing.created",
    entity_type: "listing",
    entity_id: listing.id,
    metadata: { headline: listing.headline },
  });
  return listing;
}

export async function updateListingStatus(
  listingId: UUID,
  status: ListingStatus,
  actorId?: UUID | null,
): Promise<Listing> {
  void actorId;
  // published_at is stamped by the listings_write_guard trigger on first publish
  const row = unwrapOne(
    await db.from("listings").update({ status }).eq("id", listingId).select("*").single(),
    "Listing",
  );
  const listing = toListing(row);
  if (status === "leased" || status === "paused") {
    await withdrawEverywhere(listing);
  } else if (status === "published") {
    await propagateListingChange(listing, "create");
  }
  await logAudit({
    organization_id: listing.organization_id,
    action: `listing.${status}`,
    entity_type: "listing",
    entity_id: listing.id,
  });
  return listing;
}

/** Toggle a legacy syndication destination label (the source of truth is `listing_channels`). */
export async function toggleSyndication(listingId: UUID, destination: string): Promise<Listing> {
  const current = unwrapOne(
    await db.from("listings").select("syndicated_to").eq("id", listingId).single(),
    "Listing",
  );
  const next = current.syndicated_to.includes(destination)
    ? current.syndicated_to.filter((d) => d !== destination)
    : [...current.syndicated_to, destination];
  const row = unwrapOne(
    await db
      .from("listings")
      .update({ syndicated_to: next })
      .eq("id", listingId)
      .select("*")
      .single(),
    "Listing",
  );
  return toListing(row);
}

/** Public listing lookup by short reference (or raw id, for older links). */
export async function getListingByRef(ref: string): Promise<ListingWithContext | null> {
  if (!isSafeRef(ref)) return null;
  if (await currentUserId()) {
    const filter = isUuid(ref) ? `public_ref.eq.${ref},id.eq.${ref}` : `public_ref.eq.${ref}`;
    const row = unwrapMaybe<OperatorListingRow>(
      await db
        .from("listings")
        .select(OPERATOR_LISTING_SELECT)
        .or(filter)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
    );
    if (row && (await canOperateListing(row.id)))
      return (await hydrateOperatorRows([row]))[0] ?? null;
  }
  return publicListing(ref);
}

/**
 * Edit the master listing. Any change to rent, photos, availability,
 * description, amenities or lease terms is queued out to every enabled channel.
 */
export async function updateListing(input: {
  listingId: UUID;
  patch: Partial<Listing>;
  actorId?: UUID | null;
}): Promise<Listing> {
  void input.actorId;
  const update = listingColumns(input.patch);
  const row = unwrapOne(
    Object.keys(update).length > 0
      ? await db.from("listings").update(update).eq("id", input.listingId).select("*").single()
      : await db.from("listings").select("*").eq("id", input.listingId).single(),
    "Listing",
  );
  const listing = toListing(row);
  await propagateListingChange(listing, "update");
  await logAudit({
    organization_id: listing.organization_id,
    action: "listing.updated",
    entity_type: "listing",
    entity_id: listing.id,
    metadata: { fields: Object.keys(update) },
  });
  return listing;
}

/* ------------------------------ applications ------------------------------ */

const APPLICATION_SELECT = "*, listing:listings(*, property:properties(name), unit:units(name))";

type ApplicationRow = Tables<"rental_applications"> & {
  /** Added by 20260915000720 — regenerate types; until then read through this cast. */
  passport_snapshot?: unknown;
  listing:
    | (Tables<"listings"> & { property: { name: string } | null; unit: { name: string } | null })
    | null;
};

/**
 * Applicants who have no RentID history in this workspace still share a
 * consented package; we surface the declared figures with no verified events.
 */
function syntheticPassport(application: RentalApplication): TenantPassport {
  return {
    tenant_name: application.applicant_name,
    verified_payments: 0,
    on_time_payments: 0,
    on_time_pct: 0,
    late_payments: 0,
    verified_tenancies: 0,
    months_of_history: 0,
    average_rent: null,
    open_disputes: 0,
    reviews: [],
  };
}

const applicantOf = (a: RentalApplication): PassportSubject => ({
  userId: a.applicant_user_id,
  email: a.applicant_email,
});

/**
 * Attach listing context and — with the applicant's consent only — their
 * passport: the snapshot frozen at apply time (history at every landlord),
 * else whatever history the viewer can read live, else the declared figures.
 */
async function hydrateApplications(rows: ApplicationRow[]): Promise<ApplicationWithContext[]> {
  const items = rows.map((row) => {
    const application = toApplication(row);
    const snapshot = application.profile_shared
      ? passportFromJson((row as unknown as { passport_snapshot: unknown }).passport_snapshot)
      : null;
    return { row, application, snapshot };
  });
  const needLive = items.filter((i) => i.application.profile_shared && !i.snapshot);
  const live =
    needLive.length > 0
      ? await loadPassportRows(needLive.map((i) => applicantOf(i.application)))
      : EMPTY_PASSPORT_ROWS;

  return items
    .map(({ row, application, snapshot }) => ({
      ...application,
      listing: row.listing ? toListing(row.listing) : null,
      property_name: row.listing?.property?.name ?? "—",
      unit_name: row.listing?.unit?.name ?? "—",
      passport: application.profile_shared
        ? (snapshot ??
          passportFromRows(live, applicantOf(application)) ??
          syntheticPassport(application))
        : null,
    }))
    .sort(byCreatedDesc);
}

/** Applications received by an organization (operator view), newest first. */
export async function getApplications(orgId: UUID | null): Promise<ApplicationWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("rental_applications")
      .select(APPLICATION_SELECT)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  );
  return hydrateApplications(rows as unknown as ApplicationRow[]);
}

/** The signed-in applicant's own applications, newest first. */
export async function getMyApplications(input: {
  userId?: UUID | null;
  email?: string | null;
}): Promise<ApplicationWithContext[]> {
  const email = cleanEmail(input.email);
  const filters: string[] = [];
  if (input.userId) filters.push(`applicant_user_id.eq.${input.userId}`);
  if (email) filters.push(`applicant_email.eq.${email}`); // cleanEmail() rules out filter delimiters
  if (filters.length === 0) return [];
  const rows = unwrap(
    await db
      .from("rental_applications")
      .select(APPLICATION_SELECT)
      .or(filters.join(","))
      .order("created_at", { ascending: false }),
  );
  return hydrateApplications(rows as unknown as ApplicationRow[]);
}

/**
 * Submit an application as the signed-in user (RLS: applicants apply as
 * themselves, to a published listing). With `shareProfile` the database
 * freezes the applicant's passport into `passport_snapshot` at insert time.
 */
export async function applyToListing(input: {
  listingId: UUID;
  applicantUserId?: UUID | null;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string | null;
  monthlyIncome?: number | null;
  moveInDate?: string | null;
  note?: string | null;
  shareProfile: boolean;
  source?: LeadSource;
  utmSource?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  prefilledFromResume?: boolean;
  employer?: string | null;
  currentAddress?: string | null;
  references?: string | null;
}): Promise<RentalApplication> {
  const applicantId = input.applicantUserId ?? (await currentUserId());
  if (!applicantId) {
    throw new Error("Sign in or create a RentID account to submit an application.");
  }
  const listing = unwrapMaybe<{ id: string; organization_id: string; headline: string }>(
    await db
      .from("listings")
      .select("id, organization_id, headline")
      .eq("id", input.listingId)
      .maybeSingle(),
  );
  if (!listing) throw new Error("Listing not found.");

  // The trigger recomputes the snapshot server-side; sending ours documents intent
  // and keeps the payload identical when the platform writes the row instead.
  const snapshot = input.shareProfile
    ? await buildTenantPassport({ userId: applicantId, email: input.applicantEmail })
    : null;

  const payload = {
    listing_id: listing.id,
    organization_id: listing.organization_id, // re-derived from the listing by trigger
    applicant_user_id: applicantId,
    applicant_name: input.applicantName.trim(),
    applicant_email: input.applicantEmail.trim().toLowerCase(),
    applicant_phone: input.applicantPhone?.trim() || null,
    monthly_income: input.monthlyIncome ?? null,
    move_in_date: input.moveInDate ?? null,
    note: input.note?.trim() || null,
    status: "submitted",
    profile_shared: input.shareProfile,
    source: input.source ?? "rentid",
    utm_source: input.utmSource ?? null,
    utm_campaign: input.utmCampaign ?? null,
    referrer: input.referrer ?? null,
    prefilled_from_resume: input.prefilledFromResume ?? false,
    employer: input.employer?.trim() || null,
    current_address: input.currentAddress?.trim() || null,
    references_text: input.references?.trim() || null,
    passport_snapshot: snapshot,
  } as TablesInsert<"rental_applications">;

  const row = unwrapOne(
    await db.from("rental_applications").insert(payload).select("*").single(),
    "Application",
  );
  const application = toApplication(row);
  await logAudit({
    organization_id: application.organization_id,
    actor_role: "tenant",
    action: "application.submitted",
    entity_type: "rental_application",
    entity_id: application.id,
    metadata: { listing: listing.headline, profile_shared: input.shareProfile },
  });
  return application;
}

/** Operator decision (or the applicant's withdrawal); `decided_at` is trigger-owned. */
export async function updateApplicationStatus(
  applicationId: UUID,
  status: ApplicationStatus,
  actorId?: UUID | null,
): Promise<RentalApplication> {
  void actorId;
  const row = unwrapOne(
    await db
      .from("rental_applications")
      .update({ status })
      .eq("id", applicationId)
      .select("*")
      .single(),
    "Application",
  );
  const application = toApplication(row);
  await logAudit({
    organization_id: application.organization_id,
    action: `application.${status}`,
    entity_type: "rental_application",
    entity_id: application.id,
  });
  return application;
}
