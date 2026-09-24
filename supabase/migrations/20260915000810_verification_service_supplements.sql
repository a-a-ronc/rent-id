-- =====================================================================
-- Forward migration — supplements for the Supabase-backed verification
-- service (src/lib/services/verification.ts).
--
-- 20260915000400 deliberately leaves the browser client no way to write a
-- case status, a confidence level, a badge, a risk signal or a history row:
-- those belong to decide_verification_case() and the platform. Porting the
-- service off the mock left four gaps where the client still has something
-- legitimate to do. Each is closed here with the narrowest object that
-- does the job, and NOTHING below widens who may issue a badge.
--
-- Additive and idempotent: create-or-replace functions, drop-if-exists +
-- create for the one policy. No existing object is dropped or weakened.
-- =====================================================================

-- ------------------------------------------------- 1. review queue: property
-- A RentID reviewer decides a case about a property they have no ownership,
-- membership or tenancy relationship with, so `properties_select`
-- (20260903190926) and `properties_select_managed` (20260915000300) both
-- exclude them — the admin queue in
-- src/routes/_authenticated/admin.verification.tsx rendered "Unknown property"
-- with no address. Read-only, admins only, and only for a property that
-- actually has a verification case: an admin still cannot browse the whole
-- property table. Writes stay with the owning organization.
create or replace function public.can_review_property(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin')
     and exists (select 1 from public.verification_cases c where c.property_id = _property_id);
$$;
revoke execute on function public.can_review_property(uuid) from public, anon;
grant execute on function public.can_review_property(uuid) to authenticated, service_role;

drop policy if exists properties_select_admin_review on public.properties;
create policy properties_select_admin_review on public.properties for select to authenticated
  using (public.can_review_property(id));

-- --------------------------------------------- 2. park a case with a human
-- runAutomatedChecks() has no configured provider (src/lib/verification/
-- providers.ts is all `not_configured`), so it can never corroborate a claim
-- and must leave it with a reviewer — which is what the mock did by setting
-- status = 'manual_review'. A client cannot write a status, and the only
-- existing client path into manual_review is submitting evidence, which this
-- pass has none of.
--
-- Safety: this is a one-way street TOWARDS a human. It accepts only cases in
-- 'pending' or 'collecting_evidence', only ever writes 'manual_review' (never
-- a verified, suspended, revoked or fraud state), only for a case the caller
-- can already see, and always leaves a history row behind. It can neither
-- issue nor restore a badge.
create or replace function public.queue_verification_case_for_review(_case_id uuid, _reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.verification_cases%rowtype;
  reason text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not (public.is_platform_actor() or public.can_view_verification_case(_case_id)) then
    raise exception 'not a party to this verification case' using errcode = '42501';
  end if;
  select * into c from public.verification_cases where id = _case_id for update;
  if not found then
    raise exception 'verification case not found' using errcode = 'P0002';
  end if;
  -- already with a human (or already decided): nothing to do, no history noise
  if c.status not in ('pending', 'collecting_evidence') then
    return c.id;
  end if;

  perform set_config('rentid.verification_decision', 'on', true);
  update public.verification_cases set status = 'manual_review', updated_at = now() where id = c.id;
  perform set_config('rentid.verification_decision', '', true);

  insert into public.verification_status_events
    (property_id, case_id, actor_id, action, from_status, to_status, reason)
  values
    (c.property_id, c.id, auth.uid(), 'verification.automated_checks', c.status, 'manual_review', reason);
  return c.id;
end $$;
revoke execute on function public.queue_verification_case_for_review(uuid, text) from public, anon;
grant execute on function public.queue_verification_case_for_review(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------- 3. risk signals
-- verification_risk_events has no insert grant for `authenticated` on purpose
-- (0400: risk signals are written by the platform, read by admins). The
-- service still detects two signals client-side that the mock detected —
-- rapid multi-property claims, and the same document re-submitted on another
-- of the caller's own cases — and they are worth nothing if they cannot be
-- filed.
--
-- Safety: the caller may only file a signal about a case or property it is
-- already a party to; `user_id` is forced to the caller (nobody can pin a
-- signal on someone else); `kind` and `severity` are checked against the
-- domain unions in src/lib/verification-types.ts; the row is marked as
-- client-reported so a reviewer never mistakes it for a platform finding;
-- and the call is rate limited. Risk events remain admin-read-only: the
-- filer cannot read the table back.
create or replace function public.record_verification_risk_event(
  _property_id uuid,
  _case_id uuid,
  _kind text,
  _severity text,
  _detail text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  platform boolean := public.is_platform_actor();
  actor uuid := auth.uid();
  detail text := btrim(coalesce(_detail, ''));
  row_out public.verification_risk_events%rowtype;
begin
  if not platform then
    if actor is null then
      raise exception 'sign in to report a verification risk signal' using errcode = '42501';
    end if;
    perform public.check_rate_limit('verification_risk_event', 20, interval '1 hour');
    if _case_id is not null and not public.can_view_verification_case(_case_id) then
      raise exception 'not a party to this verification case' using errcode = '42501';
    end if;
    if _property_id is not null and not public.can_view_property_verification(_property_id) then
      raise exception 'not a party to this property' using errcode = '42501';
    end if;
  end if;
  if _kind not in ('rapid_multi_property_claims', 'reused_document', 'repeated_failed_claims',
                   'entity_mismatch', 'suspicious_authorization_pattern', 'payee_change_before_payment',
                   'deed_inconsistent_with_record', 'many_unrelated_owners', 'identity_reuse') then
    raise exception 'unknown risk signal "%"', _kind using errcode = '22023';
  end if;
  if coalesce(_severity, 'low') not in ('low', 'medium', 'high') then
    raise exception 'unknown severity "%"', _severity using errcode = '22023';
  end if;
  if detail = '' then
    raise exception 'a risk signal needs a detail line' using errcode = '22023';
  end if;

  insert into public.verification_risk_events (property_id, case_id, user_id, kind, severity, detail, metadata)
  values (_property_id, _case_id, actor, _kind,
          coalesce(_severity, 'low')::public.verification_risk_severity, left(detail, 500),
          jsonb_build_object('reported_by', case when platform then 'platform' else 'client' end))
  returning * into row_out;
  -- returned to the filer only (they just wrote it); the table itself stays admin-read-only
  return to_jsonb(row_out);
end $$;
revoke execute on function public.record_verification_risk_event(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.record_verification_risk_event(uuid, uuid, text, text, text)
  to authenticated, service_role;

-- --------------------------------------------------- 4. re-verification
-- requireReverification() (ownership transfer, payee change) has to suspend
-- live badges and set verification_cases.reverification_required — a column
-- the 0400 guard lets nobody but the platform / a decision write, not even an
-- admin. decide_verification_case('suspend') moves one case but never sets
-- the flag, so the service needs this. Admin or platform only, reason
-- required, history + audit row left behind, exactly like a decision.
create or replace function public.require_property_reverification(_property_id uuid, _reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  reason text := btrim(coalesce(_reason, ''));
  affected integer := 0;
  org uuid;
begin
  if not (public.is_platform_actor() or public.has_role(actor, 'admin')) then
    raise exception 'only RentID review staff can require re-verification' using errcode = '42501';
  end if;
  if reason = '' then
    raise exception 'a reason is required to require re-verification' using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties p where p.id = _property_id) then
    raise exception 'property not found' using errcode = 'P0002';
  end if;

  perform set_config('rentid.verification_decision', 'on', true);
  -- a live badge is suspended; every case on the property is flagged for a new look
  update public.verification_cases c
     set status = case when c.status in ('ownership_verified', 'authorized_representative_verified')
                       then 'suspended'::public.verification_case_status else c.status end,
         reverification_required = true,
         updated_at = now()
   where c.property_id = _property_id;
  get diagnostics affected = row_count;
  update public.property_party_relationships r
     set status = 'suspended', updated_at = now()
   where r.property_id = _property_id
     and r.revoked_at is null
     and r.status in ('ownership_verified', 'authorized_representative_verified');
  perform set_config('rentid.verification_decision', '', true);

  select p.organization_id into org from public.properties p where p.id = _property_id;
  insert into public.verification_status_events (property_id, case_id, actor_id, action, to_status, reason)
  values (_property_id, null, actor, 'verification.reverification_required', 'suspended', reason);
  insert into public.audit_logs (actor_id, actor_role, organization_id, action, entity_type, entity_id, metadata)
  values (actor, 'admin', org, 'property_verification.reverification_required', 'property', _property_id,
          jsonb_build_object('reason', reason, 'cases', affected));
  return affected;
end $$;
revoke execute on function public.require_property_reverification(uuid, text) from public, anon;
grant execute on function public.require_property_reverification(uuid, text) to authenticated, service_role;
