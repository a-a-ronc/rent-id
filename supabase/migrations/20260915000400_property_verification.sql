-- =====================================================================
-- Forward migration 4/5 — property ownership & authorized-representative
-- verification (supabase/planned/0003 + 0004, reconciled with
-- src/lib/verification-types.ts — where the two disagree the types win).
--
-- Design rules (unchanged from the planned files):
--   * Verification is PROPERTY-SPECIFIC. Nothing here verifies a user, a
--     company or a portfolio globally.
--   * Three independent propositions (property, identity, authority) are
--     stored separately and never collapsed into one score.
--   * Only two positive public states exist: ownership_verified and
--     authorized_representative_verified. Absence of a badge is neutral.
--   * Evidence and identity data are private: readable by the claimant, the
--     claimant's organization and RentID admins — never by tenants or anon.
--   * A claimant can never mark themselves verified. Every decision goes
--     through decide_verification_case() (admin / platform only), which is
--     the ONLY path that writes a verified status or badge, and it always
--     leaves a verification_status_events row behind.
--   * Tenancy verification (tenancies.verified) is a different concept and is
--     deliberately untouched here.
-- =====================================================================

-- ------------------------------------------------------------------ enums
-- New types are usable in the same transaction (only ADD VALUE is not).
do $$ begin
  if not exists (select 1 from pg_type where typname = 'property_claim_relationship' and typnamespace = 'public'::regnamespace) then
    create type public.property_claim_relationship as enum
      ('individual_owner', 'entity_owner_representative', 'authorized_representative', 'trust_or_estate', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_case_status' and typnamespace = 'public'::regnamespace) then
    create type public.verification_case_status as enum
      ('pending', 'collecting_evidence', 'manual_review', 'ownership_verified',
       'authorized_representative_verified', 'unable_to_verify', 'suspended', 'revoked', 'fraud_review');
  end if;
  if not exists (select 1 from pg_type where typname = 'relationship_verification_status' and typnamespace = 'public'::regnamespace) then
    create type public.relationship_verification_status as enum
      ('unverified', 'pending', 'ownership_verified', 'authorized_representative_verified',
       'unable_to_verify', 'suspended', 'revoked');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_confidence' and typnamespace = 'public'::regnamespace) then
    create type public.verification_confidence as enum ('none', 'weak', 'moderate', 'strong');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_proposition' and typnamespace = 'public'::regnamespace) then
    create type public.verification_proposition as enum ('property', 'identity', 'authority');
  end if;
  if not exists (select 1 from pg_type where typname = 'owner_party_type' and typnamespace = 'public'::regnamespace) then
    create type public.owner_party_type as enum ('individual', 'entity', 'trust', 'estate', 'government', 'unknown');
  end if;
  if not exists (select 1 from pg_type where typname = 'ownership_capacity' and typnamespace = 'public'::regnamespace) then
    create type public.ownership_capacity as enum
      ('sole_owner', 'joint_owner', 'entity', 'trustee', 'executor', 'personal_representative', 'life_estate', 'unknown');
  end if;
  if not exists (select 1 from pg_type where typname = 'evidence_source_type' and typnamespace = 'public'::regnamespace) then
    create type public.evidence_source_type as enum
      ('recorded_document', 'assessor', 'tax_parcel', 'gis', 'business_registry',
       'identity_provider', 'document_verification', 'user_upload', 'manual_note');
  end if;
  if not exists (select 1 from pg_type where typname = 'evidence_strength' and typnamespace = 'public'::regnamespace) then
    create type public.evidence_strength as enum ('primary', 'supporting', 'unverified_upload');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_relationship_kind' and typnamespace = 'public'::regnamespace) then
    create type public.property_relationship_kind as enum
      ('owner', 'entity_representative', 'authorized_representative', 'property_manager', 'trustee', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'authorization_status' and typnamespace = 'public'::regnamespace) then
    create type public.authorization_status as enum ('pending', 'active', 'revoked', 'expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'disclosure_context' and typnamespace = 'public'::regnamespace) then
    create type public.disclosure_context as enum ('application', 'lease', 'payment');
  end if;
  if not exists (select 1 from pg_type where typname = 'verification_risk_severity' and typnamespace = 'public'::regnamespace) then
    create type public.verification_risk_severity as enum ('low', 'medium', 'high');
  end if;
end $$;

-- ---------------------------------------------- property identity columns
-- 0200 already added these; kept here so the file is safe on its own.
alter table public.properties
  add column if not exists normalized_address text,
  add column if not exists county text,
  add column if not exists parcel_number text,
  add column if not exists recording_jurisdiction text,
  add column if not exists legal_description text;

-- Address de-duplication: one live property row per normalized address per org.
create unique index if not exists properties_org_normalized_address_key
  on public.properties (organization_id, normalized_address)
  where deleted_at is null and normalized_address is not null;
create index if not exists properties_normalized_address_lookup_idx on public.properties (normalized_address);
create index if not exists properties_parcel_idx on public.properties (county, parcel_number);

-- ------------------------------------------------------------ write lock
-- Case status, confidence levels and badges are written by the platform or
-- by decide_verification_case() / the internal triggers below, which raise
-- this transaction-local flag around their writes. Nobody else can move a
-- case or a relationship into a verified state.
create or replace function public.verification_writer_unlocked() returns boolean
language sql stable set search_path = public as $$
  select public.is_platform_actor()
      or coalesce(current_setting('rentid.verification_decision', true), '') = 'on';
$$;
revoke execute on function public.verification_writer_unlocked() from public, anon;
grant execute on function public.verification_writer_unlocked() to authenticated, service_role;

-- ---------------------------------------------------------- entities
-- Business / trust identity, verified against an official registry. Verifying
-- an entity NEVER verifies a property; it only supports a property claim.
create table if not exists public.verified_entities (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  normalized_name text not null,
  entity_type text not null default 'entity',
  formation_state text,
  file_number text,
  registry_status text,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verified_entities_normalized_name_idx on public.verified_entities (normalized_name);
grant select, insert, update on public.verified_entities to authenticated;
grant all on public.verified_entities to service_role;
alter table public.verified_entities enable row level security;
drop trigger if exists verified_entities_touch on public.verified_entities;
create trigger verified_entities_touch before update on public.verified_entities
  for each row execute function public.touch_updated_at();

create or replace function public.verified_entities_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.verification_writer_unlocked() then
    if (tg_op = 'INSERT' and (new.verified or new.verified_at is not null))
       or (tg_op = 'UPDATE' and (new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at)) then
      raise exception 'entity verification is asserted by the platform registry check, not by users' using errcode = '42501';
    end if;
  end if;
  if new.verified and new.verified_at is null then new.verified_at := now(); end if;
  if not new.verified then new.verified_at := null; end if;
  return new;
end $$;
revoke execute on function public.verified_entities_guard() from public, anon, authenticated;
drop trigger if exists verified_entities_guard on public.verified_entities;
create trigger verified_entities_guard before insert or update on public.verified_entities
  for each row execute function public.verified_entities_guard();

-- ------------------------------------------------- ownership records
-- What the official record says, independent of any RentID account.
create table if not exists public.property_ownership_records (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_party_type public.owner_party_type not null default 'unknown',
  raw_owner_name text not null,
  normalized_owner_name text not null,
  ownership_capacity public.ownership_capacity not null default 'unknown',
  recorded_at date,
  instrument_reference text,
  source_type public.evidence_source_type not null,
  source_provider text not null default '',
  retrieved_at timestamptz not null default now(),
  is_current boolean not null default true,
  superseded_by uuid references public.property_ownership_records(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists property_ownership_records_property_idx on public.property_ownership_records (property_id, is_current);
grant select, insert, update on public.property_ownership_records to authenticated;
grant all on public.property_ownership_records to service_role;
alter table public.property_ownership_records enable row level security;

-- ------------------------------------------------- verification cases
create table if not exists public.verification_cases (
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
  decided_at timestamptz,
  last_verified_at timestamptz,
  next_review_at timestamptz,
  reverification_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open case per property at a time; historical cases are retained.
create unique index if not exists verification_cases_open_per_property
  on public.verification_cases (property_id)
  where status in ('pending', 'collecting_evidence', 'manual_review', 'fraud_review');
create index if not exists verification_cases_status_idx on public.verification_cases (status);
create index if not exists verification_cases_organization_idx on public.verification_cases (organization_id);
create index if not exists verification_cases_claimant_idx on public.verification_cases (claimant_user_id);
grant select, insert, update on public.verification_cases to authenticated;
grant all on public.verification_cases to service_role;
alter table public.verification_cases enable row level security;
drop trigger if exists verification_cases_touch on public.verification_cases;
create trigger verification_cases_touch before update on public.verification_cases
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------- evidence
-- PRIVATE. storage_path points at a private bucket served by short-lived
-- signed URLs issued server-side; tenants and anon never read this table.
create table if not exists public.verification_evidence (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.verification_cases(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  proposition public.verification_proposition not null,
  evidence_type text not null,
  summary text not null,
  source_type public.evidence_source_type not null default 'user_upload',
  source_provider text not null default 'user',
  strength public.evidence_strength not null default 'unverified_upload',
  official_reference text,
  retrieved_at timestamptz not null default now(),
  document_date date,
  document_hash text,
  storage_path text,
  expires_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists verification_evidence_case_idx on public.verification_evidence (case_id);
create index if not exists verification_evidence_hash_idx on public.verification_evidence (document_hash);
grant select, insert, update on public.verification_evidence to authenticated;
grant all on public.verification_evidence to service_role;
alter table public.verification_evidence enable row level security;

-- ------------------------------------------------ party relationships
-- The link that produces (or withholds) a public badge, per property.
create table if not exists public.property_party_relationships (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  entity_id uuid references public.verified_entities(id) on delete set null,
  relationship public.property_relationship_kind not null,
  status public.relationship_verification_status not null default 'pending',
  recorded_owner_name text,
  verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists property_party_relationships_property_idx on public.property_party_relationships (property_id, status);
create index if not exists property_party_relationships_user_idx on public.property_party_relationships (user_id);
create index if not exists property_party_relationships_org_idx on public.property_party_relationships (organization_id);
grant select on public.property_party_relationships to anon; -- badge only, see RLS
grant select, insert, update on public.property_party_relationships to authenticated;
grant all on public.property_party_relationships to service_role;
alter table public.property_party_relationships enable row level security;
drop trigger if exists property_party_relationships_touch on public.property_party_relationships;
create trigger property_party_relationships_touch before update on public.property_party_relationships
  for each row execute function public.touch_updated_at();

-- -------------------------------------------- representative authorizations
-- Property-specific, revocable, optionally expiring, permission-scoped.
create table if not exists public.representative_authorizations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_name text not null,
  representative_user_id uuid references auth.users(id) on delete set null,
  representative_organization_id uuid references public.organizations(id) on delete set null,
  representative_name text not null,
  role public.property_relationship_kind not null default 'authorized_representative',
  permissions text[] not null default '{}',
  status public.authorization_status not null default 'pending',
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  verification_case_id uuid references public.verification_cases(id) on delete set null,
  management_assignment_id uuid references public.management_assignments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists representative_authorizations_property_idx on public.representative_authorizations (property_id, status);
create index if not exists representative_authorizations_rep_org_idx on public.representative_authorizations (representative_organization_id);
create index if not exists representative_authorizations_rep_user_idx on public.representative_authorizations (representative_user_id);
grant select, insert, update on public.representative_authorizations to authenticated;
grant all on public.representative_authorizations to service_role;
alter table public.representative_authorizations enable row level security;
drop trigger if exists representative_authorizations_touch on public.representative_authorizations;
create trigger representative_authorizations_touch before update on public.representative_authorizations
  for each row execute function public.touch_updated_at();

-- ------------------------------------------- disclosure acknowledgements
-- One-time per tenant + property + payee + disclosure/verification version.
create table if not exists public.verification_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  tenant_user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  relationship_id uuid references public.property_party_relationships(id) on delete set null,
  payee_reference text not null,
  disclosure_version text not null,
  verification_version text not null,
  context public.disclosure_context not null,
  acknowledged_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists verification_ack_unique
  on public.verification_acknowledgements
     (tenant_user_id, property_id, payee_reference, disclosure_version, verification_version);
grant select, insert on public.verification_acknowledgements to authenticated;
grant all on public.verification_acknowledgements to service_role;
alter table public.verification_acknowledgements enable row level security;

-- ------------------------------------------------------------------ risk
create table if not exists public.verification_risk_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  severity public.verification_risk_severity not null default 'low',
  detail text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists verification_risk_events_property_idx on public.verification_risk_events (property_id);
create index if not exists verification_risk_events_case_idx on public.verification_risk_events (case_id);
-- Risk signals are written by the platform only; admins read and resolve them.
grant select, update on public.verification_risk_events to authenticated;
grant all on public.verification_risk_events to service_role;
alter table public.verification_risk_events enable row level security;

-- ------------------------------------------------- append-only history
create table if not exists public.verification_status_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  case_id uuid references public.verification_cases(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null default '',
  from_status public.verification_case_status,
  to_status public.verification_case_status,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists verification_status_events_case_idx on public.verification_status_events (case_id, created_at);
create index if not exists verification_status_events_property_idx on public.verification_status_events (property_id, created_at);
-- Written by triggers and decide_verification_case() only.
grant select on public.verification_status_events to authenticated;
grant all on public.verification_status_events to service_role;
alter table public.verification_status_events enable row level security;

-- ---------------------------------------------------------------- helpers
-- Does this user hold an active, unexpired authorization for THIS property
-- carrying THIS permission (src/lib/verification-types.ts PropertyPermission)?
create or replace function public.has_property_permission(_property_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.representative_authorizations a
    where a.property_id = _property_id
      and a.status = 'active'
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at > now())
      and _permission = any (a.permissions)
      and (a.representative_user_id = auth.uid()
           or (a.representative_organization_id is not null
               and public.is_org_member(a.representative_organization_id)))
  );
$$;
revoke execute on function public.has_property_permission(uuid, text) from public, anon;
grant execute on function public.has_property_permission(uuid, text) to authenticated, service_role;

-- The private side of one case: the claimant, the claimant's organization, admins.
create or replace function public.can_view_verification_case(_case_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
      or exists (
        select 1 from public.verification_cases c
        where c.id = _case_id
          and (c.claimant_user_id = auth.uid()
               or (c.organization_id is not null and public.is_org_member(c.organization_id)))
      );
$$;
revoke execute on function public.can_view_verification_case(uuid) from public, anon;
grant execute on function public.can_view_verification_case(uuid) to authenticated, service_role;

-- Can this user see the private verification workspace for a property?
-- (owning organization, any claimant on it and their organization, a
-- representative delegated 'manage_property_records', admins)
create or replace function public.can_view_property_verification(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
      or exists (select 1 from public.properties p
                  where p.id = _property_id and public.is_org_member(p.organization_id))
      or exists (select 1 from public.verification_cases c
                  where c.property_id = _property_id
                    and (c.claimant_user_id = auth.uid()
                         or (c.organization_id is not null and public.is_org_member(c.organization_id))))
      or public.has_property_permission(_property_id, 'manage_property_records');
$$;
revoke execute on function public.can_view_property_verification(uuid) from public, anon;
grant execute on function public.can_view_property_verification(uuid) to authenticated, service_role;

-- Who may open a claim on a property: its operators, or someone the owner
-- has invited to represent it.
create or replace function public.can_claim_property(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_operate_property(_property_id)
      or exists (
        select 1 from public.representative_authorizations a
        where a.property_id = _property_id
          and a.status in ('pending', 'active')
          and a.revoked_at is null
          and (a.representative_user_id = auth.uid()
               or (a.representative_organization_id is not null
                   and public.is_org_member(a.representative_organization_id)))
      );
$$;
revoke execute on function public.can_claim_property(uuid) from public, anon;
grant execute on function public.can_claim_property(uuid) to authenticated, service_role;

-- ------------------------------------------------- verification_cases rules
-- A claimant opens a case in a pre-verification state with zero confidence.
-- Afterwards status, confidence and decision fields move only through the
-- platform or decide_verification_case().
create or replace function public.verification_cases_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.verification_writer_unlocked() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.claimant_user_id := coalesce(new.claimant_user_id, auth.uid());
    if new.status not in ('pending', 'collecting_evidence', 'manual_review')
       or new.property_confidence <> 'none' or new.identity_confidence <> 'none' or new.authority_confidence <> 'none'
       or new.reviewer_id is not null or new.decided_at is not null or new.last_verified_at is not null
       or new.next_review_at is not null or new.hard_contradiction or new.reverification_required then
      raise exception 'a verification case opens in a pre-verification state; verification is never self-asserted'
        using errcode = '42501';
    end if;
    new.contradictions := '{}';
    new.decision_reason := null;
  else
    if new.status is distinct from old.status
       or new.property_confidence is distinct from old.property_confidence
       or new.identity_confidence is distinct from old.identity_confidence
       or new.authority_confidence is distinct from old.authority_confidence
       or new.hard_contradiction is distinct from old.hard_contradiction
       or new.contradictions is distinct from old.contradictions
       or new.reviewer_id is distinct from old.reviewer_id
       or new.decision_reason is distinct from old.decision_reason
       or new.decided_at is distinct from old.decided_at
       or new.last_verified_at is distinct from old.last_verified_at
       or new.next_review_at is distinct from old.next_review_at
       or new.reverification_required is distinct from old.reverification_required
       or new.property_id <> old.property_id
       or new.claimant_user_id is distinct from old.claimant_user_id then
      raise exception 'verification decisions are made through decide_verification_case()' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.verification_cases_guard() from public, anon, authenticated;
drop trigger if exists verification_cases_guard on public.verification_cases;
create trigger verification_cases_guard before insert or update on public.verification_cases
  for each row execute function public.verification_cases_guard();

-- Opening a case creates the (pending, badge-less) relationship row and the
-- first history entry — the same bookkeeping openPropertyClaim() does.
create or replace function public.verification_cases_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  kind public.property_relationship_kind;
begin
  kind := case new.claim_relationship
            when 'individual_owner' then 'owner'::public.property_relationship_kind
            when 'entity_owner_representative' then 'entity_representative'
            when 'authorized_representative' then 'authorized_representative'
            when 'trust_or_estate' then 'trustee'
            else 'other'
          end;
  insert into public.property_party_relationships
    (property_id, case_id, user_id, organization_id, entity_id, relationship, status)
  values
    (new.property_id, new.id, new.claimant_user_id, new.organization_id, new.entity_id, kind, 'pending');
  insert into public.verification_status_events
    (property_id, case_id, actor_id, action, from_status, to_status, reason)
  values
    (new.property_id, new.id, coalesce(new.claimant_user_id, auth.uid()), 'verification.case_opened',
     null, new.status, new.claim_relationship::text);
  return new;
end $$;
revoke execute on function public.verification_cases_after_insert() from public, anon, authenticated;
drop trigger if exists verification_cases_after_insert on public.verification_cases;
create trigger verification_cases_after_insert after insert on public.verification_cases
  for each row execute function public.verification_cases_after_insert();

drop policy if exists verification_cases_select on public.verification_cases;
create policy verification_cases_select on public.verification_cases for select to authenticated
  using (public.can_view_verification_case(id) or public.can_manage_property(property_id));
drop policy if exists verification_cases_insert_claimant on public.verification_cases;
create policy verification_cases_insert_claimant on public.verification_cases for insert to authenticated
  with check (
    claimant_user_id = auth.uid()
    and (organization_id is null or public.is_org_member(organization_id))
    and public.can_claim_property(property_id)
    and status in ('pending', 'collecting_evidence', 'manual_review')
    and property_confidence = 'none' and identity_confidence = 'none' and authority_confidence = 'none'
    and reviewer_id is null and decided_at is null
  );
-- Admins may edit case metadata (claimant name, entity link); decisions still
-- have to go through decide_verification_case() — see the guard above.
drop policy if exists verification_cases_update_admin on public.verification_cases;
create policy verification_cases_update_admin on public.verification_cases for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------- verification_evidence rules
create or replace function public.verification_evidence_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  case_property uuid;
begin
  select property_id into case_property from public.verification_cases where id = new.case_id;
  if case_property is null then
    raise exception 'evidence references unknown verification case %', new.case_id using errcode = '23503';
  end if;
  new.property_id := case_property;
  if not public.is_platform_actor() then
    new.submitted_by := coalesce(new.submitted_by, auth.uid());
  end if;
  return new;
end $$;
revoke execute on function public.verification_evidence_before_insert() from public, anon, authenticated;
drop trigger if exists verification_evidence_before_insert on public.verification_evidence;
create trigger verification_evidence_before_insert before insert on public.verification_evidence
  for each row execute function public.verification_evidence_before_insert();

-- Uploaded evidence goes to a human; it can never self-issue a badge.
create or replace function public.verification_evidence_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.verification_cases%rowtype;
begin
  select * into c from public.verification_cases where id = new.case_id for update;
  if c.status in ('pending', 'collecting_evidence', 'unable_to_verify', 'suspended') then
    perform set_config('rentid.verification_decision', 'on', true);
    update public.verification_cases set status = 'manual_review', updated_at = now() where id = c.id;
    perform set_config('rentid.verification_decision', '', true);
    c.status := 'manual_review';
  end if;
  insert into public.verification_status_events
    (property_id, case_id, actor_id, action, from_status, to_status, reason)
  values
    (c.property_id, c.id, new.submitted_by, 'verification.evidence_submitted', null, c.status, new.evidence_type);
  return new;
end $$;
revoke execute on function public.verification_evidence_after_insert() from public, anon, authenticated;
drop trigger if exists verification_evidence_after_insert on public.verification_evidence;
create trigger verification_evidence_after_insert after insert on public.verification_evidence
  for each row execute function public.verification_evidence_after_insert();

drop policy if exists verification_evidence_select on public.verification_evidence;
create policy verification_evidence_select on public.verification_evidence for select to authenticated
  using (public.can_view_verification_case(case_id));
drop policy if exists verification_evidence_insert_claimant on public.verification_evidence;
create policy verification_evidence_insert_claimant on public.verification_evidence for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.can_view_verification_case(case_id)
    -- user uploads are always unverified until a reviewer says otherwise
    and source_type = 'user_upload'
    and strength = 'unverified_upload'
    and reviewed_by is null
  );
drop policy if exists verification_evidence_update_admin on public.verification_evidence;
create policy verification_evidence_update_admin on public.verification_evidence for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------- property_party_relationships rules
-- A verified badge is written by decide_verification_case() or the platform
-- only — not even an admin sets it by hand.
create or replace function public.property_party_relationships_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.verification_writer_unlocked() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status in ('ownership_verified', 'authorized_representative_verified') or new.verified_at is not null then
      raise exception 'verified badges are issued by decide_verification_case()' using errcode = '42501';
    end if;
  else
    if (new.status is distinct from old.status
        and new.status in ('ownership_verified', 'authorized_representative_verified'))
       or (new.verified_at is distinct from old.verified_at and new.verified_at is not null)
       or new.property_id <> old.property_id
       or new.user_id is distinct from old.user_id then
      raise exception 'verified badges are issued by decide_verification_case()' using errcode = '42501';
    end if;
  end if;
  if new.status = 'revoked' then new.revoked_at := coalesce(new.revoked_at, now()); end if;
  return new;
end $$;
revoke execute on function public.property_party_relationships_guard() from public, anon, authenticated;
drop trigger if exists property_party_relationships_guard on public.property_party_relationships;
create trigger property_party_relationships_guard before insert or update on public.property_party_relationships
  for each row execute function public.property_party_relationships_guard();

-- The ONLY publicly readable verification table, and only positive states.
drop policy if exists relationships_select_public_badges on public.property_party_relationships;
create policy relationships_select_public_badges on public.property_party_relationships for select to anon, authenticated
  using (revoked_at is null and status in ('ownership_verified', 'authorized_representative_verified'));
drop policy if exists relationships_select_parties on public.property_party_relationships;
create policy relationships_select_parties on public.property_party_relationships for select to authenticated
  using (public.can_view_property_verification(property_id));
drop policy if exists relationships_insert_admin on public.property_party_relationships;
create policy relationships_insert_admin on public.property_party_relationships for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists relationships_update_admin on public.property_party_relationships;
create policy relationships_update_admin on public.property_party_relationships for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------ representative_authorizations rules
-- Owner invites (pending) → representative accepts (active) → owner or
-- representative revokes. Only the owner side changes the scope
-- (permissions, expiry, role); the representative can never widen it.
create or replace function public.representative_authorizations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_side boolean;
  rep_side boolean;
begin
  if public.is_platform_actor() then
    if new.status = 'active' then new.granted_at := coalesce(new.granted_at, now()); end if;
    if new.status = 'revoked' then new.revoked_at := coalesce(new.revoked_at, now()); end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.granted_at is not null or new.revoked_at is not null then
      raise exception 'an authorization is issued pending and becomes active when the representative accepts'
        using errcode = '42501';
    end if;
    new.owner_user_id := coalesce(new.owner_user_id, auth.uid());
    return new;
  end if;

  owner_side := old.owner_user_id = auth.uid()
                or public.can_manage_property(old.property_id)
                or public.has_role(auth.uid(), 'admin');
  rep_side := old.representative_user_id = auth.uid()
              or (old.representative_organization_id is not null
                  and public.is_org_member(old.representative_organization_id));

  if not owner_side then
    if new.permissions is distinct from old.permissions
       or new.expires_at is distinct from old.expires_at
       or new.role is distinct from old.role
       or new.property_id <> old.property_id
       or new.owner_user_id is distinct from old.owner_user_id
       or new.representative_organization_id is distinct from old.representative_organization_id
       or (old.representative_user_id is not null
           and new.representative_user_id is distinct from old.representative_user_id) then
      raise exception 'only the owner can change the scope of an authorization' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'active' then
      if old.status <> 'pending' or not rep_side then
        raise exception 'only the invited representative can accept a pending authorization' using errcode = '42501';
      end if;
      new.representative_user_id := coalesce(new.representative_user_id, auth.uid());
      new.granted_at := now();
    elsif new.status = 'revoked' then
      if not (owner_side or rep_side) then
        raise exception 'only the owner or the representative can revoke an authorization' using errcode = '42501';
      end if;
      new.revoked_at := coalesce(new.revoked_at, now());
    elsif new.status = 'expired' then
      if not (owner_side or rep_side) then
        raise exception 'not a party to this authorization' using errcode = '42501';
      end if;
    else
      raise exception 'an authorization cannot return to pending' using errcode = '42501';
    end if;
  elsif new.granted_at is distinct from old.granted_at or new.revoked_at is distinct from old.revoked_at then
    raise exception 'granted_at / revoked_at follow the status change' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.representative_authorizations_guard() from public, anon, authenticated;
drop trigger if exists representative_authorizations_guard on public.representative_authorizations;
create trigger representative_authorizations_guard before insert or update on public.representative_authorizations
  for each row execute function public.representative_authorizations_guard();

-- History + badge withdrawal on revoke (mirrors revokeAuthorization()).
create or replace function public.representative_authorizations_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.verification_status_events (property_id, case_id, actor_id, action, reason)
    values (new.property_id, new.verification_case_id, coalesce(new.owner_user_id, auth.uid()),
            'authorization.invited', 'Representative: ' || new.representative_name);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'active' then
      insert into public.verification_status_events (property_id, case_id, actor_id, action, reason)
      values (new.property_id, new.verification_case_id, coalesce(new.representative_user_id, auth.uid()),
              'authorization.accepted', 'Representative: ' || new.representative_name);
    elsif new.status = 'revoked' then
      -- badge and permissions go away; history is preserved
      update public.property_party_relationships r
         set status = 'revoked', revoked_at = coalesce(r.revoked_at, now()), updated_at = now()
       where r.property_id = new.property_id
         and r.relationship <> 'owner'
         and r.revoked_at is null
         and ((new.representative_user_id is not null and r.user_id = new.representative_user_id)
              or (new.verification_case_id is not null and r.case_id = new.verification_case_id));
      insert into public.verification_status_events (property_id, case_id, actor_id, action, to_status, reason)
      values (new.property_id, new.verification_case_id, auth.uid(), 'authorization.revoked', 'revoked', new.revoked_reason);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.representative_authorizations_after_write() from public, anon, authenticated;
drop trigger if exists representative_authorizations_after_write on public.representative_authorizations;
create trigger representative_authorizations_after_write after insert or update on public.representative_authorizations
  for each row execute function public.representative_authorizations_after_write();

drop policy if exists authorizations_select_parties on public.representative_authorizations;
create policy authorizations_select_parties on public.representative_authorizations for select to authenticated
  using (
    owner_user_id = auth.uid()
    or representative_user_id = auth.uid()
    or (representative_organization_id is not null and public.is_org_member(representative_organization_id))
    or public.can_view_property_verification(property_id)
  );
-- Only a party whose ownership is verified for THIS property may delegate.
drop policy if exists authorizations_insert_verified_owner on public.representative_authorizations;
create policy authorizations_insert_verified_owner on public.representative_authorizations for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.property_party_relationships r
      where r.property_id = representative_authorizations.property_id
        and r.user_id = auth.uid()
        and r.status = 'ownership_verified'
        and r.revoked_at is null
    )
  );
drop policy if exists authorizations_update_parties on public.representative_authorizations;
create policy authorizations_update_parties on public.representative_authorizations for update to authenticated
  using (
    owner_user_id = auth.uid()
    or representative_user_id = auth.uid()
    or (representative_organization_id is not null and public.is_org_member(representative_organization_id))
    or public.has_role(auth.uid(), 'admin')
  )
  with check (
    owner_user_id = auth.uid()
    or representative_user_id = auth.uid()
    or (representative_organization_id is not null and public.is_org_member(representative_organization_id))
    or public.has_role(auth.uid(), 'admin')
  );

-- ---------------------------------------------- remaining table policies
drop policy if exists entities_select_linked on public.verified_entities;
create policy entities_select_linked on public.verified_entities for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin')
    or exists (select 1 from public.verification_cases c
                where c.entity_id = verified_entities.id and public.can_view_verification_case(c.id))
  );
drop policy if exists entities_insert_admin on public.verified_entities;
create policy entities_insert_admin on public.verified_entities for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists entities_update_admin on public.verified_entities;
create policy entities_update_admin on public.verified_entities for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Owner-side workspace only. The public badge exposes the owner NAME through
-- property_party_relationships, not the underlying record rows.
drop policy if exists ownership_records_select_parties on public.property_ownership_records;
create policy ownership_records_select_parties on public.property_ownership_records for select to authenticated
  using (public.can_view_property_verification(property_id));
drop policy if exists ownership_records_insert_admin on public.property_ownership_records;
create policy ownership_records_insert_admin on public.property_ownership_records for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists ownership_records_update_admin on public.property_ownership_records;
create policy ownership_records_update_admin on public.property_ownership_records for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists acknowledgements_select_own on public.verification_acknowledgements;
create policy acknowledgements_select_own on public.verification_acknowledgements for select to authenticated
  using (tenant_user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
drop policy if exists acknowledgements_insert_own on public.verification_acknowledgements;
create policy acknowledgements_insert_own on public.verification_acknowledgements for insert to authenticated
  with check (tenant_user_id = auth.uid());
-- No update/delete policy: acknowledgements are immutable evidence of notice.

drop policy if exists risk_events_select_admin on public.verification_risk_events;
create policy risk_events_select_admin on public.verification_risk_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists risk_events_update_admin on public.verification_risk_events;
create policy risk_events_update_admin on public.verification_risk_events for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists status_events_select_parties on public.verification_status_events;
create policy status_events_select_parties on public.verification_status_events for select to authenticated
  using (public.can_view_property_verification(property_id)
         or (case_id is not null and public.can_view_verification_case(case_id)));
-- Append-only: no insert/update/delete policy for any client role.

-- ------------------------------------------------------- review decisions
-- The seven reviewer decisions from src/lib/services/verification.ts. Admin
-- or platform only; requires a reason; moves the case, updates the badge
-- relationship(s), appends history and an audit_logs row. Returns the case id.
create or replace function public.decide_verification_case(_case_id uuid, _decision text, _reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.verification_cases%rowtype;
  actor uuid := auth.uid();
  to_status public.verification_case_status;
  rel_status public.relationship_verification_status;
  verified boolean;
  owner_name text;
  reason text := btrim(coalesce(_reason, ''));
  ts timestamptz := now();
begin
  if not (public.is_platform_actor() or public.has_role(actor, 'admin')) then
    raise exception 'only RentID review staff can decide a verification case' using errcode = '42501';
  end if;
  if reason = '' then
    raise exception 'a reason is required for this decision' using errcode = '22023';
  end if;
  to_status := case _decision
    when 'verify_ownership'      then 'ownership_verified'::public.verification_case_status
    when 'verify_representative' then 'authorized_representative_verified'
    when 'request_information'   then 'collecting_evidence'
    when 'keep_pending'          then 'manual_review'
    when 'unable_to_verify'      then 'unable_to_verify'
    when 'suspend'               then 'suspended'
    when 'fraud_escalation'      then 'fraud_review'
    else null end;
  if to_status is null then
    raise exception 'unknown decision "%"', _decision using errcode = '22023';
  end if;

  select * into c from public.verification_cases where id = _case_id for update;
  if not found then
    raise exception 'verification case not found' using errcode = 'P0002';
  end if;
  verified := to_status in ('ownership_verified', 'authorized_representative_verified');

  perform set_config('rentid.verification_decision', 'on', true);

  update public.verification_cases
     set status = to_status,
         reviewer_id = actor,
         decision_reason = reason,
         decided_at = ts,
         updated_at = ts,
         last_verified_at = case when verified then ts else last_verified_at end,
         -- verification is not permanent: schedule the next look
         next_review_at = case when verified then ts + interval '365 days' else next_review_at end,
         reverification_required = case when verified then false else reverification_required end
   where id = c.id;

  rel_status := case to_status
    when 'ownership_verified'                  then 'ownership_verified'::public.relationship_verification_status
    when 'authorized_representative_verified'  then 'authorized_representative_verified'
    when 'unable_to_verify'                    then 'unable_to_verify'
    when 'suspended'                           then 'suspended'
    when 'revoked'                             then 'revoked'
    else null end;
  if rel_status is not null then
    -- a newer recorded deed outranks a stale assessor owner field
    select r.raw_owner_name into owner_name
      from public.property_ownership_records r
     where r.property_id = c.property_id and r.is_current
     order by (r.source_type = 'recorded_document') desc, r.recorded_at desc nulls last, r.retrieved_at desc
     limit 1;
    update public.property_party_relationships r
       set status = rel_status,
           recorded_owner_name = coalesce(owner_name, r.recorded_owner_name),
           verified_at = case when verified then ts else null end,
           updated_at = ts
     where r.property_id = c.property_id
       and r.revoked_at is null
       and (r.case_id = c.id or (c.claimant_user_id is not null and r.user_id = c.claimant_user_id));
  end if;

  insert into public.verification_status_events (property_id, case_id, actor_id, action, from_status, to_status, reason)
  values (c.property_id, c.id, actor, 'verification.' || _decision, c.status, to_status, reason);

  insert into public.audit_logs (actor_id, actor_role, organization_id, action, entity_type, entity_id, metadata)
  values (actor, 'admin', c.organization_id, 'property_verification.' || _decision, 'verification_case', c.id,
          jsonb_build_object('reason', reason, 'property_id', c.property_id, 'from_status', c.status, 'to_status', to_status));

  perform set_config('rentid.verification_decision', '', true);
  return c.id;
end $$;
revoke execute on function public.decide_verification_case(uuid, text, text) from public, anon;
grant execute on function public.decide_verification_case(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------ provider profile (now real)
-- verified_properties = properties on which this organization holds a live
-- verified badge (ownership or authorized representative).
create or replace function public.provider_public_profile(_org_id uuid)
returns table (
  organization_id uuid,
  name text,
  kind public.org_kind,
  verification_status public.verification_status,
  verified_properties integer,
  published_listings integer
)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.kind, o.verification_status,
         (select count(distinct r.property_id)::integer
            from public.property_party_relationships r
           where r.organization_id = o.id
             and r.revoked_at is null
             and r.status in ('ownership_verified', 'authorized_representative_verified')) as verified_properties,
         (select count(*)::integer from public.listings l
           where l.organization_id = o.id and l.status = 'published' and l.deleted_at is null) as published_listings
    from public.organizations o
   where o.id = _org_id and o.deleted_at is null;
$$;
revoke execute on function public.provider_public_profile(uuid) from public;
grant execute on function public.provider_public_profile(uuid) to anon, authenticated, service_role;

-- Evidence documents belong in a PRIVATE storage bucket ('verification-evidence'),
-- served through short-lived signed URLs issued server-side after checking
-- can_view_verification_case(); the bucket itself is provisioned with the
-- project, not by this migration.
