/**
 * Provider abstractions for property/title, business-registry and identity data.
 *
 * No vendor is selected yet, so every provider reports `not_configured` and
 * returns no evidence. Rules:
 *   - Production verification must never silently use fake successful responses.
 *   - A public badge is NEVER issued from mock/sandbox data; sandbox lookups
 *     mark their evidence as unofficial and route the case to manual review.
 *   - Only authorized APIs, licensed data services, open datasets or manual
 *     review are permitted. No scraping, no CAPTCHA/anti-bot circumvention.
 */
import type {
  EvidenceSourceType,
  EvidenceStrength,
  OwnerPartyType,
  OwnershipCapacity,
  ProviderMode,
} from "@/lib/verification-types";
import type { DateOnly, Timestamp } from "@/lib/types";

export type ProviderInfo = { id: string; label: string; mode: ProviderMode };

export type ProviderResult<T> =
  | { ok: true; mode: Exclude<ProviderMode, "not_configured">; data: T }
  | { ok: false; mode: ProviderMode; reason: string };

export type ParcelLookup = {
  parcel_number: string | null;
  county: string | null;
  recording_jurisdiction: string | null;
  legal_description: string | null;
};

export type OwnerFinding = {
  raw_owner_name: string;
  owner_party_type: OwnerPartyType;
  ownership_capacity: OwnershipCapacity;
  recorded_at: DateOnly | null;
  instrument_reference: string | null;
  source_type: EvidenceSourceType;
  strength: EvidenceStrength;
  retrieved_at: Timestamp;
};

export type EntityFinding = {
  legal_name: string;
  entity_type: string;
  formation_state: string | null;
  file_number: string | null;
  registry_status: string | null;
  /** Officers/managers where a registry publishes them. */
  principals: string[];
};

export type IdentityFinding = {
  /** Provider reference token — never a raw document number. */
  provider_reference: string;
  legal_name: string;
  passed: boolean;
};

export type DocumentFinding = {
  provider_reference: string;
  document_hash: string;
  looks_altered: boolean;
};

/** Every provider is unset until RentID contracts and configures a vendor. */
const MODE: ProviderMode = "not_configured";

function unavailable<T>(label: string): ProviderResult<T> {
  return {
    ok: false,
    mode: MODE,
    reason: `${label} is not configured yet. This case needs manual review.`,
  };
}

/** Parcel identification: assessor/GIS/parcel datasets. */
export const PropertyDataProvider = {
  info: (): ProviderInfo => ({ id: "property_data", label: "Property data provider", mode: MODE }),
  async findParcel(_input: {
    normalizedAddress: string;
    state: string;
    zip: string;
  }): Promise<ProviderResult<ParcelLookup>> {
    return unavailable("Parcel lookup");
  },
};

/** PRIMARY ownership evidence: recorded deeds from the recording authority. */
export const RecordedDocumentProvider = {
  info: (): ProviderInfo => ({
    id: "recorded_documents",
    label: "Recorded document provider",
    mode: MODE,
  }),
  async currentOwner(_input: {
    parcelNumber: string | null;
    jurisdiction: string | null;
  }): Promise<ProviderResult<OwnerFinding[]>> {
    return unavailable("Recorded deed search");
  },
  /** Later transfers that would contradict a claim. */
  async transfersSince(_input: {
    parcelNumber: string | null;
    since: DateOnly;
  }): Promise<ProviderResult<OwnerFinding[]>> {
    return unavailable("Transfer search");
  },
};

/** SUPPORTING evidence only — assessor owner fields can lag a recent deed. */
export const AssessorDataProvider = {
  info: (): ProviderInfo => ({
    id: "assessor",
    label: "Assessor / appraiser provider",
    mode: MODE,
  }),
  async owner(_input: { parcelNumber: string | null }): Promise<ProviderResult<OwnerFinding>> {
    return unavailable("Assessor lookup");
  },
};

export const BusinessRegistryProvider = {
  info: (): ProviderInfo => ({
    id: "business_registry",
    label: "Business registry provider",
    mode: MODE,
  }),
  async lookupEntity(_input: {
    legalName: string;
    state?: string | null;
  }): Promise<ProviderResult<EntityFinding>> {
    return unavailable("Business registry lookup");
  },
};

export const IdentityVerificationProvider = {
  info: (): ProviderInfo => ({
    id: "identity",
    label: "Identity verification provider",
    mode: MODE,
  }),
  async verifyPerson(_input: {
    userId: string;
    legalName: string;
  }): Promise<ProviderResult<IdentityFinding>> {
    return unavailable("Identity verification");
  },
};

export const DocumentVerificationProvider = {
  info: (): ProviderInfo => ({
    id: "document_verification",
    label: "Document verification provider",
    mode: MODE,
  }),
  async inspect(_input: { storagePath: string }): Promise<ProviderResult<DocumentFinding>> {
    return unavailable("Document verification");
  },
};

export function providerStatuses(): ProviderInfo[] {
  return [
    PropertyDataProvider.info(),
    RecordedDocumentProvider.info(),
    AssessorDataProvider.info(),
    BusinessRegistryProvider.info(),
    IdentityVerificationProvider.info(),
    DocumentVerificationProvider.info(),
  ];
}

/**
 * A badge may only be issued from official, production-mode evidence or an
 * explicit human review decision — never from sandbox or mock responses.
 */
export function evidenceCanIssueBadge(mode: ProviderMode): boolean {
  return mode === "production";
}
