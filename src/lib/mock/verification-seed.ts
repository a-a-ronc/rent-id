/**
 * Demo ownership-verification records.
 *
 * DEMO DATA ONLY. In production a badge may never come from mock data: it
 * requires production-grade official evidence or an explicit reviewer decision.
 * These rows exist so the demo portfolio shows each state — ownership verified
 * through an LLC, an authorized representative, a case in review, and a
 * property with no badge at all.
 */
import type {
  PropertyOwnershipRecord,
  PropertyPartyRelationship,
  RepresentativeAuthorization,
  UUID,
  VerificationCase,
  VerificationEvidence,
  VerificationRiskEvent,
  VerificationStatusEvent,
  VerifiedEntity,
} from "@/lib/types";
import { VERIFICATION_RULES_VERSION } from "@/lib/verification-types";
import { normalizeOwnerName } from "@/lib/verification/address";

export type VerificationSeed = {
  verified_entities: VerifiedEntity[];
  property_ownership_records: PropertyOwnershipRecord[];
  property_party_relationships: PropertyPartyRelationship[];
  verification_cases: VerificationCase[];
  verification_evidence: VerificationEvidence[];
  representative_authorizations: RepresentativeAuthorization[];
  verification_acknowledgements: [];
  verification_risk_events: VerificationRiskEvent[];
  verification_status_events: VerificationStatusEvent[];
};

function vid(prefix: string, n: number) {
  return `8f1c7a10-${prefix}-4000-8000-${String(n).padStart(12, "0")}`;
}

function iso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}

export function seedVerification(input: {
  landlordId: UUID;
  managerId: UUID;
  orgId: UUID;
  pmOrgId: UUID;
  /** Beacon Row, Cedar & Vine, Harbor Lofts, Maple Court. */
  propertyIds: UUID[];
}): VerificationSeed {
  const [beacon, cedar, harbor] = input.propertyIds;
  const entity: VerifiedEntity = {
    id: vid("a100", 1),
    legal_name: "Lucas Holding Co. LLC",
    normalized_name: normalizeOwnerName("Lucas Holding Co. LLC"),
    entity_type: "Limited liability company",
    formation_state: "MI",
    file_number: "80244***",
    registry_status: "Active",
    verified: true,
    verified_at: iso(-120),
    created_at: iso(-130),
  };

  const ownershipRecords: PropertyOwnershipRecord[] = [
    {
      id: vid("a200", 1),
      property_id: beacon!,
      owner_party_type: "entity",
      raw_owner_name: "LUCAS HOLDING CO LLC",
      normalized_owner_name: normalizeOwnerName("LUCAS HOLDING CO LLC"),
      ownership_capacity: "entity",
      recorded_at: iso(-900).slice(0, 10),
      instrument_reference: "2023R-0148821",
      source_type: "recorded_document",
      source_provider: "demo_records",
      retrieved_at: iso(-120),
      is_current: true,
      superseded_by: null,
      created_at: iso(-120),
    },
    {
      id: vid("a200", 2),
      property_id: cedar!,
      owner_party_type: "individual",
      raw_owner_name: "GAVIN R LUCAS",
      normalized_owner_name: normalizeOwnerName("GAVIN R LUCAS"),
      ownership_capacity: "sole_owner",
      recorded_at: iso(-1400).slice(0, 10),
      instrument_reference: "2022R-0092210",
      source_type: "recorded_document",
      source_provider: "demo_records",
      retrieved_at: iso(-90),
      is_current: true,
      superseded_by: null,
      created_at: iso(-90),
    },
    {
      id: vid("a200", 3),
      property_id: harbor!,
      owner_party_type: "trust",
      raw_owner_name: "SMITH FAMILY TRUST",
      normalized_owner_name: normalizeOwnerName("SMITH FAMILY TRUST"),
      ownership_capacity: "trustee",
      recorded_at: iso(-60).slice(0, 10),
      instrument_reference: "2026R-0011904",
      source_type: "recorded_document",
      source_provider: "demo_records",
      retrieved_at: iso(-10),
      is_current: true,
      superseded_by: null,
      created_at: iso(-10),
    },
  ];

  const cases: VerificationCase[] = [
    {
      id: vid("a300", 1),
      property_id: beacon!,
      organization_id: input.orgId,
      claimant_user_id: input.landlordId,
      claimant_name: "Gavin Lucas",
      claim_relationship: "entity_owner_representative",
      status: "ownership_verified",
      property_confidence: "strong",
      identity_confidence: "strong",
      authority_confidence: "strong",
      hard_contradiction: false,
      contradictions: [],
      entity_id: entity.id,
      rules_version: VERIFICATION_RULES_VERSION,
      reviewer_id: null,
      decision_reason:
        "Recorded deed, entity registry and managing-member authority all confirmed.",
      created_at: iso(-125),
      updated_at: iso(-120),
      decided_at: iso(-120),
      last_verified_at: iso(-120),
      next_review_at: iso(240),
      reverification_required: false,
    },
    {
      id: vid("a300", 2),
      property_id: cedar!,
      organization_id: input.pmOrgId,
      claimant_user_id: input.managerId,
      claimant_name: "Rowan Vale Property Management",
      claim_relationship: "authorized_representative",
      status: "authorized_representative_verified",
      property_confidence: "strong",
      identity_confidence: "strong",
      authority_confidence: "strong",
      hard_contradiction: false,
      contradictions: [],
      entity_id: null,
      rules_version: VERIFICATION_RULES_VERSION,
      reviewer_id: null,
      decision_reason:
        "Owner granted authority in RentID and the management company verified its identity.",
      created_at: iso(-80),
      updated_at: iso(-75),
      decided_at: iso(-75),
      last_verified_at: iso(-75),
      next_review_at: iso(290),
      reverification_required: false,
    },
    {
      id: vid("a300", 3),
      property_id: harbor!,
      organization_id: input.orgId,
      claimant_user_id: input.landlordId,
      claimant_name: "Gavin Lucas",
      claim_relationship: "individual_owner",
      status: "manual_review",
      property_confidence: "strong",
      identity_confidence: "strong",
      authority_confidence: "weak",
      hard_contradiction: true,
      contradictions: [
        "Records show title held in a trustee capacity while the claim is personal ownership.",
        "A trust certification or equivalent authority document is needed.",
      ],
      entity_id: null,
      rules_version: VERIFICATION_RULES_VERSION,
      reviewer_id: null,
      decision_reason: null,
      created_at: iso(-9),
      updated_at: iso(-3),
      decided_at: null,
      last_verified_at: null,
      next_review_at: null,
      reverification_required: false,
    },
  ];

  const relationships: PropertyPartyRelationship[] = [
    {
      id: vid("a400", 1),
      property_id: beacon!,
      user_id: input.landlordId,
      organization_id: input.orgId,
      entity_id: entity.id,
      relationship: "entity_representative",
      status: "ownership_verified",
      recorded_owner_name: "Lucas Holding Co. LLC",
      verified_at: iso(-120),
      expires_at: null,
      revoked_at: null,
      created_at: iso(-125),
      updated_at: iso(-120),
    },
    {
      id: vid("a400", 2),
      property_id: cedar!,
      user_id: input.managerId,
      organization_id: input.pmOrgId,
      entity_id: null,
      relationship: "authorized_representative",
      status: "authorized_representative_verified",
      recorded_owner_name: "Gavin R Lucas",
      verified_at: iso(-75),
      expires_at: null,
      revoked_at: null,
      created_at: iso(-80),
      updated_at: iso(-75),
    },
    {
      id: vid("a400", 3),
      property_id: harbor!,
      user_id: input.landlordId,
      organization_id: input.orgId,
      entity_id: null,
      relationship: "owner",
      status: "pending",
      recorded_owner_name: "Smith Family Trust",
      verified_at: null,
      expires_at: null,
      revoked_at: null,
      created_at: iso(-9),
      updated_at: iso(-3),
    },
  ];

  const evidence: VerificationEvidence[] = [
    {
      id: vid("a500", 1),
      case_id: cases[0]!.id,
      proposition: "property",
      evidence_type: "Recorded warranty deed",
      source_type: "recorded_document",
      source_provider: "demo_records",
      official_reference: "2023R-0148821",
      retrieved_at: iso(-120),
      document_date: iso(-900).slice(0, 10),
      document_hash: null,
      storage_path: null,
      strength: "primary",
      summary: "Deed records Lucas Holding Co. LLC as the current owner.",
      expires_at: null,
      created_at: iso(-120),
    },
    {
      id: vid("a500", 2),
      case_id: cases[0]!.id,
      proposition: "authority",
      evidence_type: "Entity filing naming managing member",
      source_type: "business_registry",
      source_provider: "demo_registry",
      official_reference: "MI 80244***",
      retrieved_at: iso(-120),
      document_date: null,
      document_hash: null,
      storage_path: null,
      strength: "primary",
      summary: "State filing lists the account holder as managing member.",
      expires_at: null,
      created_at: iso(-120),
    },
    {
      id: vid("a500", 3),
      case_id: cases[2]!.id,
      proposition: "property",
      evidence_type: "Recorded deed into trust",
      source_type: "recorded_document",
      source_provider: "demo_records",
      official_reference: "2026R-0011904",
      retrieved_at: iso(-10),
      document_date: iso(-60).slice(0, 10),
      document_hash: null,
      storage_path: null,
      strength: "primary",
      summary: "Title is held by Smith Family Trust, not an individual.",
      expires_at: null,
      created_at: iso(-10),
    },
  ];

  const authorizations: RepresentativeAuthorization[] = [
    {
      id: vid("a600", 1),
      property_id: cedar!,
      owner_user_id: input.landlordId,
      owner_name: "Gavin R Lucas",
      representative_user_id: input.managerId,
      representative_organization_id: input.pmOrgId,
      representative_name: "Rowan Vale Property Management",
      role: "authorized_representative",
      permissions: [
        "manage_listing",
        "view_applications",
        "manage_applications",
        "manage_leases",
        "manage_tenants",
        "manage_maintenance",
        "message_tenants",
        "manage_documents",
      ],
      status: "active",
      granted_at: iso(-78),
      expires_at: null,
      revoked_at: null,
      revoked_reason: null,
      verification_case_id: cases[1]!.id,
      management_assignment_id: null,
      created_at: iso(-80),
    },
  ];

  const risk: VerificationRiskEvent[] = [
    {
      id: vid("a700", 1),
      property_id: harbor!,
      case_id: cases[2]!.id,
      user_id: input.landlordId,
      kind: "entity_mismatch",
      severity: "medium",
      detail: "Claimed personal ownership conflicts with trustee vesting in the recorded deed.",
      created_at: iso(-8),
      resolved_at: null,
    },
  ];

  const history: VerificationStatusEvent[] = [
    {
      id: vid("a800", 1),
      property_id: beacon!,
      case_id: cases[0]!.id,
      actor_id: null,
      action: "verification.verify_ownership",
      from_status: "manual_review",
      to_status: "ownership_verified",
      reason: "Deed, entity registry and authority document reconciled.",
      created_at: iso(-120),
    },
    {
      id: vid("a800", 2),
      property_id: cedar!,
      case_id: cases[1]!.id,
      actor_id: null,
      action: "verification.verify_representative",
      from_status: "manual_review",
      to_status: "authorized_representative_verified",
      reason: "Owner granted authority inside RentID.",
      created_at: iso(-75),
    },
    {
      id: vid("a800", 3),
      property_id: harbor!,
      case_id: cases[2]!.id,
      actor_id: null,
      action: "verification.automated_checks",
      from_status: "collecting_evidence",
      to_status: "manual_review",
      reason: "Trustee vesting requires additional authority evidence.",
      created_at: iso(-8),
    },
  ];

  return {
    verified_entities: [entity],
    property_ownership_records: ownershipRecords,
    property_party_relationships: relationships,
    verification_cases: cases,
    verification_evidence: evidence,
    representative_authorizations: authorizations,
    verification_acknowledgements: [],
    verification_risk_events: risk,
    verification_status_events: history,
  };
}
