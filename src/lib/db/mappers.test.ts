import { describe, expect, it } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
import {
  toApplication,
  toInvitation,
  toLease,
  toListing,
  toMaintenance,
  toPayment,
  toProfile,
} from "@/lib/db/mappers";
import type { PaymentMethod } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/*  fixtures                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Postgres `numeric` columns arrive over PostgREST as JSON STRINGS, but the
 * generated types in src/integrations/supabase/types.ts declare them `number`.
 * That mismatch is exactly why mappers.ts routes them through num()/num0(), and
 * it is what these fixtures reproduce. The cast is the point of the test.
 */
const pgNumeric = (value: string): number => value as unknown as number;

/** A column the generated types call non-nullable but which is null in practice. */
const pgNull = <T>(): T => null as unknown as T;

const ORG = "00000000-0000-4000-8000-00000000000a";
const TENANCY = "00000000-0000-4000-8000-00000000000b";
const UNIT = "00000000-0000-4000-8000-00000000000c";
const PROPERTY = "00000000-0000-4000-8000-00000000000d";
const USER = "00000000-0000-4000-8000-00000000000e";
const CREATED = "2026-09-01T17:45:30.123Z";
const UPDATED = "2026-09-02T09:00:00.000Z";

/*
 * Every fixture is annotated `Tables<"x">`, so renaming or dropping a column in
 * a migration + `bun run db:types` breaks this file at compile time.
 */

const profileRow = (over: Partial<Tables<"profiles">> = {}): Tables<"profiles"> => ({
  id: USER,
  full_name: "Aaron Cena",
  email: "aaron@example.com",
  phone: "801-555-0100",
  avatar_url: "https://cdn.example.com/a.png",
  onboarding_completed: true,
  portfolio_size: "1-5",
  created_at: CREATED,
  updated_at: UPDATED,
  ...over,
});

const paymentRow = (over: Partial<Tables<"payments">> = {}): Tables<"payments"> => ({
  id: "pay-1",
  organization_id: ORG,
  tenancy_id: TENANCY,
  unit_id: UNIT,
  amount: pgNumeric("1500.00"),
  platform_fee_amount: pgNumeric("7.50"),
  currency: "usd",
  days_late: null,
  due_date: "2026-09-01",
  external_reference: "ch_abc123",
  memo: "September rent",
  metadata: {},
  method: "ach",
  paid_at: "2026-09-01T16:00:00.000Z",
  payout_id: null,
  period_label: "September 2026",
  recorded_by: USER,
  status: "paid",
  verification_source: "platform_settled",
  verified: true,
  verified_at: "2026-09-01T16:05:00.000Z",
  created_at: CREATED,
  updated_at: UPDATED,
  ...over,
});

const maintenanceRow = (
  over: Partial<Tables<"maintenance_requests">> = {},
): Tables<"maintenance_requests"> => ({
  id: "mr-1",
  organization_id: ORG,
  property_id: PROPERTY,
  unit_id: UNIT,
  tenancy_id: TENANCY,
  title: "Furnace will not ignite",
  description: "No heat since Tuesday.",
  status: "in_progress",
  priority: "urgent",
  created_by: USER,
  first_response_at: "2026-09-01T18:00:00.000Z",
  resolved_at: "2026-09-03T12:00:00.000Z",
  created_at: CREATED,
  updated_at: UPDATED,
  ...over,
});

const leaseRow = (over: Partial<Tables<"leases">> = {}): Tables<"leases"> => ({
  id: "lease-1",
  organization_id: ORG,
  tenancy_id: TENANCY,
  unit_id: UNIT,
  status: "active",
  start_date: "2026-09-01",
  end_date: "2027-08-31",
  monthly_rent: pgNumeric("1500.00"),
  security_deposit: pgNumeric("1500.00"),
  rent_due_day: 1,
  late_fee: pgNumeric("75.00"),
  late_fee_terms: "5% after the 5th",
  document_id: "doc-1",
  document_path: "leases/lease-1.pdf",
  signed_at: "2026-08-20T00:00:00.000Z",
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
  ...over,
});

const listingRow = (over: Partial<Tables<"listings">> = {}): Tables<"listings"> => ({
  id: "listing-1",
  public_ref: "ab12cd",
  organization_id: ORG,
  property_id: PROPERTY,
  unit_id: UNIT,
  status: "published",
  headline: "Sunny 2-bed in the Avenues",
  description: "Hardwood floors, off-street parking.",
  monthly_rent: pgNumeric("1800.00"),
  security_deposit: pgNumeric("1800.00"),
  available_on: "2026-10-01",
  lease_term_months: 12,
  amenities: ["dishwasher", "parking"],
  screening_criteria: "3x rent, 650+ credit",
  syndicated_to: ["zillow"],
  published_at: "2026-09-05T00:00:00.000Z",
  property_type: "condo",
  street_address: "817 Isham St",
  city: "Salt Lake City",
  state: "UT",
  zip: "84103",
  bedrooms: pgNumeric("2"),
  bathrooms: pgNumeric("1.5"),
  square_feet: 950,
  photos: ["https://cdn.example.com/1.jpg"],
  utilities_included: ["water"],
  pet_policy: "Cats only",
  parking: "1 off-street",
  application_requirements: ["photo id"],
  income_requirement: "3x rent",
  credit_requirement: "650+",
  occupancy_limit: 3,
  move_in_fees: "$300 admin",
  application_fee: pgNumeric("45.00"),
  contact_name: "Aaron Cena",
  contact_email: "aaron@example.com",
  contact_phone: "801-555-0100",
  showing_instructions: "Text to schedule.",
  assigned_to: USER,
  view_count: 42,
  created_at: CREATED,
  updated_at: UPDATED,
  deleted_at: null,
  ...over,
});

const applicationRow = (
  over: Partial<Tables<"rental_applications">> = {},
): Tables<"rental_applications"> => ({
  id: "app-1",
  listing_id: "listing-1",
  organization_id: ORG,
  applicant_user_id: USER,
  applicant_name: "Dana Reyes",
  applicant_email: "dana@example.com",
  applicant_phone: "801-555-0199",
  monthly_income: pgNumeric("5400.00"),
  move_in_date: "2026-10-01",
  note: "Two cats.",
  status: "in_review",
  profile_shared: true,
  decided_at: null,
  source: "zillow",
  utm_source: "zillow",
  utm_medium: "listing",
  utm_campaign: "fall-2026",
  referrer: "https://zillow.com/x",
  prefilled_from_resume: true,
  employer: "Beehive Labs",
  current_address: "629 Alger Ave",
  references_text: "Prior landlord: Pat Kim, 801-555-0123",
  passport_snapshot: null,
  created_at: CREATED,
  updated_at: UPDATED,
  ...over,
});

const invitationRow = (
  over: Partial<Tables<"tenant_invitations">> = {},
): Tables<"tenant_invitations"> => ({
  id: "inv-1",
  organization_id: ORG,
  property_id: PROPERTY,
  unit_id: UNIT,
  tenancy_id: TENANCY,
  email: "dana@example.com",
  full_name: "Dana Reyes",
  phone: "801-555-0199",
  monthly_rent: pgNumeric("1500.00"),
  lease_start: "2026-10-01",
  lease_end: "2027-09-30",
  status: "pending",
  token: "tok_abc",
  expires_at: "2026-09-30T00:00:00.000Z",
  accepted_at: null,
  accepted_by: null,
  invited_by: USER,
  created_at: CREATED,
  updated_at: UPDATED,
  ...over,
});

/* -------------------------------------------------------------------------- */
/*  the DB ↔ domain renames                                                   */
/* -------------------------------------------------------------------------- */

describe("column renames", () => {
  it("profiles.onboarding_completed → Profile.onboarded", () => {
    expect(toProfile(profileRow({ onboarding_completed: true })).onboarded).toBe(true);
    expect(toProfile(profileRow({ onboarding_completed: false })).onboarded).toBe(false);
    expect(toProfile(profileRow())).not.toHaveProperty("onboarding_completed");
  });

  it("maintenance_requests.resolved_at → MaintenanceRequest.completed_at", () => {
    const row = maintenanceRow({ resolved_at: "2026-09-03T12:00:00.000Z" });
    expect(toMaintenance(row).completed_at).toBe("2026-09-03T12:00:00.000Z");
    expect(toMaintenance(row)).not.toHaveProperty("resolved_at");
  });

  it("tenant_invitations.full_name → TenantInvitation.invited_name", () => {
    const invitation = toInvitation(invitationRow({ full_name: "Dana Reyes" }));
    expect(invitation.invited_name).toBe("Dana Reyes");
    expect(invitation).not.toHaveProperty("full_name");
  });

  it("tenant_invitations.invited_by → TenantInvitation.created_by", () => {
    const invitation = toInvitation(invitationRow({ invited_by: USER }));
    expect(invitation.created_by).toBe(USER);
    expect(invitation).not.toHaveProperty("invited_by");
  });

  it("rental_applications.references_text → RentalApplication.references", () => {
    const application = toApplication(applicationRow({ references_text: "Pat Kim" }));
    expect(application.references).toBe("Pat Kim");
    expect(application).not.toHaveProperty("references_text");
  });
});

/* -------------------------------------------------------------------------- */
/*  toProfile                                                                 */
/* -------------------------------------------------------------------------- */

describe("toProfile", () => {
  it("maps a full row", () => {
    expect(toProfile(profileRow())).toEqual({
      id: USER,
      full_name: "Aaron Cena",
      email: "aaron@example.com",
      phone: "801-555-0100",
      avatar_url: "https://cdn.example.com/a.png",
      onboarded: true,
      created_at: CREATED,
      updated_at: UPDATED,
    });
  });

  it("passes nulls straight through rather than substituting empty strings", () => {
    const profile = toProfile(
      profileRow({ full_name: null, email: null, phone: null, avatar_url: null }),
    );
    expect(profile.full_name).toBeNull();
    expect(profile.email).toBeNull();
    expect(profile.phone).toBeNull();
    expect(profile.avatar_url).toBeNull();
  });

  it("emits exactly the domain fields — no DB-only columns leak through", () => {
    // portfolio_size exists on the row and is deliberately not part of Profile.
    expect(Object.keys(toProfile(profileRow())).sort()).toEqual([
      "avatar_url",
      "created_at",
      "email",
      "full_name",
      "id",
      "onboarded",
      "phone",
      "updated_at",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*  toPayment                                                                 */
/* -------------------------------------------------------------------------- */

describe("toPayment", () => {
  it("turns the numeric strings Postgres sends into real numbers", () => {
    const payment = toPayment(
      paymentRow({ amount: pgNumeric("1500.00"), platform_fee_amount: pgNumeric("7.50") }),
    );
    expect(payment.amount).toBe(1500);
    expect(payment.platform_fee_amount).toBe(7.5);
    expect(typeof payment.amount).toBe("number");
    expect(typeof payment.platform_fee_amount).toBe("number");
  });

  it("coerces a missing amount to 0 rather than NaN", () => {
    expect(toPayment(paymentRow({ amount: pgNull<number>() })).amount).toBe(0);
  });

  it("keeps a null platform fee null — 0 would mean 'we charged nothing'", () => {
    expect(toPayment(paymentRow({ platform_fee_amount: null })).platform_fee_amount).toBeNull();
    expect(
      toPayment(paymentRow({ platform_fee_amount: pgNumeric("0.00") })).platform_fee_amount,
    ).toBe(0);
  });

  describe("method", () => {
    const VALID: PaymentMethod[] = [
      "manual",
      "ach",
      "same_day_ach",
      "rtp",
      "fednow",
      "card",
      "cash",
      "check",
    ];

    it.each(VALID)("passes the known method %s through", (method) => {
      expect(toPayment(paymentRow({ method })).method).toBe(method);
    });

    it.each([
      ["null", null],
      ["an empty string", ""],
      ["an unknown rail", "wire_transfer"],
      ["a future provider value", "paypal"],
      ["the right value in the wrong case", "ACH"],
      ["a value with surrounding whitespace", " ach "],
    ])("falls back to 'manual' for %s", (_label, method) => {
      expect(toPayment(paymentRow({ method })).method).toBe("manual");
    });
  });

  it("falls back to the created_at date when due_date is null", () => {
    const payment = toPayment(
      paymentRow({ due_date: null, created_at: "2026-09-01T17:45:30.123Z" }),
    );
    expect(payment.due_date).toBe("2026-09-01");
    expect(payment.due_date).toHaveLength(10);
  });

  it("prefers an explicit due_date over created_at", () => {
    expect(toPayment(paymentRow({ due_date: "2026-08-25" })).due_date).toBe("2026-08-25");
  });

  it("substitutes an empty string for a null period_label", () => {
    expect(toPayment(paymentRow({ period_label: null })).period_label).toBe("");
  });

  it("preserves the verification triple verbatim (it is derived server-side)", () => {
    const payment = toPayment(
      paymentRow({
        verified: false,
        verification_source: "unverified",
        verified_at: null,
      }),
    );
    expect(payment.verified).toBe(false);
    expect(payment.verification_source).toBe("unverified");
    expect(payment.verified_at).toBeNull();
  });

  it("maps a fully-populated row", () => {
    expect(toPayment(paymentRow())).toEqual({
      id: "pay-1",
      organization_id: ORG,
      tenancy_id: TENANCY,
      unit_id: UNIT,
      amount: 1500,
      platform_fee_amount: 7.5,
      status: "paid",
      method: "ach",
      due_date: "2026-09-01",
      paid_at: "2026-09-01T16:00:00.000Z",
      period_label: "September 2026",
      verified: true,
      verification_source: "platform_settled",
      verified_at: "2026-09-01T16:05:00.000Z",
      external_reference: "ch_abc123",
      payout_id: null,
      recorded_by: USER,
      memo: "September rent",
      created_at: CREATED,
      updated_at: UPDATED,
    });
  });

  it("drops DB-only columns (currency, days_late, metadata) from the domain object", () => {
    const payment = toPayment(paymentRow());
    expect(payment).not.toHaveProperty("currency");
    expect(payment).not.toHaveProperty("days_late");
    expect(payment).not.toHaveProperty("metadata");
  });
});

/* -------------------------------------------------------------------------- */
/*  toMaintenance                                                             */
/* -------------------------------------------------------------------------- */

describe("toMaintenance", () => {
  it("maps a full row", () => {
    expect(toMaintenance(maintenanceRow())).toEqual({
      id: "mr-1",
      organization_id: ORG,
      property_id: PROPERTY,
      unit_id: UNIT,
      tenancy_id: TENANCY,
      title: "Furnace will not ignite",
      description: "No heat since Tuesday.",
      status: "in_progress",
      priority: "urgent",
      created_by: USER,
      completed_at: "2026-09-03T12:00:00.000Z",
      created_at: CREATED,
      updated_at: UPDATED,
    });
  });

  it("leaves completed_at null for an open request", () => {
    expect(
      toMaintenance(maintenanceRow({ resolved_at: null, status: "open" })).completed_at,
    ).toBeNull();
  });

  it("coerces a null property_id / unit_id to '' (the domain type demands a UUID)", () => {
    const request = toMaintenance(maintenanceRow({ property_id: null, unit_id: null }));
    expect(request.property_id).toBe("");
    expect(request.unit_id).toBe("");
  });

  it("keeps a null tenancy_id null (a request can be landlord-raised)", () => {
    expect(toMaintenance(maintenanceRow({ tenancy_id: null })).tenancy_id).toBeNull();
  });

  it("does not surface first_response_at", () => {
    expect(toMaintenance(maintenanceRow())).not.toHaveProperty("first_response_at");
  });
});

/* -------------------------------------------------------------------------- */
/*  toLease                                                                   */
/* -------------------------------------------------------------------------- */

describe("toLease", () => {
  it("turns money strings into numbers", () => {
    const lease = toLease(
      leaseRow({
        monthly_rent: pgNumeric("1500.00"),
        security_deposit: pgNumeric("1500.00"),
        late_fee: pgNumeric("75.50"),
      }),
    );
    expect(lease.monthly_rent).toBe(1500);
    expect(lease.security_deposit).toBe(1500);
    expect(lease.late_fee).toBe(75.5);
  });

  it("treats a missing rent as 0 but a missing deposit or late fee as null", () => {
    const lease = toLease(
      leaseRow({ monthly_rent: pgNull<number>(), security_deposit: null, late_fee: null }),
    );
    expect(lease.monthly_rent).toBe(0); // num0 — a lease always has a rent figure
    expect(lease.security_deposit).toBeNull(); // num — "no deposit" ≠ "$0 deposit"
    expect(lease.late_fee).toBeNull();
  });

  it("carries both the numeric late_fee and the free-text terms", () => {
    const lease = toLease(
      leaseRow({ late_fee: pgNumeric("75.00"), late_fee_terms: "5% after the 5th" }),
    );
    expect(lease.late_fee).toBe(75);
    expect(lease.late_fee_terms).toBe("5% after the 5th");
  });

  it("keeps date-only columns as date-only strings", () => {
    const lease = toLease(leaseRow());
    expect(lease.start_date).toBe("2026-09-01");
    expect(lease.end_date).toBe("2027-08-31");
  });

  it("maps a full row", () => {
    expect(toLease(leaseRow())).toEqual({
      id: "lease-1",
      organization_id: ORG,
      tenancy_id: TENANCY,
      unit_id: UNIT,
      status: "active",
      start_date: "2026-09-01",
      end_date: "2027-08-31",
      monthly_rent: 1500,
      security_deposit: 1500,
      rent_due_day: 1,
      late_fee: 75,
      late_fee_terms: "5% after the 5th",
      document_id: "doc-1",
      document_path: "leases/lease-1.pdf",
      signed_at: "2026-08-20T00:00:00.000Z",
      created_at: CREATED,
      updated_at: UPDATED,
      deleted_at: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  toListing                                                                 */
/* -------------------------------------------------------------------------- */

describe("toListing", () => {
  it("turns money and room counts into numbers", () => {
    const listing = toListing(
      listingRow({
        monthly_rent: pgNumeric("1800.00"),
        security_deposit: pgNumeric("1800.00"),
        application_fee: pgNumeric("45.00"),
        bedrooms: pgNumeric("2"),
        bathrooms: pgNumeric("1.5"),
      }),
    );
    expect(listing.monthly_rent).toBe(1800);
    expect(listing.security_deposit).toBe(1800);
    expect(listing.application_fee).toBe(45);
    expect(listing.bedrooms).toBe(2);
    expect(listing.bathrooms).toBe(1.5);
  });

  it("treats a missing rent as 0 but a missing deposit or fee as null", () => {
    const listing = toListing(
      listingRow({
        monthly_rent: pgNull<number>(),
        security_deposit: null,
        application_fee: null,
        bedrooms: null,
        bathrooms: null,
      }),
    );
    expect(listing.monthly_rent).toBe(0);
    expect(listing.security_deposit).toBeNull();
    expect(listing.application_fee).toBeNull();
    expect(listing.bedrooms).toBeNull();
  });

  it("omits public_ref entirely when the column is null, rather than setting undefined", () => {
    // `Listing.public_ref?: string` under exactOptionalPropertyTypes — the key
    // must be absent, not present-and-undefined, or a spread will clobber it.
    const listing = toListing(listingRow({ public_ref: null }));
    expect("public_ref" in listing).toBe(false);
    expect(Object.keys(listing)).not.toContain("public_ref");
  });

  it("includes public_ref when the column is set", () => {
    expect(toListing(listingRow({ public_ref: "ab12cd" })).public_ref).toBe("ab12cd");
  });

  it("omits public_ref for an empty string too (an empty ref is not a ref)", () => {
    expect("public_ref" in toListing(listingRow({ public_ref: "" }))).toBe(false);
  });

  it.each([
    "amenities",
    "photos",
    "syndicated_to",
    "utilities_included",
    "application_requirements",
  ] as const)("defaults a null %s array to []", (column) => {
    const over = { [column]: pgNull<string[]>() } as Partial<Tables<"listings">>;
    expect(toListing(listingRow(over))[column]).toEqual([]);
  });

  it("preserves populated arrays by value", () => {
    const listing = toListing(listingRow({ amenities: ["dishwasher", "parking"] }));
    expect(listing.amenities).toEqual(["dishwasher", "parking"]);
  });

  it("carries the listing-detail fields the marketplace page renders", () => {
    const listing = toListing(listingRow());
    expect(listing.property_type).toBe("condo");
    expect(listing.street_address).toBe("817 Isham St");
    expect(listing.square_feet).toBe(950);
    expect(listing.pet_policy).toBe("Cats only");
    expect(listing.view_count).toBe(42);
    expect(listing.assigned_to).toBe(USER);
  });

  it("does not surface the listing's own city/state/zip columns", () => {
    // Listing has no city/state/zip — the address comes from the Property.
    const listing = toListing(listingRow());
    expect(listing).not.toHaveProperty("city");
    expect(listing).not.toHaveProperty("state");
    expect(listing).not.toHaveProperty("zip");
  });
});

/* -------------------------------------------------------------------------- */
/*  toApplication                                                             */
/* -------------------------------------------------------------------------- */

describe("toApplication", () => {
  it("turns monthly_income into a number and keeps a null income null", () => {
    expect(
      toApplication(applicationRow({ monthly_income: pgNumeric("5400.00") })).monthly_income,
    ).toBe(5400);
    expect(toApplication(applicationRow({ monthly_income: null })).monthly_income).toBeNull();
  });

  it("defaults a blank source to 'rentid'", () => {
    expect(toApplication(applicationRow({ source: "" })).source).toBe("rentid");
    expect(toApplication(applicationRow({ source: pgNull<string>() })).source).toBe("rentid");
  });

  it("passes a known syndication source through", () => {
    expect(toApplication(applicationRow({ source: "zillow" })).source).toBe("zillow");
  });

  /**
   * KNOWN GAP (reported, not fixed here — mappers.ts is not ours to edit).
   *
   * `toPayment` validates `method` against a whitelist and falls back to
   * "manual". `toApplication` does NOT do the same for `source`: it casts any
   * non-empty string to LeadSource, so a bad row puts a value into the domain
   * model that the type system says is impossible.
   */
  it("does NOT validate source against LeadSource (known gap)", () => {
    expect(toApplication(applicationRow({ source: "carrier_pigeon" })).source).toBe(
      "carrier_pigeon",
    );
  });

  it("keeps the attribution and resume-autofill fields", () => {
    const application = toApplication(applicationRow());
    expect(application.utm_source).toBe("zillow");
    expect(application.utm_campaign).toBe("fall-2026");
    expect(application.referrer).toBe("https://zillow.com/x");
    expect(application.prefilled_from_resume).toBe(true);
    expect(application.employer).toBe("Beehive Labs");
    expect(application.current_address).toBe("629 Alger Ave");
  });

  it("passes nullable applicant fields through untouched", () => {
    const application = toApplication(
      applicationRow({
        applicant_user_id: null,
        applicant_phone: null,
        move_in_date: null,
        note: null,
        decided_at: null,
        references_text: null,
        employer: null,
      }),
    );
    expect(application.applicant_user_id).toBeNull();
    expect(application.applicant_phone).toBeNull();
    expect(application.move_in_date).toBeNull();
    expect(application.references).toBeNull();
    expect(application.employer).toBeNull();
  });

  it("does not surface utm_medium or passport_snapshot", () => {
    const application = toApplication(applicationRow());
    expect(application).not.toHaveProperty("utm_medium");
    expect(application).not.toHaveProperty("passport_snapshot");
  });
});

/* -------------------------------------------------------------------------- */
/*  toInvitation                                                              */
/* -------------------------------------------------------------------------- */

describe("toInvitation", () => {
  it("maps a full row", () => {
    expect(toInvitation(invitationRow())).toEqual({
      id: "inv-1",
      organization_id: ORG,
      property_id: PROPERTY,
      unit_id: UNIT,
      tenancy_id: TENANCY,
      email: "dana@example.com",
      invited_name: "Dana Reyes",
      phone: "801-555-0199",
      monthly_rent: 1500,
      lease_start: "2026-10-01",
      lease_end: "2027-09-30",
      status: "pending",
      token: "tok_abc",
      expires_at: "2026-09-30T00:00:00.000Z",
      accepted_at: null,
      accepted_by: null,
      created_by: USER,
      created_at: CREATED,
      updated_at: UPDATED,
    });
  });

  it("coerces null email / property_id / unit_id to '' for the domain type", () => {
    const invitation = toInvitation(
      invitationRow({ email: null, property_id: null, unit_id: null }),
    );
    expect(invitation.email).toBe("");
    expect(invitation.property_id).toBe("");
    expect(invitation.unit_id).toBe("");
  });

  it("keeps a null invited_name and a null tenancy_id null", () => {
    const invitation = toInvitation(invitationRow({ full_name: null, tenancy_id: null }));
    expect(invitation.invited_name).toBeNull();
    expect(invitation.tenancy_id).toBeNull();
  });

  it("turns monthly_rent into a number and keeps it null when unset", () => {
    expect(toInvitation(invitationRow({ monthly_rent: pgNumeric("1500.00") })).monthly_rent).toBe(
      1500,
    );
    expect(toInvitation(invitationRow({ monthly_rent: null })).monthly_rent).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  cross-cutting                                                             */
/* -------------------------------------------------------------------------- */

describe("mappers as a family", () => {
  it("never leaves a numeric string in a money field", () => {
    const money: unknown[] = [
      toPayment(paymentRow()).amount,
      toPayment(paymentRow()).platform_fee_amount,
      toLease(leaseRow()).monthly_rent,
      toLease(leaseRow()).security_deposit,
      toLease(leaseRow()).late_fee,
      toListing(listingRow()).monthly_rent,
      toListing(listingRow()).security_deposit,
      toListing(listingRow()).application_fee,
      toApplication(applicationRow()).monthly_income,
      toInvitation(invitationRow()).monthly_rent,
    ];
    for (const value of money) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value as number)).toBe(true);
    }
  });

  it("is pure — mapping does not mutate the row it was given", () => {
    const row = paymentRow();
    const snapshot = structuredClone(row);
    toPayment(row);
    expect(row).toEqual(snapshot);
  });

  it("returns a fresh object each call", () => {
    const row = paymentRow();
    expect(toPayment(row)).not.toBe(toPayment(row));
    expect(toPayment(row)).toEqual(toPayment(row));
  });
});
