-- =====================================================================
-- Marketplace / syndication / management supplements discovered while
-- porting src/lib/services/{marketplace,syndication,management}.ts from the
-- in-memory mock to real queries. Additive and idempotent.
--
--   1. rental_applications.passport_snapshot — the applicant's rental history
--      frozen at apply time (RLS stops a landlord from reading an applicant's
--      history at OTHER landlords, so the consented package travels with the
--      application). Computed server-side, never taken from the client, and
--      immutable afterwards for everyone but the platform.
--   2. record_listing_sync() — the only client path that writes a
--      listing_sync_events row (the table is platform-write only) and moves
--      the matching listing_channels row.
--   3. provider_public_stats() — aggregate-only operating numbers for the
--      public provider record (/providers/$orgId, listing pages), callable by
--      anonymous visitors like provider_public_profile().
--   4. Read policies so a manager with owner-confirmed authority can see the
--      tenancies, payments and work orders of the properties it operates
--      (writes stay with the owning organization, as in 0300).
-- =====================================================================

-- ------------------------------------------------ 1. passport snapshot
alter table public.rental_applications
  add column if not exists passport_snapshot jsonb;
comment on column public.rental_applications.passport_snapshot is
  'TenantPassport (src/lib/types.ts) of the applicant at apply time when profile_shared; computed by rental_applications_passport_guard(), frozen afterwards.';

-- The applicant's verified rental history as the app computes it in
-- buildTenantPassport(): verified payments = payments.verified, on time =
-- paid on or before the due date, late = status late/failed or paid after the
-- due date. Landlord-to-tenant reviews on those tenancies ride along.
-- SECURITY DEFINER over every landlord's rows → NOT callable by clients; only
-- the trigger below (and the platform) invoke it.
create or replace function public.tenant_passport_snapshot(_user_id uuid, _email text)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (
    select * from public.tenancies
     where deleted_at is null
       and ((_user_id is not null and tenant_user_id = _user_id)
            or (nullif(btrim(coalesce(_email, '')), '') is not null and lower(tenant_email) = lower(btrim(_email))))
  ),
  p as (
    select pay.*,
           (pay.status = 'paid' and pay.verified) as settled,
           (pay.status = 'paid' and pay.verified
              and (pay.paid_at is null or pay.paid_at::date <= coalesce(pay.due_date, pay.created_at::date))) as on_time,
           (pay.status in ('late', 'failed')
              or (pay.status = 'paid' and pay.paid_at is not null
                  and pay.paid_at::date > coalesce(pay.due_date, pay.created_at::date))) as late
      from public.payments pay
     where pay.tenancy_id in (select id from t)
  ),
  r as (
    select rv.* from public.reviews rv
     where rv.tenancy_id in (select id from t) and rv.direction = 'landlord_to_tenant'
  )
  select case when not exists (select 1 from t) then null else jsonb_build_object(
    'tenant_name',        (select tenant_name from t order by created_at desc limit 1),
    'verified_payments',  (select count(*) from p where settled),
    'on_time_payments',   (select count(*) from p where on_time),
    'on_time_pct',        coalesce((select round(100.0 * count(*) filter (where on_time)
                                                / nullif(count(*) filter (where settled or late), 0))::integer from p), 0),
    'late_payments',      (select count(*) from p where late),
    'verified_tenancies', (select count(*) from t where verified),
    'months_of_history',  (select coalesce(sum(greatest(0, round(extract(epoch from (
                              case when end_date is not null and end_date < current_date
                                   then end_date::timestamp else localtimestamp end
                              - start_date::timestamp)) / 2628000))), 0)::integer
                             from t where start_date is not null),
    'average_rent',       (select avg(monthly_rent) filter (where monthly_rent > 0) from t),
    'open_disputes',      (select count(*) from public.review_disputes d
                            where d.status = 'open' and d.review_id in (select id from r)),
    'reviews',            coalesce((select jsonb_agg(jsonb_build_object(
                              'id', r.id, 'organization_id', r.organization_id, 'tenancy_id', r.tenancy_id,
                              'direction', r.direction, 'author_id', r.author_id, 'author_name', r.author_name,
                              'rating', r.rating, 'body', coalesce(r.body, ''), 'status', r.status,
                              'created_at', r.created_at, 'updated_at', r.updated_at)
                              order by r.created_at desc) from r), '[]'::jsonb)
  ) end;
$$;
revoke execute on function public.tenant_passport_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.tenant_passport_snapshot(uuid, text) to service_role;

-- On INSERT by an applicant the snapshot is computed here from the applicant's
-- own account (never trusted from the client — a forged history would defeat
-- the point). Without consent (profile_shared = false) it is null. Afterwards
-- nobody but the platform can change it; withdrawing consent drops it.
create or replace function public.rental_applications_passport_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_platform_actor() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.profile_shared then
      new.passport_snapshot := public.tenant_passport_snapshot(auth.uid(), auth.jwt() ->> 'email');
    else
      new.passport_snapshot := null;
    end if;
  else
    if new.passport_snapshot is distinct from old.passport_snapshot then
      raise exception 'the shared rental history is frozen at apply time' using errcode = '42501';
    end if;
    if not new.profile_shared then
      new.passport_snapshot := null;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.rental_applications_passport_guard() from public, anon, authenticated;
drop trigger if exists rental_applications_passport_guard on public.rental_applications;
create trigger rental_applications_passport_guard before insert or update on public.rental_applications
  for each row execute function public.rental_applications_passport_guard();

-- ------------------------------------------------ 2. record_listing_sync
-- listing_sync_events is platform-write only. The syndication service records
-- every adapter outcome through this RPC, which also moves the channel row the
-- way src/lib/services/syndication.ts did in memory:
--   succeeded            → live      (remove → removed), last_synced_at stamped
--   pending_integration  → pending_integration (remove → removal_queued)
--   queued               → queued
--   failed               → error, last_error = message
-- Callable by the listing's operators (owning org or confirmed manager).
-- Nothing external is posted anywhere: a 'succeeded' result for any
-- marketplace other than RentID's own can only be asserted by the platform.
create or replace function public.record_listing_sync(
  _listing_id uuid,
  _marketplace_id text,
  _action text,
  _result text,
  _message text default '',
  _external_listing_id text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  event_id uuid;
  next_status text;
begin
  if not (public.is_platform_actor() or public.can_operate_listing(_listing_id)) then
    raise exception 'only the listing operator can record a sync' using errcode = '42501';
  end if;
  if _marketplace_id <> 'rentid' and _result = 'succeeded' and not public.is_platform_actor() then
    raise exception 'a successful external sync is recorded by the platform feed, not the client'
      using errcode = '42501';
  end if;

  insert into public.listing_sync_events (listing_id, marketplace_id, action, result, message)
  values (_listing_id, _marketplace_id, _action, _result, coalesce(_message, ''))
  returning id into event_id;

  next_status := case _result
    when 'succeeded'           then case when _action = 'remove' then 'removed' else 'live' end
    when 'pending_integration' then case when _action = 'remove' then 'removal_queued' else 'pending_integration' end
    when 'queued'              then 'queued'
    else 'error' end;

  insert into public.listing_channels as c
    (listing_id, organization_id, marketplace_id, listing_status, external_listing_id, last_error, last_synced_at)
  select l.id, l.organization_id, _marketplace_id, next_status, _external_listing_id,
         case when _result = 'failed' then coalesce(_message, '') end,
         case when _result = 'succeeded' then now() end
    from public.listings l where l.id = _listing_id
  on conflict (listing_id, marketplace_id) do update
    set listing_status      = excluded.listing_status,
        external_listing_id = coalesce(excluded.external_listing_id, c.external_listing_id),
        last_error          = excluded.last_error,
        last_synced_at      = coalesce(excluded.last_synced_at, c.last_synced_at);

  return event_id;
end $$;
revoke execute on function public.record_listing_sync(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.record_listing_sync(uuid, text, text, text, text, text) to authenticated, service_role;

-- ------------------------------------------------ 3. provider_public_stats
-- Aggregate operating record of housing providers, for the public profile and
-- listing pages (the mock computed these client-side; RLS hides the source
-- rows from visitors). Counts, medians and percentages only — no row data.
--   verified_units   units on properties carrying a live verified badge for
--                    the organization (same definition as verified_properties)
--   owners_served    owner accounts of a property manager; 1 for a landlord
--   response / resolution / collection numbers span every property the
--   organization owns or manages with owner-confirmed authority
create or replace function public.provider_public_stats(_org_ids uuid[])
returns table (
  organization_id uuid,
  verified_units integer,
  owners_served integer,
  median_first_response_hours numeric,
  resolved_under_72h_pct integer,
  collection_rate_pct integer,
  tenant_rating numeric,
  owner_rating numeric,
  open_disputes integer
)
language sql stable security definer set search_path = public as $$
  with org as (
    select o.id, o.kind from public.organizations o
     where o.id = any (_org_ids) and o.deleted_at is null
  ),
  operated as (
    select org.id as org_id, p.id as property_id
      from org join public.properties p on p.organization_id = org.id and p.deleted_at is null
    union
    select org.id, a.property_id
      from org
      join public.management_assignments a
        on a.organization_id = org.id and a.authority_status = 'verified' and a.revoked_at is null
      join public.properties p on p.id = a.property_id and p.deleted_at is null
  ),
  badged as (
    select distinct r.organization_id as org_id, r.property_id
      from public.property_party_relationships r
     where r.organization_id = any (_org_ids) and r.revoked_at is null
       and r.status in ('ownership_verified', 'authorized_representative_verified')
  ),
  maint as (
    select op.org_id, m.created_at, m.updated_at, m.resolved_at,
           coalesce(m.first_response_at, case when m.status <> 'open' then m.updated_at end) as responded_at
      from operated op join public.maintenance_requests m on m.property_id = op.property_id
  ),
  due as (
    select op.org_id, pay.status
      from operated op
      join public.tenancies t on t.property_id = op.property_id and t.deleted_at is null
      join public.payments pay on pay.tenancy_id = t.id
     where date_trunc('month', coalesce(pay.due_date, pay.created_at::date)::timestamp)
         = date_trunc('month', current_date::timestamp)
  ),
  rev as (
    select r.organization_id as org_id, r.id, r.direction, r.rating
      from public.reviews r
     where r.organization_id = any (_org_ids) and r.status = 'published'
  )
  select org.id,
         (select count(*)::integer from badged b
            join public.units u on u.property_id = b.property_id and u.deleted_at is null
           where b.org_id = org.id),
         case when org.kind = 'property_manager'
              then (select count(*)::integer from public.owner_accounts oa where oa.organization_id = org.id)
              else 1 end,
         coalesce((select round((percentile_cont(0.5) within group
                     (order by extract(epoch from (m.responded_at - m.created_at)) / 3600.0))::numeric, 1)
                     from maint m where m.org_id = org.id and m.responded_at is not null), 0),
         coalesce((select round(100.0 * count(*) filter (where m.resolved_at - m.created_at <= interval '72 hours')
                                / nullif(count(*), 0))::integer
                     from maint m where m.org_id = org.id and m.resolved_at is not null), 0),
         coalesce((select round(100.0 * count(*) filter (where d.status = 'paid') / nullif(count(*), 0))::integer
                     from due d where d.org_id = org.id), 0),
         (select round(avg(rating)::numeric, 1) from rev where rev.org_id = org.id and rev.direction = 'tenant_to_landlord'),
         (select round(avg(rating)::numeric, 1) from rev where rev.org_id = org.id and rev.direction = 'landlord_to_tenant'),
         (select count(*)::integer from public.review_disputes d
           where d.status = 'open' and d.review_id in (select id from rev where rev.org_id = org.id))
    from org;
$$;
revoke execute on function public.provider_public_stats(uuid[]) from public;
grant execute on function public.provider_public_stats(uuid[]) to anon, authenticated, service_role;

-- ------------------------------------------------ 4. managed-portfolio reads
-- A manager with owner-confirmed authority reads the operating history of the
-- properties it manages. Payments carry no property_id, so the check goes
-- through the tenancy (SECURITY DEFINER so the policy does not recurse into
-- tenancies RLS).
create or replace function public.manages_tenancy(_tenancy_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenancies t
    where t.id = _tenancy_id and public.has_management_authority(t.property_id)
  );
$$;
revoke execute on function public.manages_tenancy(uuid) from public, anon;
grant execute on function public.manages_tenancy(uuid) to authenticated, service_role;

-- Tenancies on a managed property (names, dates, rent) — read only.
drop policy if exists tenancies_select_managed on public.tenancies;
create policy tenancies_select_managed on public.tenancies for select to authenticated
  using (public.has_management_authority(property_id));

-- Rent ledger of a managed property — read only; recording stays with the owner.
drop policy if exists payments_select_managed on public.payments;
create policy payments_select_managed on public.payments for select to authenticated
  using (public.manages_tenancy(tenancy_id));

-- Work orders on a managed property (or on one of its tenancies) — read only.
drop policy if exists maintenance_select_managed on public.maintenance_requests;
create policy maintenance_select_managed on public.maintenance_requests for select to authenticated
  using (
    (property_id is not null and public.has_management_authority(property_id))
    or (tenancy_id is not null and public.manages_tenancy(tenancy_id))
  );
