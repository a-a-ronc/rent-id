-- =====================================================================
-- Forward migration 3/5 — marketplace + property-management layer
--
-- Adds the tables behind business-map §7-§9 (owners, management authority,
-- listings, applications, syndication channels, leads) on top of the live
-- schema. Column names follow src/lib/types.ts; where supabase/planned/0001
-- and the types disagree, the types win (marketplace_id, photos,
-- profile_shared, references_text …). Enums come from 0100 — nothing here
-- adds a value to an existing enum, so the file applies in one transaction.
--
-- Access model (deny-by-default, all policies use the live helpers):
--   * published listings are public (anon + authenticated); everything else
--     stays inside the organization that owns the listing or holds
--     owner-confirmed management authority over the property
--   * a manager may REQUEST authority; only the property's owning
--     organization (or the platform) can confirm / dispute / revoke it
--   * applicants apply as themselves, read their own application and may
--     withdraw it; the housing provider decides
--   * listing_sync_events are written by the platform only
-- =====================================================================

-- --------------------------------------------------------- owner_accounts
-- The owners a property-management company works for. Ownership is recorded
-- separately from management authority so an owner can change managers
-- without losing property, lease or payment history.
create table if not exists public.owner_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contract_start date,
  management_fee_pct numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_accounts_fee_check check (management_fee_pct is null or management_fee_pct between 0 and 100)
);
create index if not exists owner_accounts_organization_idx on public.owner_accounts(organization_id);
grant select, insert, update, delete on public.owner_accounts to authenticated;
grant all on public.owner_accounts to service_role;
alter table public.owner_accounts enable row level security;
drop trigger if exists owner_accounts_touch on public.owner_accounts;
create trigger owner_accounts_touch before update on public.owner_accounts
  for each row execute function public.touch_updated_at();

drop policy if exists owner_accounts_select on public.owner_accounts;
create policy owner_accounts_select on public.owner_accounts for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists owner_accounts_insert on public.owner_accounts;
create policy owner_accounts_insert on public.owner_accounts for insert to authenticated
  with check (public.is_org_member(organization_id));
drop policy if exists owner_accounts_update on public.owner_accounts;
create policy owner_accounts_update on public.owner_accounts for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists owner_accounts_delete on public.owner_accounts;
create policy owner_accounts_delete on public.owner_accounts for delete to authenticated
  using (public.is_org_member(organization_id));

-- --------------------------------------------------- management_assignments
-- Owner-granted authority for a PM organization to operate a property.
-- Starts 'pending'; listings and badges stay locked until the owner confirms.
create table if not exists public.management_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  authority_status public.verification_status not null default 'pending',
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, property_id)
);
create index if not exists management_assignments_org_idx on public.management_assignments(organization_id);
create index if not exists management_assignments_property_idx on public.management_assignments(property_id);
create index if not exists management_assignments_owner_idx on public.management_assignments(owner_account_id);
grant select, insert, update, delete on public.management_assignments to authenticated;
grant all on public.management_assignments to service_role;
alter table public.management_assignments enable row level security;
drop trigger if exists management_assignments_touch on public.management_assignments;
create trigger management_assignments_touch before update on public.management_assignments
  for each row execute function public.touch_updated_at();

-- True when the caller belongs to a PM organization whose authority over the
-- property has been confirmed by the owner and not revoked.
create or replace function public.has_management_authority(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.management_assignments a
    where a.property_id = _property_id
      and a.authority_status = 'verified'
      and a.revoked_at is null
      and public.is_org_member(a.organization_id)
  );
$$;
revoke execute on function public.has_management_authority(uuid) from public, anon;
grant execute on function public.has_management_authority(uuid) to authenticated, service_role;

-- Operator side of a property: its owning organization or a confirmed manager.
create or replace function public.can_operate_property(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties p
    where p.id = _property_id
      and (public.is_org_member(p.organization_id) or public.has_management_authority(p.id))
  );
$$;
revoke execute on function public.can_operate_property(uuid) from public, anon;
grant execute on function public.can_operate_property(uuid) to authenticated, service_role;

-- Authority is confirmed by the property's owning organization (or the
-- platform), never by the manager itself. Managers may request, re-point
-- (which resets to pending) or resign (revoked_at); everything else is the
-- owner's call. Mirrors organizations_guard_verification in 0200.
create or replace function public.management_assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  owner_side boolean;
begin
  if not exists (select 1 from public.owner_accounts oa
                  where oa.id = new.owner_account_id and oa.organization_id = new.organization_id) then
    raise exception 'owner_account % does not belong to organization %', new.owner_account_id, new.organization_id
      using errcode = '23503';
  end if;

  owner_side := public.is_platform_actor() or public.can_manage_property(new.property_id);

  if tg_op = 'INSERT' then
    if not owner_side then
      new.authority_status := 'pending';
      new.authorized_at := null;
      new.revoked_at := null;
    end if;
  elsif not owner_side then
    if new.authority_status is distinct from old.authority_status
       or new.authorized_at is distinct from old.authorized_at then
      raise exception 'management authority is confirmed by the property owner, not the manager'
        using errcode = '42501';
    end if;
    if new.property_id <> old.property_id or new.organization_id <> old.organization_id then
      -- re-pointing an assignment never carries confirmed authority with it
      new.authority_status := 'pending';
      new.authorized_at := null;
    end if;
  end if;

  -- keep authority_status / authorized_at / revoked_at coherent
  if new.authority_status = 'verified' and (tg_op = 'INSERT' or old.authority_status <> 'verified') then
    new.authorized_at := coalesce(new.authorized_at, now());
    new.revoked_at := null;
  end if;
  if new.revoked_at is not null and new.authority_status <> 'revoked' then
    new.authority_status := 'revoked';
  end if;
  if new.authority_status = 'revoked' and new.revoked_at is null then
    new.revoked_at := now();
  end if;
  if new.authority_status in ('unverified', 'pending', 'disputed', 'rejected') then
    new.authorized_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.management_assignments_guard() from public, anon, authenticated;
drop trigger if exists management_assignments_guard on public.management_assignments;
create trigger management_assignments_guard before insert or update on public.management_assignments
  for each row execute function public.management_assignments_guard();

drop policy if exists management_assignments_select on public.management_assignments;
create policy management_assignments_select on public.management_assignments for select to authenticated
  using (public.is_org_member(organization_id) or public.can_manage_property(property_id));
drop policy if exists management_assignments_insert on public.management_assignments;
create policy management_assignments_insert on public.management_assignments for insert to authenticated
  with check (public.is_org_member(organization_id) or public.can_manage_property(property_id));
drop policy if exists management_assignments_update on public.management_assignments;
create policy management_assignments_update on public.management_assignments for update to authenticated
  using (public.is_org_member(organization_id) or public.can_manage_property(property_id))
  with check (public.is_org_member(organization_id) or public.can_manage_property(property_id));
drop policy if exists management_assignments_delete on public.management_assignments;
create policy management_assignments_delete on public.management_assignments for delete to authenticated
  using (public.is_org_member(organization_id));

-- A confirmed manager can read the property and units it operates. Writes to
-- those rows stay with the owning organization (existing policies).
drop policy if exists properties_select_managed on public.properties;
create policy properties_select_managed on public.properties for select to authenticated
  using (public.has_management_authority(id));
drop policy if exists units_select_managed on public.units;
create policy units_select_managed on public.units for select to authenticated
  using (public.has_management_authority(property_id));

-- ---------------------------------------------------------------- listings
-- The RentID listing is the master record; every marketplace copy is a
-- listing_channels row kept in sync with it.
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  public_ref text unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  status public.listing_status not null default 'draft',
  headline text not null,
  description text,
  monthly_rent numeric(12,2) not null,
  security_deposit numeric(12,2),
  available_on date not null default current_date,
  lease_term_months integer not null default 12,
  amenities text[] not null default '{}',
  screening_criteria text,
  syndicated_to text[] not null default '{}',
  published_at timestamptz,
  -- listing detail (Listing Syndication)
  property_type public.property_type,
  street_address text,
  city text,
  state text,
  zip text,
  bedrooms numeric(4,1),
  bathrooms numeric(4,1),
  square_feet integer,
  photos text[] not null default '{}',
  utilities_included text[] not null default '{}',
  pet_policy text,
  parking text,
  application_requirements text[] not null default '{}',
  income_requirement text,
  credit_requirement text,
  occupancy_limit integer,
  application_fee numeric(10,2),
  move_in_fees text,
  contact_name text,
  contact_email text,
  contact_phone text,
  showing_instructions text,
  assigned_to uuid references auth.users(id) on delete set null,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint listings_monthly_rent_check check (monthly_rent >= 0),
  constraint listings_security_deposit_check check (security_deposit is null or security_deposit >= 0),
  constraint listings_lease_term_check check (lease_term_months > 0),
  constraint listings_application_fee_check check (application_fee is null or application_fee >= 0),
  constraint listings_view_count_check check (view_count >= 0)
);
create index if not exists listings_organization_idx on public.listings(organization_id);
create index if not exists listings_property_idx on public.listings(property_id);
create index if not exists listings_unit_idx on public.listings(unit_id);
create index if not exists listings_published_idx on public.listings(status, published_at desc) where deleted_at is null;
grant select on public.listings to anon;
grant select, insert, update, delete on public.listings to authenticated;
grant all on public.listings to service_role;
alter table public.listings enable row level security;
drop trigger if exists listings_touch on public.listings;
create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();

-- Integrity + bookkeeping for a listing row:
--   * the unit must belong to the property
--   * the listing organization is the property's owner or a confirmed manager
--   * public_ref (rentid.online/listing/<ref>) is generated once and never changes
--   * published_at is stamped on first publish
--   * a view-count bump or a no-op update is not an edit (updated_at stays put)
-- Runs after listings_touch (triggers fire in name order).
create or replace function public.listings_write_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prop_org uuid;
  unit_prop uuid;
  candidate text;
begin
  select organization_id into prop_org from public.properties where id = new.property_id;
  if prop_org is null then
    raise exception 'listing references unknown property %', new.property_id using errcode = '23503';
  end if;
  select property_id into unit_prop from public.units where id = new.unit_id;
  if unit_prop is null or unit_prop <> new.property_id then
    raise exception 'unit % does not belong to property %', new.unit_id, new.property_id using errcode = '23503';
  end if;
  if new.organization_id <> prop_org and not exists (
       select 1 from public.management_assignments a
        where a.property_id = new.property_id and a.organization_id = new.organization_id
          and a.authority_status = 'verified' and a.revoked_at is null) then
    raise exception 'organization % has no confirmed authority to list property %', new.organization_id, new.property_id
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.public_ref is distinct from old.public_ref
     and old.public_ref is not null and not public.is_platform_actor() then
    new.public_ref := old.public_ref;
  end if;
  if new.public_ref is null or btrim(new.public_ref) = '' then
    loop
      candidate := substr(encode(gen_random_bytes(6), 'hex'), 1, 8);
      exit when not exists (select 1 from public.listings l where l.public_ref = candidate);
    end loop;
    new.public_ref := candidate;
  end if;

  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  -- a view bump (or a no-op update) is not an edit
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'view_count' - 'updated_at') = (to_jsonb(old) - 'view_count' - 'updated_at') then
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
revoke execute on function public.listings_write_guard() from public, anon, authenticated;
drop trigger if exists listings_write_guard on public.listings;
create trigger listings_write_guard before insert or update on public.listings
  for each row execute function public.listings_write_guard();

-- Who may work a listing: the organization it belongs to, the property's
-- owning organization, or a manager with confirmed authority.
create or replace function public.can_operate_listing(_listing_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.listings l
    where l.id = _listing_id
      and (public.is_org_member(l.organization_id) or public.can_operate_property(l.property_id))
  );
$$;
revoke execute on function public.can_operate_listing(uuid) from public, anon;
grant execute on function public.can_operate_listing(uuid) to authenticated, service_role;

drop policy if exists listings_select_public on public.listings;
create policy listings_select_public on public.listings for select to anon, authenticated
  using (status = 'published' and deleted_at is null);
drop policy if exists listings_select_operator on public.listings;
create policy listings_select_operator on public.listings for select to authenticated
  using (public.is_org_member(organization_id) or public.can_operate_property(property_id));
drop policy if exists listings_insert_operator on public.listings;
create policy listings_insert_operator on public.listings for insert to authenticated
  with check (public.can_operate_property(property_id));
drop policy if exists listings_update_operator on public.listings;
create policy listings_update_operator on public.listings for update to authenticated
  using (public.is_org_member(organization_id) or public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));
drop policy if exists listings_delete_operator on public.listings;
create policy listings_delete_operator on public.listings for delete to authenticated
  using (public.is_org_member(organization_id) or public.can_operate_property(property_id));

-- ------------------------------------------------------ rental_applications
create table if not exists public.rental_applications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  applicant_user_id uuid references auth.users(id) on delete set null,
  applicant_name text not null,
  applicant_email text not null,
  applicant_phone text,
  monthly_income numeric(12,2),
  move_in_date date,
  note text,
  status public.application_status not null default 'new',
  profile_shared boolean not null default false,
  -- syndication attribution + resume autofill
  source text not null default 'rentid',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  prefilled_from_resume boolean not null default false,
  employer text,
  current_address text,
  references_text text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_applications_income_check check (monthly_income is null or monthly_income >= 0),
  constraint rental_applications_source_check
    check (source in ('rentid', 'zillow', 'apartments_com', 'direct_link', 'qr_code', 'facebook', 'other'))
);
create index if not exists rental_applications_listing_idx on public.rental_applications(listing_id, created_at desc);
create index if not exists rental_applications_applicant_idx on public.rental_applications(applicant_user_id);
create index if not exists rental_applications_org_status_idx on public.rental_applications(organization_id, status);
grant select, insert, update on public.rental_applications to authenticated;
grant all on public.rental_applications to service_role;
alter table public.rental_applications enable row level security;
drop trigger if exists rental_applications_touch on public.rental_applications;
create trigger rental_applications_touch before update on public.rental_applications
  for each row execute function public.touch_updated_at();

-- organization_id always follows the listing; decided_at is trigger-owned;
-- an applicant may edit their own details and withdraw, nothing more.
create or replace function public.rental_applications_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  listing_org uuid;
  operator boolean;
begin
  select organization_id into listing_org from public.listings where id = new.listing_id;
  if listing_org is null then
    raise exception 'application references unknown listing %', new.listing_id using errcode = '23503';
  end if;
  new.organization_id := listing_org;

  if not public.is_platform_actor() then
    operator := public.can_operate_listing(new.listing_id);
    if tg_op = 'INSERT' then
      if not operator and new.status not in ('new', 'started', 'submitted') then
        raise exception 'an application is submitted, not decided, by the applicant' using errcode = '42501';
      end if;
    elsif not operator then
      if new.status is distinct from old.status and new.status <> 'withdrawn' then
        raise exception 'only the housing provider can change an application status' using errcode = '42501';
      end if;
      if new.status is distinct from old.status and old.status = 'lease_signed' then
        raise exception 'a signed application can no longer be withdrawn' using errcode = '42501';
      end if;
      if new.listing_id <> old.listing_id or new.applicant_user_id is distinct from old.applicant_user_id then
        raise exception 'an application cannot be moved to another listing or applicant' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status in ('approved', 'denied', 'withdrawn') then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.decided_at := now();
    end if;
  else
    new.decided_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.rental_applications_guard() from public, anon, authenticated;
drop trigger if exists rental_applications_guard on public.rental_applications;
create trigger rental_applications_guard before insert or update on public.rental_applications
  for each row execute function public.rental_applications_guard();

drop policy if exists applications_select on public.rental_applications;
create policy applications_select on public.rental_applications for select to authenticated
  using (applicant_user_id = auth.uid() or public.can_operate_listing(listing_id));
-- Applicants apply as themselves to a published listing. Anonymous applications
-- go through a server function (service role) that creates the user first.
drop policy if exists applications_insert_applicant on public.rental_applications;
create policy applications_insert_applicant on public.rental_applications for insert to authenticated
  with check (
    applicant_user_id = auth.uid()
    and status in ('new', 'started', 'submitted')
    and exists (select 1 from public.listings l
                 where l.id = listing_id and l.status = 'published' and l.deleted_at is null)
  );
drop policy if exists applications_update_operator on public.rental_applications;
create policy applications_update_operator on public.rental_applications for update to authenticated
  using (public.can_operate_listing(listing_id)) with check (public.can_operate_listing(listing_id));
drop policy if exists applications_update_applicant on public.rental_applications;
create policy applications_update_applicant on public.rental_applications for update to authenticated
  using (applicant_user_id = auth.uid()) with check (applicant_user_id = auth.uid());

-- --------------------------------------------------------- listing_channels
-- One row per marketplace describing the distribution state of a listing.
-- 'integration_pending' means RentID has no authorized feed for that
-- marketplace yet: nothing is ever posted there from this row.
create table if not exists public.listing_channels (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  marketplace_id text not null,
  enabled boolean not null default false,
  connection_status text not null default 'integration_pending',
  listing_status text not null default 'not_published',
  external_listing_id text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, marketplace_id),
  constraint listing_channels_marketplace_check
    check (marketplace_id in ('rentid', 'zillow', 'apartments_com', 'other')),
  constraint listing_channels_connection_check
    check (connection_status in ('connected', 'integration_pending', 'error')),
  constraint listing_channels_status_check
    check (listing_status in ('not_published', 'queued', 'pending_integration', 'live',
                              'pending_sync', 'removal_queued', 'removed', 'error'))
);
create index if not exists listing_channels_listing_idx on public.listing_channels(listing_id);
create index if not exists listing_channels_organization_idx on public.listing_channels(organization_id);
grant select on public.listing_channels to anon;
grant select, insert, update, delete on public.listing_channels to authenticated;
grant all on public.listing_channels to service_role;
alter table public.listing_channels enable row level security;
drop trigger if exists listing_channels_touch on public.listing_channels;
create trigger listing_channels_touch before update on public.listing_channels
  for each row execute function public.touch_updated_at();

-- Rows that hang off a listing always carry the listing's organization.
create or replace function public.listing_child_set_organization() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.listings where id = new.listing_id;
  if new.organization_id is null then
    raise exception '% references unknown listing %', tg_table_name, new.listing_id using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function public.listing_child_set_organization() from public, anon, authenticated;
drop trigger if exists listing_channels_set_organization on public.listing_channels;
create trigger listing_channels_set_organization before insert or update of listing_id on public.listing_channels
  for each row execute function public.listing_child_set_organization();

drop policy if exists listing_channels_select_public on public.listing_channels;
create policy listing_channels_select_public on public.listing_channels for select to anon, authenticated
  using (exists (select 1 from public.listings l
                  where l.id = listing_id and l.status = 'published' and l.deleted_at is null));
drop policy if exists listing_channels_select_operator on public.listing_channels;
create policy listing_channels_select_operator on public.listing_channels for select to authenticated
  using (public.can_operate_listing(listing_id));
drop policy if exists listing_channels_insert_operator on public.listing_channels;
create policy listing_channels_insert_operator on public.listing_channels for insert to authenticated
  with check (public.can_operate_listing(listing_id));
drop policy if exists listing_channels_update_operator on public.listing_channels;
create policy listing_channels_update_operator on public.listing_channels for update to authenticated
  using (public.can_operate_listing(listing_id)) with check (public.can_operate_listing(listing_id));
drop policy if exists listing_channels_delete_operator on public.listing_channels;
create policy listing_channels_delete_operator on public.listing_channels for delete to authenticated
  using (public.can_operate_listing(listing_id));

-- ------------------------------------------------------ listing_sync_events
-- Operator audit trail of every sync attempt. Written by the platform only.
create table if not exists public.listing_sync_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  marketplace_id text not null,
  action text not null,
  result text not null,
  message text not null default '',
  created_at timestamptz not null default now(),
  constraint listing_sync_events_action_check check (action in ('create', 'update', 'remove', 'resync')),
  constraint listing_sync_events_result_check check (result in ('queued', 'succeeded', 'pending_integration', 'failed'))
);
create index if not exists listing_sync_events_listing_idx on public.listing_sync_events(listing_id, created_at desc);
grant select on public.listing_sync_events to authenticated;
grant all on public.listing_sync_events to service_role;
alter table public.listing_sync_events enable row level security;
drop policy if exists listing_sync_events_select_operator on public.listing_sync_events;
create policy listing_sync_events_select_operator on public.listing_sync_events for select to authenticated
  using (public.can_operate_listing(listing_id));

-- ------------------------------------------------------------ listing_leads
-- Lead capture with attribution. Any signed-in user may leave a lead on a
-- published listing; only the operating side reads them.
create table if not exists public.listing_leads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  email text,
  phone text,
  message text,
  source text not null default 'rentid',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  application_id uuid references public.rental_applications(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint listing_leads_source_check
    check (source in ('rentid', 'zillow', 'apartments_com', 'direct_link', 'qr_code', 'facebook', 'other'))
);
create index if not exists listing_leads_listing_idx on public.listing_leads(listing_id, created_at desc);
create index if not exists listing_leads_organization_idx on public.listing_leads(organization_id, created_at desc);
grant select, insert, update on public.listing_leads to authenticated;
grant all on public.listing_leads to service_role;
alter table public.listing_leads enable row level security;

create or replace function public.listing_leads_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.listings where id = new.listing_id;
  if new.organization_id is null then
    raise exception 'lead references unknown listing %', new.listing_id using errcode = '23503';
  end if;
  if new.application_id is not null and not exists (
       select 1 from public.rental_applications a where a.id = new.application_id and a.listing_id = new.listing_id) then
    raise exception 'application % does not belong to listing %', new.application_id, new.listing_id using errcode = '23503';
  end if;
  return new;
end $$;
revoke execute on function public.listing_leads_guard() from public, anon, authenticated;
drop trigger if exists listing_leads_guard on public.listing_leads;
create trigger listing_leads_guard before insert or update on public.listing_leads
  for each row execute function public.listing_leads_guard();

drop policy if exists listing_leads_select_operator on public.listing_leads;
create policy listing_leads_select_operator on public.listing_leads for select to authenticated
  using (public.can_operate_listing(listing_id));
drop policy if exists listing_leads_insert on public.listing_leads;
create policy listing_leads_insert on public.listing_leads for insert to authenticated
  with check (
    exists (select 1 from public.listings l
             where l.id = listing_id and l.status = 'published' and l.deleted_at is null)
    or public.can_operate_listing(listing_id)
  );
drop policy if exists listing_leads_update_operator on public.listing_leads;
create policy listing_leads_update_operator on public.listing_leads for update to authenticated
  using (public.can_operate_listing(listing_id)) with check (public.can_operate_listing(listing_id));

-- ------------------------------------------------------------- public RPCs
-- Public listing-page view counter. Only published listings count.
create or replace function public.increment_listing_view(_listing_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.listings
     set view_count = view_count + 1
   where id = _listing_id and status = 'published' and deleted_at is null;
$$;
revoke execute on function public.increment_listing_view(uuid) from public;
grant execute on function public.increment_listing_view(uuid) to anon, authenticated, service_role;

-- Public snapshot of a housing provider for listing pages and badges.
-- verified_properties is filled in by 0400 (property verification tables).
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
         0::integer as verified_properties,
         (select count(*)::integer from public.listings l
           where l.organization_id = o.id and l.status = 'published' and l.deleted_at is null) as published_listings
    from public.organizations o
   where o.id = _org_id and o.deleted_at is null;
$$;
revoke execute on function public.provider_public_profile(uuid) from public;
grant execute on function public.provider_public_profile(uuid) to anon, authenticated, service_role;

-- Everything the public listing page needs in one call, by public_ref (or raw
-- id for older links). Only published listings resolve; the leasing agent's
-- user id is stripped and the property/unit are reduced to public fields.
create or replace function public.public_listing(_ref text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'listing',  to_jsonb(l) - 'assigned_to',
    'provider', (select to_jsonb(pp) from public.provider_public_profile(l.organization_id) pp),
    'property', jsonb_build_object(
                  'id', p.id, 'name', p.name, 'property_type', p.property_type,
                  'street_address', p.street_address, 'unit_label', p.unit_label,
                  'city', p.city, 'state', p.state, 'zip', p.zip, 'year_built', p.year_built),
    'unit',     jsonb_build_object(
                  'id', u.id, 'name', u.name, 'bedrooms', u.bedrooms,
                  'bathrooms', u.bathrooms, 'square_feet', u.square_feet),
    'channels', coalesce((select jsonb_agg(to_jsonb(c) order by c.marketplace_id)
                            from public.listing_channels c where c.listing_id = l.id), '[]'::jsonb)
  )
  from public.listings l
  join public.properties p on p.id = l.property_id
  join public.units u on u.id = l.unit_id
  where l.status = 'published' and l.deleted_at is null
    and (l.public_ref = _ref or l.id::text = _ref)
  limit 1;
$$;
revoke execute on function public.public_listing(text) from public;
grant execute on function public.public_listing(text) to anon, authenticated, service_role;
