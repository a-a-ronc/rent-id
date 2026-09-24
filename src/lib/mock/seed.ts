/**
 * Centralized demo portfolio.
 *
 * Every number the UI shows comes from here — no component hardcodes records.
 * Deliberately tuned so the landlord dashboard reads:
 *   rent collected $18,450 · outstanding $2,100 · 17/19 occupied
 *   2 late payments · 3 open maintenance · 2 leases expiring soon
 */
import type { MockDatabase } from "@/lib/mock/db";
import type {
  Document,
  Lease,
  Listing,
  ListingChannel,
  ListingLead,
  ListingSyncEvent,
  MaintenanceRequest,
  ManagementAssignment,
  OwnerAccount,
  Payment,
  RentalApplication,
  Tenancy,
  Unit,
} from "@/lib/types";
import { seedStudentHousing } from "@/lib/mock/student-seed";
import { normalizeAddress } from "@/lib/verification/address";
import { seedVerification } from "@/lib/mock/verification-seed";

const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = {
  landlord: { email: "landlord@rentid.demo", password: DEMO_PASSWORD },
  tenant: { email: "tenant@rentid.demo", password: DEMO_PASSWORD },
  manager: { email: "manager@rentid.demo", password: DEMO_PASSWORD },
  student: { email: "student@rentid.demo", password: DEMO_PASSWORD },
  admin: { email: "admin@rentid.demo", password: DEMO_PASSWORD },
};

const LANDLORD_ID = "8f1c7a10-0000-4000-8000-000000000001";
const TENANT_ID = "8f1c7a10-0000-4000-8000-000000000002";
const MANAGER_ID = "8f1c7a10-0000-4000-8000-000000000003";
const STUDENT_ID = "8f1c7a10-0000-4000-8000-000000000004";
const ADMIN_ID = "8f1c7a10-0000-4000-8000-000000000005";
const ORG_ID = "8f1c7a10-1000-4000-8000-000000000001";
const PM_ORG_ID = "8f1c7a10-1000-4000-8000-000000000002";

function id(prefix: string, n: number) {
  return `8f1c7a10-${prefix}-4000-8000-${String(n).padStart(12, "0")}`;
}

function iso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}

function dateOnly(daysFromNow: number) {
  return iso(daysFromNow).slice(0, 10);
}

function monthDay(day: number, monthOffset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

function periodLabel(monthOffset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const PROPERTIES = [
  {
    name: "Beacon Row",
    property_type: "multi_family" as const,
    street_address: "412 Beacon Street",
    city: "Ferndale",
    state: "MI",
    zip: "48220",
    year_built: 1996,
    unitCount: 6,
    county: "Oakland",
    parcel_number: "25-24-101-004",
  },
  {
    name: "Cedar & Vine",
    property_type: "apartment" as const,
    street_address: "88 Cedar Avenue",
    city: "Royal Oak",
    state: "MI",
    zip: "48067",
    year_built: 2004,
    unitCount: 5,
    county: "Oakland",
    parcel_number: "25-12-330-018",
  },
  {
    name: "Harbor Lofts",
    property_type: "condo" as const,
    street_address: "1220 Harbor Way",
    city: "Detroit",
    state: "MI",
    zip: "48207",
    year_built: 2015,
    unitCount: 5,
    county: "Wayne",
    parcel_number: "13-002456.001",
  },
  {
    name: "Maple Court",
    property_type: "townhouse" as const,
    street_address: "27 Maple Court",
    city: "Berkley",
    state: "MI",
    zip: "48072",
    year_built: 1988,
    unitCount: 3,
    county: "Oakland",
    parcel_number: "18-07-215-009",
  },
];

/** 15 on-time rents summing to $18,450 + 2 late rents summing to $2,100. */
const PAID_RENTS = [
  1100, 1150, 1200, 1250, 1300, 1350, 1400, 1250, 1200, 1150, 1300, 1250, 1200, 1150, 1200,
];
const LATE_RENTS = [1050, 1050];

const TENANT_NAMES = [
  "Jordan Rivera",
  "Priya Raman",
  "Marcus Bell",
  "Elena Duarte",
  "Tobias Lund",
  "Nina Okafor",
  "Grace Chen",
  "Diego Santos",
  "Hannah Weiss",
  "Omar Haddad",
  "Sofia Marchetti",
  "Leo Nakamura",
  "Amara Boyd",
  "Ruth Kessler",
  "Caleb Fontaine",
  "Mira Solvang",
  "Victor Alvarez",
];

export function seedDatabase(): MockDatabase {
  const created = iso(-420);

  const units: Unit[] = [];
  const properties: MockDatabase["properties"] = [];
  let unitIndex = 0;

  PROPERTIES.forEach((p, pi) => {
    const propertyId = id("2000", pi + 1);
    properties.push({
      id: propertyId,
      organization_id: ORG_ID,
      name: p.name,
      property_type: p.property_type,
      management_category: "standard_residential",
      street_address: p.street_address,
      unit_label: null,
      city: p.city,
      state: p.state,
      zip: p.zip,
      year_built: p.year_built,
      notes: null,
      normalized_address: normalizeAddress(p),
      county: p.county,
      parcel_number: p.parcel_number,
      recording_jurisdiction: `${p.county} County Register of Deeds`,
      legal_description: null,
      created_at: created,
      updated_at: created,
      deleted_at: null,
    });

    for (let u = 0; u < p.unitCount; u += 1) {
      unitIndex += 1;
      const rents = [...PAID_RENTS, ...LATE_RENTS];
      const rent = rents[unitIndex - 1] ?? 1225;
      units.push({
        id: id("3000", unitIndex),
        organization_id: ORG_ID,
        property_id: propertyId,
        name: `Unit ${String.fromCharCode(65 + u)}${pi + 1}`,
        bedrooms: (unitIndex % 3) + 1,
        bathrooms: unitIndex % 2 === 0 ? 2 : 1,
        square_feet: 640 + (unitIndex % 5) * 120,
        monthly_rent: rent,
        security_deposit: rent,
        rent_due_day: 1,
        // last two units stay vacant → 17 / 19 occupied
        occupancy_status: unitIndex > 17 ? "vacant" : "occupied",
        created_at: created,
        updated_at: created,
        deleted_at: null,
      });
    }
  });

  const occupied = units.filter((u) => u.occupancy_status === "occupied");

  const tenancies: Tenancy[] = occupied.map((unit, i) => {
    const startOffset = -400 + i * 12;
    // two leases expire inside the next 45 days
    const endOffset = i === 0 ? 28 : i === 1 ? 41 : 120 + i * 15;
    return {
      id: id("4000", i + 1),
      organization_id: ORG_ID,
      property_id: unit.property_id,
      unit_id: unit.id,
      tenant_user_id: i === 0 ? TENANT_ID : null,
      tenant_name: TENANT_NAMES[i] ?? `Tenant ${i + 1}`,
      tenant_email:
        i === 0
          ? DEMO_ACCOUNTS.tenant.email
          : `${(TENANT_NAMES[i] ?? "tenant").split(" ")[0]!.toLowerCase()}@example.com`,
      tenant_phone: `(313) 555-0${String(100 + i).slice(-3)}`,
      status: "active",
      verified: true,
      verified_at: iso(startOffset + 1),
      start_date: dateOnly(startOffset),
      end_date: dateOnly(endOffset),
      monthly_rent: unit.monthly_rent,
      security_deposit: unit.security_deposit,
      created_at: iso(startOffset),
      updated_at: iso(startOffset),
      deleted_at: null,
    };
  });

  const documents: Document[] = [];
  const leases: Lease[] = tenancies.map((t, i) => {
    const docId = id("6000", i + 1);
    documents.push({
      id: docId,
      organization_id: ORG_ID,
      property_id: t.property_id,
      unit_id: t.unit_id,
      tenancy_id: t.id,
      kind: "lease",
      title: `${t.tenant_name} — signed lease.pdf`,
      storage_path: `${ORG_ID}/${t.id}/lease-${i + 1}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 184_320 + i * 2048,
      visible_to_tenant: true,
      uploaded_by: LANDLORD_ID,
      created_at: t.created_at,
      updated_at: t.created_at,
      deleted_at: null,
    });
    const daysLeft = Math.round(
      (new Date(`${t.end_date}T00:00:00`).getTime() - Date.now()) / 86_400_000,
    );
    return {
      id: id("5000", i + 1),
      organization_id: ORG_ID,
      tenancy_id: t.id,
      unit_id: t.unit_id,
      status: daysLeft <= 60 ? "expiring" : "active",
      start_date: t.start_date!,
      end_date: t.end_date!,
      monthly_rent: t.monthly_rent ?? 0,
      security_deposit: t.security_deposit,
      rent_due_day: 1,
      late_fee: 75,
      document_id: docId,
      signed_at: t.created_at,
      created_at: t.created_at,
      updated_at: t.created_at,
      deleted_at: null,
    };
  });

  documents.push(
    {
      id: id("6100", 1),
      organization_id: ORG_ID,
      property_id: properties[0]!.id,
      unit_id: null,
      tenancy_id: null,
      kind: "inspection",
      title: "Beacon Row — annual inspection report.pdf",
      storage_path: `${ORG_ID}/inspections/beacon-row.pdf`,
      mime_type: "application/pdf",
      size_bytes: 96_400,
      visible_to_tenant: false,
      uploaded_by: LANDLORD_ID,
      created_at: iso(-52),
      updated_at: iso(-52),
      deleted_at: null,
    },
    {
      id: id("6100", 2),
      organization_id: ORG_ID,
      property_id: tenancies[0]!.property_id,
      unit_id: tenancies[0]!.unit_id,
      tenancy_id: tenancies[0]!.id,
      kind: "receipt",
      title: "Security deposit receipt.pdf",
      storage_path: `${ORG_ID}/${tenancies[0]!.id}/deposit-receipt.pdf`,
      mime_type: "application/pdf",
      size_bytes: 42_100,
      visible_to_tenant: true,
      uploaded_by: LANDLORD_ID,
      created_at: iso(-380),
      updated_at: iso(-380),
      deleted_at: null,
    },
  );

  // ---- payments -------------------------------------------------------
  const payments: Payment[] = [];
  let paymentSeq = 0;

  // current month
  tenancies.forEach((t, i) => {
    paymentSeq += 1;
    const late = i >= 15;
    payments.push({
      id: id("7000", paymentSeq),
      organization_id: ORG_ID,
      tenancy_id: t.id,
      amount: t.monthly_rent ?? 0,
      status: late ? "late" : "paid",
      method: late ? "manual" : i % 3 === 0 ? "ach" : "card",
      due_date: monthDay(1),
      paid_at: late ? null : iso(-((i % 6) + 1)),
      period_label: periodLabel(),
      verified: !late,
      verification_source: !late ? "platform_settled" : "unverified",
      memo: late ? "Reminder sent, partial arrangement pending" : null,
      created_at: monthDay(1),
      updated_at: iso(-1),
    });
  });

  // next month (upcoming)
  tenancies.forEach((t) => {
    paymentSeq += 1;
    payments.push({
      id: id("7000", paymentSeq),
      organization_id: ORG_ID,
      tenancy_id: t.id,
      amount: t.monthly_rent ?? 0,
      status: "scheduled",
      method: "ach",
      due_date: monthDay(1, 1),
      paid_at: null,
      period_label: periodLabel(1),
      verified: false,
      verification_source: "unverified",
      memo: null,
      created_at: iso(-2),
      updated_at: iso(-2),
    });
  });

  // trailing history (three prior months, all settled)
  for (let m = 1; m <= 3; m += 1) {
    tenancies.forEach((t) => {
      paymentSeq += 1;
      payments.push({
        id: id("7000", paymentSeq),
        organization_id: ORG_ID,
        tenancy_id: t.id,
        amount: t.monthly_rent ?? 0,
        status: "paid",
        method: "ach",
        due_date: monthDay(1, -m),
        paid_at: `${monthDay(2, -m)}T14:05:00.000Z`,
        period_label: periodLabel(-m),
        verified: true,
        verification_source: "platform_settled",
        memo: null,
        created_at: monthDay(1, -m),
        updated_at: monthDay(2, -m),
      });
    });
  }

  const maintenance: MaintenanceRequest[] = [
    {
      id: id("8000", 1),
      organization_id: ORG_ID,
      property_id: tenancies[0]!.property_id,
      unit_id: tenancies[0]!.unit_id,
      tenancy_id: tenancies[0]!.id,
      title: "Kitchen faucet dripping",
      description: "Steady drip from the cold tap, worse overnight.",
      status: "open",
      priority: "normal",
      created_by: TENANT_ID,
      completed_at: null,
      created_at: iso(-2),
      updated_at: iso(-2),
    },
    {
      id: id("8000", 2),
      organization_id: ORG_ID,
      property_id: tenancies[3]!.property_id,
      unit_id: tenancies[3]!.unit_id,
      tenancy_id: tenancies[3]!.id,
      title: "Hallway light fixture flickering",
      description: "Flickers when the heat kicks on.",
      status: "acknowledged",
      priority: "low",
      created_by: null,
      completed_at: null,
      created_at: iso(-5),
      updated_at: iso(-4),
    },
    {
      id: id("8000", 3),
      organization_id: ORG_ID,
      property_id: tenancies[8]!.property_id,
      unit_id: tenancies[8]!.unit_id,
      tenancy_id: tenancies[8]!.id,
      title: "Furnace not holding temperature",
      description: "Unit drops to 61°F overnight. Tenant has a newborn.",
      status: "in_progress",
      priority: "high",
      created_by: null,
      completed_at: null,
      created_at: iso(-8),
      updated_at: iso(-1),
    },
    {
      id: id("8000", 4),
      organization_id: ORG_ID,
      property_id: tenancies[5]!.property_id,
      unit_id: tenancies[5]!.unit_id,
      tenancy_id: tenancies[5]!.id,
      title: "Garbage disposal jammed",
      description: null,
      status: "completed",
      priority: "normal",
      created_by: null,
      completed_at: iso(-12),
      created_at: iso(-18),
      updated_at: iso(-12),
    },
  ];

  const conversationId = id("9000", 1);
  const conversation2 = id("9000", 2);

  // ---- marketplace listings + applications ----------------------------
  // A RentID listing is the master record; channels below are copies RentID
  // keeps in sync once a marketplace partnership is approved.
  const vacant = units.filter((u) => u.occupancy_status === "vacant");
  const listingSpecs: {
    unit: Unit;
    ref: string;
    status: Listing["status"];
    headline: string;
    description: string;
    amenities: string[];
    utilities: string[];
    syndicated: string[];
    availableIn: number;
    pets: string;
    parking: string;
    agent: string;
    views: number;
  }[] = [
    {
      unit: vacant[0] ?? units[17]!,
      ref: "10241",
      status: "published",
      headline: `Renovated ${(vacant[0] ?? units[17]!).bedrooms ?? 2}-bed with in-unit laundry`,
      description:
        "Bright corner unit with new appliances, in-unit laundry and off-street parking. Heat and water included.",
      amenities: ["In-unit laundry", "Off-street parking", "Dishwasher", "Heat included"],
      utilities: ["Heat", "Water", "Trash"],
      syndicated: ["RentID", "Zillow Network"],
      availableIn: 14,
      pets: "Cats and dogs under 40 lbs. $25/month pet rent, no breed restrictions.",
      parking: "One off-street space included, second space $50/month.",
      agent: "Avery Whitfield",
      views: 212,
    },
    {
      unit: vacant[1] ?? units[18]!,
      ref: "10242",
      status: "published",
      headline: "Top-floor loft near downtown",
      description:
        "Exposed brick, large windows and a secure entry. Walking distance to transit and the riverfront.",
      amenities: ["Secure entry", "Central air", "Pet friendly", "Bike storage"],
      utilities: ["Water", "Trash"],
      syndicated: ["RentID"],
      availableIn: 30,
      pets: "Pet friendly, 2 pet maximum. $300 refundable pet deposit.",
      parking: "Street permit parking; garage available nearby for $95/month.",
      agent: "Jordan Reyes",
      views: 96,
    },
    {
      unit: units[0]!,
      ref: "10243",
      status: "draft",
      headline: "Garden-level 1-bed, available at lease end",
      description: "Pre-listing draft while the current lease is being renewed.",
      amenities: ["Shared yard", "Laundry on site"],
      utilities: ["Water"],
      syndicated: [],
      availableIn: 45,
      pets: "No pets.",
      parking: "Street parking.",
      agent: "Avery Whitfield",
      views: 0,
    },
  ];

  const listings: Listing[] = listingSpecs.map((spec, i) => {
    const property = properties.find((p) => p.id === spec.unit.property_id) ?? null;
    return {
      id: id("a000", i + 1),
      public_ref: spec.ref,
      organization_id: ORG_ID,
      property_id: spec.unit.property_id,
      unit_id: spec.unit.id,
      status: spec.status,
      headline: spec.headline,
      description: spec.description,
      monthly_rent: spec.unit.monthly_rent ?? 1250,
      security_deposit: spec.unit.security_deposit ?? spec.unit.monthly_rent ?? 1250,
      available_on: dateOnly(spec.availableIn),
      lease_term_months: 12,
      amenities: spec.amenities,
      screening_criteria:
        "Verified RentID profile, income 3x rent, no unresolved move-out balance in the last 24 months.",
      syndicated_to: spec.syndicated,
      published_at: spec.status === "published" ? iso(-9 + i) : null,
      created_at: iso(-12 + i),
      updated_at: iso(-2),
      deleted_at: null,
      property_type: property?.property_type ?? "apartment",
      street_address: property
        ? `${property.street_address}, ${property.city}, ${property.state} ${property.zip}`
        : null,
      bedrooms: spec.unit.bedrooms ?? 2,
      bathrooms: spec.unit.bathrooms ?? 1,
      square_feet: spec.unit.square_feet ?? 850,
      photos: [],
      utilities_included: spec.utilities,
      pet_policy: spec.pets,
      parking: spec.parking,
      application_requirements: [
        "Government photo ID",
        "Two most recent pay stubs or offer letter",
        "RentID rental resume or two prior landlord references",
      ],
      income_requirement: "Household income of at least 3x the monthly rent.",
      credit_requirement: "No minimum score; verified on-time rent history is weighted first.",
      occupancy_limit: (spec.unit.bedrooms ?? 2) * 2,
      move_in_fees: "First month plus security deposit. No administrative fee.",
      application_fee: 40,
      contact_name: spec.agent,
      contact_email: DEMO_ACCOUNTS.landlord.email,
      contact_phone: "(313) 555-0142",
      showing_instructions:
        "Self-guided tours Monday to Saturday, 9am-6pm. Confirm through RentID messages first.",
      assigned_to: spec.agent,
      view_count: spec.views,
    };
  });

  // Distribution channels. RentID is live; partner feeds stay pending until the
  // partnership is approved — nothing is ever posted externally today.
  const CHANNEL_PLAN: {
    listingIndex: number;
    marketplace: string;
    enabled: boolean;
    connection: ListingChannel["connection_status"];
    listing_status: ListingChannel["listing_status"];
    external: string | null;
    error: string | null;
    syncedDaysAgo: number | null;
  }[] = [
    {
      listingIndex: 0,
      marketplace: "rentid",
      enabled: true,
      connection: "connected",
      listing_status: "live",
      external: "10241",
      error: null,
      syncedDaysAgo: -2,
    },
    {
      listingIndex: 0,
      marketplace: "zillow",
      enabled: true,
      connection: "integration_pending",
      listing_status: "pending_integration",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 0,
      marketplace: "apartments_com",
      enabled: false,
      connection: "integration_pending",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 1,
      marketplace: "rentid",
      enabled: true,
      connection: "connected",
      listing_status: "live",
      external: "10242",
      error: null,
      syncedDaysAgo: -3,
    },
    {
      listingIndex: 1,
      marketplace: "zillow",
      enabled: false,
      connection: "integration_pending",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 1,
      marketplace: "apartments_com",
      enabled: false,
      connection: "integration_pending",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 2,
      marketplace: "rentid",
      enabled: false,
      connection: "connected",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 2,
      marketplace: "zillow",
      enabled: false,
      connection: "integration_pending",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
    {
      listingIndex: 2,
      marketplace: "apartments_com",
      enabled: false,
      connection: "integration_pending",
      listing_status: "not_published",
      external: null,
      error: null,
      syncedDaysAgo: null,
    },
  ];

  const listingChannels: ListingChannel[] = CHANNEL_PLAN.map((c, i) => ({
    id: id("a200", i + 1),
    listing_id: listings[c.listingIndex]!.id,
    organization_id: ORG_ID,
    marketplace_id: c.marketplace,
    enabled: c.enabled,
    connection_status: c.connection,
    listing_status: c.listing_status,
    external_listing_id: c.external,
    last_synced_at: c.syncedDaysAgo === null ? null : iso(c.syncedDaysAgo),
    last_error: c.error,
    created_at: iso(-12),
    updated_at: iso(-2),
  }));

  const listingSyncEvents: ListingSyncEvent[] = [
    {
      id: id("a300", 1),
      listing_id: listings[0]!.id,
      marketplace_id: "rentid",
      action: "create",
      result: "succeeded",
      message: "Published on the RentID marketplace.",
      created_at: iso(-9),
    },
    {
      id: id("a300", 2),
      listing_id: listings[0]!.id,
      marketplace_id: "zillow",
      action: "create",
      result: "pending_integration",
      message:
        "Zillow Network: create held in the outbound queue - awaiting partner approval of the RentID feed. Nothing was posted.",
      created_at: iso(-9),
    },
    {
      id: id("a300", 3),
      listing_id: listings[0]!.id,
      marketplace_id: "rentid",
      action: "update",
      result: "succeeded",
      message: "RentID listing updated (rent and availability).",
      created_at: iso(-2),
    },
    {
      id: id("a300", 4),
      listing_id: listings[1]!.id,
      marketplace_id: "rentid",
      action: "create",
      result: "succeeded",
      message: "Published on the RentID marketplace.",
      created_at: iso(-8),
    },
  ];

  const LEAD_PLAN: {
    listingIndex: number;
    name: string;
    source: ListingLead["source"];
    daysAgo: number;
  }[] = [
    { listingIndex: 0, name: "Alicia Diaz", source: "rentid", daysAgo: 4 },
    { listingIndex: 0, name: "Marcus Webb", source: "zillow", daysAgo: 2 },
    { listingIndex: 0, name: "Tessa Moore", source: "zillow", daysAgo: 2 },
    { listingIndex: 0, name: "Ray Colton", source: "qr_code", daysAgo: 5 },
    { listingIndex: 0, name: "Devon Hart", source: "direct_link", daysAgo: 6 },
    { listingIndex: 1, name: "Nia Fletcher", source: "rentid", daysAgo: 9 },
    { listingIndex: 1, name: "Owen Petrov", source: "apartments_com", daysAgo: 11 },
    { listingIndex: 1, name: "Sasha Kim", source: "facebook", daysAgo: 1 },
  ];

  const listingLeads: ListingLead[] = LEAD_PLAN.map((l, i) => ({
    id: id("a400", i + 1),
    listing_id: listings[l.listingIndex]!.id,
    organization_id: ORG_ID,
    name: l.name,
    email: `${l.name.split(" ")[0]!.toLowerCase()}@example.com`,
    phone: null,
    message: null,
    source: l.source,
    utm_source: l.source === "rentid" ? null : l.source,
    utm_medium: l.source === "qr_code" ? "print" : l.source === "rentid" ? null : "listing",
    utm_campaign: null,
    referrer: null,
    application_id: null,
    created_at: iso(-l.daysAgo),
  }));

  const APPLICANTS: {
    name: string;
    email: string;
    income: number;
    status: RentalApplication["status"];
    listingIndex: number;
    note: string | null;
    shared: boolean;
    daysAgo: number;
  }[] = [
    {
      name: "Alicia Diaz",
      email: "alicia.diaz@example.com",
      income: 5400,
      status: "in_review",
      listingIndex: 0,
      note: "Relocating for work in October. Two verified tenancies, no damage events.",
      shared: true,
      daysAgo: 3,
    },
    {
      name: "Marcus Webb",
      email: "marcus.webb@example.com",
      income: 4100,
      status: "new",
      listingIndex: 0,
      note: "Current lease ends next month.",
      shared: true,
      daysAgo: 1,
    },
    {
      name: "Nia Fletcher",
      email: "nia.fletcher@example.com",
      income: 6250,
      status: "approved",
      listingIndex: 1,
      note: "Approved — lease packet sent.",
      shared: true,
      daysAgo: 8,
    },
    {
      name: "Owen Petrov",
      email: "owen.petrov@example.com",
      income: 2800,
      status: "denied",
      listingIndex: 1,
      note: "Income below 3× rent threshold.",
      shared: true,
      daysAgo: 10,
    },
    {
      name: "Sasha Kim",
      email: "sasha.kim@example.com",
      income: 4800,
      status: "new",
      listingIndex: 1,
      note: null,
      shared: false,
      daysAgo: 1,
    },
  ];

  const applications: RentalApplication[] = APPLICANTS.map((a, i) => ({
    id: id("a100", i + 1),
    listing_id: listings[a.listingIndex]!.id,
    organization_id: ORG_ID,
    applicant_user_id: null,
    applicant_name: a.name,
    applicant_email: a.email,
    applicant_phone: `(313) 555-1${String(100 + i).slice(-3)}`,
    monthly_income: a.income,
    move_in_date: dateOnly(21 + i * 5),
    note: a.note,
    status: a.status,
    profile_shared: a.shared,
    source: (["rentid", "zillow", "rentid", "apartments_com", "facebook"] as const)[i] ?? "rentid",
    utm_source: null,
    utm_campaign: null,
    referrer: null,
    prefilled_from_resume: a.shared,
    employer: a.shared ? "Declared on the RentID resume" : null,
    current_address: null,
    references: null,
    decided_at: a.status === "approved" || a.status === "denied" ? iso(-a.daysAgo + 2) : null,
    created_at: iso(-a.daysAgo),
    updated_at: iso(-a.daysAgo + 1),
  }));

  // ---- property-management owners + authority --------------------------
  const OWNERS = [
    {
      name: "Whitfield Holdings LLC",
      contact: "Avery Whitfield",
      email: DEMO_ACCOUNTS.landlord.email,
      fee: 8,
      propertyIndexes: [0, 1],
    },
    {
      name: "Northline Trust",
      contact: "Rosa Lindqvist",
      email: "rosa@northlinetrust.example.com",
      fee: 7.5,
      propertyIndexes: [2],
    },
    {
      name: "Ada Family Trust",
      contact: "Ben Ade",
      email: "ben@adafamily.example.com",
      fee: 9,
      propertyIndexes: [3],
    },
  ];

  const ownerAccounts: OwnerAccount[] = OWNERS.map((o, i) => ({
    id: id("a200", i + 1),
    organization_id: PM_ORG_ID,
    name: o.name,
    contact_name: o.contact,
    contact_email: o.email,
    contract_start: dateOnly(-360 + i * 40),
    management_fee_pct: o.fee,
    created_at: iso(-360 + i * 40),
    updated_at: iso(-30),
  }));

  const managementAssignments: ManagementAssignment[] = [];
  OWNERS.forEach((o, ownerIndex) => {
    o.propertyIndexes.forEach((pi) => {
      const property = properties[pi];
      if (!property) return;
      managementAssignments.push({
        id: id("a300", managementAssignments.length + 1),
        organization_id: PM_ORG_ID,
        owner_account_id: ownerAccounts[ownerIndex]!.id,
        property_id: property.id,
        authority_status: "verified",
        authorized_at: iso(-350 + ownerIndex * 40),
        revoked_at: null,
        created_at: iso(-350 + ownerIndex * 40),
      });
    });
  });

  // Student-housing vertical lives in its own module so the standard
  // residential demo metrics above stay exactly as tuned.
  const student = seedStudentHousing({
    pmOrgId: PM_ORG_ID,
    managerId: MANAGER_ID,
    residentUserId: STUDENT_ID,
  });
  properties.push(...student.properties);
  units.push(...student.units);
  ownerAccounts.push(...student.owner_accounts);
  managementAssignments.push(...student.management_assignments);

  return {
    users: [
      {
        id: LANDLORD_ID,
        email: DEMO_ACCOUNTS.landlord.email,
        created_at: created,
        last_sign_in_at: iso(-1),
      },
      {
        id: TENANT_ID,
        email: DEMO_ACCOUNTS.tenant.email,
        created_at: created,
        last_sign_in_at: iso(-1),
      },
      { id: MANAGER_ID, email: "manager@rentid.demo", created_at: created, last_sign_in_at: null },
      {
        id: STUDENT_ID,
        email: DEMO_ACCOUNTS.student.email,
        created_at: created,
        last_sign_in_at: iso(-1),
      },
      {
        id: ADMIN_ID,
        email: DEMO_ACCOUNTS.admin.email,
        created_at: created,
        last_sign_in_at: iso(-1),
      },
    ],
    credentials: [
      { user_id: LANDLORD_ID, email: DEMO_ACCOUNTS.landlord.email, password: DEMO_PASSWORD },
      { user_id: TENANT_ID, email: DEMO_ACCOUNTS.tenant.email, password: DEMO_PASSWORD },
      { user_id: MANAGER_ID, email: "manager@rentid.demo", password: DEMO_PASSWORD },
      { user_id: STUDENT_ID, email: DEMO_ACCOUNTS.student.email, password: DEMO_PASSWORD },
      { user_id: ADMIN_ID, email: DEMO_ACCOUNTS.admin.email, password: DEMO_PASSWORD },
    ],
    profiles: [
      {
        id: LANDLORD_ID,
        full_name: "Avery Whitfield",
        email: DEMO_ACCOUNTS.landlord.email,
        phone: "(313) 555-0142",
        avatar_url: null,
        onboarded: true,
        created_at: created,
        updated_at: created,
      },
      {
        id: TENANT_ID,
        full_name: "Jordan Rivera",
        email: DEMO_ACCOUNTS.tenant.email,
        phone: "(313) 555-0100",
        avatar_url: null,
        onboarded: true,
        created_at: created,
        updated_at: created,
      },
      {
        id: MANAGER_ID,
        full_name: "Dana Cole",
        email: "manager@rentid.demo",
        phone: null,
        avatar_url: null,
        onboarded: true,
        created_at: created,
        updated_at: created,
      },
      {
        id: ADMIN_ID,
        full_name: "RentID Administrator",
        email: DEMO_ACCOUNTS.admin.email,
        phone: null,
        avatar_url: null,
        onboarded: true,
        created_at: created,
        updated_at: created,
      },
      {
        id: STUDENT_ID,
        full_name: "Alex Morgan",
        email: DEMO_ACCOUNTS.student.email,
        phone: "(734) 555-0188",
        avatar_url: null,
        onboarded: true,
        created_at: created,
        updated_at: created,
      },
    ],
    user_roles: [
      { id: id("1100", 1), user_id: LANDLORD_ID, role: "landlord", created_at: created },
      { id: id("1100", 2), user_id: TENANT_ID, role: "tenant", created_at: created },
      { id: id("1100", 3), user_id: MANAGER_ID, role: "property_manager", created_at: created },
      { id: id("1100", 4), user_id: STUDENT_ID, role: "tenant", created_at: created },
      { id: id("1100", 5), user_id: ADMIN_ID, role: "admin", created_at: created },
    ],
    organizations: [
      {
        id: ORG_ID,
        name: "Whitfield Property Group",
        legal_entity_name: "Whitfield Holdings LLC",
        owner_id: LANDLORD_ID,
        kind: "landlord",
        verification_status: "verified",
        is_demo: true,
        created_at: created,
        updated_at: created,
        deleted_at: null,
      },
      {
        id: PM_ORG_ID,
        name: "Lucas Property Management",
        legal_entity_name: "Lucas PM LLC",
        owner_id: MANAGER_ID,
        kind: "property_manager",
        verification_status: "verified",
        is_demo: true,
        created_at: created,
        updated_at: created,
        deleted_at: null,
      },
    ],
    organization_members: [
      {
        id: id("1200", 1),
        organization_id: ORG_ID,
        user_id: LANDLORD_ID,
        role: "landlord",
        created_at: created,
      },
      {
        id: id("1200", 2),
        organization_id: PM_ORG_ID,
        user_id: MANAGER_ID,
        role: "landlord",
        created_at: created,
      },
    ],
    properties,
    units,
    tenancies,
    leases,
    tenant_invitations: [
      {
        id: id("4500", 1),
        organization_id: ORG_ID,
        property_id: units[17]!.property_id,
        unit_id: units[17]!.id,
        tenancy_id: null,
        email: "harper.lane@example.com",
        invited_name: "Harper Lane",
        status: "pending",
        token: "demo-invite-token-1",
        expires_at: iso(6),
        accepted_at: null,
        created_by: LANDLORD_ID,
        created_at: iso(-1),
        updated_at: iso(-1),
      },
    ],
    documents,
    payments,
    payment_schedules: tenancies.map((t, i) => ({
      id: id("7500", i + 1),
      organization_id: ORG_ID,
      tenancy_id: t.id,
      amount: t.monthly_rent ?? 0,
      cadence: "monthly" as const,
      due_day: 1,
      starts_on: t.start_date!,
      ends_on: t.end_date,
      active: true,
      created_at: t.created_at,
      updated_at: t.created_at,
    })),
    maintenance_requests: maintenance,
    conversations: [
      {
        id: conversationId,
        organization_id: ORG_ID,
        tenancy_id: tenancies[0]!.id,
        subject: "Faucet repair scheduling",
        last_message_at: iso(-1),
        created_at: iso(-2),
        updated_at: iso(-1),
      },
      {
        id: conversation2,
        organization_id: ORG_ID,
        tenancy_id: tenancies[8]!.id,
        subject: "Furnace technician visit",
        last_message_at: iso(-1),
        created_at: iso(-8),
        updated_at: iso(-1),
      },
    ],
    messages: [
      {
        id: id("9100", 1),
        conversation_id: conversationId,
        sender_id: TENANT_ID,
        sender_name: "Jordan Rivera",
        sender_role: "tenant",
        body: "The kitchen faucet is dripping steadily — worse at night.",
        read_at: iso(-2),
        created_at: iso(-2),
      },
      {
        id: id("9100", 2),
        conversation_id: conversationId,
        sender_id: LANDLORD_ID,
        sender_name: "Avery Whitfield",
        sender_role: "landlord",
        body: "Thanks — a plumber can come Thursday between 9 and 11. Does that work?",
        read_at: null,
        created_at: iso(-1),
      },
      {
        id: id("9100", 3),
        conversation_id: conversation2,
        sender_id: LANDLORD_ID,
        sender_name: "Avery Whitfield",
        sender_role: "landlord",
        body: "Technician is booked for tomorrow morning. Space heater dropped off today.",
        read_at: null,
        created_at: iso(-1),
      },
    ],
    reviews: [
      {
        id: id("9200", 1),
        organization_id: ORG_ID,
        tenancy_id: tenancies[0]!.id,
        direction: "landlord_to_tenant",
        author_id: LANDLORD_ID,
        author_name: "Avery Whitfield",
        rating: 5,
        body: "On time every month, communicates early about maintenance.",
        status: "published",
        created_at: iso(-60),
        updated_at: iso(-60),
      },
      {
        id: id("9200", 2),
        organization_id: ORG_ID,
        tenancy_id: tenancies[0]!.id,
        direction: "tenant_to_landlord",
        author_id: TENANT_ID,
        author_name: "Jordan Rivera",
        rating: 4,
        body: "Repairs handled quickly. Lease terms were clear from day one.",
        status: "published",
        created_at: iso(-58),
        updated_at: iso(-58),
      },
      {
        id: id("9200", 3),
        organization_id: PM_ORG_ID,
        tenancy_id: tenancies[2]!.id,
        direction: "tenant_to_landlord",
        author_id: null,
        author_name: TENANT_NAMES[2] ?? "Verified tenant",
        rating: 5,
        body: "Work orders acknowledged the same day and the portal always matched my ledger.",
        status: "published",
        created_at: iso(-44),
        updated_at: iso(-44),
      },
      {
        id: id("9200", 4),
        organization_id: PM_ORG_ID,
        tenancy_id: tenancies[3]!.id,
        direction: "tenant_to_landlord",
        author_id: null,
        author_name: TENANT_NAMES[3] ?? "Verified tenant",
        rating: 4,
        body: "Good communication on repairs. Owner statements arrive on schedule.",
        status: "published",
        created_at: iso(-25),
        updated_at: iso(-25),
      },
    ],
    review_disputes: [],
    verification_records: [
      ...tenancies.slice(0, 4).map((t, i) => ({
        id: id("9300", i + 1),
        organization_id: ORG_ID,
        tenancy_id: t.id,
        payment_id: null,
        kind: "tenancy" as const,
        verified_by: LANDLORD_ID,
        source: "platform" as const,
        notes: "Tenancy confirmed by both parties",
        created_at: t.verified_at ?? t.created_at,
      })),
    ],
    notifications: [
      {
        id: id("9400", 1),
        user_id: LANDLORD_ID,
        organization_id: ORG_ID,
        kind: "payment",
        title: "2 rents are past due",
        body: "$2,100 outstanding across Maple Court and Harbor Lofts.",
        read_at: null,
        created_at: iso(-1),
      },
      {
        id: id("9400", 2),
        user_id: LANDLORD_ID,
        organization_id: ORG_ID,
        kind: "lease",
        title: "2 leases expire within 45 days",
        body: "Start renewals for Jordan Rivera and Priya Raman.",
        read_at: null,
        created_at: iso(-2),
      },
      {
        id: id("9400", 3),
        user_id: LANDLORD_ID,
        organization_id: ORG_ID,
        kind: "maintenance",
        title: "High-priority maintenance open",
        body: "Furnace not holding temperature — technician scheduled.",
        read_at: iso(-1),
        created_at: iso(-3),
      },
      {
        id: id("9400", 4),
        user_id: LANDLORD_ID,
        organization_id: ORG_ID,
        kind: "invitation",
        title: "Invitation pending",
        body: "Harper Lane has not accepted the invitation yet.",
        read_at: null,
        created_at: iso(-1),
      },
      {
        id: id("9400", 5),
        user_id: TENANT_ID,
        organization_id: ORG_ID,
        kind: "payment",
        title: "Rent posted",
        body: "This month's rent was received and verified.",
        read_at: null,
        created_at: iso(-3),
      },
    ],
    audit_logs: [
      {
        id: id("9500", 1),
        organization_id: ORG_ID,
        actor_id: LANDLORD_ID,
        actor_role: "landlord",
        action: "tenancy.verified",
        entity_type: "tenancy",
        entity_id: tenancies[0]!.id,
        metadata: { source: "demo seed" },
        created_at: iso(-380),
      },
    ],
    listings,
    rental_applications: applications,
    listing_channels: listingChannels,
    listing_sync_events: listingSyncEvents,
    listing_leads: listingLeads,
    owner_accounts: ownerAccounts,
    management_assignments: managementAssignments,
    student_housing_configs: student.student_housing_configs,
    academic_terms: student.academic_terms,
    room_beds: student.room_beds,
    occupancies: student.occupancies,
    roommate_groups: student.roommate_groups,
    roommate_group_members: student.roommate_group_members,
    guarantor_relationships: student.guarantor_relationships,
    charges: student.charges,
    charge_allocations: student.charge_allocations,
    payers: student.payers,
    student_payments: student.student_payments,
    payment_allocations: student.payment_allocations,
    ledger_events: student.ledger_events,
    lease_change_requests: student.lease_change_requests,
    approval_steps: student.approval_steps,
    turn_tasks: student.turn_tasks,
    student_maintenance_cases: student.student_maintenance_cases,
    ...seedVerification({
      landlordId: LANDLORD_ID,
      managerId: MANAGER_ID,
      orgId: ORG_ID,
      pmOrgId: PM_ORG_ID,
      propertyIds: properties.map((p) => p.id),
    }),
  };
}

export const DEMO_IDS = { LANDLORD_ID, TENANT_ID, MANAGER_ID, ORG_ID, PM_ORG_ID };
