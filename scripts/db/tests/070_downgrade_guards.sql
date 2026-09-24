-- Verified history is append-only for clients. Transactional, rolls back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000d1', 'll@guard.rentid', '{"full_name":"Landlord","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000d2', 'tn@guard.rentid', '{"full_name":"Tenant","role":"tenant"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","email":"ll@guard.rentid"}';
select public.create_organization('Guard Org', 'landlord') as org \gset
insert into public.properties (id, organization_id, name, street_address, city, state, zip)
  values ('10000000-0000-4000-8000-0000000000d1', :'org', 'Guard House', '9 Main', 'SLC', 'UT', '84101');
insert into public.units (id, property_id, name, monthly_rent)
  values ('20000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'A', 1500);
insert into public.tenant_invitations (id, organization_id, property_id, unit_id, email, full_name, monthly_rent, token)
  values ('30000000-0000-4000-8000-0000000000d1', :'org', '10000000-0000-4000-8000-0000000000d1',
          '20000000-0000-4000-8000-0000000000d1', 'tn@guard.rentid', 'Tenant', 1500, 'guard-token');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","email":"tn@guard.rentid"}';
select public.accept_invitation('guard-token') ->> 'tenancy_id' as tn \gset

-- platform settles a payment
reset role; reset request.jwt.claims;
insert into public.payments (id, organization_id, tenancy_id, amount, status, method, due_date, period_label)
  values ('40000000-0000-4000-8000-0000000000d1', :'org', :'tn', 1500, 'pending', 'ach', current_date, 'Sept 2026');
select public.settle_payment('40000000-0000-4000-8000-0000000000d1', 'sandbox', 'guard_evt_1', 0.40, now());

-- ------------------------------------------- landlord cannot rewrite history
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated","email":"ll@guard.rentid"}';
do $$ begin
  begin
    update public.payments set verification_source = 'landlord_reported' where id = '40000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: settled payment downgraded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payments set amount = 1 where id = '40000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: settled payment amount changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payments set status = 'failed' where id = '40000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: settled payment status changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.payments set paid_at = null where id = '40000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: settled payment paid_at cleared';
  exception when insufficient_privilege then null;
  end;
end $$;

-- memo is still editable (annotation, not history)
update public.payments set memo = 'Received, thanks' where id = '40000000-0000-4000-8000-0000000000d1';
do $$ begin
  assert (select memo from public.payments where id = '40000000-0000-4000-8000-0000000000d1') = 'Received, thanks',
    'memo remains editable on a settled payment';
  assert (select verified from public.payments where id = '40000000-0000-4000-8000-0000000000d1'),
    'payment is still verified after the annotation';
end $$;

-- deletes are gone entirely
do $$ begin
  begin
    delete from public.payments where id = '40000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: payment deleted by client';
  exception when insufficient_privilege then null;
  end;
end $$;

-- landlord-reported rows stay fully editable
insert into public.payments (id, organization_id, tenancy_id, amount, status, method, due_date, period_label, verification_source)
  values ('40000000-0000-4000-8000-0000000000d2', :'org', :'tn', 1200, 'paid', 'check', current_date, 'Aug 2026', 'landlord_reported');
update public.payments set amount = 1250 where id = '40000000-0000-4000-8000-0000000000d2';
do $$ begin
  assert (select amount from public.payments where id = '40000000-0000-4000-8000-0000000000d2') = 1250,
    'an unverified landlord-reported payment is still correctable';
end $$;

-- ------------------------------------------- verified tenancy cannot vanish
do $$ begin
  begin
    update public.tenancies set deleted_at = now() where verified;
    raise exception 'ASSERT FAILED: verified tenancy soft-deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.tenancies where verified;
    raise exception 'ASSERT FAILED: verified tenancy hard-deleted';
  exception when insufficient_privilege then null;
  end;
end $$;
-- ending it is the supported path
update public.tenancies set status = 'ended', end_date = current_date where verified;
do $$ begin
  assert (select status from public.tenancies where verified) = 'ended', 'ending a verified tenancy is allowed';
end $$;

-- ------------------------------------------- reviews: edit window + no delete
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","email":"tn@guard.rentid"}';
insert into public.reviews (id, tenancy_id, author_id, subject_type, subject_user_id, rating, body, direction, author_name)
  values ('70000000-0000-4000-8000-0000000000d1', :'tn', '00000000-0000-4000-8000-0000000000d2', 'landlord',
          '00000000-0000-4000-8000-0000000000d1', 5, 'Responsive landlord.', 'tenant_to_landlord', 'Tenant');
update public.reviews set body = 'Responsive landlord, quick repairs.' where id = '70000000-0000-4000-8000-0000000000d1';
do $$ begin
  assert (select body from public.reviews where id = '70000000-0000-4000-8000-0000000000d1') like '%quick repairs%',
    'a fresh review is editable inside the one-hour window';
  begin
    update public.reviews set tenancy_id = gen_random_uuid() where id = '70000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: review moved to another tenancy';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  begin
    delete from public.reviews where id = '70000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: review deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- an older review is frozen: withdraw instead of rewrite
reset role; reset request.jwt.claims;
update public.reviews set created_at = now() - interval '2 hours' where id = '70000000-0000-4000-8000-0000000000d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated","email":"tn@guard.rentid"}';
do $$ begin
  begin
    update public.reviews set rating = 1, body = 'Actually terrible.' where id = '70000000-0000-4000-8000-0000000000d1';
    raise exception 'ASSERT FAILED: stale review rewritten';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.reviews set status = 'withdrawn' where id = '70000000-0000-4000-8000-0000000000d1';
do $$ begin
  assert (select status from public.reviews where id = '70000000-0000-4000-8000-0000000000d1') = 'withdrawn',
    'withdrawing a review is always allowed';
  assert (select published from public.reviews where id = '70000000-0000-4000-8000-0000000000d1') = false,
    'a withdrawn review is unpublished by the sync trigger';
end $$;

rollback;
