/**
 * RentID fee schedule — pure functions, no I/O.
 *
 * Mirrors `public.compute_platform_fee()`, whose authoritative definition is in
 * supabase/migrations/20260915000900_fee_parity_fix.sql, so SQL reports and the
 * UI agree by construction. src/lib/payments/fees.test.ts asserts that parity;
 * scripts/db/tests/090_fee_parity.sql asserts it against a real Postgres. Defaults match the seeded `platform_settings`
 * row; pass the live row when you have it.
 *
 *   ACH  $1,500 rent → $7.50 platform fee (0.5%)
 *   Card $1,500 rent → $7.50 + 2.9% + $0.30 = $51.30 (card cost passed through)
 */
export type PaymentMethodForFees =
  "ach" | "same_day_ach" | "rtp" | "fednow" | "card" | "check" | "manual" | "cash";

export type FeeSettings = {
  /** Percent of rent, e.g. 0.5 for 0.5% */
  platformFeePercentage: number;
  /** Absolute floor on the platform fee, in dollars */
  platformFeeMinimum: number;
  /** Optional cap on the platform fee, in dollars (null = no cap) */
  platformFeeCap: number | null;
  cardFeePercentage: number;
  cardFeeFixed: number;
  cardFeePassthrough: boolean;
  /** Percent of rent on RentID-sourced leases (marketplace fee) */
  marketplaceFeePercentage: number;
};

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  platformFeePercentage: 0.5,
  platformFeeMinimum: 0,
  platformFeeCap: null,
  cardFeePercentage: 2.9,
  cardFeeFixed: 0.3,
  cardFeePassthrough: true,
  marketplaceFeePercentage: 1.0,
};

/**
 * Round half-away-from-zero to cents, matching Postgres `round(numeric, 2)`.
 *
 * The obvious `Math.round(value * 100) / 100` is wrong for money: `8.245`
 * is stored as 8.244999999999999 and rounds DOWN, so RentID would bill a cent
 * less than the ledger says on 53 of the first 2,000 whole-dollar rents
 * ($427, $435, …, $1,649, …). Adding `Number.EPSILON` does not fix it either —
 * EPSILON is the ULP at 1.0, so it is a no-op above ~4.
 *
 * Instead compare against the exact decimal via the shortest round-trip string
 * (`toPrecision(15)` strips the representation error without inventing digits),
 * then round the integer cents.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const cents = Math.abs(value) * 100;
  // 15 significant digits is the widest decimal a double round-trips exactly,
  // so this recovers the decimal the author wrote rather than its binary echo.
  const exact = Number.parseFloat(cents.toPrecision(15));
  return (sign * Math.round(exact)) / 100;
}

export type FeeBreakdown = {
  amount: number;
  platformFee: number;
  cardFee: number;
  totalFees: number;
  /** What the payer is charged when fees are allocated to the tenant. */
  tenantPays: number;
  /** What the landlord receives when fees are allocated to the tenant. */
  landlordReceives: number;
};

export function computePlatformFee(
  amount: number,
  method: PaymentMethodForFees = "ach",
  settings: FeeSettings = DEFAULT_FEE_SETTINGS,
): FeeBreakdown {
  if (!Number.isFinite(amount) || amount < 0)
    throw new RangeError("amount must be a non-negative number");

  // Each component is rounded once, and `totalFees` is the sum of the rounded
  // parts — NOT a re-rounded sum. `compute_platform_fee()` in SQL rounds the
  // same way (see the parity table in fees.test.ts): a breakdown whose parts
  // don't add up to its own total is a support ticket waiting to happen.
  let rawPlatformFee = Math.max(
    (amount * settings.platformFeePercentage) / 100,
    settings.platformFeeMinimum,
  );
  if (settings.platformFeeCap !== null)
    rawPlatformFee = Math.min(rawPlatformFee, settings.platformFeeCap);
  const platformFee = roundCents(rawPlatformFee);

  const cardFee =
    method === "card" && settings.cardFeePassthrough
      ? roundCents((amount * settings.cardFeePercentage) / 100 + settings.cardFeeFixed)
      : 0;

  const totalFees = roundCents(platformFee + cardFee);
  return {
    amount: roundCents(amount),
    platformFee,
    cardFee,
    totalFees,
    tenantPays: roundCents(amount + totalFees),
    landlordReceives: roundCents(amount),
  };
}

export function computeMarketplaceFee(
  monthlyRent: number,
  settings: FeeSettings = DEFAULT_FEE_SETTINGS,
): number {
  if (!Number.isFinite(monthlyRent) || monthlyRent < 0)
    throw new RangeError("monthlyRent must be a non-negative number");
  return roundCents((monthlyRent * settings.marketplaceFeePercentage) / 100);
}

/** Map a `platform_settings` row (snake_case, numeric strings allowed) to FeeSettings. */
export function feeSettingsFromRow(row: {
  platform_fee_percentage: number | string;
  platform_fee_cap: number | string | null;
  platform_fee_minimum?: number | string | null;
  card_fee_percentage?: number | string | null;
  card_fee_fixed?: number | string | null;
  card_fee_passthrough?: boolean | null;
  marketplace_fee_percentage?: number | string | null;
}): FeeSettings {
  const n = (v: number | string | null | undefined, fallback: number) =>
    v === null || v === undefined ? fallback : Number(v);
  return {
    platformFeePercentage: n(
      row.platform_fee_percentage,
      DEFAULT_FEE_SETTINGS.platformFeePercentage,
    ),
    platformFeeMinimum: n(row.platform_fee_minimum, DEFAULT_FEE_SETTINGS.platformFeeMinimum),
    platformFeeCap:
      row.platform_fee_cap === null || row.platform_fee_cap === undefined
        ? null
        : Number(row.platform_fee_cap),
    cardFeePercentage: n(row.card_fee_percentage, DEFAULT_FEE_SETTINGS.cardFeePercentage),
    cardFeeFixed: n(row.card_fee_fixed, DEFAULT_FEE_SETTINGS.cardFeeFixed),
    cardFeePassthrough: row.card_fee_passthrough ?? DEFAULT_FEE_SETTINGS.cardFeePassthrough,
    marketplaceFeePercentage: n(
      row.marketplace_fee_percentage,
      DEFAULT_FEE_SETTINGS.marketplaceFeePercentage,
    ),
  };
}
