/**
 * Student-housing demo data (business map §25-§38).
 *
 * Kept in its own module so the standard-residential demo numbers in
 * `seed.ts` stay exactly as tuned. Student properties are operated by the
 * property-management workspace under verified owner authority.
 */
import { normalizeAddress } from "@/lib/verification/address";
import type {
  AcademicTerm,
  ApprovalStep,
  Charge,
  ChargeAllocation,
  GuarantorRelationship,
  LeaseChangeRequest,
  LedgerEvent,
  ManagementAssignment,
  Occupancy,
  OwnerAccount,
  Payer,
  PaymentAllocation,
  Property,
  RoomBed,
  RoommateGroup,
  RoommateGroupMember,
  StudentHousingConfig,
  StudentMaintenanceCase,
  StudentPayment,
  TurnTask,
  Unit,
  UUID,
} from "@/lib/types";

export type StudentSeed = {
  properties: Property[];
  units: Unit[];
  owner_accounts: OwnerAccount[];
  management_assignments: ManagementAssignment[];
  student_housing_configs: StudentHousingConfig[];
  academic_terms: AcademicTerm[];
  room_beds: RoomBed[];
  occupancies: Occupancy[];
  roommate_groups: RoommateGroup[];
  roommate_group_members: RoommateGroupMember[];
  guarantor_relationships: GuarantorRelationship[];
  charges: Charge[];
  charge_allocations: ChargeAllocation[];
  payers: Payer[];
  student_payments: StudentPayment[];
  payment_allocations: PaymentAllocation[];
  ledger_events: LedgerEvent[];
  lease_change_requests: LeaseChangeRequest[];
  approval_steps: ApprovalStep[];
  turn_tasks: TurnTask[];
  student_maintenance_cases: StudentMaintenanceCase[];
};

function sid(prefix: string, n: number): UUID {
  return `8f1c7a10-${prefix}-4000-8000-${String(n).padStart(12, "0")}`;
}

function iso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}

function day(daysFromNow: number) {
  return iso(daysFromNow).slice(0, 10);
}

function monthDay(dayOfMonth: number, monthOffset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  d.setDate(dayOfMonth);
  return d.toISOString().slice(0, 10);
}

const BED_RENT = 725;

type ResidentSpec = {
  name: string;
  email: string;
  bedLabel: string | null;
  roomLabel: string;
  unitIndex: number;
  leaseModel: "individual_by_bed" | "joint_household";
  sharePct: number | null;
  /** paid in full, partially paid, unpaid, or paid by recorded external check */
  money: "own_ach" | "parent_ach" | "partial" | "unpaid" | "external_check";
  partialAmount?: number;
  guarantorComplete: boolean;
  firstTimeRenter: boolean;
};

const RESIDENTS: ResidentSpec[] = [
  // 123 College Ave — Unit 2A (individual by bed)
  {
    name: "Alex Morgan",
    email: "alex.morgan@example.edu",
    bedLabel: "A",
    roomLabel: "Room 1",
    unitIndex: 0,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "own_ach",
    guarantorComplete: true,
    firstTimeRenter: false,
  },
  {
    name: "Ben Carter",
    email: "ben.carter@example.edu",
    bedLabel: "B",
    roomLabel: "Room 2",
    unitIndex: 0,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "unpaid",
    guarantorComplete: true,
    firstTimeRenter: true,
  },
  {
    name: "Cara Diaz",
    email: "cara.diaz@example.edu",
    bedLabel: "C",
    roomLabel: "Room 3",
    unitIndex: 0,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "parent_ach",
    guarantorComplete: false,
    firstTimeRenter: true,
  },
  {
    name: "Drew Reed",
    email: "drew.reed@example.edu",
    bedLabel: "D",
    roomLabel: "Room 4",
    unitIndex: 0,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "partial",
    partialAmount: 425,
    guarantorComplete: true,
    firstTimeRenter: false,
  },
  // 123 College Ave — Unit 3C (individual by bed, one bed available)
  {
    name: "Ivy Salazar",
    email: "ivy.salazar@example.edu",
    bedLabel: "A",
    roomLabel: "Room 1",
    unitIndex: 1,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "own_ach",
    guarantorComplete: true,
    firstTimeRenter: false,
  },
  {
    name: "Noah Kimani",
    email: "noah.kimani@example.edu",
    bedLabel: "B",
    roomLabel: "Room 2",
    unitIndex: 1,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "own_ach",
    guarantorComplete: false,
    firstTimeRenter: true,
  },
  {
    name: "Priya Nandra",
    email: "priya.nandra@example.edu",
    bedLabel: "C",
    roomLabel: "Room 3",
    unitIndex: 1,
    leaseModel: "individual_by_bed",
    sharePct: null,
    money: "unpaid",
    guarantorComplete: true,
    firstTimeRenter: true,
  },
  // 88 Campus — Unit 4B (joint household lease, 25% shares)
  {
    name: "Mia Stone",
    email: "mia.stone@example.edu",
    bedLabel: null,
    roomLabel: "Joint lease",
    unitIndex: 2,
    leaseModel: "joint_household",
    sharePct: 25,
    money: "external_check",
    guarantorComplete: true,
    firstTimeRenter: false,
  },
  {
    name: "Tess Aoki",
    email: "tess.aoki@example.edu",
    bedLabel: null,
    roomLabel: "Joint lease",
    unitIndex: 2,
    leaseModel: "joint_household",
    sharePct: 25,
    money: "own_ach",
    guarantorComplete: true,
    firstTimeRenter: false,
  },
  {
    name: "Ravi Shah",
    email: "ravi.shah@example.edu",
    bedLabel: null,
    roomLabel: "Joint lease",
    unitIndex: 2,
    leaseModel: "joint_household",
    sharePct: 25,
    money: "own_ach",
    guarantorComplete: true,
    firstTimeRenter: true,
  },
  {
    name: "Jae Park",
    email: "jae.park@example.edu",
    bedLabel: null,
    roomLabel: "Joint lease",
    unitIndex: 2,
    leaseModel: "joint_household",
    sharePct: 25,
    money: "unpaid",
    guarantorComplete: false,
    firstTimeRenter: true,
  },
];

export function seedStudentHousing(input: {
  pmOrgId: UUID;
  managerId: UUID;
  /** Demo student resident account linked to the first bed occupancy. */
  residentUserId?: UUID;
}): StudentSeed {
  const { pmOrgId, managerId, residentUserId } = input;
  const created = iso(-300);

  /* ------------------------------ properties ----------------------------- */

  const propertySpecs = [
    {
      name: "123 College Ave",
      property_type: "multi_family" as const,
      street_address: "123 College Avenue",
      city: "Ypsilanti",
      state: "MI",
      zip: "48197",
      campus: "Eastern Michigan University",
      distance: 0.4,
      units: ["Unit 2A", "Unit 3C"],
    },
    {
      name: "88 Campus Flats",
      property_type: "apartment" as const,
      street_address: "88 Campus Drive",
      city: "Ann Arbor",
      state: "MI",
      zip: "48104",
      campus: "University of Michigan",
      distance: 0.9,
      units: ["Unit 4B"],
    },
  ];

  const properties: Property[] = propertySpecs.map((p, i) => ({
    id: sid("b000", i + 1),
    organization_id: pmOrgId,
    name: p.name,
    property_type: p.property_type,
    management_category: "student_housing",
    street_address: p.street_address,
    unit_label: null,
    city: p.city,
    state: p.state,
    zip: p.zip,
    year_built: 1978 + i * 20,
    notes: null,
    normalized_address: normalizeAddress(p),
    county: "Washtenaw",
    parcel_number: null,
    recording_jurisdiction: "Washtenaw County Register of Deeds",
    legal_description: null,
    created_at: created,
    updated_at: created,
    deleted_at: null,
  }));

  const units: Unit[] = [];
  const unitPropertyIndex: number[] = [];
  propertySpecs.forEach((p, pi) => {
    p.units.forEach((name) => {
      units.push({
        id: sid("b100", units.length + 1),
        organization_id: pmOrgId,
        property_id: properties[pi]!.id,
        name,
        bedrooms: 4,
        bathrooms: 2,
        square_feet: 1180,
        monthly_rent: BED_RENT * 4,
        security_deposit: BED_RENT,
        rent_due_day: 1,
        occupancy_status: "occupied",
        created_at: created,
        updated_at: created,
        deleted_at: null,
      });
      unitPropertyIndex.push(pi);
    });
  });

  /* ------------------------ owner authority + config --------------------- */

  const ownerAccounts: OwnerAccount[] = [
    {
      id: sid("b200", 1),
      organization_id: pmOrgId,
      name: "Campus Ventures LLC",
      contact_name: "Marta Ilves",
      contact_email: "marta@campusventures.example.com",
      contract_start: day(-300),
      management_fee_pct: 9.5,
      created_at: created,
      updated_at: iso(-30),
    },
  ];

  const managementAssignments: ManagementAssignment[] = properties.map((p, i) => ({
    id: sid("b300", i + 1),
    organization_id: pmOrgId,
    owner_account_id: ownerAccounts[0]!.id,
    property_id: p.id,
    authority_status: "verified",
    authorized_at: iso(-295),
    revoked_at: null,
    created_at: created,
  }));

  const configs: StudentHousingConfig[] = propertySpecs.map((p, i) => ({
    id: sid("b400", i + 1),
    property_id: properties[i]!.id,
    organization_id: pmOrgId,
    campus: p.campus,
    campus_distance_miles: p.distance,
    lease_model: i === 0 ? "individual_by_bed" : "joint_household",
    occupancy_limit_per_unit: 4,
    guarantor_required: true,
    sublease_policy: i === 0 ? "conditional" : "prohibited",
    assignment_policy: "conditional",
    replacement_policy: "allowed",
    early_termination_policy: "conditional",
    requires_owner_approval: i === 1,
    approval_sla_hours: 48,
    lease_change_fee: 150,
    required_documents: ["Signed addendum", "Guarantor agreement", "Photo ID"],
    accepted_payment_rails: [
      "RentID ACH",
      "Debit card",
      "Check (recorded)",
      "Bank bill-pay (recorded)",
    ],
    external_payment_recording: true,
    created_at: created,
    updated_at: iso(-20),
  }));

  const terms: AcademicTerm[] = properties.flatMap((p, i) => [
    {
      id: sid("b500", i * 2 + 1),
      organization_id: pmOrgId,
      property_id: p.id,
      label: "2026-27",
      campus: propertySpecs[i]!.campus,
      application_opens_on: day(-260),
      renewal_deadline: day(-40),
      move_out_on: day(300),
      turn_starts_on: day(302),
      move_in_on: day(320),
      term_rent: BED_RENT,
      is_current: true,
      created_at: created,
    },
    {
      id: sid("b500", i * 2 + 2),
      organization_id: pmOrgId,
      property_id: p.id,
      label: "2027-28",
      campus: propertySpecs[i]!.campus,
      application_opens_on: day(-20),
      renewal_deadline: day(35),
      move_out_on: day(300),
      turn_starts_on: day(302),
      move_in_on: day(320),
      term_rent: BED_RENT + 35,
      is_current: false,
      created_at: iso(-30),
    },
  ]);

  const currentTermFor = (propertyId: UUID) =>
    terms.find((t) => t.property_id === propertyId && t.is_current)?.id ?? null;
  const nextTermFor = (propertyId: UUID) =>
    terms.find((t) => t.property_id === propertyId && !t.is_current)?.id ?? null;

  /* -------------------------- rooms, beds, people ------------------------ */

  const beds: RoomBed[] = [];
  const occupancies: Occupancy[] = [];
  const guarantors: GuarantorRelationship[] = [];
  const payers: Payer[] = [];
  const charges: Charge[] = [];
  const chargeAllocations: ChargeAllocation[] = [];
  const payments: StudentPayment[] = [];
  const paymentAllocations: PaymentAllocation[] = [];
  const ledger: LedgerEvent[] = [];

  const pushLedger = (row: Omit<LedgerEvent, "id" | "organization_id">) => {
    ledger.push({ id: sid("bb00", ledger.length + 1), organization_id: pmOrgId, ...row });
  };

  RESIDENTS.forEach((r, i) => {
    const unit = units[r.unitIndex]!;
    const property = properties[unitPropertyIndex[r.unitIndex]!]!;
    const bedId = r.bedLabel ? sid("b600", beds.length + 1) : null;

    if (r.bedLabel && bedId) {
      beds.push({
        id: bedId,
        organization_id: pmOrgId,
        property_id: property.id,
        unit_id: unit.id,
        room_label: r.roomLabel,
        bed_label: r.bedLabel,
        monthly_rent: BED_RENT,
        status: "occupied",
        ready: true,
        created_at: created,
        updated_at: created,
      });
    }

    const occupancy: Occupancy = {
      id: sid("b700", i + 1),
      organization_id: pmOrgId,
      property_id: property.id,
      unit_id: unit.id,
      bed_id: bedId,
      term_id: currentTermFor(property.id),
      resident_name: r.name,
      resident_email: r.email,
      resident_user_id: r.name === "Alex Morgan" ? (residentUserId ?? null) : null,
      lease_model: r.leaseModel,
      share_pct: r.sharePct,
      start_date: day(-25),
      end_date: day(300),
      stage: "current",
      verified: true,
      created_at: iso(-60),
      updated_at: iso(-25),
    };
    occupancies.push(occupancy);

    // Guarantor / parent relationship
    guarantors.push({
      id: sid("b800", guarantors.length + 1),
      organization_id: pmOrgId,
      occupancy_id: occupancy.id,
      group_member_id: null,
      name: `${r.name.split(" ")[1] ?? "Guardian"} household guarantor`,
      email: `guarantor.${r.name.split(" ")[0]!.toLowerCase()}@example.com`,
      role: r.money === "parent_ach" ? "authorized_payer" : "guarantor",
      identity_verified: r.guarantorComplete,
      signed_at: r.guarantorComplete ? iso(-40) : null,
      created_at: iso(-55),
    });

    // Payers: the resident, plus a parent when the parent funds the charge.
    const residentPayer: Payer = {
      id: sid("b900", payers.length + 1),
      organization_id: pmOrgId,
      name: r.name,
      kind: "resident",
      email: r.email,
      linked_occupancy_id: occupancy.id,
      authorized: true,
      created_at: iso(-55),
    };
    payers.push(residentPayer);

    let parentPayer: Payer | null = null;
    if (r.money === "parent_ach") {
      parentPayer = {
        id: sid("b900", payers.length + 1),
        organization_id: pmOrgId,
        name: `Lidia ${r.name.split(" ")[1] ?? "Diaz"}`,
        kind: "guarantor",
        email: `lidia.${r.name.split(" ")[1]?.toLowerCase() ?? "diaz"}@example.com`,
        linked_occupancy_id: occupancy.id,
        authorized: true,
        created_at: iso(-54),
      };
      payers.push(parentPayer);
    }

    // Rent charge for the current month
    const rentCharge: Charge = {
      id: sid("ba00", charges.length + 1),
      organization_id: pmOrgId,
      property_id: property.id,
      unit_id: unit.id,
      occupancy_id: occupancy.id,
      term_id: occupancy.term_id,
      charge_type: "rent",
      scope: "resident",
      label: `${new Date().toLocaleDateString("en-US", { month: "long" })} rent`,
      amount: BED_RENT,
      credits: 0,
      due_date: monthDay(1),
      late_fee_rule: "$50 after the 5th",
      state: "open",
      gated_on_request_id: null,
      created_at: monthDay(1),
      updated_at: iso(-1),
    };
    charges.push(rentCharge);
    chargeAllocations.push({
      id: sid("bc00", chargeAllocations.length + 1),
      charge_id: rentCharge.id,
      occupancy_id: occupancy.id,
      label: r.bedLabel ? `${r.name} · Bed ${r.bedLabel}` : `${r.name} · ${r.sharePct ?? 0}% share`,
      amount: BED_RENT,
      created_at: rentCharge.created_at,
    });
    pushLedger({
      charge_id: rentCharge.id,
      payment_id: null,
      occupancy_id: occupancy.id,
      kind: "charge_created",
      amount: BED_RENT,
      balance_after: BED_RENT,
      note: null,
      actor_id: managerId,
      created_at: rentCharge.created_at,
    });

    // Settle it according to the resident's money story.
    const settle = (
      amount: number,
      payer: Payer,
      method: StudentPayment["method"],
      processed: boolean,
      state: StudentPayment["state"],
      reference: string | null,
      proof: string | null,
    ) => {
      const payment: StudentPayment = {
        id: sid("bd00", payments.length + 1),
        organization_id: pmOrgId,
        payer_id: payer.id,
        amount,
        method,
        processed_by_rentid: processed,
        reference,
        proof_label: proof,
        state,
        received_at: iso(-3),
        created_at: iso(-3),
      };
      payments.push(payment);
      paymentAllocations.push({
        id: sid("be00", paymentAllocations.length + 1),
        payment_id: payment.id,
        charge_id: rentCharge.id,
        amount,
        created_at: payment.created_at,
      });
      pushLedger({
        charge_id: rentCharge.id,
        payment_id: payment.id,
        occupancy_id: occupancy.id,
        kind: "payment_allocated",
        amount,
        balance_after: Math.max(0, BED_RENT - amount),
        note: `${payer.name} · ${method}`,
        actor_id: managerId,
        created_at: payment.created_at,
      });
    };

    if (r.money === "own_ach") {
      settle(BED_RENT, residentPayer, "rentid_ach", true, "settled", "ACH-2261", null);
      rentCharge.state = "paid";
    } else if (r.money === "parent_ach" && parentPayer) {
      settle(500, parentPayer, "rentid_ach", true, "settled", "ACH-2262", null);
      settle(225, residentPayer, "card", true, "settled", "CARD-8841", null);
      rentCharge.state = "paid";
    } else if (r.money === "partial") {
      settle(
        r.partialAmount ?? 425,
        residentPayer,
        "rentid_ach",
        true,
        "settled",
        "ACH-2263",
        null,
      );
      rentCharge.state = "partial";
    } else if (r.money === "external_check") {
      settle(
        BED_RENT,
        residentPayer,
        "check",
        false,
        "reconciled",
        "Check #1042",
        "Scanned check image",
      );
      rentCharge.state = "paid";
    }
  });

  const occupancyByName = (name: string) => occupancies.find((o) => o.resident_name === name)!;

  /* ---------------------- shared + one-off unit charges ------------------ */

  const unit2A = units[0]!;
  const unit2AResidents = occupancies.filter((o) => o.unit_id === unit2A.id);

  const utilities: Charge = {
    id: sid("ba00", charges.length + 1),
    organization_id: pmOrgId,
    property_id: unit2A.property_id,
    unit_id: unit2A.id,
    occupancy_id: null,
    term_id: currentTermFor(unit2A.property_id),
    charge_type: "utilities",
    scope: "unit",
    label: "Utilities — shared",
    amount: 240,
    credits: 0,
    due_date: monthDay(5),
    late_fee_rule: null,
    state: "partial",
    gated_on_request_id: null,
    created_at: monthDay(2),
    updated_at: iso(-1),
  };
  charges.push(utilities);
  unit2AResidents.forEach((o, i) => {
    chargeAllocations.push({
      id: sid("bc00", chargeAllocations.length + 1),
      charge_id: utilities.id,
      occupancy_id: o.id,
      label: `${o.resident_name} · 1/4 share`,
      amount: 60,
      created_at: utilities.created_at,
    });
    if (i < 3) {
      const payer = payers.find((p) => p.linked_occupancy_id === o.id && p.kind === "resident")!;
      const payment: StudentPayment = {
        id: sid("bd00", payments.length + 1),
        organization_id: pmOrgId,
        payer_id: payer.id,
        amount: 60,
        method: "rentid_ach",
        processed_by_rentid: true,
        reference: `ACH-33${i}`,
        proof_label: null,
        state: "settled",
        received_at: iso(-2),
        created_at: iso(-2),
      };
      payments.push(payment);
      paymentAllocations.push({
        id: sid("be00", paymentAllocations.length + 1),
        payment_id: payment.id,
        charge_id: utilities.id,
        amount: 60,
        created_at: payment.created_at,
      });
      pushLedger({
        charge_id: utilities.id,
        payment_id: payment.id,
        occupancy_id: o.id,
        kind: "payment_allocated",
        amount: 60,
        balance_after: 240 - 60 * (i + 1),
        note: `${o.resident_name} · shared utilities share`,
        actor_id: managerId,
        created_at: payment.created_at,
      });
    }
  });

  const alex = occupancyByName("Alex Morgan");
  const parking: Charge = {
    id: sid("ba00", charges.length + 1),
    organization_id: pmOrgId,
    property_id: unit2A.property_id,
    unit_id: unit2A.id,
    occupancy_id: alex.id,
    term_id: alex.term_id,
    charge_type: "parking",
    scope: "resident",
    label: "Parking permit",
    amount: 75,
    credits: 0,
    due_date: monthDay(1),
    late_fee_rule: null,
    state: "paid",
    gated_on_request_id: null,
    created_at: monthDay(1),
    updated_at: iso(-3),
  };
  charges.push(parking);
  chargeAllocations.push({
    id: sid("bc00", chargeAllocations.length + 1),
    charge_id: parking.id,
    occupancy_id: alex.id,
    label: "Alex Morgan",
    amount: 75,
    created_at: parking.created_at,
  });
  const alexPayer = payers.find((p) => p.linked_occupancy_id === alex.id)!;
  const parkingPayment: StudentPayment = {
    id: sid("bd00", payments.length + 1),
    organization_id: pmOrgId,
    payer_id: alexPayer.id,
    amount: 75,
    method: "rentid_ach",
    processed_by_rentid: true,
    reference: "ACH-2270",
    proof_label: null,
    state: "settled",
    received_at: iso(-3),
    created_at: iso(-3),
  };
  payments.push(parkingPayment);
  paymentAllocations.push({
    id: sid("be00", paymentAllocations.length + 1),
    payment_id: parkingPayment.id,
    charge_id: parking.id,
    amount: 75,
    created_at: parkingPayment.created_at,
  });

  /* ----------------------- lease-change requests ------------------------- */

  const requests: LeaseChangeRequest[] = [];
  const steps: ApprovalStep[] = [];

  const addRequest = (spec: {
    resident: string;
    type: LeaseChangeRequest["request_type"];
    state: LeaseChangeRequest["state"];
    policy: LeaseChangeRequest["policy_mode"];
    reason: string;
    candidate?: { name: string; email: string } | null;
    ownerApproval: boolean;
    listingEnabled?: boolean;
    documents?: boolean;
    signatures?: boolean;
    payment?: boolean;
    daysAgo: number;
  }) => {
    const occ = occupancyByName(spec.resident);
    const request: LeaseChangeRequest = {
      id: sid("bf00", requests.length + 1),
      organization_id: pmOrgId,
      property_id: occ.property_id,
      unit_id: occ.unit_id,
      occupancy_id: occ.id,
      bed_id: occ.bed_id,
      request_type: spec.type,
      state: spec.state,
      policy_mode: spec.policy,
      reason: spec.reason,
      requested_start: day(20),
      requested_end: day(300),
      candidate_name: spec.candidate?.name ?? null,
      candidate_email: spec.candidate?.email ?? null,
      replacement_listing_enabled: spec.listingEnabled ?? false,
      requires_owner_approval: spec.ownerApproval,
      fee_amount: 150,
      documents_complete: spec.documents ?? false,
      signatures_complete: spec.signatures ?? false,
      payment_complete: spec.payment ?? false,
      effective_date: null,
      sla_hours: 48,
      submitted_at: iso(-spec.daysAgo),
      decided_at: null,
      created_at: iso(-spec.daysAgo),
      updated_at: iso(-spec.daysAgo + 1),
    };
    requests.push(request);

    steps.push({
      id: sid("c000", steps.length + 1),
      request_id: request.id,
      role: "pm",
      label: "Property manager review",
      state: [
        "approved",
        "documents_pending",
        "signatures_pending",
        "payment_pending",
        "scheduled",
        "effective",
        "completed",
      ].includes(request.state)
        ? "approved"
        : "pending",
      actor_name: null,
      note: null,
      decided_at: null,
      created_at: request.created_at,
    });
    if (spec.ownerApproval) {
      steps.push({
        id: sid("c000", steps.length + 1),
        request_id: request.id,
        role: "owner",
        label: "Owner approval",
        state: "pending",
        actor_name: null,
        note: null,
        decided_at: null,
        created_at: request.created_at,
      });
    }
    return request;
  };

  const benRequest = addRequest({
    resident: "Ben Carter",
    type: "replacement_resident",
    state: "under_review",
    policy: "allowed",
    reason: "Studying abroad in the spring; found a replacement from my program.",
    candidate: { name: "Hana Weber", email: "hana.weber@example.edu" },
    ownerApproval: false,
    daysAgo: 3,
  });

  addRequest({
    resident: "Cara Diaz",
    type: "guarantor_change",
    state: "documents_pending",
    policy: "allowed",
    reason: "Switching guarantor from my father to my mother.",
    ownerApproval: false,
    documents: false,
    daysAgo: 6,
  });

  addRequest({
    resident: "Mia Stone",
    type: "early_termination",
    state: "owner_review",
    policy: "conditional",
    reason: "Graduating in December and leaving the joint household lease.",
    ownerApproval: true,
    daysAgo: 4,
  });

  addRequest({
    resident: "Noah Kimani",
    type: "bed_transfer",
    state: "submitted",
    policy: "allowed",
    reason: "Requesting the open bed in Unit 3C for a quieter room.",
    ownerApproval: false,
    daysAgo: 1,
  });

  addRequest({
    resident: "Ravi Shah",
    type: "sublease",
    state: "submitted",
    policy: "prohibited",
    reason:
      "Summer sublease request — property prohibits subleasing, submitted for exception review.",
    ownerApproval: true,
    daysAgo: 2,
  });

  // The lease-change fee exists but is not collectible until approval.
  const benCharge: Charge = {
    id: sid("ba00", charges.length + 1),
    organization_id: pmOrgId,
    property_id: benRequest.property_id,
    unit_id: benRequest.unit_id,
    occupancy_id: benRequest.occupancy_id,
    term_id: currentTermFor(benRequest.property_id),
    charge_type: "lease_change_fee",
    scope: "resident",
    label: "Lease-change fee",
    amount: 150,
    credits: 0,
    due_date: day(20),
    late_fee_rule: null,
    state: "not_yet_due",
    gated_on_request_id: benRequest.id,
    created_at: benRequest.created_at,
    updated_at: benRequest.created_at,
  };
  charges.push(benCharge);
  chargeAllocations.push({
    id: sid("bc00", chargeAllocations.length + 1),
    charge_id: benCharge.id,
    occupancy_id: benRequest.occupancy_id,
    label: "Ben Carter",
    amount: 150,
    created_at: benCharge.created_at,
  });

  /* ------------------------ pre-leasing + groups ------------------------- */

  // Available / pipeline beds for the next term in Unit 3C.
  const unit3C = units[1]!;
  const pipelineBeds: RoomBed[] = [
    {
      id: sid("b600", beds.length + 1),
      organization_id: pmOrgId,
      property_id: unit3C.property_id,
      unit_id: unit3C.id,
      room_label: "Room 4",
      bed_label: "D",
      monthly_rent: BED_RENT,
      status: "available",
      ready: false,
      created_at: created,
      updated_at: iso(-5),
    },
  ];
  beds.push(...pipelineBeds);

  // Renewal / pipeline signal for the next term.
  const renewingNames = ["Alex Morgan", "Ivy Salazar"];
  renewingNames.forEach((name) => {
    const occ = occupancies.find((o) => o.resident_name === name);
    const bed = beds.find((b) => b.id === occ?.bed_id);
    if (bed) bed.status = "renewing";
  });
  const noticeOcc = occupancies.find((o) => o.resident_name === "Ben Carter");
  const noticeBed = beds.find((b) => b.id === noticeOcc?.bed_id);
  if (noticeBed) noticeBed.status = "notice_given";
  pipelineBeds[0]!.status = "applied";

  const groups: RoommateGroup[] = [
    {
      id: sid("c100", 1),
      organization_id: pmOrgId,
      property_id: properties[0]!.id,
      unit_id: unit3C.id,
      term_id: nextTermFor(properties[0]!.id),
      label: "Weber / Ochoa group",
      stage: "guarantors_incomplete",
      created_by_name: "Hana Weber",
      created_at: iso(-12),
      updated_at: iso(-2),
    },
    {
      id: sid("c100", 2),
      organization_id: pmOrgId,
      property_id: properties[1]!.id,
      unit_id: null,
      term_id: nextTermFor(properties[1]!.id),
      label: "Lin four-bedroom group",
      stage: "operator_review",
      created_by_name: "Cody Lin",
      created_at: iso(-9),
      updated_at: iso(-1),
    },
  ];

  const memberSpecs: {
    group: number;
    name: string;
    state: RoommateGroupMember["state"];
    verified: boolean;
    first: boolean;
  }[] = [
    { group: 0, name: "Hana Weber", state: "complete", verified: true, first: true },
    { group: 0, name: "Sam Ochoa", state: "guarantor_incomplete", verified: true, first: true },
    { group: 0, name: "Bri Talley", state: "profile_incomplete", verified: false, first: true },
    { group: 0, name: "Kit Ferrand", state: "invited", verified: false, first: true },
    { group: 1, name: "Cody Lin", state: "complete", verified: true, first: false },
    { group: 1, name: "Dara Ozturk", state: "complete", verified: true, first: true },
    { group: 1, name: "Eli Rourke", state: "guarantor_incomplete", verified: true, first: true },
    { group: 1, name: "Fern Adeyemi", state: "complete", verified: true, first: false },
  ];

  const groupMembers: RoommateGroupMember[] = memberSpecs.map((m, i) => ({
    id: sid("c200", i + 1),
    group_id: groups[m.group]!.id,
    name: m.name,
    email: `${m.name.split(" ")[0]!.toLowerCase()}@example.edu`,
    state: m.state,
    identity_verified: m.verified,
    passport_shared: m.verified,
    first_time_renter: m.first,
    created_at: iso(-11 + i),
  }));

  groupMembers
    .filter((m) => m.state !== "invited")
    .forEach((m, i) => {
      guarantors.push({
        id: sid("b800", guarantors.length + 1),
        organization_id: pmOrgId,
        occupancy_id: null,
        group_member_id: m.id,
        name: `${m.name.split(" ")[1] ?? "Family"} guarantor`,
        email: `guarantor.${m.name.split(" ")[0]!.toLowerCase()}@example.com`,
        role: "guarantor",
        identity_verified: m.state === "complete",
        signed_at: m.state === "complete" ? iso(-4 + i) : null,
        created_at: iso(-8),
      });
    });

  /* ------------------------------- turnover ------------------------------ */

  const turnSpecs: {
    unitIndex: number;
    bedIndex: number | null;
    area: TurnTask["area"];
    label: string;
    category: TurnTask["category"];
    vendor: string | null;
    state: TurnTask["state"];
    blocker: string | null;
    days: number;
  }[] = [
    {
      unitIndex: 0,
      bedIndex: 0,
      area: "bed",
      label: "Bed A — private room inspection",
      category: "inspection",
      vendor: "In-house tech",
      state: "complete",
      blocker: null,
      days: 4,
    },
    {
      unitIndex: 0,
      bedIndex: 1,
      area: "bed",
      label: "Bed B — paint and patch",
      category: "paint",
      vendor: "Vendor #14",
      state: "in_progress",
      blocker: null,
      days: 7,
    },
    {
      unitIndex: 0,
      bedIndex: 2,
      area: "bed",
      label: "Bed C — flooring replacement",
      category: "flooring",
      vendor: "Vendor #9",
      state: "blocked",
      blocker: "Material backorder — at risk of missing move-in",
      days: 6,
    },
    {
      unitIndex: 0,
      bedIndex: null,
      area: "shared",
      label: "Shared kitchen deep clean",
      category: "cleaning",
      vendor: "Bright Clean Co.",
      state: "not_started",
      blocker: null,
      days: 9,
    },
    {
      unitIndex: 1,
      bedIndex: null,
      area: "unit",
      label: "Unit 3C keys and access re-key",
      category: "keys",
      vendor: "In-house tech",
      state: "not_started",
      blocker: null,
      days: 10,
    },
    {
      unitIndex: 1,
      bedIndex: null,
      area: "unit",
      label: "Incoming resident guarantor packet",
      category: "documents",
      vendor: null,
      state: "blocked",
      blocker: "Missing guarantor signature",
      days: 3,
    },
    {
      unitIndex: 2,
      bedIndex: null,
      area: "unit",
      label: "Move-out balance and deposit workflow",
      category: "money",
      vendor: null,
      state: "blocked",
      blocker: "Unpaid move-out balance",
      days: 5,
    },
    {
      unitIndex: 2,
      bedIndex: null,
      area: "shared",
      label: "Living room wall repair",
      category: "repair",
      vendor: "Vendor #14",
      state: "in_progress",
      blocker: null,
      days: 8,
    },
  ];

  const turnTasks: TurnTask[] = turnSpecs.map((t, i) => {
    const unit = units[t.unitIndex]!;
    const unitBeds = beds.filter((b) => b.unit_id === unit.id);
    return {
      id: sid("c300", i + 1),
      organization_id: pmOrgId,
      property_id: unit.property_id,
      unit_id: unit.id,
      bed_id: t.bedIndex === null ? null : (unitBeds[t.bedIndex]?.id ?? null),
      term_id: nextTermFor(unit.property_id),
      area: t.area,
      label: t.label,
      category: t.category,
      vendor: t.vendor,
      due_date: day(t.days),
      state: t.state,
      outgoing_occupancy_id: occupancies.find((o) => o.unit_id === unit.id)?.id ?? null,
      incoming_occupancy_id: null,
      blocker_reason: t.blocker,
      created_at: iso(-14 + i),
      updated_at: iso(-1),
    };
  });

  /* ---------------------- maintenance + damage cases --------------------- */

  const cases: StudentMaintenanceCase[] = [
    {
      id: sid("c400", 1),
      organization_id: pmOrgId,
      property_id: unit2A.property_id,
      unit_id: unit2A.id,
      bed_id: beds.find((b) => b.unit_id === unit2A.id && b.bed_label === "B")?.id ?? null,
      requester_name: "Ben Carter",
      requester_occupancy_id: occupancyByName("Ben Carter").id,
      area: "private_room",
      area_label: "Bed B",
      issue: "Window will not lock",
      category: "Doors & windows",
      priority: "high",
      status: "in_progress",
      assignment: "Vendor #14",
      entry_permission: true,
      evidence: ["window-latch-1.jpg", "window-latch-2.jpg"],
      first_response_at: iso(-2),
      resolved_at: null,
      damage_allocation: "unassigned",
      damage_amount: null,
      lease_basis: null,
      tenant_response: null,
      affects_verified_history: false,
      created_at: iso(-2),
      updated_at: iso(-1),
    },
    {
      id: sid("c400", 2),
      organization_id: pmOrgId,
      property_id: unit2A.property_id,
      unit_id: unit2A.id,
      bed_id: null,
      requester_name: "Cara Diaz",
      requester_occupancy_id: occupancyByName("Cara Diaz").id,
      area: "shared_area",
      area_label: "Kitchen — shared",
      issue: "Sink leak under the cabinet",
      category: "Plumbing",
      priority: "normal",
      status: "resolved",
      assignment: "Maintenance tech",
      entry_permission: true,
      evidence: ["sink-leak.jpg"],
      first_response_at: iso(-9),
      resolved_at: iso(-7),
      damage_allocation: "owner",
      damage_amount: null,
      lease_basis: "Normal wear — landlord responsibility",
      tenant_response: null,
      affects_verified_history: true,
      created_at: iso(-9),
      updated_at: iso(-7),
    },
    {
      id: sid("c400", 3),
      organization_id: pmOrgId,
      property_id: units[2]!.property_id,
      unit_id: units[2]!.id,
      bed_id: null,
      requester_name: "PM inspection",
      requester_occupancy_id: null,
      area: "shared_area",
      area_label: "Living room — shared",
      issue: "Wall damage found at inspection",
      category: "Damage",
      priority: "normal",
      status: "disputed",
      assignment: null,
      entry_permission: false,
      evidence: ["wall-damage-1.jpg", "inspection-report.pdf"],
      first_response_at: iso(-5),
      resolved_at: null,
      damage_allocation: "unassigned",
      damage_amount: 380,
      lease_basis: "Shared-area damage clause 8(b)",
      tenant_response: "Household disputes origin — damage predates our move-in condition report.",
      affects_verified_history: false,
      created_at: iso(-5),
      updated_at: iso(-1),
    },
  ];

  return {
    properties,
    units,
    owner_accounts: ownerAccounts,
    management_assignments: managementAssignments,
    student_housing_configs: configs,
    academic_terms: terms,
    room_beds: beds,
    occupancies,
    roommate_groups: groups,
    roommate_group_members: groupMembers,
    guarantor_relationships: guarantors,
    charges,
    charge_allocations: chargeAllocations,
    payers,
    student_payments: payments,
    payment_allocations: paymentAllocations,
    ledger_events: ledger,
    lease_change_requests: requests,
    approval_steps: steps,
    turn_tasks: turnTasks,
    student_maintenance_cases: cases,
  };
}
