-- Payments foundation + security hardening guarantees. Transactional, rolls back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'll@pay.rentid', '{"full_name":"Landlord","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'tn@pay.rentid', '{"full_name":"Tenant","role":"tenant"}'),
  ('00000000-0000-4000-8000-0000000000a3', 'admin@pay.rentid', '{"full_name":"Admin","role":"tenant"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a3', 'admin');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","email":"ll@pay.rentid"}';
select public.create_organization('Pay Org', 'landlord') as org \gset
insert into public.properties (id, organization_id, name, street_address, city, state, zip)
  values ('10000000-0000-4000-8000-0000000000a1', :'org', 'Pay House', '1 Main', 'SLC', 'UT', '84101');
insert into public.units (id, property_id, name, monthly_rent)
  values ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'A', 1500);
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, status, monthly_rent)
  values ('50000000-0000-4000-8000-0000000000a1', :'org', '10000000-0000-4000-8000-0000000000a1',
          '20000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'Tenant', 'active', 1500);

-- ------------------------------------------------ payout accounts
insert into public.payout_accounts (id, organization_id, provider, provider_account_ref, nickname, account_last4, status, is_default)
  values ('60000000-0000-4000-8000-0000000000a1', :'org', 'sandbox', 'acct_tok_123', 'Ops checking', '4321', 'verified', true);
do $$ begin
  assert (select status from public.payout_accounts where id = '60000000-0000-4000-8000-0000000000a1') = 'unverified',
    'client-inserted payout account is forced to unverified';
  begin
    insert into public.payout_accounts (organization_id, provider_account_ref)
      values ((select id from public.organizations where name = 'Pay Org'), '021000021');
    raise exception 'ASSERT FAILED: raw routing number accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.payout_accounts set status = 'verified' where id = '60000000-0000-4000-8000-0000000000a1';
    raise exception 'ASSERT FAILED: client verified its own payout account';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payouts (organization_id, amount) values ((select id from public.organizations where name = 'Pay Org'), 100);
    raise exception 'ASSERT FAILED: client created a payout';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ledger_entries (organization_id, entry_type, amount)
      values ((select id from public.organizations where name = 'Pay Org'), 'adjustment', 5);
    raise exception 'ASSERT FAILED: client wrote a ledger entry';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------ settlement (platform)
insert into public.payments (id, organization_id, tenancy_id, amount, status, method, due_date, period_label)
  values ('40000000-0000-4000-8000-0000000000a1', :'org', '50000000-0000-4000-8000-0000000000a1', 1500, 'pending', 'ach', current_date, 'Sept 2026');

do $$ begin
  begin
    perform public.settle_payment('40000000-0000-4000-8000-0000000000a1', 'sandbox', 'evt_1', 0.40, now());
    raise exception 'ASSERT FAILED: landlord settled a payment';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role; reset request.jwt.claims;
select public.settle_payment('40000000-0000-4000-8000-0000000000a1', 'sandbox', 'evt_1', 0.40, now());
select public.settle_payment('40000000-0000-4000-8000-0000000000a1', 'sandbox', 'evt_1', 0.40, now()); -- replay
do $$ declare p public.payments%rowtype; begin
  select * into p from public.payments where id = '40000000-0000-4000-8000-0000000000a1';
  assert p.status = 'paid' and p.verified and p.verification_source = 'platform_settled', 'settled payment is verified';
  assert p.platform_fee_amount = 7.50, format('0.5%% of 1500 is 7.50, got %s', p.platform_fee_amount);
  assert (select count(*) from public.ledger_entries where payment_id = p.id) = 3, 'rent + platform fee + processor fee journaled once (idempotent)';
  assert (select sum(amount) from public.ledger_entries where payment_id = p.id) = 1500 - 7.50 - 0.40, 'net to landlord';
  assert (select count(*) from public.verification_records where payment_id = p.id and source = 'platform') = 1, 'platform verification record';
  assert public.compute_platform_fee(1500, 'card') = round(7.50 + 1500 * 0.029 + 0.30, 2), 'card fee passthrough';
end $$;

-- ledger is append-only even for the platform
do $$ begin
  begin
    update public.ledger_entries set amount = 0 where payment_id = '40000000-0000-4000-8000-0000000000a1';
    raise exception 'ASSERT FAILED: ledger entry mutated';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs where action = 'payment.settled';
    raise exception 'ASSERT FAILED: audit log deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- return flow
select public.return_payment('40000000-0000-4000-8000-0000000000a1', 'sandbox', 'evt_2', 'R01 insufficient funds');
do $$ declare p public.payments%rowtype; begin
  select * into p from public.payments where id = '40000000-0000-4000-8000-0000000000a1';
  assert p.status = 'returned' and not p.verified, 'returned payment is no longer verified';
  assert (select amount from public.ledger_entries where payment_id = p.id and entry_type = 'payment_return') = -1500, 'return journaled';
end $$;

-- ------------------------------------------------ tenant visibility of money history
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","email":"tn@pay.rentid"}';
do $$ begin
  assert (select count(*) from public.ledger_entries) = 4, 'tenant sees ledger entries for own tenancy';
  assert (select count(*) from public.payout_accounts) = 0, 'tenant cannot see landlord payout accounts';
  assert (select count(*) from public.payment_events) = 0, 'tenant cannot see raw provider events';
end $$;

-- ------------------------------------------------ admin needs MFA for settings + events
reset role; reset request.jwt.claims;
insert into public.payment_events (provider, event_id, event_type, payload) values ('sandbox', 'evt_1', 'payment.settled', '{}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","email":"admin@pay.rentid","aal":"aal1"}';
do $$ begin
  assert (select count(*) from public.payment_events) = 0, 'admin without MFA cannot read payment events';
  assert (select count(*) from public.platform_settings) = 1, 'settings readable';
end $$;
update public.platform_settings set platform_fee_percentage = 0.75;  -- silently affects 0 rows without aal2
do $$ begin
  assert (select platform_fee_percentage from public.platform_settings) = 0.5000, 'admin without MFA cannot change fees';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","email":"admin@pay.rentid","aal":"aal2"}';
update public.platform_settings set platform_fee_percentage = 0.75;
do $$ begin
  assert (select platform_fee_percentage from public.platform_settings) = 0.7500, 'admin with MFA can change fees';
  assert (select count(*) from public.payment_events) = 1, 'admin with MFA reads payment events';
end $$;

-- ------------------------------------------------ anon sees nothing but published listings
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    perform count(*) from public.payments;
    raise exception 'ASSERT FAILED: anon can query payments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.profiles;
    raise exception 'ASSERT FAILED: anon can query profiles';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.listings) = 0, 'anon listings query works but returns only published rows';
end $$;

-- ------------------------------------------------ rate limit
reset role; reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","email":"tn@pay.rentid"}';
do $$ declare i int; begin
  for i in 1..10 loop
    assert (public.accept_invitation('no-such-token') ->> 'error') = 'not_found', 'soft failure counted';
  end loop;
  begin
    perform public.accept_invitation('no-such-token');
    raise exception 'ASSERT FAILED: 11th attempt not rate limited';
  exception when program_limit_exceeded then null;
  end;
end $$;

-- ------------------------------------------------ every table has RLS
reset role; reset request.jwt.claims;
do $$ declare bad text; begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'tables without RLS: ' || coalesce(bad, '');
end $$;

rollback;
