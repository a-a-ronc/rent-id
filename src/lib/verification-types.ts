/**
 * Property ownership & authorized-representative verification models.
 *
 * These are deliberately SEPARATE from tenancy verification (`Tenancy.verified`,
 * `VerificationRecord`) and from business verification (`Organization.
 * verification_status`). Three different assertions, three different records:
 *
 *   Verified Tenancy               — a landlord and tenant really had a tenancy
 *   Property Ownership Verified    — this account is tied to the recorded owner
 *   Authorized Representative      — this account may act for the recorded owner
 *
 * Verification is always PROPERTY-SPECIFIC. Verifying one property never
 * verifies another, and managing one property never authorizes another.
 */
import type { DateOnly, Timestamp, UUID } from "@/lib/types";

/** Answer to "What is your relationship to this property?" in the add flow. */
export type PropertyClaimRelationship =
  | "individual_owner"
  | "entity_owner_representative"
  | "authorized_representative"
  | "trust_or_estate"
  | "other";

/** Internal case lifecycle. Public UI only ever renders badge / no badge. */
export type VerificationCaseStatus =
  | "pending"
  | "collecting_evidence"
  | "manual_review"
  | "ownership_verified"
  | "authorized_representative_verified"
  | "unable_to_verify"
  | "suspended"
  | "revoked"
  | "fraud_review";

/** Never exposed publicly — internal only, one dimension per proposition. */
export type ConfidenceLevel = "none" | "weak" | "moderate" | "strong";

/** The three independent propositions that must each be proven. */
export type VerificationProposition = "property" | "identity" | "authority";

export type OwnerPartyType =
  "individual" | "entity" | "trust" | "estate" | "government" | "unknown";

/** Legal capacity in which the owner holds title — never flattened away. */
export type OwnershipCapacity =
  | "sole_owner"
  | "joint_owner"
  | "entity"
  | "trustee"
  | "executor"
  | "personal_representative"
  | "life_estate"
  | "unknown";

export type EvidenceSourceType =
  | "recorded_document"
  | "assessor"
  | "tax_parcel"
  | "gis"
  | "business_registry"
  | "identity_provider"
  | "document_verification"
  | "user_upload"
  | "manual_note";

/**
 * Recorded deeds are primary. Assessor/parcel data corroborates but can lag a
 * recent sale, so it never stands alone as proof of current title.
 */
export type EvidenceStrength = "primary" | "supporting" | "unverified_upload";

/** External integrations are not live yet; nothing may be silently faked. */
export type ProviderMode = "not_configured" | "sandbox" | "production";

/** Ownership as reported by an official or corroborating source. */
export type PropertyOwnershipRecord = {
  id: UUID;
  property_id: UUID;
  owner_party_type: OwnerPartyType;
  /** Exactly as the source returned it. */
  raw_owner_name: string;
  normalized_owner_name: string;
  ownership_capacity: OwnershipCapacity;
  /** Recording date of the instrument, where the source provides one. */
  recorded_at: DateOnly | null;
  instrument_reference: string | null;
  source_type: EvidenceSourceType;
  source_provider: string;
  retrieved_at: Timestamp;
  /** False once a newer recorded instrument supersedes this record. */
  is_current: boolean;
  superseded_by: UUID | null;
  created_at: Timestamp;
};

/** A verified legal entity (LLC, corporation, trust) from a business registry. */
export type VerifiedEntity = {
  id: UUID;
  legal_name: string;
  normalized_name: string;
  entity_type: string;
  formation_state: string | null;
  /** State file/entity number. Full EINs are never stored here. */
  file_number: string | null;
  registry_status: string | null;
  verified: boolean;
  verified_at: Timestamp | null;
  created_at: Timestamp;
};

export type PropertyRelationshipKind =
  | "owner"
  | "entity_representative"
  | "authorized_representative"
  | "property_manager"
  | "trustee"
  | "other";

export type RelationshipVerificationStatus =
  | "unverified"
  | "pending"
  | "ownership_verified"
  | "authorized_representative_verified"
  | "unable_to_verify"
  | "suspended"
  | "revoked";

/** The property-specific link between a property and a person/business. */
export type PropertyPartyRelationship = {
  id: UUID;
  property_id: UUID;
  user_id: UUID | null;
  /** Landlord or property-management workspace, where applicable. */
  organization_id: UUID | null;
  /** Owning entity when title is held by an LLC/corp/trust. */
  entity_id: UUID | null;
  relationship: PropertyRelationshipKind;
  status: RelationshipVerificationStatus;
  /** Recorded owner name shown alongside the badge. */
  recorded_owner_name: string | null;
  verified_at: Timestamp | null;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** One claim by one account over one property. */
export type VerificationCase = {
  id: UUID;
  property_id: UUID;
  organization_id: UUID | null;
  claimant_user_id: UUID | null;
  claimant_name: string;
  claim_relationship: PropertyClaimRelationship;
  status: VerificationCaseStatus;
  /** Internal only — never rendered to renters or landlords. */
  property_confidence: ConfidenceLevel;
  identity_confidence: ConfidenceLevel;
  authority_confidence: ConfidenceLevel;
  hard_contradiction: boolean;
  contradictions: string[];
  entity_id: UUID | null;
  rules_version: string;
  reviewer_id: UUID | null;
  decision_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  decided_at: Timestamp | null;
  last_verified_at: Timestamp | null;
  next_review_at: Timestamp | null;
  reverification_required: boolean;
};

export type VerificationEvidence = {
  id: UUID;
  case_id: UUID;
  proposition: VerificationProposition;
  evidence_type: string;
  source_type: EvidenceSourceType;
  source_provider: string;
  official_reference: string | null;
  retrieved_at: Timestamp;
  document_date: DateOnly | null;
  /** Hash only — raw identity documents live in private storage. */
  document_hash: string | null;
  /** Private-storage path for uploads; never rendered publicly. */
  storage_path: string | null;
  strength: EvidenceStrength;
  summary: string;
  expires_at: Timestamp | null;
  created_at: Timestamp;
};

/** Capabilities an owner can delegate; mirrors existing RentID surfaces. */
export type PropertyPermission =
  | "manage_listing"
  | "view_applications"
  | "manage_applications"
  | "manage_leases"
  | "approve_lease_changes"
  | "manage_tenants"
  | "view_ledger"
  | "view_payments"
  | "manage_payment_settings"
  | "manage_maintenance"
  | "message_tenants"
  | "manage_documents"
  | "manage_property_records";

export type AuthorizationStatus = "pending" | "active" | "expired" | "revoked";

/** Revocable, property-specific delegation from owner to representative. */
export type RepresentativeAuthorization = {
  id: UUID;
  property_id: UUID;
  owner_user_id: UUID | null;
  owner_name: string;
  representative_user_id: UUID | null;
  representative_organization_id: UUID | null;
  representative_name: string;
  role: PropertyRelationshipKind;
  permissions: PropertyPermission[];
  status: AuthorizationStatus;
  granted_at: Timestamp | null;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  revoked_reason: string | null;
  verification_case_id: UUID | null;
  /** Links to the existing PM authority row when one exists. */
  management_assignment_id: UUID | null;
  created_at: Timestamp;
};

export type DisclosureContext = "application" | "lease" | "payment";

/** One-time tenant acknowledgement — not a popup on every rent payment. */
export type VerificationDisclosureAck = {
  id: UUID;
  tenant_user_id: UUID;
  property_id: UUID;
  /** The party being trusted: relationship row where known. */
  relationship_id: UUID | null;
  /** Payee identity at acknowledgement; a change re-triggers the disclosure. */
  payee_reference: string;
  disclosure_version: string;
  /** Snapshot of the property's verification state at acknowledgement. */
  verification_version: string;
  context: DisclosureContext;
  acknowledged_at: Timestamp;
  metadata: Record<string, unknown> | null;
};

export type RiskEventKind =
  | "rapid_multi_property_claims"
  | "reused_document"
  | "repeated_failed_claims"
  | "entity_mismatch"
  | "suspicious_authorization_pattern"
  | "payee_change_before_payment"
  | "deed_inconsistent_with_record"
  | "many_unrelated_owners"
  | "identity_reuse";

export type VerificationRiskEvent = {
  id: UUID;
  property_id: UUID | null;
  case_id: UUID | null;
  user_id: UUID | null;
  kind: RiskEventKind;
  severity: "low" | "medium" | "high";
  detail: string;
  created_at: Timestamp;
  resolved_at: Timestamp | null;
};

/** Append-only status history behind every decision. */
export type VerificationStatusEvent = {
  id: UUID;
  property_id: UUID;
  case_id: UUID | null;
  actor_id: UUID | null;
  action: string;
  from_status: VerificationCaseStatus | null;
  to_status: VerificationCaseStatus | null;
  reason: string | null;
  created_at: Timestamp;
};

/* ------------------------------ read models ------------------------------- */

/** Only two positive public badges exist. `null` means simply no badge. */
export type PropertyBadge = "ownership_verified" | "authorized_representative" | null;

export type PropertyVerification = {
  property_id: UUID;
  badge: PropertyBadge;
  /** Recorded owner shown with either badge. */
  recorded_owner_name: string | null;
  representative_name: string | null;
  verified_at: Timestamp | null;
  /** Changes whenever the trust state materially changes. */
  verification_version: string;
  case: VerificationCase | null;
  relationships: PropertyPartyRelationship[];
  ownership_records: PropertyOwnershipRecord[];
  authorizations: RepresentativeAuthorization[];
};

export type VerificationQueueItem = {
  case: VerificationCase;
  property_name: string;
  property_address: string;
  recorded_owner_name: string | null;
  evidence: VerificationEvidence[];
  ownership_records: PropertyOwnershipRecord[];
  entity: VerifiedEntity | null;
  risk_events: VerificationRiskEvent[];
  history: VerificationStatusEvent[];
};

/** Bumped whenever the legal wording of the tenant disclosure changes. */
export const DISCLOSURE_VERSION = "2026-09-11";
export const VERIFICATION_RULES_VERSION = "1.0.0";
