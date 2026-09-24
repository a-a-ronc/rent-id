-- Guarantees the ported marketplace / syndication / management services rely
-- on (20260915000720). One transaction, rolled back at the end. Literal ids
-- because psql :'vars' do not interpolate inside $$ blocks.
--
--   users  L 00000000-0000-4000-8000-0000000000c1  landlord, owns org L
--          P 00000000-0000-4000-8000-0000000000c2  property manager, owns org P
--          T 00000000-0000-4000-8000-0000000000c3  tenant of L with history; applicant
--          B 00000000-0000-4000-8000-0000000000c4  unrelated landlord, owns org B
--   orgs   L 60000000-0000-4000-8000-0000000000c1   P ...c2   B ...c3
--   L's property 10000000-0000-4000-8000-0000000000c1, units ...c1 / ...c2
--   B's property 10000000-0000-4000-8000-0000000000c2, unit  ...c3
--   T's verified tenancy at L/unit c1: 50000000-0000-4000-8000-0000000000c1
--   L's published listing on unit c2:  80000000-0000-4000-8000-0000000000c1
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'landlord-l@mkt.rentid', '{"full_name":"Landlord L","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'manager-p@mkt.rentid',  '{"full_name":"Manager P","role":"property_manager"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'tenant-t@mkt.rentid',   '{"full_name":"Tenant T","role":"tenant"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'landlord-b@mkt.rentid', '{"full_name":"Landlord B","role":"landlord"}');

insert into public.organizations (id, name, owner_id, kind) values
  ('60000000-0000-4000-8000-0000000000c1', 'L Homes',      '00000000-0000-4000-8000-0000000000c1', 'landlord'),
  ('60000000-0000-4000-8000-0000000000c2', 'P Management', '00000000-0000-4000-8000-0000000000c2', 'property_manager'),
  ('60000000-0000-4000-8000-0000000000c3', 'B Rentals',    '00000000-0000-4000-8000-0000000000c4', 'landlord');
insert into public.organization_members (organization_id, user_id, role) values
  ('60000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', 'landlord'),
  ('60000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c2', 'property_manager'),
  ('60000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c4', 'landlord');

insert into public.properties (id, organization_id, name, street_address, city, state, zip) values
  ('10000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', 'Maple Court', '5 Maple Ct', 'Salt Lake City', 'UT', '84105'),
  ('10000000-0000-4000-8000-0000000000c2', '60000000-0000-4000-8000-0000000000c3', 'B Duplex',    '9 Bee St',    'Provo',          'UT', '84601');
insert into public.units (id, property_id, name, monthly_rent, bedrooms, bathrooms) values
  ('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Unit 1', 1400, 2, 1),
  ('20000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-0000000000c1', 'Unit 2', 1250, 1, 1),
  ('20000000-0000-4000-8000-0000000000c3', '10000000-0000-4000-8000-0000000000c2', 'Left',   1100, 2, 1);

-- T's history at L, written by the platform (verified tenancy + settled payments).
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, tenant_email,
                              status, verified, verified_at, start_date, monthly_rent)
  values ('50000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1',
          '20000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c3', 'Tenant T', 'tenant-t@mkt.rentid',
          'active', true, now(), current_date - interval '8 months', 1400);
insert into public.payments (id, organization_id, tenancy_id, unit_id, amount, status, method, due_date, paid_at, period_label, verification_source) values
  -- settled on time
  ('30000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   1400, 'paid', 'ach', date '2026-06-01', timestamptz '2026-05-30 12:00:00+00', 'June 2026', 'platform_settled'),
  -- settled, but four days late
  ('30000000-0000-4000-8000-0000000000c2', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   1400, 'paid', 'ach', date '2026-07-01', timestamptz '2026-07-05 12:00:00+00', 'July 2026', 'platform_settled'),
  -- still late
  ('30000000-0000-4000-8000-0000000000c3', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   1400, 'late', 'manual', date '2026-08-01', null, 'August 2026', 'unverified'),
  -- landlord-reported: paid on time but NOT verified
  ('30000000-0000-4000-8000-0000000000c4', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   1400, 'paid', 'cash', date '2026-05-01', timestamptz '2026-05-01 12:00:00+00', 'May 2026', 'landlord_reported'),
  -- current month: one collected, one late → 50% collection rate
  ('30000000-0000-4000-8000-0000000000c5', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   1400, 'paid', 'ach', date_trunc('month', current_date)::date + 1, date_trunc('month', current_date) + interval '1 day', 'This month', 'platform_settled'),
  ('30000000-0000-4000-8000-0000000000c6', '60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   200, 'late', 'manual', date_trunc('month', current_date)::date + 2, null, 'This month (fee)', 'unverified');
insert into public.maintenance_requests (id, organization_id, property_id, unit_id, tenancy_id, title, status, priority, created_at, first_response_at, resolved_at) values
  ('40000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   '50000000-0000-4000-8000-0000000000c1', 'Leaking tap', 'completed', 'normal', now() - interval '30 hours', now() - interval '26 hours', now() - interval '10 hours'),
  ('40000000-0000-4000-8000-0000000000c2', '60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1',
   null, 'Porch light', 'open', 'low', now() - interval '100 hours', null, null);
-- reviews on the verified tenancy: one in each direction
insert into public.reviews (id, tenancy_id, organization_id, author_id, author_name, subject_user_id, direction, rating, body, status) values
  ('65000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000c1', 'Landlord L', '00000000-0000-4000-8000-0000000000c3', 'landlord_to_tenant', 5, 'Always on time', 'published'),
  ('65000000-0000-4000-8000-0000000000c2', '50000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000c3', 'Tenant T', '00000000-0000-4000-8000-0000000000c1', 'tenant_to_landlord', 4, 'Responsive', 'published');

-- L publishes a listing on the vacant unit.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"landlord-l@mkt.rentid"}';
insert into public.listings (id, organization_id, property_id, unit_id, status, headline, monthly_rent, available_on, bedrooms, bathrooms)
  values ('80000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1',
          '20000000-0000-4000-8000-0000000000c2', 'published', 'Bright 1BR at Maple Court', 1250, current_date + 7, 1, 1);
-- a second published listing, so the no-consent application below has a listing
-- of its own (one open application per applicant per listing)
insert into public.listings (id, organization_id, property_id, unit_id, status, headline, monthly_rent, available_on, bedrooms, bathrooms)
  values ('80000000-0000-4000-8000-0000000000c2', '60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1',
          '20000000-0000-4000-8000-0000000000c1', 'published', 'Roomy 2BR at Maple Court', 1400, current_date + 21, 2, 1);

-- ------------------------------------------- 1. passport snapshot at apply time
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated","email":"tenant-t@mkt.rentid"}';
do $$ begin
  begin
    perform public.tenant_passport_snapshot('00000000-0000-4000-8000-0000000000c3', null);
    raise exception 'ASSERT FAILED: a client called tenant_passport_snapshot() directly';
  exception when insufficient_privilege then null;
  end;
end $$;
-- T applies with consent and tries to smuggle in a forged history.
insert into public.rental_applications (id, listing_id, organization_id, applicant_user_id, applicant_name, applicant_email, status, profile_shared, passport_snapshot)
  values ('90000000-0000-4000-8000-0000000000c1', '80000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-0000000000c3', 'Tenant T', 'tenant-t@mkt.rentid', 'submitted', true,
          '{"tenant_name":"Tenant T","verified_payments":999,"on_time_pct":100}'::jsonb);
-- and once more without consent, on a SECOND listing: one open application per
-- applicant per listing is an invariant (rental_applications_one_open_per_applicant)
insert into public.rental_applications (id, listing_id, organization_id, applicant_user_id, applicant_name, applicant_email, status, profile_shared, passport_snapshot)
  values ('90000000-0000-4000-8000-0000000000c2', '80000000-0000-4000-8000-0000000000c2', '60000000-0000-4000-8000-0000000000c1',
          '00000000-0000-4000-8000-0000000000c3', 'Tenant T', 'tenant-t@mkt.rentid', 'submitted', false,
          '{"verified_payments":999}'::jsonb);
do $$ declare s jsonb; begin
  select passport_snapshot into s from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c1';
  assert s is not null, 'consented application carries a snapshot';
  -- payments c1, c2, c5 are platform-settled (verified); c4 is landlord-reported and does not count
  assert (s ->> 'verified_payments')::int = 3, 'snapshot is computed server-side (3 settled payments), not taken from the client';
  assert (s ->> 'on_time_payments')::int = 2, 'settled on or before the due date: c1, c5';
  assert (s ->> 'late_payments')::int = 3, 'late = status late (c3, c6) + settled after the due date (c2)';
  assert (s ->> 'on_time_pct')::int = 40, 'on-time share over settled ∪ late (2 of 5)';
  assert (s ->> 'verified_tenancies')::int = 1, 'the verified tenancy counts';
  assert (s ->> 'months_of_history')::int = 8, 'months of history from the tenancy start';
  assert (s ->> 'average_rent')::numeric = 1400, 'average rent over tenancies with rent';
  assert (s ->> 'tenant_name') = 'Tenant T', 'tenant name from the tenancy';
  assert jsonb_array_length(s -> 'reviews') = 1, 'landlord-to-tenant reviews ride along';
  assert (s -> 'reviews' -> 0 ->> 'rating')::int = 5, 'review payload mirrors the Review shape';
  assert (s ->> 'open_disputes')::int = 0, 'no open disputes';
  assert (select passport_snapshot from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c2') is null,
    'no consent, no snapshot';
  begin
    update public.rental_applications set passport_snapshot = '{"verified_payments":999}'::jsonb where id = '90000000-0000-4000-8000-0000000000c1';
    raise exception 'ASSERT FAILED: applicant rewrote the frozen snapshot';
  exception when insufficient_privilege then null;
  end;
end $$;
-- withdrawing consent drops the snapshot
update public.rental_applications set profile_shared = false where id = '90000000-0000-4000-8000-0000000000c1';
do $$ begin
  assert (select passport_snapshot from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c1') is null,
    'withdrawing consent drops the snapshot';
end $$;
update public.rental_applications set profile_shared = true where id = '90000000-0000-4000-8000-0000000000c1';
-- the operator cannot touch it either
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"landlord-l@mkt.rentid"}';
do $$ begin
  assert (select count(*) from public.rental_applications) = 2, 'listing operator reads the applications';
  begin
    update public.rental_applications set passport_snapshot = '{"verified_payments":0}'::jsonb where id = '90000000-0000-4000-8000-0000000000c2';
    raise exception 'ASSERT FAILED: operator wrote a snapshot after insert';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.rental_applications set status = 'under_review' where id = '90000000-0000-4000-8000-0000000000c1';
do $$ begin
  assert (select status from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c1') = 'under_review',
    'operator status changes still work with the snapshot guard in place';
end $$;
-- the platform may correct one
reset role;
reset request.jwt.claims;
update public.rental_applications set passport_snapshot = '{"verified_payments":2,"corrected":true}'::jsonb where id = '90000000-0000-4000-8000-0000000000c1';
do $$ begin
  assert (select passport_snapshot ->> 'corrected' from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c1') = 'true',
    'platform can write the snapshot';
end $$;

-- ------------------------------------------------- 2. record_listing_sync()
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"landlord-l@mkt.rentid"}';
insert into public.listing_channels (listing_id, organization_id, marketplace_id, enabled, connection_status) values
  ('80000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', 'rentid', true, 'connected'),
  ('80000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', 'zillow', true, 'integration_pending');
do $$ declare c public.listing_channels%rowtype; e uuid; begin
  e := public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'create', 'succeeded', 'Published on RentID', 'ref-1');
  assert (select count(*) from public.listing_sync_events where id = e) = 1, 'operator recorded a sync event through the RPC';
  select * into c from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'rentid';
  assert c.listing_status = 'live' and c.last_synced_at is not null and c.external_listing_id = 'ref-1' and c.last_error is null,
    'succeeded → live, synced, external id kept';

  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'zillow', 'create', 'pending_integration', 'Held in the outbound queue');
  select * into c from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'zillow';
  assert c.listing_status = 'pending_integration' and c.last_synced_at is null and c.last_error is null,
    'pending_integration → pending_integration, nothing synced';

  begin
    perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'zillow', 'create', 'succeeded', 'posted');
    raise exception 'ASSERT FAILED: client asserted a successful external sync';
  exception when insufficient_privilege then null;
  end;

  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'update', 'failed', 'boom');
  select * into c from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'rentid';
  assert c.listing_status = 'error' and c.last_error = 'boom' and c.external_listing_id = 'ref-1',
    'failed → error with the message, external id retained';

  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'remove', 'succeeded', 'Removed');
  select * into c from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'rentid';
  assert c.listing_status = 'removed' and c.last_error is null, 'remove + succeeded → removed';

  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'zillow', 'remove', 'pending_integration', 'queued');
  assert (select listing_status from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'zillow') = 'removal_queued',
    'remove + pending_integration → removal_queued';

  -- a channel row is created on the fly when missing
  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'apartments_com', 'create', 'queued', 'queued');
  assert (select listing_status from public.listing_channels where listing_id = '80000000-0000-4000-8000-0000000000c1' and marketplace_id = 'apartments_com') = 'queued',
    'RPC upserts the channel row';
  assert (select count(*) from public.listing_sync_events where listing_id = '80000000-0000-4000-8000-0000000000c1') = 6, 'every attempt left an event';

  begin
    perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'create', 'nope', 'x');
    raise exception 'ASSERT FAILED: unknown result accepted';
  exception when check_violation then null;
  end;
end $$;
-- Unrelated landlord B: no
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated","email":"landlord-b@mkt.rentid"}';
do $$ begin
  begin
    perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'create', 'succeeded', 'hijack');
    raise exception 'ASSERT FAILED: stranger recorded a sync';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.listing_sync_events) = 0, 'stranger reads no sync history';
end $$;
-- Anonymous: no execute
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'create', 'succeeded', 'anon');
    raise exception 'ASSERT FAILED: anon called record_listing_sync';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------ 3. managed reads follow confirmed authority
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","email":"manager-p@mkt.rentid"}';
insert into public.owner_accounts (id, organization_id, name) values ('55000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c2', 'Maple Owner LLC');
insert into public.management_assignments (id, organization_id, owner_account_id, property_id)
  values ('70000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c2', '55000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1');
do $$ begin
  assert (select count(*) from public.tenancies) = 0, 'pending authority: no tenancies';
  assert (select count(*) from public.payments) = 0, 'pending authority: no payments';
  assert (select count(*) from public.maintenance_requests) = 0, 'pending authority: no work orders';
  begin
    perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'resync', 'succeeded', 'pm');
    raise exception 'ASSERT FAILED: unconfirmed manager recorded a sync on the owner''s listing';
  exception when insufficient_privilege then null;
  end;
end $$;
-- Owner L confirms
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"landlord-l@mkt.rentid"}';
update public.management_assignments set authority_status = 'verified' where id = '70000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","email":"manager-p@mkt.rentid"}';
do $$ begin
  assert public.manages_tenancy('50000000-0000-4000-8000-0000000000c1'), 'manages_tenancy() follows confirmed authority';
  assert (select count(*) from public.tenancies) = 1, 'confirmed manager reads the managed tenancy';
  assert (select count(*) from public.payments) = 6, 'confirmed manager reads the managed rent ledger';
  assert (select count(*) from public.maintenance_requests) = 2, 'confirmed manager reads the managed work orders';
  assert (select count(*) from public.rental_applications) = 2, 'confirmed manager reads applications on the managed listing';
  assert (select passport_snapshot ->> 'corrected' from public.rental_applications where id = '90000000-0000-4000-8000-0000000000c1') = 'true',
    'the snapshot travels with the application to every operator';
  -- reads only: recording money or closing work orders stays with the owner
  begin
    insert into public.payments (organization_id, tenancy_id, amount, status, verification_source)
      values ('60000000-0000-4000-8000-0000000000c1', '50000000-0000-4000-8000-0000000000c1', 1, 'paid', 'landlord_reported');
    raise exception 'ASSERT FAILED: manager recorded a payment for the owner';
  exception when insufficient_privilege then null;
  end;
  update public.maintenance_requests set status = 'closed' where id = '40000000-0000-4000-8000-0000000000c2';
  assert (select status from public.maintenance_requests where id = '40000000-0000-4000-8000-0000000000c2') = 'open',
    'manager cannot update the owner''s work order';
  update public.tenancies set tenant_name = 'Hacked' where id = '50000000-0000-4000-8000-0000000000c1';
  assert (select tenant_name from public.tenancies where id = '50000000-0000-4000-8000-0000000000c1') = 'Tenant T',
    'manager cannot edit the owner''s tenancy';
  -- a confirmed manager operates the owner's listing
  perform public.record_listing_sync('80000000-0000-4000-8000-0000000000c1', 'rentid', 'resync', 'succeeded', 'pm resync');
  assert (select count(*) from public.listing_sync_events where message = 'pm resync') = 1, 'confirmed manager records syncs on the managed listing';
end $$;
-- Unrelated landlord B sees none of it
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated","email":"landlord-b@mkt.rentid"}';
do $$ begin
  assert (select count(*) from public.tenancies) = 0, 'stranger reads no tenancies';
  assert (select count(*) from public.payments) = 0, 'stranger reads no payments';
  assert (select count(*) from public.maintenance_requests) = 0, 'stranger reads no work orders';
end $$;

-- ------------------------------------------------ 4. provider_public_stats()
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ declare s record; begin
  select * into s from public.provider_public_stats(array['60000000-0000-4000-8000-0000000000c1'::uuid]);
  assert s.organization_id = '60000000-0000-4000-8000-0000000000c1', 'anon reads the aggregate record';
  assert s.verified_units = 0, 'no verified badge yet → no verified units';
  assert s.owners_served = 1, 'a landlord serves one portfolio';
  assert s.median_first_response_hours = 4.0, 'median first response from first_response_at (open requests excluded)';
  assert s.resolved_under_72h_pct = 100, 'the one resolved request closed inside 72h';
  assert s.collection_rate_pct = 50, 'one of two payments due this month is paid';
  assert s.tenant_rating = 4.0 and s.owner_rating = 5.0, 'ratings average published reviews by direction';
  assert s.open_disputes = 0, 'no open disputes';
  select * into s from public.provider_public_stats(array['60000000-0000-4000-8000-0000000000c2'::uuid]);
  assert s.owners_served = 1 and s.collection_rate_pct = 50 and s.median_first_response_hours = 4.0,
    'a confirmed manager''s record spans the properties it manages';
  assert (select count(*) from public.provider_public_stats(array['60000000-0000-4000-8000-0000000000c1'::uuid, '60000000-0000-4000-8000-0000000000c3'::uuid])) = 2,
    'stats come back per organization';
  assert (select count(*) from public.provider_public_stats(array['00000000-0000-4000-8000-0000000000ff'::uuid])) = 0,
    'unknown organization → no row';
  begin
    perform count(*) from public.payments;
    raise exception 'ASSERT FAILED: anon read the underlying payment rows';
  exception when insufficient_privilege then null;
  end;
end $$;
-- A verified ownership badge (platform decision) turns units into verified units.
reset role;
reset request.jwt.claims;
insert into public.property_party_relationships (property_id, user_id, organization_id, relationship, status, verified_at)
  values ('10000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', '60000000-0000-4000-8000-0000000000c1', 'owner', 'ownership_verified', now());
insert into public.review_disputes (review_id, raised_by, reason)
  values ('65000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1', 'Not accurate');
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ declare s record; begin
  select * into s from public.provider_public_stats(array['60000000-0000-4000-8000-0000000000c1'::uuid]);
  assert s.verified_units = 2, 'units on badge-verified properties count as verified';
  assert s.open_disputes = 1, 'open disputes on the provider''s reviews are counted';
  assert (select verified_properties from public.provider_public_profile('60000000-0000-4000-8000-0000000000c1')) = 1,
    'provider_public_profile() agrees on the verified property';
end $$;

-- ------------------------------------------------ 5. revoke closes the door
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"landlord-l@mkt.rentid"}';
update public.management_assignments set revoked_at = now() where id = '70000000-0000-4000-8000-0000000000c1';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated","email":"manager-p@mkt.rentid"}';
do $$ begin
  assert (select count(*) from public.tenancies) = 0, 'revoked: tenancies gone';
  assert (select count(*) from public.payments) = 0, 'revoked: payments gone';
  assert (select count(*) from public.maintenance_requests) = 0, 'revoked: work orders gone';
end $$;

rollback;
