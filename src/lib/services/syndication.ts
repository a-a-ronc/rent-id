/**
 * Listing distribution service — Supabase-backed (RLS-scoped).
 *
 * RentID holds the master listing. One `listing_channels` row per marketplace
 * carries the distribution state; every sync attempt is recorded through the
 * `record_listing_sync` RPC (the events table is platform-write only), which
 * also moves the channel row. External networks stay `pending_integration`
 * until RentID has an approved feed — the adapters never post anywhere, and
 * the RPC refuses a client-asserted "succeeded" for any network but RentID's.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { currentUserId, db, DbError, logAudit, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import { toListing, toListingChannel, toListingLead, toListingSyncEvent } from "@/lib/db/mappers";
import { MARKETPLACE_ADAPTERS, getAdapter } from "@/lib/syndication/adapters";
import type { Tables } from "@/integrations/supabase/types";
import type {
  ApplicationStatus,
  LeadSource,
  Listing,
  ListingChannel,
  ListingLead,
  ListingPipeline,
  ListingSyncEvent,
  MarketplaceId,
  SyncAction,
  UUID,
} from "@/lib/types";

/**
 * `record_listing_sync` was added by migration 20260915000720 and is not in
 * the generated `Database["public"]["Functions"]` yet (regenerate with
 * `bun run db:types`); until then the call goes through this untyped shim.
 */
const rpcUntyped = db.rpc.bind(db) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

const byCreatedDesc = <T extends { created_at: string }>(a: T, b: T) =>
  b.created_at.localeCompare(a.created_at);

/** Registry order: RentID first, then the partner networks. */
function adapterIndex(marketplaceId: string) {
  const index = MARKETPLACE_ADAPTERS.findIndex((m) => m.id === marketplaceId);
  return index === -1 ? MARKETPLACE_ADAPTERS.length : index;
}

export function sortChannels(channels: ListingChannel[]): ListingChannel[] {
  return [...channels].sort(
    (a, b) => adapterIndex(a.marketplace_id) - adapterIndex(b.marketplace_id),
  );
}

/** The master listing, as the operator sees it (drafts included). */
async function loadListing(listingId: UUID): Promise<Listing> {
  const row = unwrapOne(
    await db.from("listings").select("*").eq("id", listingId).single(),
    "Listing",
  );
  return toListing(row);
}

async function canOperateListing(listingId: UUID): Promise<boolean> {
  if (!(await currentUserId())) return false;
  return Boolean(unwrap(await db.rpc("can_operate_listing", { _listing_id: listingId })));
}

/* -------------------------------- channels -------------------------------- */

/**
 * Ensure a channel row exists for every registered marketplace and that its
 * connection state matches the adapter registry. Operator-only (RLS).
 */
export async function ensureChannels(listing: Listing): Promise<ListingChannel[]> {
  const existing = unwrap(
    await db.from("listing_channels").select("*").eq("listing_id", listing.id),
  );
  const missing = MARKETPLACE_ADAPTERS.filter(
    (adapter) => !existing.some((c) => c.marketplace_id === adapter.id),
  );
  if (missing.length > 0) {
    unwrap(
      await db.from("listing_channels").upsert(
        missing.map((adapter) => ({
          listing_id: listing.id,
          organization_id: listing.organization_id, // re-derived from the listing by trigger
          marketplace_id: adapter.id,
          enabled: false,
          connection_status: adapter.connection_status,
          listing_status: "not_published",
        })),
        { onConflict: "listing_id,marketplace_id", ignoreDuplicates: true },
      ),
    );
  }
  for (const channel of existing) {
    const adapter = getAdapter(channel.marketplace_id);
    if (adapter && adapter.connection_status !== channel.connection_status) {
      unwrap(
        await db
          .from("listing_channels")
          .update({ connection_status: adapter.connection_status })
          .eq("id", channel.id),
      );
    }
  }
  return channelsFor(listing.id);
}

/** Channel rows of one listing in registry order (published listings: readable by anyone). */
export async function channelsFor(listingId: UUID): Promise<ListingChannel[]> {
  const rows = unwrap(await db.from("listing_channels").select("*").eq("listing_id", listingId));
  return sortChannels(rows.map(toListingChannel));
}

/** Channel rows for many listings in one round-trip, keyed by listing id. */
export async function channelsForListings(
  listingIds: UUID[],
): Promise<Map<UUID, ListingChannel[]>> {
  const map = new Map<UUID, ListingChannel[]>();
  if (listingIds.length === 0) return map;
  const rows = unwrap(await db.from("listing_channels").select("*").in("listing_id", listingIds));
  for (const row of rows) {
    const channel = toListingChannel(row);
    map.set(channel.listing_id, [...(map.get(channel.listing_id) ?? []), channel]);
  }
  for (const [id, channels] of map) map.set(id, sortChannels(channels));
  return map;
}

/**
 * Run one adapter call and record the outcome. The RPC writes the sync event
 * and moves the channel row (live / pending_integration / removed / error).
 */
async function runSync(
  listing: Listing,
  channel: ListingChannel,
  action: SyncAction,
): Promise<void> {
  const adapter = getAdapter(channel.marketplace_id);
  if (!adapter) {
    unwrap(
      await db
        .from("listing_channels")
        .update({
          listing_status: "error",
          last_error: "No adapter registered for this marketplace.",
        })
        .eq("id", channel.id),
    );
    return;
  }
  const outcome = await adapter.sync(action, listing);
  unwrap(
    await rpcUntyped("record_listing_sync", {
      _listing_id: listing.id,
      _marketplace_id: channel.marketplace_id,
      _action: action,
      _result: outcome.result,
      _message: outcome.message,
      _external_listing_id: outcome.external_listing_id ?? null,
    }),
  );
}

/** Turn a channel on or off for a listing, then sync it. */
export async function setChannelEnabled(input: {
  listingId: UUID;
  marketplaceId: MarketplaceId;
  enabled: boolean;
  actorId?: UUID | null;
}): Promise<ListingChannel[]> {
  void input.actorId; // the audit trail uses the session user
  const listing = await loadListing(input.listingId);
  await ensureChannels(listing);
  const row = unwrapOne(
    await db
      .from("listing_channels")
      .update({ enabled: input.enabled })
      .eq("listing_id", listing.id)
      .eq("marketplace_id", input.marketplaceId)
      .select("*")
      .single(),
    "Channel",
  );
  const channel = toListingChannel(row);
  await runSync(listing, channel, input.enabled ? "create" : "remove");
  if (!input.enabled) {
    // switched off and taken down: the channel is simply not published there
    unwrap(
      await db
        .from("listing_channels")
        .update({ listing_status: "not_published" })
        .eq("id", channel.id)
        .eq("listing_status", "removed"),
    );
  }
  await logAudit({
    organization_id: listing.organization_id,
    action: input.enabled ? "listing.channel_enabled" : "listing.channel_disabled",
    entity_type: "listing",
    entity_id: listing.id,
    metadata: { marketplace: input.marketplaceId },
  });
  const channels = await channelsFor(listing.id);
  // legacy display field on the listing row follows the channel switches
  unwrap(
    await db
      .from("listings")
      .update({
        syndicated_to: channels
          .filter((c) => c.enabled)
          .map((c) => getAdapter(c.marketplace_id)?.name ?? c.marketplace_id),
      })
      .eq("id", listing.id),
  );
  return channels;
}

/** Re-send the master listing to one channel. */
export async function resyncChannel(input: {
  listingId: UUID;
  marketplaceId: MarketplaceId;
}): Promise<ListingChannel[]> {
  const listing = await loadListing(input.listingId);
  const row = unwrapOne(
    await db
      .from("listing_channels")
      .select("*")
      .eq("listing_id", listing.id)
      .eq("marketplace_id", input.marketplaceId)
      .single(),
    "Channel",
  );
  await runSync(listing, toListingChannel(row), "resync");
  return channelsFor(listing.id);
}

/**
 * Called whenever the master listing changes. Every enabled channel is queued
 * for an outbound update so the copies never drift from RentID.
 */
export async function propagateListingChange(
  listing: Listing,
  action: SyncAction = "update",
): Promise<void> {
  const channels = await ensureChannels(listing);
  for (const channel of channels) {
    if (!channel.enabled) continue;
    await runSync(listing, channel, action);
  }
}

/** Marked rented: prepare removal everywhere the listing is distributed. */
export async function withdrawEverywhere(listing: Listing): Promise<void> {
  await propagateListingChange(listing, "remove");
}

/** Channel states plus the last 25 sync events (operators see the history; others only channels). */
export async function getDistribution(listingId: UUID): Promise<{
  channels: ListingChannel[];
  events: ListingSyncEvent[];
}> {
  let channels: ListingChannel[];
  if (await canOperateListing(listingId)) {
    const row = unwrapMaybe<Tables<"listings">>(
      await db.from("listings").select("*").eq("id", listingId).maybeSingle(),
    );
    channels = row ? await ensureChannels(toListing(row)) : await channelsFor(listingId);
  } else {
    channels = await channelsFor(listingId);
  }
  const events = (await currentUserId())
    ? unwrap(
        await db
          .from("listing_sync_events")
          .select("*")
          .eq("listing_id", listingId)
          .order("created_at", { ascending: false })
          .limit(25),
      ).map(toListingSyncEvent)
    : [];
  return { channels, events };
}

/* --------------------------------- leads ---------------------------------- */

/**
 * Capture an enquiry with its source. Best-effort and authenticated-only: an
 * anonymous visitor (or a refused / rate-limited insert) yields `null` so the
 * public listing and apply pages never break over lead capture.
 *
 * Only operators may READ leads, so the insert cannot use RETURNING (Postgres
 * applies the select policy to it); the id is minted here instead.
 */
export async function recordLead(input: {
  listingId: UUID;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: LeadSource;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}): Promise<ListingLead | null> {
  try {
    if (!(await currentUserId())) return null;
    const listing = unwrapMaybe<{ id: string; organization_id: string }>(
      await db
        .from("listings")
        .select("id, organization_id")
        .eq("id", input.listingId)
        .maybeSingle(),
    );
    if (!listing) return null;
    const lead: ListingLead = {
      id: crypto.randomUUID(),
      listing_id: listing.id,
      organization_id: listing.organization_id, // re-derived from the listing by trigger
      name: input.name?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      message: input.message?.trim() || null,
      source: input.source ?? "rentid",
      utm_source: input.utmSource ?? null,
      utm_medium: input.utmMedium ?? null,
      utm_campaign: input.utmCampaign ?? null,
      referrer: input.referrer ?? null,
      application_id: null,
      created_at: new Date().toISOString(),
    };
    const { application_id: _applicationId, created_at: _createdAt, ...insert } = lead;
    unwrap(await db.from("listing_leads").insert(insert));
    return lead;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[leads] not recorded:", (error as Error).message);
    return null;
  }
}

/** A public listing-page view (published listings only; anonymous allowed). Fire-and-forget. */
export async function recordListingView(listingId: UUID): Promise<void> {
  const { error } = await db.rpc("increment_listing_view", { _listing_id: listingId });
  if (error && import.meta.env.DEV) console.warn("[listing] view not counted:", error.message);
}

/** Leads received by an organization, newest first (operators only — RLS). */
export async function getLeads(orgId: UUID | null): Promise<ListingLead[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("listing_leads")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  );
  return rows.map(toListingLead).sort(byCreatedDesc);
}

/** Pure funnel arithmetic shared by buildPipeline() and the listing read models. */
export function computePipeline(
  listingId: UUID,
  views: number,
  leads: number,
  applicationStatuses: ApplicationStatus[],
): ListingPipeline {
  return {
    listing_id: listingId,
    views,
    leads,
    started: applicationStatuses.length,
    completed: applicationStatuses.filter((s) => s !== "started" && s !== "new").length,
    qualified: applicationStatuses.filter((s) =>
      ["qualified", "approved", "lease_sent", "lease_signed"].includes(s),
    ).length,
    approved: applicationStatuses.filter((s) =>
      ["approved", "lease_sent", "lease_signed"].includes(s),
    ).length,
  };
}

/** Applicant funnel per listing. Leads and applications are only visible to operators. */
export async function buildPipeline(listingId: UUID): Promise<ListingPipeline> {
  const listing = unwrapMaybe<{ view_count: number }>(
    await db.from("listings").select("view_count").eq("id", listingId).maybeSingle(),
  );
  if (!(await currentUserId())) return computePipeline(listingId, listing?.view_count ?? 0, 0, []);
  const [leadsRes, appsRes] = await Promise.all([
    db
      .from("listing_leads")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", listingId),
    db.from("rental_applications").select("status").eq("listing_id", listingId),
  ]);
  if (leadsRes.error) throw new DbError(leadsRes.error);
  const statuses = unwrap(appsRes).map((a) => a.status);
  return computePipeline(listingId, listing?.view_count ?? 0, leadsRes.count ?? 0, statuses);
}

/** Which channels are producing leads and signed tenants. */
export async function getSourceBreakdown(
  orgId: UUID | null,
  listingIds?: UUID[],
): Promise<{ source: LeadSource; leads: number; applications: number; signed: number }[]> {
  if (!orgId) return [];
  // A property manager's desk covers listings across owner organizations, so an
  // explicit listing set takes precedence over the organization filter.
  const ids = listingIds && listingIds.length > 0 ? listingIds : null;
  let leadsQuery = db.from("listing_leads").select("source");
  let appsQuery = db.from("rental_applications").select("source, status");
  if (ids) {
    leadsQuery = leadsQuery.in("listing_id", ids);
    appsQuery = appsQuery.in("listing_id", ids);
  } else {
    leadsQuery = leadsQuery.eq("organization_id", orgId);
    appsQuery = appsQuery.eq("organization_id", orgId);
  }
  const [leadsRes, appsRes] = await Promise.all([leadsQuery, appsQuery]);
  const leads = unwrap(leadsRes);
  const apps = unwrap(appsRes);

  const sources = new Map<LeadSource, { leads: number; applications: number; signed: number }>();
  const bump = (source: string, key: "leads" | "applications" | "signed") => {
    const id = (source || "rentid") as LeadSource;
    const row = sources.get(id) ?? { leads: 0, applications: 0, signed: 0 };
    row[key] += 1;
    sources.set(id, row);
  };
  leads.forEach((l) => bump(l.source, "leads"));
  apps.forEach((a) => {
    bump(a.source, "applications");
    if (a.status === "lease_signed") bump(a.source, "signed");
  });
  return [...sources.entries()]
    .map(([source, counts]) => ({ source, ...counts }))
    .sort((a, b) => b.leads - a.leads);
}
