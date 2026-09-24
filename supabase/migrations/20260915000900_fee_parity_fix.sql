-- =====================================================================
-- Forward migration — make compute_platform_fee() agree with the TypeScript
-- fee module, cent for cent.
--
-- Two divergences were found by the SQL-parity test in
-- src/lib/payments/fees.test.ts, both of which would have produced a fee the
-- UI quoted and the ledger disagreed with:
--
--   1. The SQL ignored `platform_settings.platform_fee_cap`. The column has
--      existed since the first migration and the TS module honours it, so the
--      day an admin sets a cap the two would differ by the whole uncapped
--      remainder (cap $25 on a $10,000 payment: $25 in the app, $50 in SQL).
--   2. The SQL rounded the platform fee and the card fee as one sum; the TS
--      module rounds each component, because the UI shows the components. On
--      553 of the first 2,000 whole-dollar card rents the two differed by a
--      cent in one direction or the other.
--
-- This version rounds each component once and adds the rounded parts, which is
-- what a customer sees on a receipt, and applies the floor and the cap.
-- =====================================================================

create or replace function public.compute_platform_fee(_amount numeric, _method text default 'ach')
returns numeric language sql stable set search_path = public as $$
  with s as (select * from public.platform_settings where id)
  select round(
           -- platform fee: percentage, floored by the minimum, capped when set
           case
             when (select platform_fee_cap from s) is null
               then greatest(_amount * (select platform_fee_percentage from s) / 100.0,
                             (select platform_fee_minimum from s))
             else least(
                    greatest(_amount * (select platform_fee_percentage from s) / 100.0,
                             (select platform_fee_minimum from s)),
                    (select platform_fee_cap from s))
           end, 2)
       + case
           when _method = 'card' and (select card_fee_passthrough from s)
           then round(
                  _amount * (select card_fee_percentage from s) / 100.0
                  + (select card_fee_fixed from s), 2)
           else 0
         end
$$;

comment on function public.compute_platform_fee(numeric, text) is
  'Platform fee for one payment. Mirrors computePlatformFee() in src/lib/payments/fees.ts — each component rounded once, then summed. Change both together; src/lib/payments/fees.test.ts asserts parity.';

-- The marketplace fee (1% of rent on a RentID-sourced lease) is a separate
-- line from the payment fee; expose it here so reporting SQL cannot drift
-- from computeMarketplaceFee() either.
create or replace function public.compute_marketplace_fee(_monthly_rent numeric)
returns numeric language sql stable set search_path = public as $$
  select round(_monthly_rent * (select marketplace_fee_percentage from public.platform_settings where id) / 100.0, 2)
$$;
grant execute on function public.compute_marketplace_fee(numeric) to authenticated, service_role;
