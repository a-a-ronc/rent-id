/**
 * Property ownership & authorized-representative verification — Supabase-backed.
 *
 * Separate from tenancy verification: this answers *who owns this exact
 * property* and *who may act for that owner*, property by property. Three
 * independent propositions (property, identity, authority) are tracked with
 * their own confidence dimensions and must each hold before a badge is issued.
 *
 * Everything here goes through `db` (RLS-scoped), and the database — not this
 * file — owns every trust-bearing write (supabase/migrations/…_property_verification.sql):
 *
 *   * inserting a `verification_cases` row fires a trigger that creates the
 *     pending relationship and the `verification.case_opened` history entry,
 *     so this service must never write those itself;
 *   * inserting `verification_evidence` moves the case to manual_review and
 *     writes its own history entry;
 *   * case status, the three confidences, contradictions and every badge move
 *     only through `decide_verification_case()` (admin/platform) — direct
 *     updates are refused even for admins, by design;
 *   * `representative_authorizations` are issued pending, accepted by the
 *     representative, revoked by either side, all enforced by a trigger.
 *
 * Providers are not configured yet (src/lib/verification/providers.ts), so
 * automated checks can only park a case with a human. A badge is only ever
 * issued by an explicit reviewer decision or production-grade official
 * evidence — this file can never grant one.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import {
  currentUserId,
  db,
  DbError,
  logAudit,
  NotFoundError,
  nowIso,
  unwrap,
  unwrapMaybe,
  unwrapOne,
} from "@/lib/db";
import { compareOwnerName, normalizeOwnerName } from "@/lib/verification/address";
import {
  AssessorDataProvider,
  IdentityVerificationProvider,
  PropertyDataProvider,
  RecordedDocumentProvider,
  evidenceCanIssueBadge,
  providerStatuses,
} from "@/lib/verification/providers";
import type { IdentityFinding, OwnerFinding } from "@/lib/verification/providers";
import { DISCLOSURE_VERSION, VERIFICATION_RULES_VERSION } from "@/lib/verification-types";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import type {
  AuthorizationStatus,
  ConfidenceLevel,
  DisclosureContext,
  EvidenceSourceType,
  EvidenceStrength,
  Property,
  PropertyBadge,
  PropertyClaimRelationship,
  PropertyOwnershipRecord,
  PropertyPartyRelationship,
  PropertyPermission,
  PropertyRelationshipKind,
  PropertyVerification,
  ProviderMode,
  RepresentativeAuthorization,
  RiskEventKind,
  UUID,
  VerificationCase,
  VerificationCaseStatus,
  VerificationEvidence,
  VerificationProposition,
  VerificationQueueItem,
  VerificationRiskEvent,
  VerificationStatusEvent,
  VerifiedEntity,
} from "@/lib/types";

export const DEFAULT_REPRESENTATIVE_PERMISSIONS: PropertyPermission[] = [
  "manage_listing",
  "view_applications",
  "manage_applications",
  "manage_leases",
  "manage_tenants",
  "manage_maintenance",
  "message_tenants",
  "manage_documents",
];

export const PERMISSION_LABELS: Record<PropertyPermission, string> = {
  manage_listing: "Manage the listing",
  view_applications: "View applications",
  manage_applications: "Decide applications",
  manage_leases: "Manage leases",
  approve_lease_changes: "Approve lease changes",
  manage_tenants: "Manage tenants",
  view_ledger: "View the rental ledger",
  view_payments: "View payments",
  manage_payment_settings: "Manage payment settings",
  manage_maintenance: "Manage maintenance",
  message_tenants: "Message tenants",
  manage_documents: "Manage documents",
  manage_property_records: "Manage property records",
};

export const CLAIM_LABELS: Record<PropertyClaimRelationship, string> = {
  individual_owner: "I personally own this property",
  entity_owner_representative: "A business or entity I represent owns this property",
  authorized_representative: "I am the property manager or authorized representative",
  trust_or_estate: "The property is owned by a trust or estate",
  other: "Other",
};

/* ------------------------------ row mappers ------------------------------- */
/* Local to this file on purpose: src/lib/db/mappers.ts covers the core domain
   and none of these nine tables appear there. Keep each mapper total so
   TypeScript catches drift when types.ts is regenerated. */

type CaseRow = Tables<"verification_cases">;
type EvidenceRow = Tables<"verification_evidence">;
type RelationshipRow = Tables<"property_party_relationships">;
type AuthorizationRow = Tables<"representative_authorizations">;
type OwnershipRow = Tables<"property_ownership_records">;
type RiskEventRow = Tables<"verification_risk_events">;
type StatusEventRow = Tables<"verification_status_events">;
type EntityRow = Tables<"verified_entities">;
type PropertyFactsRow = Pick<
  Tables<"properties">,
  "id" | "name" | "street_address" | "city" | "state" | "zip"
>;

const toCase = (r: CaseRow): VerificationCase => ({
  id: r.id,
  property_id: r.property_id,
  organization_id: r.organization_id,
  claimant_user_id: r.claimant_user_id,
  claimant_name: r.claimant_name,
  claim_relationship: r.claim_relationship,
  status: r.status,
  property_confidence: r.property_confidence,
  identity_confidence: r.identity_confidence,
  authority_confidence: r.authority_confidence,
  hard_contradiction: r.hard_contradiction,
  contradictions: r.contradictions ?? [],
  entity_id: r.entity_id,
  rules_version: r.rules_version,
  reviewer_id: r.reviewer_id,
  decision_reason: r.decision_reason,
  created_at: r.created_at,
  updated_at: r.updated_at,
  decided_at: r.decided_at,
  last_verified_at: r.last_verified_at,
  next_review_at: r.next_review_at,
  reverification_required: r.reverification_required,
});

const toEvidence = (r: EvidenceRow): VerificationEvidence => ({
  id: r.id,
  case_id: r.case_id,
  proposition: r.proposition,
  evidence_type: r.evidence_type,
  source_type: r.source_type,
  source_provider: r.source_provider,
  official_reference: r.official_reference,
  retrieved_at: r.retrieved_at,
  document_date: r.document_date,
  document_hash: r.document_hash,
  storage_path: r.storage_path,
  strength: r.strength,
  summary: r.summary,
  expires_at: r.expires_at,
  created_at: r.created_at,
});

const toRelationship = (r: RelationshipRow): PropertyPartyRelationship => ({
  id: r.id,
  property_id: r.property_id,
  user_id: r.user_id,
  organization_id: r.organization_id,
  entity_id: r.entity_id,
  relationship: r.relationship,
  status: r.status,
  recorded_owner_name: r.recorded_owner_name,
  verified_at: r.verified_at,
  expires_at: r.expires_at,
  revoked_at: r.revoked_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const toAuthorization = (r: AuthorizationRow): RepresentativeAuthorization => ({
  id: r.id,
  property_id: r.property_id,
  owner_user_id: r.owner_user_id,
  owner_name: r.owner_name,
  representative_user_id: r.representative_user_id,
  representative_organization_id: r.representative_organization_id,
  representative_name: r.representative_name,
  role: r.role,
  permissions: (r.permissions ?? []) as PropertyPermission[],
  status: r.status,
  granted_at: r.granted_at,
  expires_at: r.expires_at,
  revoked_at: r.revoked_at,
  revoked_reason: r.revoked_reason,
  verification_case_id: r.verification_case_id,
  management_assignment_id: r.management_assignment_id,
  created_at: r.created_at,
});

const toOwnershipRecord = (r: OwnershipRow): PropertyOwnershipRecord => ({
  id: r.id,
  property_id: r.property_id,
  owner_party_type: r.owner_party_type,
  raw_owner_name: r.raw_owner_name,
  normalized_owner_name: r.normalized_owner_name,
  ownership_capacity: r.ownership_capacity,
  recorded_at: r.recorded_at,
  instrument_reference: r.instrument_reference,
  source_type: r.source_type,
  source_provider: r.source_provider,
  retrieved_at: r.retrieved_at,
  is_current: r.is_current,
  superseded_by: r.superseded_by,
  created_at: r.created_at,
});

const toRiskEvent = (r: RiskEventRow): VerificationRiskEvent => ({
  id: r.id,
  property_id: r.property_id,
  case_id: r.case_id,
  user_id: r.user_id,
  kind: r.kind as RiskEventKind,
  severity: r.severity,
  detail: r.detail,
  created_at: r.created_at,
  resolved_at: r.resolved_at,
});

const toStatusEvent = (r: StatusEventRow): VerificationStatusEvent => ({
  id: r.id,
  property_id: r.property_id,
  case_id: r.case_id,
  actor_id: r.actor_id,
  action: r.action,
  from_status: r.from_status,
  to_status: r.to_status,
  reason: r.reason,
  created_at: r.created_at,
});

const toEntity = (r: EntityRow): VerifiedEntity => ({
  id: r.id,
  legal_name: r.legal_name,
  normalized_name: r.normalized_name,
  entity_type: r.entity_type,
  formation_state: r.formation_state,
  file_number: r.file_number,
  registry_status: r.registry_status,
  verified: r.verified,
  verified_at: r.verified_at,
  created_at: r.created_at,
});

/* -------------------------------- internals ------------------------------- */

/**
 * `queue_verification_case_for_review`, `record_verification_risk_event` and
 * `require_property_reverification` were added by migration 20260915000810 and
 * are not in the generated `Database["public"]["Functions"]` yet (regenerate
 * with `bun run db:types`); until then these calls go through this shim.
 */
const rpcUntyped = db.rpc.bind(db) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: PostgrestError | null }>;

const desc = (a: string, b: string) => b.localeCompare(a);

/** Complex vesting always needs a human. */
function needsManualReview(relationship: PropertyClaimRelationship) {
  return relationship === "trust_or_estate" || relationship === "other";
}

/** A newer recorded deed outranks a stale assessor owner field. */
function currentOwnershipRecord(
  records: PropertyOwnershipRecord[],
): PropertyOwnershipRecord | null {
  const strength = (r: PropertyOwnershipRecord) => (r.source_type === "recorded_document" ? 1 : 0);
  return (
    [...records]
      .filter((r) => r.is_current)
      .sort((a, b) =>
        strength(b) !== strength(a)
          ? strength(b) - strength(a)
          : desc(a.recorded_at ?? "", b.recorded_at ?? ""),
      )[0] ?? null
  );
}

function badgeFor(relationships: PropertyPartyRelationship[]): PropertyBadge {
  const live = relationships.filter((r) => r.revoked_at === null);
  if (live.some((r) => r.status === "ownership_verified")) return "ownership_verified";
  if (live.some((r) => r.status === "authorized_representative_verified")) {
    return "authorized_representative";
  }
  return null;
}

/**
 * Version string for the property's trust state. A tenant re-sees the
 * disclosure only when this — or the payee, or the wording — changes.
 *
 * Built from what the CALLER can see: a tenant reads the public badge rows but
 * never the ownership records or the authorizations behind them, so their
 * version string is coarser than an owner's. That is fine — a tenant's
 * acknowledgement is only ever compared against a version computed the same
 * way, and every fact a tenant can see (badge, recorded owner name on the
 * badge) still moves it when the trust state changes.
 */
function verificationVersion(
  relationships: PropertyPartyRelationship[],
  records: PropertyOwnershipRecord[],
  authorizations: RepresentativeAuthorization[],
): string {
  const badge = badgeFor(relationships) ?? "none";
  const badgeOwner = relationships.find(
    (r) => r.revoked_at === null && r.recorded_owner_name !== null,
  )?.recorded_owner_name;
  const owner =
    currentOwnershipRecord(records)?.normalized_owner_name ??
    (badgeOwner ? normalizeOwnerName(badgeOwner) : null) ??
    "unknown";
  const reps = authorizations
    .filter((a) => a.status === "active")
    .map((a) => a.representative_name)
    .sort()
    .join("|");
  return `${badge}:${owner}:${reps}`;
}

async function readCase(caseId: UUID): Promise<VerificationCase> {
  const row = unwrapMaybe<CaseRow>(
    await db.from("verification_cases").select("*").eq("id", caseId).maybeSingle(),
  );
  if (!row) throw new NotFoundError("Verification case");
  return toCase(row);
}

/* ------------------------------- claims ---------------------------------- */

/**
 * Opens a property-specific claim. The AFTER INSERT trigger on
 * `verification_cases` creates the pending, badge-less relationship row and
 * the `verification.case_opened` history entry, so neither is written here.
 * A claim never grants any verification by itself: the insert policy only
 * accepts a pre-verification status with zero confidence.
 */
async function openClaim(input: {
  propertyId: UUID;
  claimantUserId: UUID | null;
  claimantName: string | null;
  relationship: PropertyClaimRelationship;
  organizationId: UUID | null;
}): Promise<VerificationCase> {
  const claimant = input.claimantUserId ?? (await currentUserId());
  const inserted = unwrapOne(
    await db
      .from("verification_cases")
      .insert({
        property_id: input.propertyId,
        organization_id: input.organizationId,
        claimant_user_id: claimant,
        claimant_name: input.claimantName?.trim() || "RentID account holder",
        claim_relationship: input.relationship,
        status: needsManualReview(input.relationship) ? "manual_review" : "collecting_evidence",
        rules_version: VERIFICATION_RULES_VERSION,
      })
      .select("id")
      .single(),
    "Verification case",
  );
  // Read the case back so the trigger's work (and any platform defaulting) is
  // what the caller sees.
  const opened = await readCase(inserted.id);
  await logAudit({
    organization_id: input.organizationId,
    action: "property_verification.claim_opened",
    entity_type: "verification_case",
    entity_id: opened.id,
    metadata: { relationship: input.relationship, property_id: input.propertyId },
  });
  await detectRapidClaims(claimant);
  return opened;
}

/**
 * Opens a claim for a property the caller already has in hand.
 *
 * Async now (it was synchronous against the mock): every write is a round
 * trip. `createProperty` in src/lib/services/portfolio.ts already awaits it.
 */
export async function openPropertyClaim(input: {
  property: Property;
  claimantUserId: UUID | null;
  claimantName: string | null;
  relationship: PropertyClaimRelationship;
  organizationId: UUID | null;
}): Promise<VerificationCase> {
  return openClaim({
    propertyId: input.property.id,
    claimantUserId: input.claimantUserId,
    claimantName: input.claimantName,
    relationship: input.relationship,
    organizationId: input.organizationId,
  });
}

/** Start (or restart) a claim on a property that already exists. */
export async function startPropertyClaim(input: {
  propertyId: UUID;
  claimantUserId: UUID | null;
  claimantName?: string | null;
  relationship: PropertyClaimRelationship;
}): Promise<VerificationCase> {
  // The property row is readable to its operators but NOT, for example, to an
  // invited representative — who may still open a claim (can_claim_property).
  // Absent row ⇒ claim under no organization; the database decides standing.
  const property = unwrapMaybe<{ organization_id: string }>(
    await db.from("properties").select("organization_id").eq("id", input.propertyId).maybeSingle(),
  );
  const created = await openClaim({
    propertyId: input.propertyId,
    claimantUserId: input.claimantUserId,
    claimantName: input.claimantName ?? null,
    relationship: input.relationship,
    organizationId: property?.organization_id ?? null,
  });
  return runAutomatedChecks(created.id);
}

/**
 * Many unrelated claims in a short window is reviewed, never accused.
 *
 * RLS-scoped: this counts the caller's own cases, which is the signal that
 * matters here. Best-effort — a heuristic must never block a legitimate claim.
 */
async function detectRapidClaims(userId: UUID | null) {
  if (!userId) return;
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const recent = unwrap(
      await db
        .from("verification_cases")
        .select("id")
        .eq("claimant_user_id", userId)
        .gte("created_at", since),
    );
    if (recent.length >= 5) {
      await recordRiskEvent({
        propertyId: null,
        caseId: null,
        userId,
        kind: "rapid_multi_property_claims",
        severity: "medium",
        detail: `${recent.length} property claims opened in 24 hours.`,
      });
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[verification] rapid-claim check skipped:", error);
  }
}

/* ------------------------------- evidence -------------------------------- */

export async function submitEvidence(input: {
  caseId: UUID;
  proposition: VerificationProposition;
  evidenceType: string;
  summary: string;
  sourceType?: EvidenceSourceType;
  strength?: EvidenceStrength;
  storagePath?: string | null;
  documentDate?: string | null;
  actorId?: UUID | null;
}): Promise<VerificationEvidence> {
  const c = unwrapMaybe<{
    id: string;
    property_id: string;
    organization_id: string | null;
    claimant_user_id: string | null;
  }>(
    await db
      .from("verification_cases")
      .select("id, property_id, organization_id, claimant_user_id")
      .eq("id", input.caseId)
      .maybeSingle(),
  );
  if (!c) throw new NotFoundError("Verification case");

  const row = unwrapOne(
    await db
      .from("verification_evidence")
      .insert({
        case_id: c.id,
        // re-derived from the case by the before-insert trigger; sent because
        // the column is NOT NULL in the generated Insert type
        property_id: c.property_id,
        proposition: input.proposition,
        evidence_type: input.evidenceType,
        summary: input.summary,
        // Uploads are never primary proof — documents can be forged, and the
        // insert policy refuses anything a client dresses up as official.
        source_type: input.sourceType ?? "user_upload",
        source_provider: "user",
        strength: input.strength ?? "unverified_upload",
        storage_path: input.storagePath ?? null,
        document_date: input.documentDate ?? null,
        retrieved_at: nowIso(),
        submitted_by: input.actorId ?? (await currentUserId()),
      })
      .select("*")
      .single(),
    "Evidence",
  );
  const evidence = toEvidence(row);

  // The after-insert trigger has already moved the case to manual_review and
  // written the `verification.evidence_submitted` history entry.
  await flagReusedDocument(c.property_id, c.id, c.claimant_user_id, evidence.summary);
  await logAudit({
    organization_id: c.organization_id,
    action: "property_verification.evidence_submitted",
    entity_type: "verification_case",
    entity_id: c.id,
    metadata: { evidence_type: input.evidenceType, proposition: input.proposition },
  });
  return evidence;
}

/**
 * The same supporting document on another property is a risk signal.
 *
 * RLS narrows this to cases the submitter can already see — their own and
 * their organization's — which is exactly the "one deed, five properties"
 * pattern. Reuse ACROSS accounts is invisible from a browser and belongs to a
 * platform-side sweep over `verification_evidence.document_hash`.
 */
async function flagReusedDocument(
  propertyId: UUID,
  caseId: UUID,
  claimantUserId: UUID | null,
  summary: string,
) {
  try {
    const reused = unwrap(
      await db
        .from("verification_evidence")
        .select("id")
        .eq("summary", summary)
        .neq("case_id", caseId)
        .limit(1),
    );
    if (reused.length > 0) {
      await recordRiskEvent({
        propertyId,
        caseId,
        userId: claimantUserId,
        kind: "reused_document",
        severity: "medium",
        detail: "The same supporting document was submitted for another property.",
      });
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[verification] reuse check skipped:", error);
  }
}

function ownerFindingEvidence(
  c: VerificationCase,
  provider: string,
  finding: OwnerFinding,
): TablesInsert<"verification_evidence"> {
  return {
    case_id: c.id,
    property_id: c.property_id,
    proposition: "property",
    evidence_type: "recorded_owner",
    summary: `Recorded owner ${finding.raw_owner_name} (${finding.ownership_capacity}).`,
    source_type: finding.source_type,
    source_provider: provider,
    strength: finding.strength,
    official_reference: finding.instrument_reference,
    document_date: finding.recorded_at,
    retrieved_at: finding.retrieved_at,
  };
}

function identityFindingEvidence(
  c: VerificationCase,
  provider: string,
  finding: IdentityFinding,
  mode: ProviderMode,
): TablesInsert<"verification_evidence"> {
  return {
    case_id: c.id,
    property_id: c.property_id,
    proposition: "identity",
    evidence_type: "identity_check",
    summary: `Identity check ${finding.passed ? "passed" : "did not pass"} for ${finding.legal_name}.`,
    source_type: "identity_provider",
    source_provider: provider,
    // an identity check corroborates a claimant, it is never title proof
    strength: evidenceCanIssueBadge(mode) ? "supporting" : "unverified_upload",
    // a provider reference token, never a raw document number
    official_reference: finding.provider_reference,
    retrieved_at: nowIso(),
  };
}

/**
 * Runs the provider chain. With no vendor configured this records why the case
 * cannot be automated and parks it with a reviewer — it must never fabricate a
 * success, and it can never issue a badge: only `decide_verification_case()`
 * writes a status, a confidence or a badge.
 */
export async function runAutomatedChecks(caseId: UUID): Promise<VerificationCase> {
  const c = await readCase(caseId);
  // Property facts are readable to the property's operators; an invited
  // representative may have a case without being able to read the row.
  const property = unwrapMaybe<{
    normalized_address: string | null;
    state: string;
    zip: string;
    parcel_number: string | null;
    recording_jurisdiction: string | null;
  }>(
    await db
      .from("properties")
      .select("normalized_address, state, zip, parcel_number, recording_jurisdiction")
      .eq("id", c.property_id)
      .maybeSingle(),
  );

  const notes: string[] = [];
  const parcel = await PropertyDataProvider.findParcel({
    normalizedAddress: property?.normalized_address ?? "",
    state: property?.state ?? "",
    zip: property?.zip ?? "",
  });
  if (!parcel.ok) notes.push(parcel.reason);

  const deed = await RecordedDocumentProvider.currentOwner({
    parcelNumber: property?.parcel_number ?? null,
    jurisdiction: property?.recording_jurisdiction ?? null,
  });
  const assessor = await AssessorDataProvider.owner({
    parcelNumber: property?.parcel_number ?? null,
  });
  const identity = await IdentityVerificationProvider.verifyPerson({
    userId: c.claimant_user_id ?? "",
    legalName: c.claimant_name,
  });

  // Record what actually came back — nothing is invented. With every provider
  // `not_configured` this list is always empty today. These rows carry the
  // provider's own source_type/strength, which a browser client may never
  // assert (verification_evidence_insert_claimant); a configured provider runs
  // server-side on the service-role client, where the insert is allowed.
  const findings: TablesInsert<"verification_evidence">[] = [];
  if (deed.ok) {
    findings.push(
      ...deed.data.map((finding) => ownerFindingEvidence(c, "recorded_documents", finding)),
    );
  }
  if (assessor.ok) findings.push(ownerFindingEvidence(c, "assessor", assessor.data));
  if (identity.ok) {
    findings.push(identityFindingEvidence(c, "identity", identity.data, identity.mode));
  }
  if (findings.length > 0) unwrap(await db.from("verification_evidence").insert(findings));

  const propertyConfidence: ConfidenceLevel =
    deed.ok && evidenceCanIssueBadge(deed.mode) ? "strong" : assessor.ok ? "weak" : "none";
  const identityConfidence: ConfidenceLevel =
    identity.ok && identity.data.passed && evidenceCanIssueBadge(identity.mode) ? "strong" : "none";

  // Corroborate the claimed name against recorded ownership where available.
  const record = currentOwnershipRecord(await getOwnershipRecords([c.property_id]));
  let authorityConfidence: ConfidenceLevel = "none";
  let hardContradiction = false;
  if (record && c.claim_relationship === "individual_owner") {
    const match = compareOwnerName(c.claimant_name, record.raw_owner_name);
    notes.push(match.reason);
    if (match.match === "none") {
      hardContradiction = true;
    } else if (match.match === "exact" || match.match === "strong") {
      authorityConfidence = identityConfidence === "strong" ? "moderate" : "weak";
    }
    if (record.ownership_capacity === "trustee" || record.owner_party_type === "trust") {
      hardContradiction = true;
      notes.push(
        "Records show title held in a trustee capacity while the claim is personal ownership.",
      );
    }
  }
  if (!deed.ok || !identity.ok) {
    notes.push("Automated verification is unavailable, so this claim needs manual review.");
  }

  // Fail closed: every proposition must hold, on production-grade evidence —
  // and even then the badge is a human decision. The confidences and the
  // contradiction notes computed here are platform-owned columns
  // (verification_cases_guard), so a browser pass carries them into the
  // history entry instead of writing them onto the case.
  const sufficient = (level: ConfidenceLevel) => level === "strong" || level === "moderate";
  const corroborated =
    !hardContradiction &&
    propertyConfidence === "strong" &&
    identityConfidence === "strong" &&
    sufficient(authorityConfidence);
  const reason = corroborated
    ? "Automated checks corroborated this claim; a reviewer must confirm it."
    : (notes.find(Boolean) ?? null);

  // Moves pending/collecting_evidence to manual_review and writes the
  // `verification.automated_checks` history entry. It can produce no other
  // status, so this can never grant or restore a badge.
  unwrap(
    await rpcUntyped("queue_verification_case_for_review", { _case_id: c.id, _reason: reason }),
  );
  return readCase(c.id);
}

/* ------------------------------- decisions -------------------------------- */

export type ReviewDecision =
  | "verify_ownership"
  | "verify_representative"
  | "request_information"
  | "keep_pending"
  | "unable_to_verify"
  | "suspend"
  | "fraud_escalation";

const DECISION_STATUS: Record<ReviewDecision, VerificationCaseStatus> = {
  verify_ownership: "ownership_verified",
  verify_representative: "authorized_representative_verified",
  request_information: "collecting_evidence",
  keep_pending: "manual_review",
  unable_to_verify: "unable_to_verify",
  suspend: "suspended",
  fraud_escalation: "fraud_review",
};

/**
 * Reviewer decision. Material decisions require a reason.
 *
 * `decide_verification_case()` (admin/platform only) is the ONLY path that
 * moves a case status or issues a badge — it also moves the relationship
 * row(s), copies the recorded owner name from the current ownership record and
 * writes both the history and the audit entry, so nothing is duplicated here.
 * `reviewerId` is kept for signature compatibility; the database records
 * `auth.uid()` as the reviewer and will not take anyone else's word for it.
 */
export async function decideVerificationCase(input: {
  caseId: UUID;
  decision: ReviewDecision;
  reason: string;
  reviewerId: UUID | null;
  recordedOwnerName?: string | null;
}): Promise<VerificationCase> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required for this decision.");
  if (!DECISION_STATUS[input.decision]) throw new Error("Unknown review decision.");

  unwrap(
    await db.rpc("decide_verification_case", {
      _case_id: input.caseId,
      _decision: input.decision,
      _reason: reason,
    }),
  );

  // Optional reviewer override of the name shown beside the badge; the RPC
  // otherwise copies it from the property's current ownership record.
  if (input.recordedOwnerName) {
    unwrap(
      await db
        .from("property_party_relationships")
        .update({ recorded_owner_name: input.recordedOwnerName })
        .eq("case_id", input.caseId)
        .is("revoked_at", null),
    );
  }
  return readCase(input.caseId);
}

/* --------------------------- representatives ------------------------------ */

/**
 * Owner-initiated, property-specific, revocable delegation.
 *
 * Issued `pending` — the trigger refuses anything else — and the insert policy
 * only accepts it from a party whose OWNERSHIP is verified for this exact
 * property, so the mock's "representative invited before ownership was
 * verified" risk signal cannot arise: the row never gets written. The
 * after-insert trigger writes the `authorization.invited` history entry.
 */
export async function authorizeRepresentative(input: {
  propertyId: UUID;
  ownerUserId: UUID | null;
  ownerName: string;
  representativeName: string;
  representativeUserId?: UUID | null;
  representativeOrganizationId?: UUID | null;
  role?: PropertyRelationshipKind;
  permissions?: PropertyPermission[];
  expiresAt?: string | null;
}): Promise<RepresentativeAuthorization> {
  const assignment = unwrapMaybe<{ id: string }>(
    await db
      .from("management_assignments")
      .select("id")
      .eq("property_id", input.propertyId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle(),
  );
  const row = unwrapOne(
    await db
      .from("representative_authorizations")
      .insert({
        property_id: input.propertyId,
        owner_user_id: input.ownerUserId ?? (await currentUserId()),
        owner_name: input.ownerName.trim(),
        representative_user_id: input.representativeUserId ?? null,
        representative_organization_id: input.representativeOrganizationId ?? null,
        representative_name: input.representativeName.trim(),
        role: input.role ?? "authorized_representative",
        permissions: input.permissions ?? DEFAULT_REPRESENTATIVE_PERMISSIONS,
        // pending until the representative accepts and their authority is verified
        status: "pending",
        expires_at: input.expiresAt ?? null,
        management_assignment_id: assignment?.id ?? null,
      })
      .select("*")
      .single(),
    "Authorization",
  );
  const authorization = toAuthorization(row);
  await logAudit({
    action: "property_verification.representative_invited",
    entity_type: "representative_authorization",
    entity_id: authorization.id,
    metadata: {
      property_id: input.propertyId,
      representative_name: authorization.representative_name,
    },
  });
  return authorization;
}

/**
 * Representative accepts. Their authority still has to be verified, so this
 * opens a case rather than issuing the badge.
 *
 * The trigger binds the accepting user to the row and stamps `granted_at`, and
 * refuses the move from anyone but the invited representative — which is why
 * `representative_user_id` is not sent from here.
 */
export async function acceptAuthorization(input: {
  authorizationId: UUID;
  representativeUserId: UUID | null;
  representativeName?: string | null;
}): Promise<RepresentativeAuthorization> {
  const accepted = unwrapOne(
    await db
      .from("representative_authorizations")
      .update({ status: "active" })
      .eq("id", input.authorizationId)
      .select("*")
      .single(),
    "Authorization",
  );
  const verificationCase = await openClaim({
    propertyId: accepted.property_id,
    claimantUserId: accepted.representative_user_id ?? input.representativeUserId,
    claimantName: input.representativeName ?? accepted.representative_name,
    relationship: "authorized_representative",
    organizationId: accepted.representative_organization_id,
  });
  const linked = unwrapOne(
    await db
      .from("representative_authorizations")
      .update({ verification_case_id: verificationCase.id })
      .eq("id", accepted.id)
      .select("*")
      .single(),
    "Authorization",
  );
  await logAudit({
    organization_id: accepted.representative_organization_id,
    action: "property_verification.representative_accepted",
    entity_type: "representative_authorization",
    entity_id: accepted.id,
    metadata: { property_id: accepted.property_id, case_id: verificationCase.id },
  });
  return toAuthorization(linked);
}

/**
 * Either side revokes. The after-update trigger withdraws the representative's
 * badge relationship and writes the history entry; the owner's own badge is
 * untouched.
 */
export async function revokeAuthorization(input: {
  authorizationId: UUID;
  actorId: UUID | null;
  reason: string;
}): Promise<RepresentativeAuthorization> {
  const row = unwrapOne(
    await db
      .from("representative_authorizations")
      // revoked_at is stamped by the trigger; sending it is refused
      .update({ status: "revoked", revoked_reason: input.reason.trim() || null })
      .eq("id", input.authorizationId)
      .select("*")
      .single(),
    "Authorization",
  );
  const authorization = toAuthorization(row);
  await logAudit({
    action: "property_verification.representative_revoked",
    entity_type: "representative_authorization",
    entity_id: authorization.id,
    metadata: { property_id: authorization.property_id, reason: authorization.revoked_reason },
  });
  return authorization;
}

/**
 * Permissions this user holds on THIS property through a live authorization.
 *
 * Async now (it read the mock database synchronously). Every caller in the app
 * goes through the service layer or a hook — there is no synchronous render
 * path left to keep a cache for. The database answers the same question
 * server-side with `has_property_permission(_property_id, _permission)`, which
 * is what the RLS policies use; this is the client-side mirror for UI gating.
 */
export async function permissionsFor(
  propertyId: UUID,
  userId: UUID | null,
): Promise<PropertyPermission[]> {
  if (!userId) return [];
  const rows = unwrap(
    await db
      .from("representative_authorizations")
      .select("permissions, expires_at")
      .eq("property_id", propertyId)
      .eq("representative_user_id", userId)
      .eq("status", "active")
      .is("revoked_at", null),
  );
  const now = Date.now();
  return rows
    .filter((a) => a.expires_at === null || Date.parse(a.expires_at) > now)
    .flatMap((a) => (a.permissions ?? []) as PropertyPermission[]);
}

/* ------------------------------ read models ------------------------------- */

async function getOwnershipRecords(propertyIds: UUID[]): Promise<PropertyOwnershipRecord[]> {
  if (propertyIds.length === 0) return [];
  return unwrap(
    await db.from("property_ownership_records").select("*").in("property_id", propertyIds),
  ).map(toOwnershipRecord);
}

function assemble(
  propertyId: UUID,
  relationships: PropertyPartyRelationship[],
  records: PropertyOwnershipRecord[],
  authorizations: RepresentativeAuthorization[],
  latestCase: VerificationCase | null,
): PropertyVerification {
  const badge = badgeFor(relationships);
  const record = currentOwnershipRecord(records);
  const winning = relationships.find(
    (r) =>
      r.revoked_at === null &&
      (badge === "ownership_verified"
        ? r.status === "ownership_verified"
        : r.status === "authorized_representative_verified"),
  );
  const activeRep = authorizations.find((a) => a.status === "active");
  return {
    property_id: propertyId,
    badge,
    recorded_owner_name: record?.raw_owner_name ?? winning?.recorded_owner_name ?? null,
    representative_name:
      badge === "authorized_representative" ? (activeRep?.representative_name ?? null) : null,
    verified_at: winning?.verified_at ?? null,
    verification_version: verificationVersion(relationships, records, authorizations),
    case: latestCase,
    relationships,
    ownership_records: records,
    authorizations,
  };
}

/**
 * The owner-facing verification workspace for one property.
 *
 * Signed out (the public listing page) only the badge relationships are
 * readable — cases, evidence, ownership records and authorizations are not
 * granted to `anon` at all — so the private queries are skipped rather than
 * failing the whole page.
 */
async function buildVerification(propertyId: UUID): Promise<PropertyVerification> {
  const relationships = unwrap(
    await db
      .from("property_party_relationships")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
  ).map(toRelationship);

  if (!(await currentUserId())) return assemble(propertyId, relationships, [], [], null);

  const [recordRows, authorizationRows, caseRows] = await Promise.all([
    db.from("property_ownership_records").select("*").eq("property_id", propertyId),
    db
      .from("representative_authorizations")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),
    db
      .from("verification_cases")
      .select("*")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const latest = unwrap(caseRows)[0];
  return assemble(
    propertyId,
    relationships,
    unwrap(recordRows).map(toOwnershipRecord),
    unwrap(authorizationRows).map(toAuthorization),
    latest ? toCase(latest) : null,
  );
}

export async function getPropertyVerification(
  propertyId: UUID | null,
): Promise<PropertyVerification | null> {
  if (!propertyId) return null;
  return buildVerification(propertyId);
}

/**
 * Badges for many properties at once — used by listing cards, and by public
 * pages where the viewer is signed out.
 */
export async function getPropertyBadges(
  propertyIds: UUID[],
): Promise<Record<UUID, PropertyVerification>> {
  const ids = [...new Set(propertyIds)];
  const map: Record<UUID, PropertyVerification> = {};
  if (ids.length === 0) return map;

  // Public policy: only live, positively verified rows come back for a visitor
  // who is not a party to the property.
  const relationships = unwrap(
    await db
      .from("property_party_relationships")
      .select("*")
      .in("property_id", ids)
      .order("created_at", { ascending: false }),
  ).map(toRelationship);

  const signedIn = Boolean(await currentUserId());
  const [records, authorizations, cases] = signedIn
    ? await Promise.all([
        getOwnershipRecords(ids),
        db
          .from("representative_authorizations")
          .select("*")
          .in("property_id", ids)
          .order("created_at", { ascending: false })
          .then((res) => unwrap(res).map(toAuthorization)),
        db
          .from("verification_cases")
          .select("*")
          .in("property_id", ids)
          .order("created_at", { ascending: false })
          .then((res) => unwrap(res).map(toCase)),
      ])
    : [
        [] as PropertyOwnershipRecord[],
        [] as RepresentativeAuthorization[],
        [] as VerificationCase[],
      ];

  for (const id of ids) {
    map[id] = assemble(
      id,
      relationships.filter((r) => r.property_id === id),
      records.filter((r) => r.property_id === id),
      authorizations.filter((a) => a.property_id === id),
      cases.find((c) => c.property_id === id) ?? null,
    );
  }
  return map;
}

export async function getVerificationCasesForOrg(orgId: UUID | null): Promise<VerificationCase[]> {
  if (!orgId) return [];
  return unwrap(
    await db
      .from("verification_cases")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ).map(toCase);
}

/** Everything awaiting a human decision, in one round trip plus the records. */
const QUEUE_SELECT =
  "*, property:properties(id, name, street_address, city, state, zip), entity:verified_entities(*), evidence:verification_evidence(*), risk_events:verification_risk_events(*), history:verification_status_events(*)";

type QueueRow = CaseRow & {
  property: PropertyFactsRow | null;
  entity: EntityRow | null;
  evidence: EvidenceRow[];
  risk_events: RiskEventRow[];
  history: StatusEventRow[];
};

const OPEN_STATUSES: VerificationCaseStatus[] = [
  "pending",
  "collecting_evidence",
  "manual_review",
  "fraud_review",
  "suspended",
];

/**
 * Admin review queue. RLS decides what a caller actually sees: a reviewer sees
 * every open case with its evidence, risk signals and history, and (through
 * `properties_select_admin_review`, migration 20260915000810) the property the
 * decision is about; anyone else sees only their own cases and no risk events.
 */
export async function getVerificationQueue(): Promise<VerificationQueueItem[]> {
  const rows = unwrap(
    await db
      .from("verification_cases")
      .select(QUEUE_SELECT)
      .in("status", OPEN_STATUSES)
      .order("created_at", { ascending: false }),
  ) as unknown as QueueRow[];

  const records = await getOwnershipRecords([...new Set(rows.map((r) => r.property_id))]);
  return rows.map((row) => {
    const forProperty = records.filter((r) => r.property_id === row.property_id);
    const property = row.property;
    return {
      case: toCase(row),
      property_name: property?.name ?? "Unknown property",
      property_address: property
        ? `${property.street_address}, ${property.city}, ${property.state} ${property.zip}`
        : "—",
      recorded_owner_name: currentOwnershipRecord(forProperty)?.raw_owner_name ?? null,
      evidence: row.evidence.map(toEvidence).sort((a, b) => desc(a.created_at, b.created_at)),
      ownership_records: forProperty,
      entity: row.entity ? toEntity(row.entity) : null,
      risk_events: row.risk_events
        .map(toRiskEvent)
        .sort((a, b) => desc(a.created_at, b.created_at)),
      history: row.history.map(toStatusEvent).sort((a, b) => desc(a.created_at, b.created_at)),
    };
  });
}

export function providerStatusList() {
  return providerStatuses();
}

/* ------------------------------ disclosures ------------------------------- */

/** Identity of the party being paid/trusted, so a payee change re-triggers. */
async function payeeReference(
  propertyId: UUID,
  authorizations: RepresentativeAuthorization[],
): Promise<string> {
  const activeRep = authorizations.find((a) => a.status === "active");
  if (activeRep) {
    return `rep:${activeRep.representative_organization_id ?? activeRep.representative_name}`;
  }
  const property = unwrapMaybe<{ organization_id: string }>(
    await db.from("properties").select("organization_id").eq("id", propertyId).maybeSingle(),
  );
  return `org:${property?.organization_id ?? "unknown"}`;
}

export type DisclosureRequirement = {
  required: boolean;
  badge: PropertyBadge;
  /** True once a badge exists — no disclosure and no notice needed. */
  verified: boolean;
  /** Neutral notice text for verified-free properties, already acknowledged. */
  notice: string | null;
  disclosure_version: string;
  verification_version: string;
};

export async function getDisclosureRequirement(input: {
  tenantUserId: UUID | null;
  propertyId: UUID | null;
  context: DisclosureContext;
}): Promise<DisclosureRequirement> {
  const empty: DisclosureRequirement = {
    required: false,
    badge: null,
    verified: false,
    notice: null,
    disclosure_version: DISCLOSURE_VERSION,
    verification_version: "",
  };
  if (!input.propertyId) return empty;

  const verification = await buildVerification(input.propertyId);
  if (verification.badge) {
    return {
      ...empty,
      badge: verification.badge,
      verified: true,
      verification_version: verification.verification_version,
    };
  }

  // The payee is only needed to match an acknowledgement, and a signed-out
  // visitor (the public apply page) can read neither properties nor
  // acknowledgements — they simply always owe the disclosure.
  const payee = input.tenantUserId
    ? await payeeReference(input.propertyId, verification.authorizations)
    : null;
  const acknowledged = input.tenantUserId
    ? unwrapMaybe<{ id: string }>(
        await db
          .from("verification_acknowledgements")
          .select("id")
          .eq("tenant_user_id", input.tenantUserId)
          .eq("property_id", input.propertyId)
          .eq("payee_reference", payee ?? "")
          .eq("disclosure_version", DISCLOSURE_VERSION)
          .eq("verification_version", verification.verification_version)
          .maybeSingle(),
      ) !== null
    : false;

  return {
    required: !acknowledged,
    badge: null,
    verified: false,
    notice: "Property ownership has not been verified by RentID.",
    disclosure_version: DISCLOSURE_VERSION,
    verification_version: verification.verification_version,
  };
}

export async function acknowledgeDisclosure(input: {
  tenantUserId: UUID;
  propertyId: UUID;
  context: DisclosureContext;
}): Promise<void> {
  const verification = await buildVerification(input.propertyId);
  const relationship = verification.relationships.find((r) => r.revoked_at === null) ?? null;
  const { error } = await db.from("verification_acknowledgements").insert({
    tenant_user_id: input.tenantUserId,
    property_id: input.propertyId,
    relationship_id: relationship?.id ?? null,
    payee_reference: await payeeReference(input.propertyId, verification.authorizations),
    disclosure_version: DISCLOSURE_VERSION,
    verification_version: verification.verification_version,
    context: input.context,
    metadata: { status_at_acknowledgement: verification.case?.status ?? "none" },
  });
  // Acknowledgements are immutable and unique per tenant + property + payee +
  // versions: the same notice acknowledged twice is a no-op, not an error.
  if (error && error.code !== "23505") throw new DbError(error);

  await logAudit({
    action: "property_verification.disclosure_acknowledged",
    entity_type: "property",
    entity_id: input.propertyId,
    metadata: { context: input.context, disclosure_version: DISCLOSURE_VERSION },
  });
}

/* ------------------------------- risk events ------------------------------ */

/**
 * Files a risk signal.
 *
 * `verification_risk_events` has no client insert grant (risk signals are
 * written by the platform, read by admins), so this goes through
 * `record_verification_risk_event()` (migration 20260915000810), which pins
 * the signal to the caller, checks they are a party to the case/property,
 * validates the kind and severity, marks the row client-reported and rate
 * limits it. The filer cannot read the table back — only admins can.
 */
export async function recordRiskEvent(input: {
  propertyId: UUID | null;
  caseId: UUID | null;
  userId: UUID | null;
  kind: RiskEventKind;
  severity: VerificationRiskEvent["severity"];
  detail: string;
}): Promise<VerificationRiskEvent> {
  const row = unwrap(
    await rpcUntyped("record_verification_risk_event", {
      _property_id: input.propertyId,
      _case_id: input.caseId,
      _kind: input.kind,
      _severity: input.severity,
      _detail: input.detail,
    }),
  ) as RiskEventRow;
  return toRiskEvent(row);
}

/**
 * Ownership transfer or payee change suspends the badge until re-verified.
 *
 * `reverification_required` and a status move are platform-owned
 * (verification_cases_guard refuses them even from an admin), so this goes
 * through `require_property_reverification()` (migration 20260915000810),
 * which suspends live badges, flags every case on the property and leaves a
 * history and an audit row behind. Admin or platform only.
 */
export async function requireReverification(input: {
  propertyId: UUID;
  reason: string;
  actorId?: UUID | null;
}): Promise<void> {
  unwrap(
    await rpcUntyped("require_property_reverification", {
      _property_id: input.propertyId,
      _reason: input.reason,
    }),
  );
}

export { DISCLOSURE_VERSION, normalizeOwnerName };
export type { AuthorizationStatus };
