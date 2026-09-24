/**
 * Student-housing service layer (business map §25-§38).
 *
 * Every rule the business map treats as non-negotiable lives here, not in the
 * UI: charge/obligation is separate from payer, external payments are recorded
 * rather than pretended-processed, lease changes are approval-first, and
 * ledger/approval history is append-only.
 */
import { clone, getDb, latency, logAudit, nowIso, uuid } from "@/lib/mock/db";
import type {
  AcademicTerm,
  GuarantorRelationship,
  LedgerEvent,
  Payer,
  ResidentHousing,
  ApprovalStep,
  BedStatus,
  Charge,
  LeaseChangeRequest,
  LeaseChangeRequestWithContext,
  LeaseChangeType,
  PolicyMode,
  PreLeasingSummary,
  RoomBed,
  StudentChargeRow,
  StudentHousingConfig,
  StudentMaintenanceCase,
  StudentPaymentMethod,
  StudentPortfolioMetrics,
  StudentPropertyContext,
  StudentRosterRow,
  StudentUnitLedger,
  TurnoverSummary,
  UUID,
} from "@/lib/types";

/* ------------------------------- helpers --------------------------------- */

function orgPropertyIds(organizationId: UUID): UUID[] {
  const db = getDb();
  return db.student_housing_configs
    .filter((c) => c.organization_id === organizationId)
    .map((c) => c.property_id);
}

function propertyName(propertyId: UUID) {
  return getDb().properties.find((p) => p.id === propertyId)?.name ?? "Property";
}

function unitName(unitId: UUID) {
  return getDb().units.find((u) => u.id === unitId)?.name ?? "Unit";
}

function currentTerm(propertyId: UUID): AcademicTerm | null {
  return getDb().academic_terms.find((t) => t.property_id === propertyId && t.is_current) ?? null;
}

function nextTerm(propertyId: UUID): AcademicTerm | null {
  return getDb().academic_terms.find((t) => t.property_id === propertyId && !t.is_current) ?? null;
}

function paidOnCharge(chargeId: UUID) {
  return getDb()
    .payment_allocations.filter((a) => a.charge_id === chargeId)
    .reduce((sum, a) => sum + a.amount, 0);
}

/** Charges an occupancy owes, including its slice of unit/group charges. */
function occupancyCharges(occupancyId: UUID) {
  const db = getDb();
  return db.charge_allocations
    .filter((a) => a.occupancy_id === occupancyId)
    .map((a) => ({ allocation: a, charge: db.charges.find((c) => c.id === a.charge_id)! }))
    .filter((row) => Boolean(row.charge));
}

function rosterRow(occupancyId: UUID): StudentRosterRow | null {
  const db = getDb();
  const occ = db.occupancies.find((o) => o.id === occupancyId);
  if (!occ) return null;

  const bed = occ.bed_id ? db.room_beds.find((b) => b.id === occ.bed_id) : null;
  const rows = occupancyCharges(occ.id).filter(
    (r) => r.charge.state !== "not_yet_due" && r.charge.state !== "waived",
  );

  let charged = 0;
  let paid = 0;
  rows.forEach((r) => {
    charged += r.allocation.amount;
    // Credit only the money this resident's payers actually sent, so one
    // roommate's payment never appears to settle another's share.
    const mine = db.payment_allocations
      .filter((a) => a.charge_id === r.charge.id)
      .filter((a) => {
        const payment = db.student_payments.find((p) => p.id === a.payment_id);
        const payer = payment ? db.payers.find((x) => x.id === payment.payer_id) : null;
        return !payer?.linked_occupancy_id || payer.linked_occupancy_id === occ.id;
      })
      .reduce((sum, a) => sum + a.amount, 0);
    paid += Math.min(r.allocation.amount, mine);
  });
  const balance = Math.max(0, Math.round(charged - paid));

  // Payer separation: who actually funded this resident's obligations.
  const payerIds = new Set(
    db.payment_allocations
      .filter((a) => rows.some((r) => r.charge.id === a.charge_id))
      .map((a) => db.student_payments.find((p) => p.id === a.payment_id)?.payer_id)
      .filter((pid): pid is UUID => {
        if (!pid) return false;
        const payer = db.payers.find((p) => p.id === pid);
        return !payer?.linked_occupancy_id || payer.linked_occupancy_id === occ.id;
      }),
  );
  const payerNames = [...payerIds]
    .map((pid) => db.payers.find((p) => p.id === pid))
    .filter(Boolean)
    .map((p) => (p!.kind === "resident" ? "Self" : p!.name));
  const externalOnly =
    payerIds.size > 0 &&
    [...payerIds].every((pid) =>
      db.student_payments.filter((p) => p.payer_id === pid).every((p) => !p.processed_by_rentid),
    );

  const paymentState: StudentRosterRow["payment_state"] =
    balance === 0 && externalOnly
      ? "recorded_external"
      : balance === 0
        ? "paid"
        : paid > 0
          ? "partial"
          : "unpaid";

  const guarantor = db.guarantor_relationships.find((g) => g.occupancy_id === occ.id);
  const request = db.lease_change_requests.find(
    (r) =>
      r.occupancy_id === occ.id &&
      !["completed", "denied", "withdrawn", "cancelled", "expired"].includes(r.state),
  );

  return {
    occupancy_id: occ.id,
    property_id: occ.property_id,
    property_name: propertyName(occ.property_id),
    unit_id: occ.unit_id,
    unit_name: unitName(occ.unit_id),
    bed_label: bed?.bed_label ?? null,
    resident_name: occ.resident_name,
    lease_model: occ.lease_model,
    share_pct: occ.share_pct,
    rent:
      bed?.monthly_rent ??
      (occ.share_pct
        ? Math.round(
            ((db.units.find((u) => u.id === occ.unit_id)?.monthly_rent ?? 0) * occ.share_pct) / 100,
          )
        : 0),
    balance,
    paid: Math.round(paid),
    charged: Math.round(charged),
    payment_state: paymentState,
    payer_summary: payerNames.length ? [...new Set(payerNames)].join(" + ") : "No payment yet",
    guarantor_complete: Boolean(guarantor?.identity_verified && guarantor?.signed_at),
    pending_request: request
      ? { id: request.id, request_type: request.request_type, state: request.state }
      : null,
    move_in_ready: bed ? bed.ready : true,
  };
}

function requestChecklist(request: LeaseChangeRequest) {
  const db = getDb();
  const steps = db.approval_steps.filter((s) => s.request_id === request.id);
  return [
    { label: "Request submitted", done: Boolean(request.submitted_at) },
    {
      label: "Property manager approval",
      done: steps.some((s) => s.role === "pm" && s.state === "approved"),
    },
    ...(request.requires_owner_approval
      ? [
          {
            label: "Owner approval",
            done: steps.some((s) => s.role === "owner" && s.state === "approved"),
          },
        ]
      : []),
    { label: "Required documents attached", done: request.documents_complete },
    { label: "Signatures collected", done: request.signatures_complete },
    { label: "Fees and balances settled", done: request.payment_complete },
    { label: "Effective date set", done: Boolean(request.effective_date) },
  ];
}

function withContext(request: LeaseChangeRequest): LeaseChangeRequestWithContext {
  const db = getDb();
  const occ = db.occupancies.find((o) => o.id === request.occupancy_id);
  const bed = request.bed_id ? db.room_beds.find((b) => b.id === request.bed_id) : null;
  return {
    ...request,
    property_name: propertyName(request.property_id),
    unit_name: unitName(request.unit_id),
    bed_label: bed?.bed_label ?? null,
    resident_name: occ?.resident_name ?? "Resident",
    steps: db.approval_steps.filter((s) => s.request_id === request.id),
    checklist: requestChecklist(request),
  };
}

/* ------------------------------ configuration ----------------------------- */

export async function getStudentProperties(
  organizationId: UUID,
): Promise<StudentPropertyContext[]> {
  const db = getDb();
  return latency(
    clone(
      db.student_housing_configs
        .filter((c) => c.organization_id === organizationId)
        .map((config) => ({
          property_id: config.property_id,
          property_name: propertyName(config.property_id),
          organization_id: config.organization_id,
          config,
          current_term: currentTerm(config.property_id),
        })),
    ),
  );
}

export async function updateStudentConfig(
  propertyId: UUID,
  patch: Partial<StudentHousingConfig>,
  actorId?: UUID | null,
): Promise<StudentHousingConfig | null> {
  const db = getDb();
  const config = db.student_housing_configs.find((c) => c.property_id === propertyId);
  if (!config) return latency(null);
  Object.assign(config, patch, { updated_at: nowIso() });
  logAudit({
    organization_id: config.organization_id,
    actor_id: actorId ?? null,
    action: "student.config.updated",
    entity_type: "student_housing_config",
    entity_id: config.id,
    metadata: { keys: Object.keys(patch) },
  });
  return latency(clone(config));
}

/** Turning the category on is what launches the student surfaces. */
export async function enableStudentHousing(input: {
  propertyId: UUID;
  organizationId: UUID;
  campus: string;
  leaseModel: StudentHousingConfig["lease_model"];
  actorId?: UUID | null;
}): Promise<StudentHousingConfig> {
  const db = getDb();
  const property = db.properties.find((p) => p.id === input.propertyId);
  if (property) property.management_category = "student_housing";
  const now = nowIso();
  const existing = db.student_housing_configs.find((c) => c.property_id === input.propertyId);
  if (existing) {
    Object.assign(existing, {
      campus: input.campus,
      lease_model: input.leaseModel,
      updated_at: now,
    });
    return latency(clone(existing));
  }
  const config: StudentHousingConfig = {
    id: uuid(),
    property_id: input.propertyId,
    organization_id: input.organizationId,
    campus: input.campus,
    campus_distance_miles: null,
    lease_model: input.leaseModel,
    occupancy_limit_per_unit: null,
    guarantor_required: true,
    sublease_policy: "conditional",
    assignment_policy: "conditional",
    replacement_policy: "conditional",
    early_termination_policy: "conditional",
    requires_owner_approval: false,
    approval_sla_hours: 48,
    lease_change_fee: null,
    required_documents: ["Signed addendum", "Guarantor agreement"],
    accepted_payment_rails: ["RentID ACH", "Check (recorded)"],
    external_payment_recording: true,
    created_at: now,
    updated_at: now,
  };
  db.student_housing_configs.push(config);
  logAudit({
    organization_id: input.organizationId,
    actor_id: input.actorId ?? null,
    action: "student.category.enabled",
    entity_type: "property",
    entity_id: input.propertyId,
    metadata: { campus: input.campus },
  });
  return latency(clone(config));
}

/* ------------------------------- roster + KPIs ---------------------------- */

export async function getStudentRoster(
  organizationId: UUID,
  filters?: { propertyId?: UUID; unitId?: UUID },
): Promise<StudentRosterRow[]> {
  const db = getDb();
  const propertyIds = orgPropertyIds(organizationId);
  const rows = db.occupancies
    .filter((o) => propertyIds.includes(o.property_id) && o.stage !== "former")
    .filter((o) => (filters?.propertyId ? o.property_id === filters.propertyId : true))
    .filter((o) => (filters?.unitId ? o.unit_id === filters.unitId : true))
    .map((o) => rosterRow(o.id))
    .filter(Boolean) as StudentRosterRow[];
  rows.sort(
    (a, b) =>
      a.property_name.localeCompare(b.property_name) ||
      a.unit_name.localeCompare(b.unit_name) ||
      (a.bed_label ?? "").localeCompare(b.bed_label ?? ""),
  );
  return latency(clone(rows));
}

export async function getStudentMetrics(organizationId: UUID): Promise<StudentPortfolioMetrics> {
  const db = getDb();
  const propertyIds = orgPropertyIds(organizationId);
  const roster = (await getStudentRoster(organizationId)).filter((r) =>
    propertyIds.includes(r.property_id),
  );

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const collected = db.payment_allocations
    .filter((a) => {
      const charge = db.charges.find((c) => c.id === a.charge_id);
      return Boolean(
        charge &&
        propertyIds.includes(charge.property_id) &&
        a.created_at.slice(0, 7) === monthPrefix,
      );
    })
    .reduce((sum, a) => sum + a.amount, 0);

  return latency({
    collected_this_month: Math.round(collected),
    unpaid_beds: roster.filter((r) => r.payment_state === "unpaid").length,
    partial_residents: roster.filter((r) => r.payment_state === "partial").length,
    pending_lease_changes: db.lease_change_requests.filter(
      (r) =>
        propertyIds.includes(r.property_id) &&
        [
          "submitted",
          "under_review",
          "owner_review",
          "documents_pending",
          "signatures_pending",
          "payment_pending",
        ].includes(r.state),
    ).length,
    incomplete_guarantors: roster.filter((r) => !r.guarantor_complete).length,
    turns_not_ready: db.turn_tasks.filter(
      (t) => propertyIds.includes(t.property_id) && t.state !== "complete",
    ).length,
    beds_total: db.room_beds.filter((b) => propertyIds.includes(b.property_id)).length,
  });
}

/* ------------------------------- unit ledger ------------------------------ */

export async function getStudentUnitLedger(unitId: UUID): Promise<StudentUnitLedger | null> {
  const db = getDb();
  const unit = db.units.find((u) => u.id === unitId);
  if (!unit) return latency(null);
  const config = db.student_housing_configs.find((c) => c.property_id === unit.property_id);
  if (!config) return latency(null);

  const residents = db.occupancies
    .filter((o) => o.unit_id === unitId && o.stage !== "former")
    .map((o) => rosterRow(o.id))
    .filter(Boolean) as StudentRosterRow[];

  const chargeRows: StudentChargeRow[] = db.charges
    .filter((c) => c.unit_id === unitId)
    .map((charge) => {
      const allocations = db.charge_allocations.filter((a) => a.charge_id === charge.id);
      const paid = paidOnCharge(charge.id);
      const assigned =
        charge.scope === "unit"
          ? `Shared · ${allocations.length} residents`
          : allocations.map((a) => a.label).join(", ") || "Unassigned";
      const sources = db.payment_allocations
        .filter((a) => a.charge_id === charge.id)
        .map((a) => db.student_payments.find((p) => p.id === a.payment_id))
        .filter(Boolean);
      const source_status = charge.gated_on_request_id
        ? "Not collectible until approval"
        : sources.length === 0
          ? "No payment recorded"
          : sources.every((p) => p!.processed_by_rentid)
            ? "Paid through RentID"
            : "External payment recorded";
      return {
        ...charge,
        assigned_to: assigned,
        paid,
        balance: Math.max(0, charge.amount - charge.credits - paid),
        source_status,
      };
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const beds = db.room_beds
    .filter((b) => b.unit_id === unitId)
    .sort((a, b) => a.bed_label.localeCompare(b.bed_label))
    .map((bed) => ({
      ...bed,
      resident: residents.find((r) => r.bed_label === bed.bed_label) ?? null,
    }));

  return latency(
    clone({
      unit_id: unit.id,
      unit_name: unit.name,
      property_id: unit.property_id,
      property_name: propertyName(unit.property_id),
      campus: config.campus,
      lease_model: config.lease_model,
      term_label: currentTerm(unit.property_id)?.label ?? null,
      beds,
      residents,
      charges: chargeRows,
      requests: db.lease_change_requests.filter((r) => r.unit_id === unitId).map(withContext),
      maintenance: db.student_maintenance_cases.filter((c) => c.unit_id === unitId),
      total_balance: chargeRows.reduce((sum, c) => sum + c.balance, 0),
    }),
  );
}

/* ---------------------------- money: recording ---------------------------- */

/**
 * Record a payment and allocate it to a charge. `processedByRentID = false`
 * records an external payment (check, bank bill-pay) without ever claiming
 * RentID moved the money.
 */
export async function recordStudentPayment(input: {
  organizationId: UUID;
  chargeId: UUID;
  payerId: UUID;
  amount: number;
  method: StudentPaymentMethod;
  processedByRentID: boolean;
  reference?: string | null;
  proofLabel?: string | null;
  actorId?: UUID | null;
}) {
  const db = getDb();
  const charge = db.charges.find((c) => c.id === input.chargeId);
  if (!charge) throw new Error("Charge not found");
  if (charge.gated_on_request_id)
    throw new Error("This charge is not collectible until the request is approved");

  const now = nowIso();
  const payment = {
    id: uuid(),
    organization_id: input.organizationId,
    payer_id: input.payerId,
    amount: input.amount,
    method: input.method,
    processed_by_rentid: input.processedByRentID,
    reference: input.reference ?? null,
    proof_label: input.proofLabel ?? null,
    state: input.processedByRentID ? ("settled" as const) : ("reconciled" as const),
    received_at: now,
    created_at: now,
  };
  db.student_payments.push(payment);
  db.payment_allocations.push({
    id: uuid(),
    payment_id: payment.id,
    charge_id: charge.id,
    amount: input.amount,
    created_at: now,
  });

  const paid = paidOnCharge(charge.id);
  charge.state = paid >= charge.amount - charge.credits ? "paid" : "partial";
  charge.updated_at = now;

  db.ledger_events.push({
    id: uuid(),
    organization_id: input.organizationId,
    charge_id: charge.id,
    payment_id: payment.id,
    occupancy_id: charge.occupancy_id,
    kind: input.processedByRentID ? "payment_allocated" : "payment_recorded",
    amount: input.amount,
    balance_after: Math.max(0, charge.amount - charge.credits - paid),
    note: input.processedByRentID ? null : `External payment recorded · ${input.method}`,
    actor_id: input.actorId ?? null,
    created_at: now,
  });

  logAudit({
    organization_id: input.organizationId,
    actor_id: input.actorId ?? null,
    action: input.processedByRentID ? "student.payment.processed" : "student.payment.recorded",
    entity_type: "charge",
    entity_id: charge.id,
    metadata: { amount: input.amount, method: input.method },
  });
  return latency(clone(payment));
}

export async function getUnitLedgerEvents(unitId: UUID) {
  const db = getDb();
  const chargeIds = db.charges.filter((c) => c.unit_id === unitId).map((c) => c.id);
  return latency(
    clone(
      db.ledger_events
        .filter((e) => e.charge_id && chargeIds.includes(e.charge_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ),
  );
}

/* -------------------------- approval-first changes ------------------------ */

export async function listLeaseChangeRequests(
  organizationId: UUID,
  filters?: { state?: "open" | "all" },
): Promise<LeaseChangeRequestWithContext[]> {
  const db = getDb();
  const propertyIds = orgPropertyIds(organizationId);
  const open = [
    "submitted",
    "under_review",
    "owner_review",
    "documents_pending",
    "signatures_pending",
    "payment_pending",
    "scheduled",
  ];
  return latency(
    clone(
      db.lease_change_requests
        .filter((r) => propertyIds.includes(r.property_id))
        .filter((r) => (filters?.state === "all" ? true : open.includes(r.state)))
        .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
        .map(withContext),
    ),
  );
}

export async function getLeaseChangeRequest(requestId: UUID) {
  const request = getDb().lease_change_requests.find((r) => r.id === requestId);
  return latency(request ? clone(withContext(request)) : null);
}

export async function createLeaseChangeRequest(input: {
  organizationId: UUID;
  occupancyId: UUID;
  requestType: LeaseChangeType;
  reason: string;
  candidateName?: string | null;
  candidateEmail?: string | null;
  requestedStart?: string | null;
  actorId?: UUID | null;
}): Promise<LeaseChangeRequestWithContext> {
  const db = getDb();
  const occ = db.occupancies.find((o) => o.id === input.occupancyId);
  if (!occ) throw new Error("Occupancy not found");
  const config = db.student_housing_configs.find((c) => c.property_id === occ.property_id);

  const policyFor = (type: LeaseChangeType): PolicyMode => {
    if (!config) return "conditional";
    if (type === "sublease") return config.sublease_policy;
    if (type === "assignment") return config.assignment_policy;
    if (type === "replacement_resident") return config.replacement_policy;
    if (type === "early_termination") return config.early_termination_policy;
    return "allowed";
  };

  const now = nowIso();
  const request: LeaseChangeRequest = {
    id: uuid(),
    organization_id: input.organizationId,
    property_id: occ.property_id,
    unit_id: occ.unit_id,
    occupancy_id: occ.id,
    bed_id: occ.bed_id,
    request_type: input.requestType,
    state: "submitted",
    policy_mode: policyFor(input.requestType),
    reason: input.reason,
    requested_start: input.requestedStart ?? null,
    requested_end: occ.end_date,
    candidate_name: input.candidateName ?? null,
    candidate_email: input.candidateEmail ?? null,
    // A replacement listing never goes public on submission alone.
    replacement_listing_enabled: false,
    requires_owner_approval: Boolean(config?.requires_owner_approval),
    fee_amount: config?.lease_change_fee ?? null,
    documents_complete: false,
    signatures_complete: false,
    payment_complete: false,
    effective_date: null,
    sla_hours: config?.approval_sla_hours ?? 48,
    submitted_at: now,
    decided_at: null,
    created_at: now,
    updated_at: now,
  };
  db.lease_change_requests.push(request);

  const steps: ApprovalStep[] = [
    {
      id: uuid(),
      request_id: request.id,
      role: "pm",
      label: "Property manager review",
      state: "pending",
      actor_name: null,
      note: null,
      decided_at: null,
      created_at: now,
    },
  ];
  if (request.requires_owner_approval) {
    steps.push({
      id: uuid(),
      request_id: request.id,
      role: "owner",
      label: "Owner approval",
      state: "pending",
      actor_name: null,
      note: null,
      decided_at: null,
      created_at: now,
    });
  }
  db.approval_steps.push(...steps);

  logAudit({
    organization_id: input.organizationId,
    actor_id: input.actorId ?? null,
    action: "student.lease_change.submitted",
    entity_type: "lease_change_request",
    entity_id: request.id,
    metadata: { type: input.requestType, policy: request.policy_mode },
  });
  return latency(clone(withContext(request)));
}

/**
 * Advance a request. Approvals are recorded as immutable steps; nothing takes
 * effect until documents, signatures, money and an effective date all land.
 */
export async function decideLeaseChange(input: {
  requestId: UUID;
  action:
    | "start_review"
    | "pm_approve"
    | "owner_approve"
    | "deny"
    | "attach_documents"
    | "collect_signatures"
    | "settle_money"
    | "enable_replacement_listing"
    | "schedule"
    | "make_effective";
  note?: string | null;
  effectiveDate?: string | null;
  actorName?: string | null;
  actorId?: UUID | null;
}): Promise<LeaseChangeRequestWithContext | null> {
  const db = getDb();
  const request = db.lease_change_requests.find((r) => r.id === input.requestId);
  if (!request) return latency(null);
  const now = nowIso();
  const steps = db.approval_steps.filter((s) => s.request_id === request.id);
  const decide = (role: ApprovalStep["role"], state: ApprovalStep["state"]) => {
    const step = steps.find((s) => s.role === role);
    if (step) {
      step.state = state;
      step.actor_name = input.actorName ?? null;
      step.note = input.note ?? null;
      step.decided_at = now;
    }
  };

  switch (input.action) {
    case "start_review":
      request.state = "under_review";
      break;
    case "pm_approve":
      decide("pm", "approved");
      request.state = request.requires_owner_approval ? "owner_review" : "documents_pending";
      break;
    case "owner_approve":
      decide("owner", "approved");
      request.state = "documents_pending";
      break;
    case "deny":
      decide(request.state === "owner_review" ? "owner" : "pm", "denied");
      request.state = "denied";
      request.decided_at = now;
      request.replacement_listing_enabled = false;
      break;
    case "attach_documents":
      request.documents_complete = true;
      request.state = "signatures_pending";
      break;
    case "collect_signatures":
      request.signatures_complete = true;
      request.state = request.fee_amount ? "payment_pending" : "scheduled";
      break;
    case "settle_money": {
      request.payment_complete = true;
      request.state = "scheduled";
      const gated = db.charges.find((c) => c.gated_on_request_id === request.id);
      if (gated) {
        gated.gated_on_request_id = null;
        gated.state = "open";
        gated.updated_at = now;
      }
      break;
    }
    case "enable_replacement_listing":
      // Only permitted once an operator has approved the request.
      if (
        [
          "documents_pending",
          "signatures_pending",
          "payment_pending",
          "scheduled",
          "approved",
        ].includes(request.state)
      ) {
        request.replacement_listing_enabled = true;
      }
      break;
    case "schedule":
      request.effective_date = input.effectiveDate ?? null;
      request.state = "scheduled";
      break;
    case "make_effective":
      request.state = "completed";
      request.decided_at = now;
      request.effective_date = request.effective_date ?? now.slice(0, 10);
      break;
  }
  request.updated_at = now;

  logAudit({
    organization_id: request.organization_id,
    actor_id: input.actorId ?? null,
    action: `student.lease_change.${input.action}`,
    entity_type: "lease_change_request",
    entity_id: request.id,
    metadata: { state: request.state, note: input.note ?? null },
  });
  return latency(clone(withContext(request)));
}

/* ------------------------- pre-leasing and renewals ----------------------- */

export async function getPreLeasing(
  organizationId: UUID,
  propertyId?: UUID,
): Promise<PreLeasingSummary> {
  const db = getDb();
  const propertyIds = propertyId ? [propertyId] : orgPropertyIds(organizationId);
  const beds = db.room_beds.filter((b) => propertyIds.includes(b.property_id));
  const preLeasedStatuses: BedStatus[] = ["renewing", "leased", "approved", "held"];
  const preLeased = beds.filter((b) => preLeasedStatuses.includes(b.status)).length;

  const pipelineOrder: BedStatus[] = [
    "available",
    "applied",
    "approved",
    "held",
    "leased",
    "renewing",
    "notice_given",
    "occupied",
    "offline",
  ];
  const pipeline = pipelineOrder
    .map((status) => ({ status, count: beds.filter((b) => b.status === status).length }))
    .filter((row) => row.count > 0);

  const groups = db.roommate_groups
    .filter((g) => propertyIds.includes(g.property_id))
    .map((g) => ({
      ...g,
      members: db.roommate_group_members.filter((m) => m.group_id === g.id),
      property_name: propertyName(g.property_id),
    }));

  return latency(
    clone({
      term: propertyIds[0] ? nextTerm(propertyIds[0]) : null,
      beds_total: beds.length,
      pre_leased: preLeased,
      pre_leased_pct: beds.length ? Math.round((preLeased / beds.length) * 100) : 0,
      renewals_pending: db.occupancies.filter(
        (o) => propertyIds.includes(o.property_id) && o.stage === "current",
      ).length,
      applications_in_review: groups.filter((g) =>
        ["submitted", "screening", "operator_review"].includes(g.stage),
      ).length,
      changes_pending: db.lease_change_requests.filter(
        (r) =>
          propertyIds.includes(r.property_id) &&
          !["completed", "denied", "withdrawn"].includes(r.state),
      ).length,
      pipeline,
      groups,
    }),
  );
}

export async function updateRoommateGroupStage(
  groupId: UUID,
  stage: PreLeasingSummary["groups"][number]["stage"],
  actorId?: UUID | null,
) {
  const db = getDb();
  const group = db.roommate_groups.find((g) => g.id === groupId);
  if (!group) return latency(null);
  group.stage = stage;
  group.updated_at = nowIso();
  logAudit({
    organization_id: group.organization_id,
    actor_id: actorId ?? null,
    action: "student.group.stage_changed",
    entity_type: "roommate_group",
    entity_id: group.id,
    metadata: { stage },
  });
  return latency(clone(group));
}

/* --------------------------------- turnover ------------------------------- */

export async function getTurnover(
  organizationId: UUID,
  propertyId?: UUID,
): Promise<TurnoverSummary> {
  const db = getDb();
  const propertyIds = propertyId ? [propertyId] : orgPropertyIds(organizationId);
  const tasks = db.turn_tasks
    .filter((t) => propertyIds.includes(t.property_id))
    .map((t) => ({
      ...t,
      property_name: propertyName(t.property_id),
      unit_name: unitName(t.unit_id),
      bed_label: t.bed_id ? (db.room_beds.find((b) => b.id === t.bed_id)?.bed_label ?? null) : null,
    }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const beds = db.room_beds.filter((b) => propertyIds.includes(b.property_id));
  const inspections = tasks.filter((t) => t.category === "inspection");

  return latency(
    clone({
      moving_out: db.occupancies.filter(
        (o) => propertyIds.includes(o.property_id) && o.stage === "current",
      ).length,
      inspected: inspections.filter((t) => t.state === "complete").length,
      inspection_remaining: inspections.filter((t) => t.state !== "complete").length,
      make_ready_open: tasks.filter((t) => t.state !== "complete" && t.category !== "inspection")
        .length,
      beds_ready: beds.filter((b) => b.ready).length,
      move_in_blocked: tasks.filter((t) => t.state === "blocked").length,
      tasks,
    }),
  );
}

export async function updateTurnTask(
  taskId: UUID,
  patch: {
    state?: "not_started" | "in_progress" | "blocked" | "complete";
    blocker_reason?: string | null;
    vendor?: string | null;
  },
  actorId?: UUID | null,
) {
  const db = getDb();
  const task = db.turn_tasks.find((t) => t.id === taskId);
  if (!task) return latency(null);
  Object.assign(task, patch, { updated_at: nowIso() });
  if (task.state === "complete") {
    task.blocker_reason = null;
    if (task.bed_id) {
      const bed = db.room_beds.find((b) => b.id === task.bed_id);
      if (bed) {
        bed.ready = true;
        bed.updated_at = nowIso();
      }
    }
  }
  logAudit({
    organization_id: task.organization_id,
    actor_id: actorId ?? null,
    action: "student.turn_task.updated",
    entity_type: "turn_task",
    entity_id: task.id,
    metadata: { state: task.state },
  });
  return latency(clone(task));
}

/* --------------------------- maintenance + damage ------------------------- */

export async function listStudentMaintenance(
  organizationId: UUID,
  propertyId?: UUID,
): Promise<StudentMaintenanceCase[]> {
  const db = getDb();
  const propertyIds = propertyId ? [propertyId] : orgPropertyIds(organizationId);
  return latency(
    clone(
      db.student_maintenance_cases
        .filter((c) => propertyIds.includes(c.property_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    ),
  );
}

/**
 * Damage responsibility is a documented decision: it needs a lease basis and
 * leaves the resident's disputed response visible. It never becomes a score.
 */
export async function allocateDamage(input: {
  caseId: UUID;
  allocation: StudentMaintenanceCase["damage_allocation"];
  amount: number | null;
  leaseBasis: string;
  actorId?: UUID | null;
}) {
  const db = getDb();
  const record = db.student_maintenance_cases.find((c) => c.id === input.caseId);
  if (!record) return latency(null);
  record.damage_allocation = input.allocation;
  record.damage_amount = input.amount;
  record.lease_basis = input.leaseBasis;
  record.affects_verified_history = record.evidence.length > 0 && record.status === "resolved";
  record.updated_at = nowIso();
  logAudit({
    organization_id: record.organization_id,
    actor_id: input.actorId ?? null,
    action: "student.damage.allocated",
    entity_type: "student_maintenance_case",
    entity_id: record.id,
    metadata: { allocation: input.allocation, amount: input.amount },
  });
  return latency(clone(record));
}

export async function getStudentChargeContext(chargeId: UUID) {
  const db = getDb();
  const charge = db.charges.find((c) => c.id === chargeId) as Charge | undefined;
  if (!charge) return latency(null);
  const eligiblePayers = db.payers.filter((p) =>
    charge.occupancy_id ? p.linked_occupancy_id === charge.occupancy_id : true,
  );
  return latency(
    clone({
      charge,
      allocations: db.charge_allocations.filter((a) => a.charge_id === charge.id),
      payers: eligiblePayers,
      paid: paidOnCharge(charge.id),
    }),
  );
}

export type { RoomBed };

/* --------------------------- resident-side reads -------------------------- */

/**
 * Everything a student resident may see about their own housing: their bed,
 * their roommates by name only, their own charges and payers, their lease
 * change requests and the maintenance cases on their unit. A roommate's money
 * is never included — the same boundary the planned RLS enforces server-side.
 */
export async function getResidentHousing(userId: UUID): Promise<ResidentHousing | null> {
  const db = getDb();
  const occupancy = db.occupancies.find(
    (o) => o.resident_user_id === userId && o.stage !== "former",
  );
  if (!occupancy) return latency(null);
  const config = db.student_housing_configs.find((c) => c.property_id === occupancy.property_id);
  const bed = db.room_beds.find((b) => b.id === occupancy.bed_id) ?? null;
  const term = currentTerm(occupancy.property_id);

  const myChargeRows: StudentChargeRow[] = db.charges
    .filter((charge) => {
      if (charge.occupancy_id === occupancy.id) return true;
      return db.charge_allocations.some(
        (a) => a.charge_id === charge.id && a.occupancy_id === occupancy.id,
      );
    })
    .map((charge) => {
      const allocation = db.charge_allocations.find(
        (a) => a.charge_id === charge.id && a.occupancy_id === occupancy.id,
      );
      const amount = allocation?.amount ?? charge.amount;
      const mine = db.payment_allocations
        .filter((a) => a.charge_id === charge.id)
        .filter((a) => {
          const payment = db.student_payments.find((p) => p.id === a.payment_id);
          const payer = payment ? db.payers.find((x) => x.id === payment.payer_id) : null;
          return !payer?.linked_occupancy_id || payer.linked_occupancy_id === occupancy.id;
        })
        .reduce((sum, a) => sum + a.amount, 0);
      const paid = Math.min(amount, mine);
      const sources = db.payment_allocations
        .filter((a) => a.charge_id === charge.id)
        .map((a) => db.student_payments.find((p) => p.id === a.payment_id))
        .filter(Boolean);
      return {
        ...charge,
        amount,
        assigned_to: allocation?.label ?? occupancy.resident_name,
        paid,
        balance: Math.max(0, amount - paid),
        source_status: charge.gated_on_request_id
          ? "Not collectible until approval"
          : sources.length === 0
            ? "No payment recorded"
            : sources.every((p) => p!.processed_by_rentid)
              ? "Paid through RentID"
              : "External payment recorded",
      };
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const myPayers = db.payers.filter((p) => p.linked_occupancy_id === occupancy.id);
  const myChargeIds = myChargeRows.map((c) => c.id);
  const events = db.ledger_events
    .filter(
      (e) => (e.charge_id && myChargeIds.includes(e.charge_id)) || e.occupancy_id === occupancy.id,
    )
    // A shared charge produces one event per roommate payment; only mine is mine.
    .filter((e) => {
      if (!e.payment_id) return true;
      const payment = db.student_payments.find((p) => p.id === e.payment_id);
      const payer = payment ? db.payers.find((x) => x.id === payment.payer_id) : null;
      return !payer?.linked_occupancy_id || payer.linked_occupancy_id === occupancy.id;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);

  const roommates = db.occupancies
    .filter((o) => o.unit_id === occupancy.unit_id && o.id !== occupancy.id && o.stage !== "former")
    .map((o) => ({
      name: o.resident_name,
      bed_label: db.room_beds.find((b) => b.id === o.bed_id)?.bed_label ?? null,
      share_pct: o.share_pct,
      verified: o.verified,
    }));

  return latency(
    clone({
      occupancy,
      bed,
      property_name: propertyName(occupancy.property_id),
      unit_name: unitName(occupancy.unit_id),
      campus: config?.campus ?? null,
      lease_model: occupancy.lease_model,
      term_label: term?.label ?? null,
      renewal_deadline: term?.renewal_deadline ?? null,
      sublease_policy: config?.sublease_policy ?? "conditional",
      replacement_policy: config?.replacement_policy ?? "conditional",
      roommates,
      charges: myChargeRows,
      balance: myChargeRows.reduce((sum, c) => sum + c.balance, 0),
      payers: myPayers,
      guarantors: db.guarantor_relationships.filter((g) => g.occupancy_id === occupancy.id),
      requests: db.lease_change_requests
        .filter((r) => r.occupancy_id === occupancy.id)
        .map(withContext),
      maintenance: db.student_maintenance_cases.filter((c) => c.unit_id === occupancy.unit_id),
      events,
    }),
  );
}
