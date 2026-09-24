-- =====================================================================
-- Forward migration 5/6 — payments foundation
--
-- Provider-agnostic money-movement model so the provider decision
-- (Column / Worldpay / Moov / Adyen / Stripe) does not force a remodel later:
--
--   payout_accounts  — where a landlord/PM gets paid. Holds a PROVIDER TOKEN
--                      only. Raw routing/account numbers are never stored.
--   payouts          — one transfer of settled rent to a payout account.
--   ledger_entries   — append-only double-entry style journal: every rent
--                      payment, platform fee, processor fee, payout, return.
--   payment_events   — raw provider webhook log with idempotency key.
--   platform_settings — fee schedule (0.5% ACH platform fee, card passthrough).
--
-- Clients (landlords, tenants) can READ their money history. Only the platform
-- (service role: webhook handlers, settlement jobs) can WRITE to payouts,
-- ledger_entries and payment_events. See docs/SECURITY.md.
-- =====================================================================

-- ------------------------------------------------------- platform_settings
alter table public.platform_settings
  add column if not exists card_fee_percentage numeric(6,4) not null default 2.9000,
  add column if not exists card_fee_fixed numeric(6,2) not null default 0.30,
  add column if not exists card_fee_passthrough boolean not null default true,
  add column if not exists platform_fee_minimum numeric(6,2) not null default 0,
  add column if not exists marketplace_fee_percentage numeric(6,4) not null default 1.0000;

-- Fee schedule as a pure function so SQL reports and the TS module
-- (src/lib/payments/fees.ts) agree by construction.
create or replace function public.compute_platform_fee(_amount numeric, _method text default 'ach')
returns numeric language sql stable set search_path = public as $$
  select round(
    greatest(
      _amount * (select platform_fee_percentage from public.platform_settings where id) / 100.0,
      (select platform_fee_minimum from public.platform_settings where id)
    )
    + case when _method = 'card' and (select card_fee_passthrough from public.platform_settings where id)
           then _amount * (select card_fee_percentage from public.platform_settings where id) / 100.0
                + (select card_fee_fixed from public.platform_settings where id)
           else 0 end,
    2)
$$;
grant execute on function public.compute_platform_fee(numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------- payout_accounts
create table if not exists public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  provider text not null default 'sandbox',
  -- Opaque token issued by the provider (e.g. a Moov bank-account id, a Stripe
  -- external account id). NEVER a routing or account number — enforced below.
  provider_account_ref text,
  nickname text,
  bank_name text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  account_type text check (account_type is null or account_type in ('checking', 'savings')),
  status public.payout_account_status not null default 'unverified',
  is_default boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.payout_accounts.provider_account_ref is
  'Provider-issued token only. Storing raw bank account or routing numbers here is prohibited (see docs/SECURITY.md).';
grant select, insert, update on public.payout_accounts to authenticated;
grant all on public.payout_accounts to service_role;
alter table public.payout_accounts enable row level security;
create index if not exists payout_accounts_org_idx on public.payout_accounts(organization_id);
create unique index if not exists payout_accounts_one_default_idx
  on public.payout_accounts(organization_id) where is_default;
drop trigger if exists payout_accounts_touch on public.payout_accounts;
create trigger payout_accounts_touch before update on public.payout_accounts
  for each row execute function public.touch_updated_at();

-- Refuse anything that looks like a raw US routing (9 digits) or account number.
create or replace function public.payout_accounts_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.provider_account_ref ~ '^[0-9]{8,17}$' then
    raise exception 'provider_account_ref must be a provider token, not a bank account number' using errcode = '22023';
  end if;
  if not public.is_platform_actor() then
    -- clients may add/rename/disable accounts; verification is a platform outcome
    if tg_op = 'INSERT' then
      new.status := 'unverified';
      new.verified_at := null;
    elsif new.status is distinct from old.status and new.status <> 'disabled' then
      raise exception 'payout account status is set by the platform' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists payout_accounts_guard on public.payout_accounts;
create trigger payout_accounts_guard before insert or update on public.payout_accounts
  for each row execute function public.payout_accounts_guard();

drop policy if exists payout_accounts_select on public.payout_accounts;
create policy payout_accounts_select on public.payout_accounts for select to authenticated
  using (public.is_org_member(organization_id));
drop policy if exists payout_accounts_insert on public.payout_accounts;
create policy payout_accounts_insert on public.payout_accounts for insert to authenticated
  with check (public.is_org_member(organization_id));
drop policy if exists payout_accounts_update on public.payout_accounts;
create policy payout_accounts_update on public.payout_accounts for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ----------------------------------------------------------------- payouts
create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payout_account_id uuid references public.payout_accounts(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'usd',
  rail public.payment_rail not null default 'ach',
  status public.payout_status not null default 'pending',
  provider text not null default 'sandbox',
  provider_reference text,
  initiated_at timestamptz,
  settled_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.payouts to authenticated;
grant all on public.payouts to service_role;
alter table public.payouts enable row level security;
create index if not exists payouts_org_idx on public.payouts(organization_id, created_at desc);
create unique index if not exists payouts_provider_ref_idx on public.payouts(provider, provider_reference)
  where provider_reference is not null;
drop trigger if exists payouts_touch on public.payouts;
create trigger payouts_touch before update on public.payouts
  for each row execute function public.touch_updated_at();
drop policy if exists payouts_select on public.payouts;
create policy payouts_select on public.payouts for select to authenticated
  using (public.is_org_member(organization_id));
-- no insert/update/delete policies for authenticated: platform-only writes.

alter table public.payments drop constraint if exists payments_payout_id_fkey;
alter table public.payments add constraint payments_payout_id_fkey
  foreign key (payout_id) references public.payouts(id) on delete set null;
create index if not exists payments_payout_idx on public.payments(payout_id);

-- ---------------------------------------------------------- ledger_entries
-- Signed amounts from the ORGANIZATION's point of view:
--   rent_payment +, platform_fee -, processor_fee -, payout -, payment_return -, payout_return +
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  payout_id uuid references public.payouts(id) on delete set null,
  entry_type public.ledger_entry_type not null,
  amount numeric(12,2) not null,
  currency text not null default 'usd',
  provider text,
  provider_reference text,
  occurred_at timestamptz not null default now(),
  memo text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;
alter table public.ledger_entries enable row level security;
create index if not exists ledger_entries_org_idx on public.ledger_entries(organization_id, occurred_at desc);
create index if not exists ledger_entries_tenancy_idx on public.ledger_entries(tenancy_id);
create index if not exists ledger_entries_payment_idx on public.ledger_entries(payment_id);
create unique index if not exists ledger_entries_provider_ref_idx
  on public.ledger_entries(provider, provider_reference, entry_type) where provider_reference is not null;
drop policy if exists ledger_entries_select on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (public.is_org_member(organization_id)
         or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));

-- ---------------------------------------------------------- payment_events
-- Raw provider webhook payloads. Idempotent on (provider, event_id).
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);
grant select on public.payment_events to authenticated;
grant all on public.payment_events to service_role;
alter table public.payment_events enable row level security;
drop policy if exists payment_events_select_admin on public.payment_events;
create policy payment_events_select_admin on public.payment_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ----------------------------------------------------- append-only guards
create or replace function public.reject_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists ledger_entries_append_only on public.ledger_entries;
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function public.reject_mutation();

-- payment_events: processed_at/error may be set once; payload is immutable.
create or replace function public.payment_events_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_events is append-only' using errcode = '42501';
  end if;
  if new.payload is distinct from old.payload or new.event_id is distinct from old.event_id
     or new.provider is distinct from old.provider or new.received_at is distinct from old.received_at then
    raise exception 'payment_events payload is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists payment_events_guard on public.payment_events;
create trigger payment_events_guard before update or delete on public.payment_events
  for each row execute function public.payment_events_guard();

-- -------------------------------------------- settle_payment (platform RPC)
-- Called by the webhook handler (service role) when the provider confirms
-- settlement. Marks the payment platform_settled, journals rent + fees, and
-- returns the payment id. Idempotent per provider reference.
create or replace function public.settle_payment(
  _payment_id uuid, _provider text, _provider_reference text,
  _processor_fee numeric default 0, _settled_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p public.payments%rowtype;
  fee numeric;
begin
  if not public.is_platform_actor() then
    raise exception 'settle_payment is platform-only' using errcode = '42501';
  end if;
  select * into p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment % not found', _payment_id using errcode = 'P0002'; end if;

  if exists (select 1 from public.ledger_entries
              where provider = _provider and provider_reference = _provider_reference and entry_type = 'rent_payment') then
    return p.id; -- already settled: idempotent replay
  end if;

  fee := coalesce(p.platform_fee_amount, public.compute_platform_fee(p.amount, coalesce(p.method, 'ach')));

  update public.payments
     set status = 'paid', paid_at = coalesce(paid_at, _settled_at), verification_source = 'platform_settled',
         platform_fee_amount = fee, external_reference = coalesce(external_reference, _provider_reference),
         metadata = metadata || jsonb_build_object('provider', _provider, 'settled_at', _settled_at)
   where id = p.id;

  insert into public.ledger_entries (organization_id, tenancy_id, payment_id, entry_type, amount, provider, provider_reference, occurred_at)
  values (p.organization_id, p.tenancy_id, p.id, 'rent_payment', p.amount, _provider, _provider_reference, _settled_at);
  if fee > 0 then
    insert into public.ledger_entries (organization_id, tenancy_id, payment_id, entry_type, amount, provider, provider_reference, occurred_at)
    values (p.organization_id, p.tenancy_id, p.id, 'platform_fee', -fee, _provider, _provider_reference, _settled_at);
  end if;
  if coalesce(_processor_fee, 0) > 0 then
    insert into public.ledger_entries (organization_id, tenancy_id, payment_id, entry_type, amount, provider, provider_reference, occurred_at)
    values (p.organization_id, p.tenancy_id, p.id, 'processor_fee', -_processor_fee, _provider, _provider_reference, _settled_at);
  end if;

  insert into public.verification_records (organization_id, tenancy_id, payment_id, kind, source, record_type, label, subject_user_id)
  select p.organization_id, p.tenancy_id, p.id, 'payment', 'platform', 'payment_settled',
         'Rent payment settled via ' || _provider, t.tenant_user_id
    from public.tenancies t where t.id = p.tenancy_id;

  insert into public.audit_logs (organization_id, action, entity_type, entity_id, metadata)
  values (p.organization_id, 'payment.settled', 'payment', p.id,
          jsonb_build_object('provider', _provider, 'reference', _provider_reference, 'fee', fee));
  return p.id;
end $$;
revoke execute on function public.settle_payment(uuid, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.settle_payment(uuid, text, text, numeric, timestamptz) to service_role;

-- ------------------------------------------ return_payment (platform RPC)
create or replace function public.return_payment(
  _payment_id uuid, _provider text, _provider_reference text, _reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.payments%rowtype;
begin
  if not public.is_platform_actor() then
    raise exception 'return_payment is platform-only' using errcode = '42501';
  end if;
  select * into p from public.payments where id = _payment_id for update;
  if not found then raise exception 'payment % not found', _payment_id using errcode = 'P0002'; end if;
  if exists (select 1 from public.ledger_entries
              where provider = _provider and provider_reference = _provider_reference and entry_type = 'payment_return') then
    return p.id;
  end if;
  update public.payments
     set status = 'returned', verification_source = 'unverified',
         metadata = metadata || jsonb_build_object('return_reason', _reason, 'returned_by', _provider)
   where id = p.id;
  insert into public.ledger_entries (organization_id, tenancy_id, payment_id, entry_type, amount, provider, provider_reference, memo)
  values (p.organization_id, p.tenancy_id, p.id, 'payment_return', -p.amount, _provider, _provider_reference, _reason);
  insert into public.audit_logs (organization_id, action, entity_type, entity_id, metadata)
  values (p.organization_id, 'payment.returned', 'payment', p.id, jsonb_build_object('provider', _provider, 'reason', _reason));
  return p.id;
end $$;
revoke execute on function public.return_payment(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.return_payment(uuid, text, text, text) to service_role;
