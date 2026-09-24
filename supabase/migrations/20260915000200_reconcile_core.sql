-- =====================================================================
-- Forward migration 2/5 — reconcile core tables with src/lib/types.ts
--
-- The live schema (Sept 3-4) and the app's types drifted: the types followed
-- supabase/planned/0001 which was never applied and cannot be (it re-creates
-- tables that exist). This migration is ADDITIVE on top of the live tables —
-- every live column stays, columns the app needs are added, and a few
-- nullable columns become NOT NULL after a backfill. It also adds the
-- server-side rules the product depends on:
--
--   * payments.verification_source — a landlord clicking "mark paid" can never
--     produce a platform-verified payment (trigger enforced)
--   * accept_invitation(token) — atomic invitation → tenancy hand-off
--   * handle_new_user — profile AND requested role created at signup
--   * messages/conversations bookkeeping, review direction sync, notify_user
-- =====================================================================

-- ------------------------------------------------------------------ helpers
-- True when there is no end-user JWT (migrations, cron, psql) or the JWT role
-- is service_role. Used to gate platform-only assertions.
create or replace function public.is_platform_actor()
returns boolean language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'
           is distinct from 'authenticated'
     and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'
           is distinct from 'anon'
$$;
revoke execute on function public.is_platform_actor() from public, anon;
grant execute on function public.is_platform_actor() to authenticated, service_role;

-- ----------------------------------------------------------- organizations
alter table public.organizations
  add column if not exists kind public.org_kind not null default 'landlord',
  add column if not exists verification_status public.verification_status not null default 'unverified',
  add column if not exists deleted_at timestamptz;
create index if not exists organizations_owner_idx on public.organizations(owner_id);

-- Verification status is a platform decision, never a self-declaration.
create or replace function public.organizations_guard_verification()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.verification_status is distinct from old.verification_status
     and not public.is_platform_actor() then
    raise exception 'verification_status can only be changed by the platform' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.verification_status <> 'unverified' and not public.is_platform_actor() then
    new.verification_status := 'unverified';
  end if;
  return new;
end $$;
drop trigger if exists organizations_guard_verification on public.organizations;
create trigger organizations_guard_verification before insert or update on public.organizations
  for each row execute function public.organizations_guard_verification();

-- --------------------------------------------------------------- profiles
-- profiles.onboarding_completed is the live column; the app calls it `onboarded`
-- (mapped in src/lib/db/mappers.ts). Nothing to add.

-- new-user bootstrap: create the profile AND the role the user picked at signup
-- (metadata.role) so signup is atomic and the client never inserts roles.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email, new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;

  if requested in ('landlord', 'tenant', 'property_manager') then
    insert into public.user_roles (user_id, role)
    values (new.id, requested::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------- properties
alter table public.properties
  add column if not exists unit_label text,
  add column if not exists year_built integer,
  add column if not exists management_category public.management_category not null default 'standard_residential',
  add column if not exists normalized_address text,
  add column if not exists county text,
  add column if not exists parcel_number text,
  add column if not exists recording_jurisdiction text,
  add column if not exists legal_description text,
  add column if not exists deleted_at timestamptz;
alter table public.properties drop constraint if exists properties_year_built_check;
alter table public.properties add constraint properties_year_built_check
  check (year_built is null or year_built between 1700 and 2100);
create index if not exists properties_normalized_address_idx
  on public.properties(organization_id, normalized_address);

-- ------------------------------------------------------------------ units
-- Denormalised organization_id so unit queries/RLS don't always need the join;
-- kept in sync from the parent property by trigger.
alter table public.units
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists deleted_at timestamptz;

update public.units u
   set organization_id = p.organization_id
  from public.properties p
 where p.id = u.property_id and u.organization_id is null;

create or replace function public.units_set_organization() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.properties where id = new.property_id;
  if new.organization_id is null then
    raise exception 'unit % references unknown property %', new.id, new.property_id;
  end if;
  return new;
end $$;
drop trigger if exists units_set_organization on public.units;
create trigger units_set_organization before insert or update of property_id on public.units
  for each row execute function public.units_set_organization();

alter table public.units alter column organization_id set not null;
alter table public.units alter column rent_due_day set default 1;
update public.units set rent_due_day = 1 where rent_due_day is null;
alter table public.units alter column rent_due_day set not null;
create index if not exists units_organization_idx on public.units(organization_id);

-- -------------------------------------------------------------- tenancies
alter table public.tenancies
  add column if not exists security_deposit numeric(12,2),
  add column if not exists deleted_at timestamptz;
alter table public.tenancies drop constraint if exists tenancies_security_deposit_check;
alter table public.tenancies add constraint tenancies_security_deposit_check
  check (security_deposit is null or security_deposit >= 0);
update public.tenancies set tenant_name = coalesce(tenant_name, tenant_email, 'Tenant') where tenant_name is null;
alter table public.tenancies alter column tenant_name set not null;

create or replace function public.validate_tenancy_dates() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.end_date is not null and new.start_date is not null and new.end_date < new.start_date then
    raise exception 'end_date must be on or after start_date';
  end if;
  return new;
end $$;
drop trigger if exists tenancies_validate_dates on public.tenancies;
create trigger tenancies_validate_dates before insert or update on public.tenancies
  for each row execute function public.validate_tenancy_dates();

-- ----------------------------------------------------------------- leases
alter table public.leases
  add column if not exists status public.lease_status not null default 'active',
  add column if not exists late_fee numeric(12,2),
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists signed_at timestamptz,
  add column if not exists deleted_at timestamptz;
alter table public.leases drop constraint if exists leases_late_fee_check;
alter table public.leases add constraint leases_late_fee_check check (late_fee is null or late_fee >= 0);

update public.leases
   set start_date  = coalesce(start_date, created_at::date),
       end_date    = coalesce(end_date, (created_at + interval '12 months')::date),
       monthly_rent = coalesce(monthly_rent, 0),
       rent_due_day = coalesce(rent_due_day, 1);
alter table public.leases
  alter column start_date set not null,
  alter column end_date set not null,
  alter column monthly_rent set not null,
  alter column rent_due_day set not null,
  alter column rent_due_day set default 1;
create index if not exists leases_end_date_idx on public.leases(end_date);
create index if not exists leases_organization_idx on public.leases(organization_id);

-- -------------------------------------------------------------- documents
alter table public.documents add column if not exists deleted_at timestamptz;

-- --------------------------------------------------------------- payments
alter table public.payments
  add column if not exists period_label text,
  add column if not exists memo text,
  add column if not exists verification_source public.payment_verification_source not null default 'unverified',
  add column if not exists verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists payout_id uuid;
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method is null or method in ('manual', 'ach', 'same_day_ach', 'rtp', 'fednow', 'card', 'cash', 'check'));
alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments add constraint payments_amount_check check (amount >= 0);
create index if not exists payments_verification_idx on public.payments(tenancy_id, verified);

-- THE rule the product rests on: `verified` is derived from verification_source,
-- and only the platform can assert a settled / bank-linked / imported source.
-- Landlords may record landlord_reported, tenants tenant_reported, both unverified.
create or replace function public.payments_enforce_verification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  tenancy_org uuid;
begin
  -- a payment always belongs to its tenancy's organization, whatever the client sent
  select organization_id into tenancy_org from public.tenancies where id = new.tenancy_id;
  if tenancy_org is null then
    raise exception 'payment references unknown tenancy %', new.tenancy_id;
  end if;
  new.organization_id := tenancy_org;

  if not public.is_platform_actor() then
    if new.verification_source in ('platform_settled', 'bank_linked', 'imported') then
      raise exception 'verification_source % can only be asserted by the platform', new.verification_source
        using errcode = '42501';
    end if;
    if new.verification_source = 'landlord_reported' and not public.is_org_member(new.organization_id) then
      raise exception 'only the housing provider can record a landlord-reported payment' using errcode = '42501';
    end if;
    if new.verification_source = 'tenant_reported'
       and not exists (select 1 from public.tenancies t where t.id = new.tenancy_id and t.tenant_user_id = actor) then
      raise exception 'only the tenant on this tenancy can record a tenant-reported payment' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.recorded_by := actor;
    end if;
  end if;

  new.verified := new.verification_source in ('platform_settled', 'bank_linked');
  if new.verified then
    new.verified_at := coalesce(new.verified_at, now());
  else
    new.verified_at := null;
  end if;
  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end $$;
drop trigger if exists payments_enforce_verification on public.payments;
create trigger payments_enforce_verification before insert or update on public.payments
  for each row execute function public.payments_enforce_verification();

-- Tenants may record their own (unverified / tenant_reported) payments.
drop policy if exists payments_insert_tenant on public.payments;
create policy payments_insert_tenant on public.payments for insert to authenticated
  with check (
    exists (select 1 from public.tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid())
    and verification_source in ('unverified', 'tenant_reported')
  );

-- ------------------------------------------------------ payment_schedules
alter table public.payment_schedules
  add column if not exists cadence public.payment_cadence not null default 'monthly',
  add column if not exists starts_on date not null default current_date,
  add column if not exists ends_on date;
alter table public.payment_schedules drop constraint if exists payment_schedules_due_day_check;
alter table public.payment_schedules add constraint payment_schedules_due_day_check
  check (due_day between 1 and 31);

-- ----------------------------------------------------- maintenance_requests
-- resolved_at is the live column; the app's `completed_at` maps onto it.
create index if not exists maintenance_tenancy_idx on public.maintenance_requests(tenancy_id);
create index if not exists maintenance_property_idx on public.maintenance_requests(property_id);

-- --------------------------------------------------- conversations/messages
alter table public.conversations
  add column if not exists last_message_at timestamptz not null default now();
update public.conversations set subject = 'Conversation' where subject is null;
alter table public.conversations
  alter column subject set default 'Conversation',
  alter column subject set not null;

alter table public.messages
  add column if not exists sender_name text not null default '',
  add column if not exists sender_role public.app_role;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = greatest(last_message_at, new.created_at)
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- Parties may mark messages read (live schema granted UPDATE but had no policy).
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (public.can_access_conversation(conversation_id))
  with check (public.can_access_conversation(conversation_id));

-- ---------------------------------------------------------------- reviews
alter table public.reviews
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists direction public.review_direction,
  add column if not exists author_name text not null default '',
  add column if not exists status public.review_status not null default 'published';

update public.reviews r
   set organization_id = t.organization_id
  from public.tenancies t
 where t.id = r.tenancy_id and r.organization_id is null;
update public.reviews
   set direction = case subject_type when 'tenant' then 'landlord_to_tenant'::public.review_direction
                                     else 'tenant_to_landlord'::public.review_direction end
 where direction is null;

-- Keep the live (subject_type/published) and app (direction/status) shapes in sync.
create or replace function public.reviews_sync_shape() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from public.tenancies where id = new.tenancy_id;
  end if;
  if new.direction is null then
    new.direction := case new.subject_type when 'tenant' then 'landlord_to_tenant' else 'tenant_to_landlord' end;
  end if;
  new.subject_type := case new.direction when 'landlord_to_tenant' then 'tenant' else 'landlord' end;
  new.published := (new.status = 'published');
  return new;
end $$;
drop trigger if exists reviews_sync_shape on public.reviews;
create trigger reviews_sync_shape before insert or update on public.reviews
  for each row execute function public.reviews_sync_shape();

alter table public.reviews alter column organization_id set not null;
alter table public.reviews alter column direction set not null;
create index if not exists reviews_organization_idx on public.reviews(organization_id);

alter table public.review_disputes add column if not exists resolved_at timestamptz;
alter table public.review_disputes drop constraint if exists review_disputes_status_check;
alter table public.review_disputes add constraint review_disputes_status_check
  check (status in ('open', 'resolved', 'rejected'));
drop policy if exists review_disputes_select on public.review_disputes;
create policy review_disputes_select on public.review_disputes for select to authenticated
  using (
    raised_by = auth.uid()
    or public.has_role(auth.uid(), 'admin')
    or exists (select 1 from public.reviews r
                where r.id = review_id and (r.author_id = auth.uid() or r.subject_user_id = auth.uid()))
  );
drop trigger if exists review_disputes_touch on public.review_disputes;
create trigger review_disputes_touch before update on public.review_disputes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------- verification_records
alter table public.verification_records
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists payment_id uuid references public.payments(id) on delete cascade,
  add column if not exists kind public.verification_kind not null default 'tenancy',
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists source public.verification_source not null default 'platform',
  add column if not exists notes text;
alter table public.verification_records alter column tenancy_id drop not null;
alter table public.verification_records alter column record_type set default 'verification';
alter table public.verification_records alter column label set default '';

update public.verification_records v
   set organization_id = t.organization_id
  from public.tenancies t
 where t.id = v.tenancy_id and v.organization_id is null;

create or replace function public.verification_records_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.tenancy_id is not null then
    select organization_id into new.organization_id from public.tenancies where id = new.tenancy_id;
  end if;
  if new.organization_id is null and new.payment_id is not null then
    select organization_id into new.organization_id from public.payments where id = new.payment_id;
  end if;
  if new.verified_by is null then new.verified_by := auth.uid(); end if;
  -- an end user can only ever attest as landlord or tenant, never as the platform
  if not public.is_platform_actor() and new.source = 'platform' then
    new.source := case when public.is_org_member(new.organization_id) then 'landlord' else 'tenant' end;
  end if;
  return new;
end $$;
drop trigger if exists verification_records_fill on public.verification_records;
create trigger verification_records_fill before insert on public.verification_records
  for each row execute function public.verification_records_fill();

drop policy if exists verification_records_select on public.verification_records;
create policy verification_records_select on public.verification_records for select to authenticated
  using (
    (tenancy_id is not null and public.is_tenancy_party(tenancy_id))
    or subject_user_id = auth.uid()
    or (organization_id is not null and public.is_org_member(organization_id))
  );
drop policy if exists verification_records_insert on public.verification_records;
create policy verification_records_insert on public.verification_records for insert to authenticated
  with check (
    (tenancy_id is not null and public.is_tenancy_party(tenancy_id))
    or (organization_id is not null and public.is_org_member(organization_id))
  );
create index if not exists verification_records_org_idx on public.verification_records(organization_id);

-- ---------------------------------------------------------- notifications
alter table public.notifications
  add column if not exists kind public.notification_kind not null default 'system';

-- Landlords/PMs notify their tenants and vice-versa. The live insert policy only
-- allows self-notifications, so cross-user notifications go through this
-- function, which checks the two parties share an organization/tenancy.
create or replace function public.notify_user(
  _user_id uuid, _organization_id uuid, _kind public.notification_kind, _title text, _body text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  allowed boolean;
  nid uuid;
begin
  if _user_id is null then return null; end if;
  if public.is_platform_actor() then
    allowed := true;
  else
    allowed :=
      _user_id = actor
      or (_organization_id is not null and public.is_org_member(_organization_id)
          and (exists (select 1 from public.tenancies t
                        where t.organization_id = _organization_id and t.tenant_user_id = _user_id)
               or exists (select 1 from public.organization_members m
                           where m.organization_id = _organization_id and m.user_id = _user_id)
               or exists (select 1 from public.organizations o
                           where o.id = _organization_id and o.owner_id = _user_id)))
      or (_organization_id is not null
          and exists (select 1 from public.tenancies t
                       where t.organization_id = _organization_id and t.tenant_user_id = actor)
          and (exists (select 1 from public.organization_members m
                        where m.organization_id = _organization_id and m.user_id = _user_id)
               or exists (select 1 from public.organizations o
                           where o.id = _organization_id and o.owner_id = _user_id)));
  end if;
  if not allowed then
    raise exception 'not allowed to notify this user' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, organization_id, kind, title, body)
  values (_user_id, _organization_id, _kind, _title, _body)
  returning id into nid;
  return nid;
end $$;
revoke execute on function public.notify_user(uuid, uuid, public.notification_kind, text, text) from public, anon;
grant execute on function public.notify_user(uuid, uuid, public.notification_kind, text, text) to authenticated, service_role;

-- ------------------------------------------------------------- audit_logs
alter table public.audit_logs add column if not exists actor_role public.app_role;

-- ------------------------------------------------------ tenant_invitations
-- Invitation → tenancy hand-off is a single atomic, server-side step: the
-- tenant never needs UPDATE rights on someone else's tenancy row.
create or replace function public.accept_invitation(_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv public.tenant_invitations%rowtype;
  uid uuid := auth.uid();
  uemail text := lower(coalesce(auth.jwt() ->> 'email', ''));
  uname text;
  t_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into inv from public.tenant_invitations where token = _token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if inv.status <> 'pending' then
    raise exception 'invitation is %', inv.status using errcode = '22023';
  end if;
  if inv.expires_at < now() then
    update public.tenant_invitations set status = 'expired' where id = inv.id;
    raise exception 'invitation has expired' using errcode = '22023';
  end if;
  if inv.email is not null and lower(inv.email) <> uemail then
    raise exception 'this invitation was sent to a different email address' using errcode = '42501';
  end if;

  select full_name into uname from public.profiles where id = uid;

  if inv.tenancy_id is not null then
    update public.tenancies
       set tenant_user_id = uid,
           status = case when status = 'pending' then 'active' else status end,
           tenant_email = coalesce(tenant_email, uemail)
     where id = inv.tenancy_id
     returning id into t_id;
  else
    insert into public.tenancies (organization_id, property_id, unit_id, tenant_user_id, tenant_name,
                                  tenant_email, tenant_phone, status, monthly_rent, start_date, end_date)
    values (inv.organization_id, inv.property_id, inv.unit_id, uid,
            coalesce(inv.full_name, uname, uemail), coalesce(inv.email, uemail), inv.phone,
            'active', inv.monthly_rent, inv.lease_start, inv.lease_end)
    returning id into t_id;
  end if;

  update public.tenant_invitations
     set status = 'accepted', accepted_by = uid, accepted_at = now(), tenancy_id = t_id
   where id = inv.id;

  insert into public.user_roles (user_id, role) values (uid, 'tenant') on conflict (user_id, role) do nothing;

  if inv.unit_id is not null then
    update public.units set occupancy_status = 'occupied' where id = inv.unit_id;
  end if;

  insert into public.audit_logs (actor_id, actor_role, organization_id, action, entity_type, entity_id, metadata)
  values (uid, 'tenant', inv.organization_id, 'invitation.accepted', 'tenancy', t_id,
          jsonb_build_object('invitation_id', inv.id));

  return t_id;
end $$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- Limited, safe preview of an invitation for the person holding the link.
create or replace function public.invitation_preview(_token text)
returns table (
  id uuid, status public.invitation_status, email text, full_name text, expires_at timestamptz,
  monthly_rent numeric, lease_start date, lease_end date,
  organization_name text, property_name text, street_address text, city text, state text, unit_name text
)
language sql security definer stable set search_path = public as $$
  select i.id, i.status, i.email, i.full_name, i.expires_at, i.monthly_rent, i.lease_start, i.lease_end,
         o.name, p.name, p.street_address, p.city, p.state, u.name
    from public.tenant_invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.properties p on p.id = i.property_id
    left join public.units u on u.id = i.unit_id
   where i.token = _token
$$;
revoke execute on function public.invitation_preview(text) from public, anon;
grant execute on function public.invitation_preview(text) to authenticated;

-- ------------------------------------------------- organization bootstrap
-- Creating an organization and its owner membership atomically.
create or replace function public.create_organization(
  _name text, _kind public.org_kind default 'landlord', _legal_entity_name text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  oid uuid;
  member_role public.app_role;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if length(btrim(coalesce(_name, ''))) = 0 then raise exception 'name is required' using errcode = '22023'; end if;

  member_role := case _kind when 'property_manager' then 'property_manager' else 'landlord' end;

  insert into public.organizations (name, legal_entity_name, owner_id, kind)
  values (btrim(_name), nullif(btrim(coalesce(_legal_entity_name, '')), ''), uid, _kind)
  returning id into oid;

  insert into public.organization_members (organization_id, user_id, role)
  values (oid, uid, member_role)
  on conflict (organization_id, user_id) do nothing;

  insert into public.user_roles (user_id, role) values (uid, member_role) on conflict (user_id, role) do nothing;

  insert into public.audit_logs (actor_id, actor_role, organization_id, action, entity_type, entity_id)
  values (uid, member_role, oid, 'organization.created', 'organization', oid);

  return oid;
end $$;
revoke execute on function public.create_organization(text, public.org_kind, text) from public, anon;
grant execute on function public.create_organization(text, public.org_kind, text) to authenticated;
