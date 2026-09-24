-- =====================================================================
-- RentID — RLS for property ownership & authorized representative
-- verification (NOT YET APPLIED)
--
--   * Evidence, risk events and identity data are NEVER readable by tenants
--     or anonymous callers.
--   * Anonymous/public reads are limited to the badge-bearing relationship
--     rows, and only when the relationship is in a positive verified state.
--   * Confidence levels, statuses and decisions are written by the
--     verification service (service_role) and admin review only — a claimant
--     can never mark themselves verified.
-- =====================================================================

-- Property-specific authority helper: does this user hold an active,
-- unexpired authorization for THIS property with THIS permission?
create or replace function public.has_property_permission(_property_id uuid, _permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.representative_authorizations a
    where a.property_id = _property_id
      and a.status = 'active'
      and (a.expires_at is null or a.expires_at > now())
      and _permission = any (a.permissions)
      and (
        a.representative_user_id = auth.uid()
        or (a.representative_organization_id is not null
            and public.is_org_member(a.representative_organization_id))
      )
  );
$$;

-- Can this user see the private verification workspace for a property?
create or replace function public.can_view_property_verification(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties p
    where p.id = _property_id and public.is_org_member(p.organization_id)
  )
  or exists (
    select 1 from public.verification_cases c
    where c.property_id = _property_id and c.claimant_user_id = auth.uid()
  )
  or public.has_property_permission(_property_id, 'manage_verification')
  or public.has_role(auth.uid(), 'admin');
$$;

-- ------------------------- verified_entities --------------------------
alter table public.verified_entities enable row level security;
create policy "entities readable by linked parties" on public.verified_entities
  for select to authenticated using (
    public.has_role(auth.uid(), 'admin')
    or exists (
      select 1 from public.verification_cases c
      where c.entity_id = verified_entities.id
        and public.can_view_property_verification(c.property_id)
    )
  );
create policy "admins manage entities" on public.verified_entities
  for all to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- --------------------- property_ownership_records ---------------------
-- Owner-side workspace only. The public badge exposes the owner NAME through
-- property_party_relationships, not the underlying record rows.
alter table public.property_ownership_records enable row level security;
create policy "ownership records visible to property parties"
  on public.property_ownership_records for select to authenticated
  using (public.can_view_property_verification(property_id));
create policy "admins manage ownership records"
  on public.property_ownership_records for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- -------------------------- verification_cases ------------------------
alter table public.verification_cases enable row level security;
create policy "cases visible to property parties" on public.verification_cases
  for select to authenticated using (public.can_view_property_verification(property_id));
-- A claimant may OPEN a case, but only in a pre-verification status and only
-- with zero confidence: verification is never self-asserted.
create policy "claimant may open a case" on public.verification_cases
  for insert to authenticated with check (
    claimant_user_id = auth.uid()
    and status in ('pending', 'collecting_evidence', 'manual_review')
    and property_confidence = 'none'
    and identity_confidence = 'none'
    and authority_confidence = 'none'
    and reviewer_id is null
    and decided_at is null
  );
create policy "admins review cases" on public.verification_cases
  for update to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ------------------------ verification_evidence -----------------------
-- Private evidence. No anon grant, no tenant access, no delete for anyone.
alter table public.verification_evidence enable row level security;
create policy "evidence visible to property parties" on public.verification_evidence
  for select to authenticated using (public.can_view_property_verification(property_id));
create policy "claimant may submit evidence" on public.verification_evidence
  for insert to authenticated with check (
    submitted_by = auth.uid()
    and public.can_view_property_verification(property_id)
    -- user uploads are always unverified until a reviewer says otherwise
    and source_type = 'user_upload'
    and strength = 'unverified'
    and reviewed_by is null
  );
create policy "admins review evidence" on public.verification_evidence
  for update to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- -------------------- property_party_relationships --------------------
-- The ONLY publicly readable verification table, and only positive states.
alter table public.property_party_relationships enable row level security;
create policy "public may read verified badges" on public.property_party_relationships
  for select to anon using (
    revoked_at is null
    and status in ('ownership_verified', 'authorized_representative_verified')
  );
create policy "signed-in may read verified badges" on public.property_party_relationships
  for select to authenticated using (
    (revoked_at is null
     and status in ('ownership_verified', 'authorized_representative_verified'))
    or public.can_view_property_verification(property_id)
  );
create policy "admins manage relationships" on public.property_party_relationships
  for all to authenticated using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ------------------- representative_authorizations --------------------
alter table public.representative_authorizations enable row level security;
create policy "authorizations visible to both sides"
  on public.representative_authorizations for select to authenticated using (
    owner_user_id = auth.uid()
    or representative_user_id = auth.uid()
    or (representative_organization_id is not null
        and public.is_org_member(representative_organization_id))
    or public.can_view_property_verification(property_id)
  );
-- Only a party whose ownership is verified for THIS property may delegate.
create policy "verified owner may authorize" on public.representative_authorizations
  for insert to authenticated with check (
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
-- Owner may revoke; representative may accept their own authorization.
create policy "owner or representative may update"
  on public.representative_authorizations for update to authenticated
  using (owner_user_id = auth.uid() or representative_user_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'))
  with check (owner_user_id = auth.uid() or representative_user_id = auth.uid()
              or public.has_role(auth.uid(), 'admin'));

-- --------------------- verification_acknowledgements ------------------
alter table public.verification_acknowledgements enable row level security;
create policy "tenant reads own acknowledgements"
  on public.verification_acknowledgements for select to authenticated
  using (tenant_user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "tenant records own acknowledgement"
  on public.verification_acknowledgements for insert to authenticated
  with check (tenant_user_id = auth.uid());
-- No update/delete policy: acknowledgements are immutable evidence of notice.

-- ------------------------ verification_risk_events --------------------
alter table public.verification_risk_events enable row level security;
create policy "admins read risk events" on public.verification_risk_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
-- Writes happen through service_role / security-definer functions only.

-- --------------------- verification_status_events ---------------------
alter table public.verification_status_events enable row level security;
create policy "history visible to property parties" on public.verification_status_events
  for select to authenticated using (public.can_view_property_verification(property_id));
-- Append-only: no update or delete policy for any role.

-- --------------------------- private storage --------------------------
-- Evidence documents live in a PRIVATE bucket ('verification-evidence').
-- Access is by short-lived signed URL issued server-side after checking
-- can_view_property_verification(); no public bucket, no tenant access.
