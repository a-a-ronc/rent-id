-- =====================================================================
-- RentID — property ownership & authorized representative verification
-- (NOT YET APPLIED — review target, additive to 0001_schema.sql)
--
-- Design rules encoded here:
--   * Verification is PROPERTY-SPECIFIC. Nothing in this schema can verify a
--     user, a company, or a portfolio globally.
--   * Three independent propositions (property identity, claimant identity,
--     authority) are stored separately and never collapsed into one score.
--   * Only two positive public states exist: ownership_verified and
--     authorized_representative_verified. There is no "unverified" state to
--     display — absence of a row/badge is the neutral state.
--   * Evidence and identity data are private: never selectable by tenants or
--     anonymous callers (see 0004_property_verification_rls.sql).
--   * Tenancy verification (tenancies.verified) is a DIFFERENT concept and is
--     deliberately untouched here.
-- =====================================================================

-- ------------------------------- enums -------------------------------
create type public.property_claim_relationship as enum (
  'individual_owner', 'entity_owner_representative', 'authorized_representative',
  'trust_or_estate', 'other'
);
create type public.verification_case_status as enum (
  'pending', 'collecting_evidence', 'manual_review', 'ownership_verified',
  'authorized_representative_verified', 'unable_to_verify', 'suspended',
  'revoked', 'fraud_review'
);
create type public.verification_confidence as enum ('none', 'weak', 'moderate', 'strong');
create type public.verification_proposition as enum ('property', 'identity', 'authority');
create type public.owner_party_type as enum ('individual', 'entity', 'trust', 'estate', 'government', 'unknown');
create type public.evidence_source_type as enum (
  'recorded_document', 'assessor_record', 'parcel_dataset', 'business_registry',
  'identity_provider', 'user_upload', 'manual_review_note'
);
create type public.evidence_strength as enum ('primary', 'supporting', 'unverified');
create type public.property_relationship_kind as enum (
  'owner', 'entity_owner', 'trustee', 'executor', 'property_manager',
  'authorized_representative'
);
create type public.authorization_status as enum ('pending', 'active', 'revoked', 'expired');
create type public.disclosure_context as enum ('application', 'lease', 'payment');
create type public.verification_risk_severity as enum ('low', 'medium', 'high');

-- --------------------- property identity columns ----------------------
alter table public.properties
  add column if not exists normalized_address text,
  add column if not exists county text,
  add column if not exists parcel_number text,
  add column if not exists recording_jurisdiction text,
  add column if not exists legal_description text;

-- Address de-duplication: one property row per normalized address per org.
create unique index if not exists properties_org_normalized_address_key
  on public.properties (organization_id, normalized_address)
  where deleted_at is null and normalized_address is not null;
create index if not exists properties_normalized_address_idx
  on public.properties (normalized_address);
create index if not exists properties_parcel_idx on public.properties (county, parcel_number);

-- ---------------------------- entities -------------------------------
-- Business / trust identity, verified against an official registry. Verifying
-- an entity NEVER verifies a property; it only supports a property claim.
create table public.verified_entities (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  normalized_name text not null,
  party_type public.owner_party_type not null default 'entity',
  jurisdiction text,
  registry_id text,
  registry_source text,
  status text not null default 'unverified',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.verified_entities (normalized_name);
grant select, insert, update on public.verified_entities to authenticated;
grant all on public.verified_entities to service_role;

-- ------------------------- ownership records --------------------------
-- What the official record says, independent of any RentID account.
create table public.property_ownership_records (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_name text not null,
  normalized_owner_name text not null,
  party_type public.owner_party_type not null default 'unknown',
  source_type public.evidence_source_type not null,
  source_name text,
  document_reference text,
  recorded_at date,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.property_ownership_records (property_id, is_current);
grant select on public.property_ownership_records to authenticated;
grant all on public.property_ownership_records to service_role;

-- ------------------------ verification cases --------------------------
create table public.verification_cases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  claimant_user_id uuid references auth.users(id) on delete set null,
  claimant_name text not null,
  claim_relationship public.property_claim_relationship not null,
  status public.verification_case_status not null default 'pending',
  -- three independent propositions, never averaged into a single score
  property_confidence public.verification_confidence not null default 'none',
  identity_confidence public.verification_confidence not null default 'none',
  authority_confidence public.verification_confidence not null default 'none',
  hard_contradiction boolean not null default false,
  contradictions text[] not null default '{}',
  entity_id uuid references public.verified_entities(id) on delete set null,
  rules_version text not null,
  reviewer_id uuid references auth.users(id) on delete set null,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  last_verified_at timestamptz,
  reverify_after timestamptz
);
-- One open case per property at a time; historical cases are retained.
create unique index verification_cases_open_per_property
  on public.verification_cases (property_id)
  where status in ('pending', 'collecting_evidence', 'manual_review', 'fraud_review');
create index on public.verification_cases (status);
create index on public.verification_cases (organization_id);
create index on public.verification_cases (claimant_user_id);
grant select, insert, update on public.verification_cases to authenticated;
grant all on public.verification_cases to service_role;

-- --------------------------- evidence --------------------------------
-- PRIVATE. Storage paths point at a private bucket; tenants never read this.
create table public.verification_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.verification_cases(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  proposition public.verification_proposition not null,
  evidence_type text not null,
  summary text not null,
  source_type public.evidence_source_type not null,
  strength public.evidence_strength not null default 'unverified',
  storage_path text,
  document_hash text,
  document_date date,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.verification_evidence (case_id);
create index on public.verification_evidence (document_hash);
grant select, insert on public.verification_evidence to authenticated;
grant all on public.verification_evidence to service_role;

-- --------------------- party relationships ---------------------------
-- The link that produces (or withholds) a public badge, per property.
create table public.property_party_relationships (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  entity_id uuid references public.verified_entities(id) on delete set null,
  kind public.property_relationship_kind not null,
  display_name text not null,
  status public.verification_case_status not null default 'pending',
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.property_party_relationships (property_id, status);
grant select on public.property_party_relationships to authenticated;
grant select on public.property_party_relationships to anon; -- badge only, see RLS
grant all on public.property_party_relationships to service_role;

-- ------------------ representative authorizations ---------------------
-- Property-specific, revocable, optionally expiring, permission-scoped.
create table public.representative_authorizations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_name text not null,
  representative_user_id uuid references auth.users(id) on delete set null,
  representative_organization_id uuid references public.organizations(id) on delete set null,
  representative_name text not null,
  role public.property_relationship_kind not null default 'property_manager',
  permissions text[] not null default '{}',
  status public.authorization_status not null default 'pending',
  accepted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.representative_authorizations (property_id, status);
create index on public.representative_authorizations (representative_organization_id);
grant select, insert, update on public.representative_authorizations to authenticated;
grant all on public.representative_authorizations to service_role;

-- -------------------- disclosure acknowledgements ---------------------
-- One-time per tenant + property + payee + disclosure/verification version.
create table public.verification_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  tenant_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  relationship_id uuid references public.property_party_relationships(id) on delete set null,
  payee_reference text not null,
  disclosure_version text not null,
  verification_version text not null,
  context public.disclosure_context not null,
  acknowledged_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create unique index verification_ack_unique
  on public.verification_acknowledgements
     (tenant_user_id, property_id, payee_reference, disclosure_version, verification_version);
grant select, insert on public.verification_acknowledgements to authenticated;
grant all on public.verification_acknowledgements to service_role;

-- ----------------------------- risk ----------------------------------
create table public.verification_risk_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  severity public.verification_risk_severity not null default 'low',
  detail text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.verification_risk_events (property_id);
grant all on public.verification_risk_events to service_role;
-- deliberately NO authenticated grant: risk signals are admin-only.

-- ------------------------ append-only history -------------------------
create table public.verification_status_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  from_status public.verification_case_status,
  to_status public.verification_case_status not null,
  reason text,
  created_at timestamptz not null default now()
);
create index on public.verification_status_events (case_id, created_at);
grant select, insert on public.verification_status_events to authenticated;
grant all on public.verification_status_events to service_role;

-- Verification propositions must not be silently mutated by clients: the
-- confidence columns and status are written only by the verification service
-- (service_role / security-definer functions). Enforced by RLS in 0004.
