-- Marketplace + management-authority guarantees (20260915000300). One
-- transaction, rolled back at the end. Fixtures use literal ids because psql
-- :'vars' do not interpolate inside $$ blocks.
--
--   users  L 00000000-0000-4000-8000-000000000101  landlord, owns org L
--          B 00000000-0000-4000-8000-000000000102  landlord, owns org B (unrelated)
--          P 00000000-0000-4000-8000-000000000103  property manager, owns org P
--          T 00000000-0000-4000-8000-000000000104  applicant
--          U 00000000-0000-4000-8000-000000000105  applicant
--   orgs   L 60000000-0000-4000-8000-000000000101
--          B 60000000-0000-4000-8000-000000000102
--          P 60000000-0000-4000-8000-000000000103
--   L's property 10000000-0000-4000-8000-000000000101, units ...0101 / ...0102
--   B's property 10000000-0000-4000-8000-000000000102, unit  ...0103
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000101', 'landlord-l@test.rentid',  '{"full_name":"Landlord L","role":"landlord"}'),
  ('00000000-0000-4000-8000-000000000102', 'landlord-b@test.rentid',  '{"full_name":"Landlord B","role":"landlord"}'),
  ('00000000-0000-4000-8000-000000000103', 'manager-p@test.rentid',   '{"full_name":"Manager P","role":"property_manager"}'),
  ('00000000-0000-4000-8000-000000000104', 'applicant-t@test.rentid', '{"full_name":"Applicant T","role":"tenant"}'),
  ('00000000-0000-4000-8000-000000000105', 'applicant-u@test.rentid', '{"full_name":"Applicant U","role":"tenant"}');

insert into public.organizations (id, name, owner_id, kind) values
  ('60000000-0000-4000-8000-000000000101', 'L Holdings',   '00000000-0000-4000-8000-000000000101', 'landlord'),
  ('60000000-0000-4000-8000-000000000102', 'B Rentals',    '00000000-0000-4000-8000-000000000102', 'landlord'),
  ('60000000-0000-4000-8000-000000000103', 'P Management', '00000000-0000-4000-8000-000000000103', 'property_manager');
insert into public.organization_members (organization_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'landlord'),
  ('60000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000102', 'landlord'),
  ('60000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000103', 'property_manager');

insert into public.properties (id, organization_id, name, street_address, city, state, zip) values
  ('10000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000101', 'Alger House', '12 Alger Ave', 'Salt Lake City', 'UT', '84105'),
  ('10000000-0000-4000-8000-000000000102', '60000000-0000-4000-8000-000000000102', 'B Duplex',    '9 Bee St',      'Provo',          'UT', '84601');
insert into public.units (id, property_id, name, monthly_rent, bedrooms, bathrooms) values
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'Unit 1', 1450, 2, 1),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101', 'Unit 2', 1200, 1, 1),
  ('20000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000102', 'Left',   1100, 2, 1),
  -- unit 4 exists so the manager's draft does not collide with the owner's
  -- listing on unit 2 (listings_one_live_per_unit)
  ('20000000-0000-4000-8000-000000000104', '10000000-0000-4000-8000-000000000101', 'Unit 4', 1250, 1, 1);

-- ------------------------------------------ 1. PM org member CRUD on owner_accounts
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';

insert into public.owner_accounts (id, organization_id, name, contact_email, management_fee_pct)
  values ('50000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000103', 'Alger Owner LLC', 'owner@test.rentid', 8.5);
insert into public.owner_accounts (id, organization_id, name)
  values ('50000000-0000-4000-8000-000000000102', '60000000-0000-4000-8000-000000000103', 'Temporary Owner');
update public.owner_accounts set contact_name = 'Owner Contact' where id = '50000000-0000-4000-8000-000000000101';
delete from public.owner_accounts where id = '50000000-0000-4000-8000-000000000102';
do $$ begin
  assert (select count(*) from public.owner_accounts) = 1, 'PM sees exactly its own owner accounts after create/update/delete';
  assert (select contact_name from public.owner_accounts where id = '50000000-0000-4000-8000-000000000101') = 'Owner Contact',
    'PM can update its own owner account';
  begin
    insert into public.owner_accounts (organization_id, name) values ('60000000-0000-4000-8000-000000000101', 'Not my org');
    raise exception 'ASSERT FAILED: PM inserted an owner account into another organization';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Landlord B sees nothing of P's and cannot write into P's org
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.owner_accounts) = 0, 'other organizations cannot see PM owner accounts';
  begin
    insert into public.owner_accounts (organization_id, name) values ('60000000-0000-4000-8000-000000000103', 'Sneaky');
    raise exception 'ASSERT FAILED: landlord B inserted an owner account into P''s organization';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------- 2. management authority: PM requests, owner confirms
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
-- P asks for authority over L's property, trying to self-verify on the way in.
insert into public.management_assignments (id, organization_id, owner_account_id, property_id, authority_status, authorized_at)
  values ('70000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000103',
          '50000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'verified', now());
do $$ declare a public.management_assignments%rowtype; begin
  select * into a from public.management_assignments where id = '70000000-0000-4000-8000-000000000101';
  assert a.authority_status = 'pending', 'a PM-created assignment always starts pending';
  assert a.authorized_at is null, 'authorized_at is cleared on a PM-created assignment';
  assert not public.has_management_authority('10000000-0000-4000-8000-000000000101'), 'pending assignment grants no authority';
  assert (select count(*) from public.properties) = 0, 'PM cannot see the property before the owner confirms';
  begin
    update public.management_assignments set authority_status = 'verified' where id = '70000000-0000-4000-8000-000000000101';
    raise exception 'ASSERT FAILED: PM self-verified its management authority';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.management_assignments set authorized_at = now() where id = '70000000-0000-4000-8000-000000000101';
    raise exception 'ASSERT FAILED: PM stamped authorized_at itself';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Unrelated landlord B: cannot see or touch the assignment.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
update public.management_assignments set authority_status = 'verified' where id = '70000000-0000-4000-8000-000000000101';
do $$ begin
  assert (select count(*) from public.management_assignments) = 0, 'unrelated org cannot see the assignment';
end $$;

-- Owner L confirms.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
do $$ begin
  assert (select count(*) from public.management_assignments) = 1, 'property owner sees the pending request';
  assert (select authority_status from public.management_assignments where id = '70000000-0000-4000-8000-000000000101') = 'pending',
    'B''s update did not touch the assignment';
end $$;
update public.management_assignments set authority_status = 'verified' where id = '70000000-0000-4000-8000-000000000101';
do $$ declare a public.management_assignments%rowtype; begin
  select * into a from public.management_assignments where id = '70000000-0000-4000-8000-000000000101';
  assert a.authority_status = 'verified', 'owner confirmed the authority';
  assert a.authorized_at is not null, 'authorized_at stamped on confirmation';
end $$;

-- P now operates the property (read access to property + units).
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
do $$ begin
  assert public.has_management_authority('10000000-0000-4000-8000-000000000101'), 'confirmed assignment grants authority';
  assert (select count(*) from public.properties) = 1, 'PM reads the managed property';
  assert (select count(*) from public.units) = 3, 'PM reads the managed property''s units';
end $$;

-- ------------------------------------------------------------- 3. listings
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
-- Listing A: published straight away, updated_at backdated so we can see whether a view bump edits it.
insert into public.listings (id, organization_id, property_id, unit_id, status, headline, monthly_rent, available_on, bedrooms, bathrooms, updated_at)
  values ('80000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101',
          '20000000-0000-4000-8000-000000000101', 'published', 'Sunny 2BR near Liberty Park', 1450, current_date + 14, 2, 1,
          now() - interval '1 day');
-- Listing C: a draft.
insert into public.listings (id, organization_id, property_id, unit_id, headline, monthly_rent)
  values ('80000000-0000-4000-8000-000000000103', '60000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101',
          '20000000-0000-4000-8000-000000000102', 'Cozy 1BR (draft)', 1200);
do $$ declare a public.listings%rowtype; c public.listings%rowtype; begin
  select * into a from public.listings where id = '80000000-0000-4000-8000-000000000101';
  select * into c from public.listings where id = '80000000-0000-4000-8000-000000000103';
  assert a.public_ref ~ '^[0-9a-f]{8}$', 'public_ref generated as 8 lowercase hex chars';
  assert a.published_at is not null, 'published_at stamped when inserted as published';
  assert c.status = 'draft' and c.published_at is null and c.public_ref ~ '^[0-9a-f]{8}$', 'draft has a ref but no published_at';
  assert a.public_ref <> c.public_ref, 'refs are unique';
  begin
    insert into public.listings (organization_id, property_id, unit_id, headline, monthly_rent)
      values ('60000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000103', 'Wrong unit', 1);
    raise exception 'ASSERT FAILED: listing accepted a unit from a different property';
  exception when foreign_key_violation then null;
  end;
end $$;
-- public_ref is permanent
update public.listings set public_ref = 'hacked01' where id = '80000000-0000-4000-8000-000000000101';
do $$ begin
  assert (select public_ref from public.listings where id = '80000000-0000-4000-8000-000000000101') <> 'hacked01', 'public_ref cannot be changed by the client';
end $$;

-- Landlord B: sees the published listing only, cannot touch it, cannot list L's property.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
update public.listings set headline = 'Hacked' where id = '80000000-0000-4000-8000-000000000101';
do $$ begin
  assert (select count(*) from public.listings) = 1, 'other org sees only the published listing';
  assert (select count(*) from public.listings where id = '80000000-0000-4000-8000-000000000103') = 0, 'other org cannot read a draft';
  assert public.public_listing('80000000-0000-4000-8000-000000000103') is null, 'public_listing() does not resolve a draft';
  assert public.public_listing('80000000-0000-4000-8000-000000000101') -> 'provider' ->> 'name' = 'L Holdings', 'public_listing() carries the provider snapshot';
  assert public.public_listing('80000000-0000-4000-8000-000000000101') -> 'listing' ->> 'headline' = 'Sunny 2BR near Liberty Park', 'public_listing() carries the listing';
  assert (public.public_listing('80000000-0000-4000-8000-000000000101') -> 'listing') ? 'assigned_to' = false, 'public payload strips the leasing agent id';
  assert (select headline from public.listings where id = '80000000-0000-4000-8000-000000000101') = 'Sunny 2BR near Liberty Park', 'other org cannot edit the listing';
  begin
    insert into public.listings (organization_id, property_id, unit_id, headline, monthly_rent)
      values ('60000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000102', 'Not mine', 999);
    raise exception 'ASSERT FAILED: landlord B listed L''s property';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anonymous visitor: table read + public_listing() + view counter, by ref.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  perform public.increment_listing_view('80000000-0000-4000-8000-000000000101');
  perform public.increment_listing_view('80000000-0000-4000-8000-000000000103');
end $$;
do $$ begin
  assert (select count(*) from public.listings) = 1, 'anon sees published listings only';
  assert (select view_count from public.listings where id = '80000000-0000-4000-8000-000000000101') = 1, 'anon view counted on a published listing';
  assert (select updated_at from public.listings where id = '80000000-0000-4000-8000-000000000101') < now() - interval '23 hours',
    'a view bump does not touch updated_at';
  assert (public.public_listing('80000000-0000-4000-8000-000000000101') -> 'unit' ->> 'name') = 'Unit 1', 'public_listing() includes the unit summary';
  assert (public.public_listing((select public_ref from public.listings where id = '80000000-0000-4000-8000-000000000101')) -> 'listing' ->> 'id')
         = '80000000-0000-4000-8000-000000000101', 'public_listing() resolves by public_ref';
  begin
    insert into public.listings (organization_id, property_id, unit_id, headline, monthly_rent)
      values ('60000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000102', 'anon', 1);
    raise exception 'ASSERT FAILED: anon inserted a listing';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Manager P (confirmed authority): reads drafts, lists under its own org, not under a stranger's.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
insert into public.listings (id, organization_id, property_id, unit_id, headline, monthly_rent)
  values ('80000000-0000-4000-8000-000000000102', '60000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101',
          '20000000-0000-4000-8000-000000000104', 'Managed 1BR (draft)', 1250);
do $$ begin
  assert (select count(*) from public.listings) = 3, 'confirmed manager sees the owner''s drafts and its own';
  assert (select view_count from public.listings where id = '80000000-0000-4000-8000-000000000103') = 0, 'anon view on a draft is not counted';
  begin
    insert into public.listings (organization_id, property_id, unit_id, headline, monthly_rent)
      values ('60000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000102', 'Wrong org', 1);
    raise exception 'ASSERT FAILED: listing created under an organization with no authority';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------------------------------------- 4. applications
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"applicant-t@test.rentid"}';
insert into public.rental_applications (id, listing_id, organization_id, applicant_user_id, applicant_name, applicant_email, status, profile_shared, source, references_text)
  values ('90000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000102',
          '00000000-0000-4000-8000-000000000104', 'Applicant T', 'applicant-t@test.rentid', 'submitted', true, 'direct_link', 'Former landlord: Jane');
do $$ declare a public.rental_applications%rowtype; begin
  select * into a from public.rental_applications where id = '90000000-0000-4000-8000-000000000101';
  assert a.organization_id = '60000000-0000-4000-8000-000000000101', 'organization_id follows the listing, whatever the client sent';
  assert a.decided_at is null and a.status = 'submitted', 'submitted application is undecided';
  assert (select count(*) from public.rental_applications) = 1, 'applicant reads own application';
  begin
    insert into public.rental_applications (listing_id, applicant_user_id, applicant_name, applicant_email, status)
      values ('80000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000104', 'T', 't@x', 'approved');
    raise exception 'ASSERT FAILED: applicant inserted an approved application';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.rental_applications (listing_id, applicant_user_id, applicant_name, applicant_email, status)
      values ('80000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104', 'T', 't@x', 'submitted');
    raise exception 'ASSERT FAILED: applicant applied to a draft listing';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.rental_applications (listing_id, applicant_user_id, applicant_name, applicant_email, status)
      values ('80000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000105', 'U', 'u@x', 'submitted');
    raise exception 'ASSERT FAILED: applicant applied as someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rental_applications set status = 'approved' where id = '90000000-0000-4000-8000-000000000101';
    raise exception 'ASSERT FAILED: applicant approved their own application';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.rental_applications set note = 'Can move in early' where id = '90000000-0000-4000-8000-000000000101';
do $$ begin
  assert (select note from public.rental_applications where id = '90000000-0000-4000-8000-000000000101') = 'Can move in early', 'applicant can edit own details';
end $$;

-- Unrelated landlord B cannot see it.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.rental_applications) = 0, 'unrelated org cannot read applications';
end $$;

-- Owner L approves.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
update public.rental_applications set status = 'approved' where id = '90000000-0000-4000-8000-000000000101';
do $$ declare a public.rental_applications%rowtype; begin
  select * into a from public.rental_applications where id = '90000000-0000-4000-8000-000000000101';
  assert a.status = 'approved', 'org member approved the application';
  assert a.decided_at is not null, 'decided_at stamped by trigger on approval';
end $$;

-- Applicant U applies and withdraws; sees only their own.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000105","role":"authenticated","email":"applicant-u@test.rentid"}';
insert into public.rental_applications (id, listing_id, applicant_user_id, applicant_name, applicant_email, status)
  values ('90000000-0000-4000-8000-000000000102', '80000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000105', 'Applicant U', 'applicant-u@test.rentid', 'submitted');
update public.rental_applications set status = 'withdrawn' where id = '90000000-0000-4000-8000-000000000102';
do $$ begin
  assert (select count(*) from public.rental_applications) = 1, 'applicant U sees only their own application';
  assert (select status from public.rental_applications where id = '90000000-0000-4000-8000-000000000102') = 'withdrawn', 'applicant can withdraw';
  assert (select decided_at from public.rental_applications where id = '90000000-0000-4000-8000-000000000102') is not null, 'decided_at stamped on withdrawal';
end $$;

-- Confirmed manager P sees applications on the owner's listing.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
do $$ begin
  assert (select count(*) from public.rental_applications) = 2, 'confirmed manager reads applications for the managed property';
end $$;

-- ---------------------------------------------------------------- 5. leads
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000104","role":"authenticated","email":"applicant-t@test.rentid"}';
insert into public.listing_leads (id, listing_id, organization_id, name, email, source, utm_source)
  values ('a0000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000102',
          'Applicant T', 'applicant-t@test.rentid', 'qr_code', 'flyer');
do $$ begin
  assert (select count(*) from public.listing_leads) = 0, 'a visitor never reads the lead table';
  begin
    insert into public.listing_leads (listing_id, email) values ('80000000-0000-4000-8000-000000000103', 'x@x');
    raise exception 'ASSERT FAILED: lead recorded against a draft listing';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.listing_leads) = 0, 'landlord B cannot read another org''s leads';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
update public.listing_leads set application_id = '90000000-0000-4000-8000-000000000101' where id = 'a0000000-0000-4000-8000-000000000101';
do $$ declare l public.listing_leads%rowtype; begin
  select * into l from public.listing_leads where id = 'a0000000-0000-4000-8000-000000000101';
  assert l.organization_id = '60000000-0000-4000-8000-000000000101', 'lead organization follows the listing';
  assert l.application_id = '90000000-0000-4000-8000-000000000101', 'org member links a lead to its application';
  assert (select count(*) from public.listing_leads) = 1, 'listing owner reads its leads';
end $$;

-- ------------------------------------------------------------- 6. channels
insert into public.listing_channels (id, listing_id, organization_id, marketplace_id, enabled, connection_status, listing_status)
  values ('b0000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000101', '60000000-0000-4000-8000-000000000102', 'rentid', true, 'connected', 'live');
do $$ begin
  assert (select organization_id from public.listing_channels where id = 'b0000000-0000-4000-8000-000000000101') = '60000000-0000-4000-8000-000000000101',
    'channel organization follows the listing';
  begin
    insert into public.listing_channels (listing_id, marketplace_id) values ('80000000-0000-4000-8000-000000000101', 'craigslist');
    raise exception 'ASSERT FAILED: unknown marketplace accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.listing_sync_events (listing_id, marketplace_id, action, result) values ('80000000-0000-4000-8000-000000000101', 'rentid', 'create', 'succeeded');
    raise exception 'ASSERT FAILED: client wrote a sync event';
  exception when insufficient_privilege then null;
  end;
end $$;
-- P adds a channel on its own draft listing
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
insert into public.listing_channels (id, listing_id, marketplace_id) values ('b0000000-0000-4000-8000-000000000102', '80000000-0000-4000-8000-000000000102', 'zillow');

-- Platform records sync events.
reset role;
reset request.jwt.claims;
insert into public.listing_sync_events (listing_id, marketplace_id, action, result, message) values
  ('80000000-0000-4000-8000-000000000101', 'rentid', 'create', 'succeeded', 'Listed on RentID'),
  ('80000000-0000-4000-8000-000000000102', 'zillow', 'create', 'pending_integration', 'Zillow feed not yet authorized');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000102","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.listing_channels) = 1, 'other org sees channels of published listings only';
  assert (select count(*) from public.listing_sync_events) = 0, 'other org sees no sync history';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
do $$ begin
  assert (select count(*) from public.listing_sync_events) = 2, 'property owner reads sync history for every listing on its property';
  assert (select count(*) from public.listing_channels) = 2, 'property owner reads channels for every listing on its property';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert (select count(*) from public.listing_channels) = 1, 'anon sees distribution state of published listings only';
end $$;

-- ------------------------------------------- 7. publish a draft, public profile
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
update public.listings set status = 'published' where id = '80000000-0000-4000-8000-000000000103';
do $$ begin
  assert (select published_at from public.listings where id = '80000000-0000-4000-8000-000000000103') is not null, 'published_at stamped on publish';
  assert (select updated_at from public.listings where id = '80000000-0000-4000-8000-000000000103') = now(), 'a real edit touches updated_at';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ declare p record; begin
  select * into p from public.provider_public_profile('60000000-0000-4000-8000-000000000101');
  assert p.name = 'L Holdings' and p.kind = 'landlord', 'provider_public_profile() returns the organization';
  assert p.verification_status = 'unverified', 'provider starts unverified';
  assert p.published_listings = 2, 'provider_public_profile() counts published listings';
  assert p.verified_properties = 0, 'no verified properties yet';
  assert (select count(*) from public.listings) = 2, 'anon sees both published listings now';
end $$;

-- ------------------------------------------------ 8. owner revokes authority
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000101","role":"authenticated","email":"landlord-l@test.rentid"}';
update public.management_assignments set revoked_at = now() where id = '70000000-0000-4000-8000-000000000101';
do $$ begin
  assert (select authority_status from public.management_assignments where id = '70000000-0000-4000-8000-000000000101') = 'revoked',
    'revoked_at flips authority_status to revoked';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000103","role":"authenticated","email":"manager-p@test.rentid"}';
do $$ begin
  assert not public.has_management_authority('10000000-0000-4000-8000-000000000101'), 'revoked assignment grants nothing';
  assert (select count(*) from public.properties) = 0, 'PM loses read access to the property';
  assert (select count(*) from public.listings where id = '80000000-0000-4000-8000-000000000102') = 1, 'PM keeps its own listing row';
  begin
    insert into public.listings (organization_id, property_id, unit_id, headline, monthly_rent)
      values ('60000000-0000-4000-8000-000000000103', '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', 'After revoke', 1);
    raise exception 'ASSERT FAILED: PM listed a property after authority was revoked';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
