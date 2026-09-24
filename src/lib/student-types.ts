/**
 * Student housing vertical (business map §25-§38).
 *
 * Student housing is a *configuration-driven* category on top of the same
 * RentID identity / property / lease / payment graph — not a separate app.
 * Physical `property_type` and `management_category` stay separate columns.
 */
import type { DateOnly, Timestamp, UUID } from "@/lib/types";

export type ManagementCategory = "standard_residential" | "student_housing";

export type LeaseModel = "individual_by_bed" | "joint_household" | "mixed";

/** Policy mode for each lease-change request type. */
export type PolicyMode = "allowed" | "conditional" | "prohibited";

export type StudentHousingConfig = {
  id: UUID;
  property_id: UUID;
  organization_id: UUID;
  campus: string;
  campus_distance_miles: number | null;
  lease_model: LeaseModel;
  occupancy_limit_per_unit: number | null;
  guarantor_required: boolean;
  /** Which lease-change types are allowed / conditional / prohibited. */
  sublease_policy: PolicyMode;
  assignment_policy: PolicyMode;
  replacement_policy: PolicyMode;
  early_termination_policy: PolicyMode;
  /** Approvals required before any change becomes effective. */
  requires_owner_approval: boolean;
  approval_sla_hours: number;
  lease_change_fee: number | null;
  required_documents: string[];
  accepted_payment_rails: string[];
  external_payment_recording: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AcademicTerm = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  label: string;
  campus: string;
  application_opens_on: DateOnly;
  renewal_deadline: DateOnly;
  move_out_on: DateOnly;
  turn_starts_on: DateOnly;
  move_in_on: DateOnly;
  term_rent: number | null;
  is_current: boolean;
  created_at: Timestamp;
};

export type BedStatus =
  | "occupied"
  | "renewing"
  | "notice_given"
  | "available"
  | "held"
  | "applied"
  | "approved"
  | "leased"
  | "offline";

export type RoomBed = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  room_label: string;
  bed_label: string;
  monthly_rent: number;
  status: BedStatus;
  /** Bed-level readiness is tracked separately from the unit (turnover rule). */
  ready: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type OccupancyStage = "upcoming" | "current" | "former";

/** A person in a bed/unit for a date range. Never merged with the lease. */
export type Occupancy = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  bed_id: UUID | null;
  term_id: UUID | null;
  resident_name: string;
  resident_email: string | null;
  resident_user_id: UUID | null;
  /** Individual-by-bed or a share of a joint household lease. */
  lease_model: LeaseModel;
  share_pct: number | null;
  start_date: DateOnly;
  end_date: DateOnly | null;
  stage: OccupancyStage;
  verified: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type RoommateGroupStage =
  | "invited"
  | "profiles_incomplete"
  | "guarantors_incomplete"
  | "submitted"
  | "screening"
  | "operator_review"
  | "approved"
  | "denied"
  | "waitlisted"
  | "lease_pending"
  | "signatures_pending"
  | "funded"
  | "leased";

export type RoommateGroup = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID | null;
  term_id: UUID | null;
  label: string;
  stage: RoommateGroupStage;
  created_by_name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type GroupMemberState =
  "invited" | "profile_incomplete" | "guarantor_incomplete" | "complete" | "approved" | "denied";

export type RoommateGroupMember = {
  id: UUID;
  group_id: UUID;
  name: string;
  email: string | null;
  state: GroupMemberState;
  identity_verified: boolean;
  passport_shared: boolean;
  /** First-time renters are shown as "first verified tenancy", never negative. */
  first_time_renter: boolean;
  created_at: Timestamp;
};

export type GuarantorRole = "guarantor" | "authorized_payer" | "contact_only";

export type GuarantorRelationship = {
  id: UUID;
  organization_id: UUID;
  occupancy_id: UUID | null;
  group_member_id: UUID | null;
  name: string;
  email: string | null;
  role: GuarantorRole;
  identity_verified: boolean;
  signed_at: Timestamp | null;
  created_at: Timestamp;
};

/* --------------------------------- money ---------------------------------- */

export type ChargeType =
  | "rent"
  | "deposit"
  | "application"
  | "utilities"
  | "parking"
  | "pet"
  | "damage"
  | "late_fee"
  | "lease_change_fee";

export type ChargeScope = "resident" | "roommate_group" | "unit" | "lease";

export type ChargeState = "open" | "partial" | "paid" | "waived" | "reversed" | "not_yet_due";

export type Charge = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  /** Set for resident-scoped charges; null for unit / group charges. */
  occupancy_id: UUID | null;
  term_id: UUID | null;
  charge_type: ChargeType;
  scope: ChargeScope;
  label: string;
  amount: number;
  credits: number;
  due_date: DateOnly;
  late_fee_rule: string | null;
  state: ChargeState;
  /** e.g. a lease-change fee that is not collectible until approval. */
  gated_on_request_id: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Which party owes which slice of a charge. */
export type ChargeAllocation = {
  id: UUID;
  charge_id: UUID;
  occupancy_id: UUID | null;
  label: string;
  amount: number;
  created_at: Timestamp;
};

export type PayerKind = "resident" | "guarantor" | "third_party" | "institution";

/** The payer is recorded separately from the obligated resident. */
export type Payer = {
  id: UUID;
  organization_id: UUID;
  name: string;
  kind: PayerKind;
  email: string | null;
  linked_occupancy_id: UUID | null;
  authorized: boolean;
  created_at: Timestamp;
};

export type StudentPaymentMethod =
  "rentid_ach" | "card" | "check" | "cash" | "money_order" | "bank_billpay" | "other_external";

export type StudentPaymentState =
  | "initiated"
  | "pending"
  | "settled"
  | "returned"
  | "recorded"
  | "proof_attached"
  | "reconciled"
  | "rejected";

export type StudentPayment = {
  id: UUID;
  organization_id: UUID;
  payer_id: UUID;
  amount: number;
  method: StudentPaymentMethod;
  /** RentID-processed vs recorded external payment — never conflated. */
  processed_by_rentid: boolean;
  reference: string | null;
  proof_label: string | null;
  state: StudentPaymentState;
  received_at: Timestamp;
  created_at: Timestamp;
};

export type PaymentAllocation = {
  id: UUID;
  payment_id: UUID;
  charge_id: UUID;
  amount: number;
  created_at: Timestamp;
};

/** Append-only balance history. Allocations never overwrite prior events. */
export type LedgerEvent = {
  id: UUID;
  organization_id: UUID;
  charge_id: UUID | null;
  payment_id: UUID | null;
  occupancy_id: UUID | null;
  kind:
    | "charge_created"
    | "payment_recorded"
    | "payment_allocated"
    | "credit_applied"
    | "charge_waived"
    | "charge_reversed"
    | "reminder_sent";
  amount: number;
  balance_after: number;
  note: string | null;
  actor_id: UUID | null;
  created_at: Timestamp;
};

/* ---------------------- approval-first lease changes ---------------------- */

export type LeaseChangeType =
  | "sublease"
  | "assignment"
  | "replacement_resident"
  | "add_occupant"
  | "remove_occupant"
  | "bed_transfer"
  | "room_transfer"
  | "renewal"
  | "early_termination"
  | "guarantor_change"
  | "payment_plan"
  | "addendum";

export type LeaseChangeState =
  | "draft"
  | "submitted"
  | "under_review"
  | "owner_review"
  | "approved"
  | "denied"
  | "documents_pending"
  | "signatures_pending"
  | "payment_pending"
  | "scheduled"
  | "effective"
  | "completed"
  | "withdrawn"
  | "expired"
  | "cancelled";

export type LeaseChangeRequest = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  occupancy_id: UUID;
  bed_id: UUID | null;
  request_type: LeaseChangeType;
  state: LeaseChangeState;
  policy_mode: PolicyMode;
  reason: string;
  requested_start: DateOnly | null;
  requested_end: DateOnly | null;
  candidate_name: string | null;
  candidate_email: string | null;
  /** Replacement listings only exist once the operator permits the request. */
  replacement_listing_enabled: boolean;
  requires_owner_approval: boolean;
  fee_amount: number | null;
  documents_complete: boolean;
  signatures_complete: boolean;
  payment_complete: boolean;
  effective_date: DateOnly | null;
  sla_hours: number;
  submitted_at: Timestamp | null;
  decided_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ApprovalStepRole = "pm" | "owner" | "resident" | "guarantor";

/** Immutable approval trail — one row per required approver decision. */
export type ApprovalStep = {
  id: UUID;
  request_id: UUID;
  role: ApprovalStepRole;
  label: string;
  state: "pending" | "approved" | "denied" | "skipped";
  actor_name: string | null;
  note: string | null;
  decided_at: Timestamp | null;
  created_at: Timestamp;
};

/* ------------------------- turnover + maintenance ------------------------- */

export type TurnTaskState = "not_started" | "in_progress" | "blocked" | "complete";
export type TurnTaskArea = "bed" | "room" | "unit" | "shared";

export type TurnTask = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  bed_id: UUID | null;
  term_id: UUID | null;
  area: TurnTaskArea;
  label: string;
  category:
    "inspection" | "cleaning" | "repair" | "paint" | "flooring" | "keys" | "documents" | "money";
  vendor: string | null;
  due_date: DateOnly;
  state: TurnTaskState;
  /** Links the outgoing and incoming occupancy so history is preserved. */
  outgoing_occupancy_id: UUID | null;
  incoming_occupancy_id: UUID | null;
  blocker_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type StudentMaintenanceArea = "private_room" | "shared_area" | "unit" | "unknown";
export type DamageAllocationTarget =
  "unassigned" | "single_resident" | "multiple_residents" | "household" | "owner";

export type StudentMaintenanceCase = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  bed_id: UUID | null;
  requester_name: string;
  requester_occupancy_id: UUID | null;
  area: StudentMaintenanceArea;
  area_label: string;
  issue: string;
  category: string;
  priority: "low" | "normal" | "high" | "emergency";
  status: "open" | "in_progress" | "resolved" | "disputed" | "closed";
  assignment: string | null;
  entry_permission: boolean;
  evidence: string[];
  first_response_at: Timestamp | null;
  resolved_at: Timestamp | null;
  damage_allocation: DamageAllocationTarget;
  damage_amount: number | null;
  lease_basis: string | null;
  tenant_response: string | null;
  /** Only evidence-backed, resolved events feed verified history. */
  affects_verified_history: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/* ------------------------------ read models ------------------------------- */

export type StudentPropertyContext = {
  property_id: UUID;
  property_name: string;
  organization_id: UUID;
  config: StudentHousingConfig;
  current_term: AcademicTerm | null;
};

/** One row per resident in the roommate command center. */
export type StudentRosterRow = {
  occupancy_id: UUID;
  property_id: UUID;
  property_name: string;
  unit_id: UUID;
  unit_name: string;
  bed_label: string | null;
  resident_name: string;
  lease_model: LeaseModel;
  share_pct: number | null;
  rent: number;
  balance: number;
  paid: number;
  charged: number;
  payment_state: "paid" | "partial" | "unpaid" | "recorded_external";
  payer_summary: string;
  guarantor_complete: boolean;
  pending_request: { id: UUID; request_type: LeaseChangeType; state: LeaseChangeState } | null;
  move_in_ready: boolean;
};

export type StudentPortfolioMetrics = {
  collected_this_month: number;
  unpaid_beds: number;
  partial_residents: number;
  pending_lease_changes: number;
  incomplete_guarantors: number;
  turns_not_ready: number;
  beds_total: number;
};

export type StudentChargeRow = Charge & {
  assigned_to: string;
  paid: number;
  balance: number;
  source_status: string;
};

export type StudentUnitLedger = {
  unit_id: UUID;
  unit_name: string;
  property_id: UUID;
  property_name: string;
  campus: string;
  lease_model: LeaseModel;
  term_label: string | null;
  beds: (RoomBed & { resident: StudentRosterRow | null })[];
  residents: StudentRosterRow[];
  charges: StudentChargeRow[];
  requests: LeaseChangeRequestWithContext[];
  maintenance: StudentMaintenanceCase[];
  total_balance: number;
};

export type LeaseChangeRequestWithContext = LeaseChangeRequest & {
  property_name: string;
  unit_name: string;
  bed_label: string | null;
  resident_name: string;
  steps: ApprovalStep[];
  checklist: { label: string; done: boolean }[];
};

export type PreLeasingSummary = {
  term: AcademicTerm | null;
  beds_total: number;
  pre_leased: number;
  pre_leased_pct: number;
  renewals_pending: number;
  applications_in_review: number;
  changes_pending: number;
  pipeline: { status: BedStatus; count: number }[];
  groups: (RoommateGroup & { members: RoommateGroupMember[]; property_name: string })[];
};

export type TurnoverSummary = {
  moving_out: number;
  inspected: number;
  inspection_remaining: number;
  make_ready_open: number;
  beds_ready: number;
  move_in_blocked: number;
  tasks: (TurnTask & { property_name: string; unit_name: string; bed_label: string | null })[];
};

/** Resident-side read model — never contains another roommate's money. */
export type ResidentHousing = {
  occupancy: Occupancy;
  bed: RoomBed | null;
  property_name: string;
  unit_name: string;
  campus: string | null;
  lease_model: LeaseModel;
  term_label: string | null;
  renewal_deadline: DateOnly | null;
  sublease_policy: PolicyMode;
  replacement_policy: PolicyMode;
  roommates: {
    name: string;
    bed_label: string | null;
    share_pct: number | null;
    verified: boolean;
  }[];
  charges: StudentChargeRow[];
  balance: number;
  payers: Payer[];
  guarantors: GuarantorRelationship[];
  requests: LeaseChangeRequestWithContext[];
  maintenance: StudentMaintenanceCase[];
  events: LedgerEvent[];
};
