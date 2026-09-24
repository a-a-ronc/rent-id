-- Core RLS + trigger guarantees. Runs inside one transaction and rolls back.
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
-- Two landlords, one tenant. Inserting into auth.users fires handle_new_user,
-- which must create the profile and the requested role.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'landlord-a@test.rentid', '{"full_name":"Landlord A","role":"landlord"}'),
  ('00000000-0000-4000-8000-00000000000b', 'landlord-b@test.rentid', '{"full_name":"Landlord B","role":"landlord"}'),
  ('00000000-0000-4000-8000-00000000000c', 'tenant-c@test.rentid',   '{"full_name":"Tenant C","role":"tenant"}'),
  ('00000000-0000-4000-8000-00000000000d', 'stranger-d@test.rentid', '{"full_name":"Stranger D","role":"tenant"}');

do $$ begin
  assert (select count(*) from public.profiles where email like '%@test.rentid') = 4, 'profiles created by trigger';
  assert public.has_role('00000000-0000-4000-8000-00000000000a', 'landlord'), 'landlord role from signup metadata';
  assert public.has_role('00000000-0000-4000-8000-00000000000c', 'tenant'), 'tenant role from signup metadata';
  assert not exists (select 1 from public.user_roles where role = 'admin' and user_id::text like '00000000-0000-4000-8000-%'),
    'signup metadata can never grant admin';
end $$;

-- A user asking for role=admin at signup gets nothing.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000e', 'wannabe-admin@test.rentid', '{"full_name":"X","role":"admin"}');
do $$ begin
  assert not exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-8000-00000000000e'),
    'admin role cannot be self-assigned at signup';
end $$;

-- ------------------------------------------- landlord A creates an org + property
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","email":"landlord-a@test.rentid"}';

select public.create_organization('A Holdings', 'landlord') as org_a \gset
insert into public.properties (id, organization_id, name, street_address, city, state, zip)
  values ('10000000-0000-4000-8000-000000000001', :'org_a', 'Isham House', '817 Isham St', 'Salt Lake City', 'UT', '84101');
insert into public.units (id, property_id, name, monthly_rent)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Main', 1500);

do $$ begin
  assert (select organization_id from public.units where id = '20000000-0000-4000-8000-000000000001')
         = (select organization_id from public.properties where id = '10000000-0000-4000-8000-000000000001'),
    'units.organization_id is filled from the property by trigger';
  assert (select count(*) from public.organization_members where organization_id = (select organization_id from public.properties where id = '10000000-0000-4000-8000-000000000001')) = 1,
    'owner membership created by create_organization';
end $$;

-- A cannot self-verify the organization
do $$ begin
  begin
    update public.organizations set verification_status = 'verified' where name = 'A Holdings';
    raise exception 'ASSERT FAILED: landlord could self-verify organization';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A invites tenant C
insert into public.tenant_invitations (id, organization_id, property_id, unit_id, email, full_name, monthly_rent, token)
  values ('30000000-0000-4000-8000-000000000001', :'org_a', '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001', 'tenant-c@test.rentid', 'Tenant C', 1500, 'test-token-c');

-- A cannot hand-verify a tenancy that has no tenant account
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_name, status, verified)
  values ('50000000-0000-4000-8000-0000000000ff', :'org_a', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Paper Tenant', 'active', true);
do $$ begin
  assert (select verified from public.tenancies where id = '50000000-0000-4000-8000-0000000000ff') = false, 'client insert cannot create a verified tenancy';
  begin
    update public.tenancies set verified = true where id = '50000000-0000-4000-8000-0000000000ff';
    raise exception 'ASSERT FAILED: landlord hand-verified a tenancy';
  exception when insufficient_privilege then null;
  end;
end $$;
delete from public.tenancies where id = '50000000-0000-4000-8000-0000000000ff';

-- ------------------------------------------- landlord B sees nothing of A's
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated","email":"landlord-b@test.rentid"}';
select public.create_organization('B Rentals', 'landlord') as org_b \gset
do $$ begin
  assert (select count(*) from public.properties) = 0, 'landlord B cannot see landlord A properties';
  assert (select count(*) from public.units) = 0, 'landlord B cannot see landlord A units';
  assert (select count(*) from public.tenant_invitations) = 0, 'landlord B cannot see landlord A invitations';
  assert (select count(*) from public.organizations where name = 'A Holdings') = 0, 'landlord B cannot see org A';
end $$;

-- B cannot insert a unit into A's property
do $$ begin
  begin
    insert into public.units (property_id, name) values ('10000000-0000-4000-8000-000000000001', 'Sneaky');
    raise exception 'ASSERT FAILED: landlord B inserted a unit into A''s property';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
end $$;

-- ------------------------------------------- stranger D cannot accept C's invitation
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000d","role":"authenticated","email":"stranger-d@test.rentid"}';
do $$ begin
  assert (public.accept_invitation('test-token-c') ->> 'error') = 'wrong_email',
    'stranger cannot accept an invitation addressed to someone else';
end $$;

-- ------------------------------------------- tenant C accepts
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated","email":"tenant-c@test.rentid"}';
select public.accept_invitation('test-token-c') ->> 'tenancy_id' as tenancy_c \gset
do $$ declare t public.tenancies%rowtype; begin
  select * into t from public.tenancies where tenant_email = 'tenant-c@test.rentid';
  assert t.tenant_user_id = '00000000-0000-4000-8000-00000000000c', 'tenancy bound to accepting user';
  assert t.status = 'active', 'tenancy active after accept';
  assert t.monthly_rent = 1500, 'rent carried from invitation';
  assert (select status from public.tenant_invitations where id = '30000000-0000-4000-8000-000000000001') = 'accepted', 'invitation marked accepted';
  assert (select occupancy_status from public.units where id = '20000000-0000-4000-8000-000000000001') = 'occupied', 'unit occupied';
  assert (select count(*) from public.properties) = 1, 'tenant can see the property they rent';
  assert t.verified and t.verified_at is not null, 'tenancy verified once both sides confirmed';
  assert (select count(*) from public.payments where tenancy_id = t.id and status = 'scheduled') = 1, 'first rent period seeded';
  assert (select count(*) from public.verification_records where tenancy_id = t.id and kind = 'tenancy') = 1, 'tenancy verification record';
end $$;

-- second accept must fail
do $$ begin
  assert (public.accept_invitation('test-token-c') ->> 'error') = 'already_accepted', 'invitation cannot be accepted twice';
end $$;

-- ------------------------------------------- payment verification rules
-- Tenant can record a tenant_reported payment, but never a platform one.
insert into public.payments (organization_id, tenancy_id, amount, status, method, due_date, period_label, verification_source)
  values (:'org_a', :'tenancy_c', 1500, 'paid', 'cash', current_date, 'September 2026', 'tenant_reported');
do $$ begin
  assert (select verified from public.payments where period_label = 'September 2026' and verification_source = 'tenant_reported') = false,
    'tenant_reported payment is NOT verified';
  begin
    insert into public.payments (organization_id, tenancy_id, amount, status, method, due_date, period_label, verification_source)
      values ((select id from public.organizations where name = 'A Holdings'), (select id from public.tenancies where tenant_email = 'tenant-c@test.rentid'), 1500, 'paid', 'ach', current_date, 'October 2026', 'platform_settled');
    raise exception 'ASSERT FAILED: tenant asserted platform_settled';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments (organization_id, tenancy_id, amount, status, method, due_date, period_label, verification_source)
      values ((select id from public.organizations where name = 'A Holdings'), (select id from public.tenancies where tenant_email = 'tenant-c@test.rentid'), 1500, 'paid', 'cash', current_date, 'October 2026', 'landlord_reported');
    raise exception 'ASSERT FAILED: tenant asserted landlord_reported';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Landlord A: landlord_reported is allowed but stays unverified; `verified` column is trigger-owned.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","email":"landlord-a@test.rentid"}';
insert into public.payments (id, organization_id, tenancy_id, amount, status, method, due_date, period_label, verification_source, verified)
  values ('40000000-0000-4000-8000-000000000001', :'org_a', :'tenancy_c', 1500, 'paid', 'check', current_date, 'August 2026', 'landlord_reported', true);
do $$ begin
  assert (select verified from public.payments where id = '40000000-0000-4000-8000-000000000001') = false,
    'landlord cannot set verified=true directly (trigger derives it)';
  assert (select recorded_by from public.payments where id = '40000000-0000-4000-8000-000000000001') = '00000000-0000-4000-8000-00000000000a',
    'recorded_by stamped from auth.uid()';
  begin
    update public.payments set verification_source = 'platform_settled' where id = '40000000-0000-4000-8000-000000000001';
    raise exception 'ASSERT FAILED: landlord upgraded a payment to platform_settled';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Platform (service role / webhook) can settle it, and that flips verified.
reset role;
reset request.jwt.claims;
update public.payments set verification_source = 'platform_settled', method = 'ach'
 where id = '40000000-0000-4000-8000-000000000001';
do $$ begin
  assert (select verified from public.payments where id = '40000000-0000-4000-8000-000000000001') = true,
    'platform_settled ⇒ verified';
  assert (select verified_at from public.payments where id = '40000000-0000-4000-8000-000000000001') is not null,
    'verified_at stamped';
end $$;

-- ------------------------------------------- notifications across parties
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","email":"landlord-a@test.rentid"}';
select public.notify_user('00000000-0000-4000-8000-00000000000c', :'org_a', 'payment', 'Rent received', null) as n1 \gset
do $$ begin
  begin
    perform public.notify_user('00000000-0000-4000-8000-00000000000b', (select id from public.organizations where name = 'A Holdings'), 'system', 'hi', null);
    raise exception 'ASSERT FAILED: landlord A notified an unrelated user';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated","email":"tenant-c@test.rentid"}';
do $$ begin
  assert (select count(*) from public.notifications where title = 'Rent received') = 1, 'tenant sees the notification';
end $$;

rollback;
