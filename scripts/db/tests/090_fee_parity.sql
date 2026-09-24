-- The TypeScript fee module and compute_platform_fee() must agree cent for
-- cent. fees.test.ts proves TS matches a transcription of the SQL; this proves
-- the SQL itself, on a real Postgres, returns the numbers that transcription
-- predicts. Values chosen where naive float rounding diverges.
\set ON_ERROR_STOP on
begin;

do $$ begin
  -- 0.5% of rent, ACH: the ".x5 stored below the half" cases
  assert public.compute_platform_fee(1500, 'ach') = 7.50,  format('1500 ach → %s', public.compute_platform_fee(1500,'ach'));
  assert public.compute_platform_fee(1649, 'ach') = 8.25,  format('1649 ach → %s', public.compute_platform_fee(1649,'ach'));
  assert public.compute_platform_fee(427,  'ach') = 2.14,  format('427 ach → %s',  public.compute_platform_fee(427,'ach'));
  assert public.compute_platform_fee(1999, 'ach') = 10.00, format('1999 ach → %s', public.compute_platform_fee(1999,'ach'));
  assert public.compute_platform_fee(0,    'ach') = 0,     'zero is zero';

  -- card: platform fee + passed-through 2.9% + $0.30, each rounded once
  assert public.compute_platform_fee(1500, 'card') = 51.30, format('1500 card → %s', public.compute_platform_fee(1500,'card'));
  assert public.compute_platform_fee(1501, 'card') = 51.34, format('1501 card → %s', public.compute_platform_fee(1501,'card'));
  assert public.compute_platform_fee(1649, 'card') = 56.37, format('1649 card → %s', public.compute_platform_fee(1649,'card'));

  -- marketplace fee: 1% of rent on a RentID-sourced lease
  assert public.compute_marketplace_fee(1800) = 18.00, format('1800 → %s', public.compute_marketplace_fee(1800));
  assert public.compute_marketplace_fee(1649) = 16.49, format('1649 → %s', public.compute_marketplace_fee(1649));
end $$;

-- the cap the SQL used to ignore entirely
update public.platform_settings set platform_fee_cap = 25;
do $$ begin
  assert public.compute_platform_fee(10000, 'ach') = 25.00,
    format('capped ach → %s', public.compute_platform_fee(10000,'ach'));
  -- the cap applies to RentID's fee only; the card cost is still passed through
  assert public.compute_platform_fee(10000, 'card') = 25.00 + 290.30,
    format('capped card → %s', public.compute_platform_fee(10000,'card'));
end $$;

-- and the floor
update public.platform_settings set platform_fee_cap = null, platform_fee_minimum = 2.50;
do $$ begin
  assert public.compute_platform_fee(100, 'ach') = 2.50, 'floor applies below it';
  assert public.compute_platform_fee(1500, 'ach') = 7.50, 'floor does not apply above it';
end $$;

rollback;
