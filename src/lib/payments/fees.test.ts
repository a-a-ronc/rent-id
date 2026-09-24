import { describe, expect, it } from "vitest";

import type { Tables } from "@/integrations/supabase/types";
import {
  DEFAULT_FEE_SETTINGS,
  computeMarketplaceFee,
  computePlatformFee,
  feeSettingsFromRow,
  roundCents,
  type FeeSettings,
  type PaymentMethodForFees,
} from "@/lib/payments/fees";

/* -------------------------------------------------------------------------- */
/*  SQL oracle                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Exact replica of `public.compute_platform_fee(_amount numeric, _method text)`
 * as redefined in supabase/migrations/20260915000900_fee_parity_fix.sql (which
 * supersedes the original in 20260915000500_payments_foundation.sql).
 * No database connection is made — this is the formula, transcribed:
 *
 *   create or replace function public.compute_platform_fee(_amount numeric, _method text default 'ach')
 *   returns numeric language sql stable set search_path = public as $$
 *     with s as (select * from public.platform_settings where id)
 *     select round(
 *              case
 *                when (select platform_fee_cap from s) is null
 *                  then greatest(_amount * (select platform_fee_percentage from s) / 100.0,
 *                                (select platform_fee_minimum from s))
 *                else least(
 *                       greatest(_amount * (select platform_fee_percentage from s) / 100.0,
 *                                (select platform_fee_minimum from s)),
 *                       (select platform_fee_cap from s))
 *              end, 2)
 *          + case
 *              when _method = 'card' and (select card_fee_passthrough from s)
 *              then round(
 *                     _amount * (select card_fee_percentage from s) / 100.0
 *                     + (select card_fee_fixed from s), 2)
 *              else 0
 *            end
 *   $$;
 *
 * Three properties of that SQL matter and are reproduced faithfully below:
 *
 *  1. Postgres evaluates it in `numeric`, i.e. exact base-10 arithmetic with no
 *     binary-float error, and `round(x, 2)` is half-AWAY-FROM-ZERO. The operands
 *     here carry at most 4 decimal places (numeric(6,4) percentages) against
 *     amounts of at most 2, so every intermediate is exactly representable and
 *     Postgres' division scale never truncates. BigInt over scaled integers
 *     therefore models it exactly — the oracle carries no error of its own.
 *
 *  2. It rounds each component ONCE and adds the ROUNDED parts, matching
 *     `computePlatformFee` — a breakdown must add up to its own total.
 *
 *  3. It applies the floor (`platform_fee_minimum`) and, when one is set, the
 *     cap (`platform_fee_cap`) to the platform fee only, before rounding. A
 *     null cap means no cap. The card passthrough is never capped.
 *
 * `scripts/db/tests/090_fee_parity.sql` asserts the same numbers against a real
 * Postgres, so this oracle cannot silently drift from the deployed function.
 *
 * Seeded `platform_settings` row (migrations 20260903190926 + 20260915000500):
 * platform_fee_percentage 0.5000, platform_fee_minimum 0, platform_fee_cap NULL,
 * card_fee_percentage 2.9000, card_fee_fixed 0.30, card_fee_passthrough true.
 */
type SqlFeeSettings = {
  /** Decimal strings, so the oracle never rounds a float on the way in. */
  platformFeePercentage: string;
  platformFeeMinimum: string;
  /** null models SQL NULL — the `cap is null` branch, i.e. no cap at all. */
  platformFeeCap: string | null;
  cardFeePercentage: string;
  cardFeeFixed: string;
  cardFeePassthrough: boolean;
  marketplaceFeePercentage: string;
};

const SQL_SEEDED_SETTINGS: SqlFeeSettings = {
  platformFeePercentage: "0.5000",
  platformFeeMinimum: "0",
  platformFeeCap: null,
  cardFeePercentage: "2.9000",
  cardFeeFixed: "0.30",
  cardFeePassthrough: true,
  marketplaceFeePercentage: "1.0000",
};

/** Decimal string → integer scaled by 10^scale, exactly. */
function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const magnitude = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = magnitude.split(".");
  const padded = `${fraction}${"0".repeat(scale)}`.slice(0, scale);
  const scaled = BigInt(`${whole || "0"}${padded}`);
  return negative ? -scaled : scaled;
}

/**
 * Work in cents scaled by a further 1e6 so percentages (4 dp) divided by 100
 * stay exact: amount_cents * pct_scaled_1e4 has denominator 1e6 in cents.
 */
const DENOM = 1_000_000n;

/** Postgres `round(x, 2)` on a value carried as numerator/DENOM cents. */
function sqlRoundCents(numerator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (magnitude + DENOM / 2n) / DENOM; // half AWAY from zero
  return negative ? -rounded : rounded;
}

/**
 * `public.compute_platform_fee(_amount, _method)`, in dollars.
 * `amount` is a decimal STRING so the oracle never touches a float.
 */
function sqlComputePlatformFee(
  amount: string,
  method: string,
  settings: SqlFeeSettings = SQL_SEEDED_SETTINGS,
): number {
  const amountCents = toScaled(amount, 2);

  // greatest(amount * pct / 100, minimum)
  const base = amountCents * toScaled(settings.platformFeePercentage, 4);
  const minimum = toScaled(settings.platformFeeMinimum, 2) * DENOM;
  let platform = base > minimum ? base : minimum;

  // `case when cap is null then … else least(…, cap) end` — no cap when null.
  if (settings.platformFeeCap !== null) {
    const cap = toScaled(settings.platformFeeCap, 2) * DENOM;
    if (platform > cap) platform = cap;
  }

  const cardRaw =
    method === "card" && settings.cardFeePassthrough
      ? amountCents * toScaled(settings.cardFeePercentage, 4) +
        toScaled(settings.cardFeeFixed, 2) * DENOM
      : 0n;

  // Each component rounded once, then the ROUNDED parts are added.
  return Number(sqlRoundCents(platform) + sqlRoundCents(cardRaw)) / 100;
}

/**
 * `public.compute_marketplace_fee(_monthly_rent)`, added by the same migration:
 *
 *   select round(_monthly_rent * (select marketplace_fee_percentage
 *                                 from public.platform_settings where id) / 100.0, 2)
 */
function sqlComputeMarketplaceFee(
  monthlyRent: string,
  settings: SqlFeeSettings = SQL_SEEDED_SETTINGS,
): number {
  const raw = toScaled(monthlyRent, 2) * toScaled(settings.marketplaceFeePercentage, 4);
  return Number(sqlRoundCents(raw)) / 100;
}

/* -------------------------------------------------------------------------- */
/*  roundCents                                                                */
/* -------------------------------------------------------------------------- */

describe("roundCents", () => {
  it.each([
    ["exact half at the cent rounds up", 1.005, 1.01],
    ["half at the cent, small value", 0.005, 0.01],
    ["half at the cent, 1.015 (stored below .015 as a double)", 1.015, 1.02],
    ["half at the cent, 1.045", 1.045, 1.05],
    ["half at the cent, 2.675 (the classic float-drift example)", 2.675, 2.68],
    ["0.1 + 0.2 does not leak 0.30000000000000004", 0.1 + 0.2, 0.3],
    ["just under a half does NOT round up", 1.0049999, 1],
    ["already-exact values pass through", 7.5, 7.5],
    ["zero", 0, 0],
    ["large values keep their cents", 29_000.3, 29_000.3],
  ])("%s", (_label, input, expected) => {
    expect(roundCents(input)).toBe(expected);
  });

  /**
   * The regression this guards: `Math.round(value * 100) / 100` (and the
   * `+ Number.EPSILON` variant, since EPSILON is the ULP at 1.0 and therefore a
   * no-op above ~4) rounds 8.245 DOWN, because the double nearest 8.245 is
   * 8.2449999999999992… RentID would then bill a cent less than the ledger says
   * on 53 of the first 2,000 whole-dollar rents.
   */
  it.each([
    ["the fee on a $1,649 rent", 8.245, 8.25],
    ["the fee on a $427 rent", 2.135, 2.14],
    ["the fee on a $435 rent", 2.175, 2.18],
    ["the fee on a $1,999 rent", 9.995, 10],
  ])(
    "rounds half-AWAY-FROM-ZERO where the naive implementations round down: %s",
    (_label, input, expected) => {
      expect(roundCents(input)).toBe(expected);
      // These are the values whose double sits just BELOW the decimal half, so
      // both naive implementations round down. Pinning them means a
      // "simplification" back to either fails here, not in production billing.
      expect(Math.round(input * 100) / 100).not.toBe(expected);
      expect(Math.round((input + Number.EPSILON) * 100) / 100).not.toBe(expected);
    },
  );

  it.each([
    ["a four-figure half", 1000.005, 1000.01],
    ["a five-figure half", 12_345.675, 12_345.68],
    ["a sub-dollar half", 0.125, 0.13],
    ["a half whose double happens to sit above the boundary", 1234.565, 1234.57],
  ])(
    "also rounds half-up where the naive implementations happen to agree: %s",
    (_label, input, expected) => {
      // Not every ".xx5" is stored below its decimal value — these land above it
      // and round up either way. Included so the suite covers both directions.
      expect(roundCents(input)).toBe(expected);
    },
  );

  it("matches Postgres round(numeric, 2) on the exact decimal", () => {
    expect(roundCents(8.245)).toBe(sqlComputePlatformFee("1649", "ach"));
    expect(roundCents((1649 * 0.5) / 100)).toBe(8.25);
  });

  it.each([
    ["negative half rounds away from zero, not toward it", -1.005, -1.01],
    ["negative four-figure half", -8.245, -8.25],
    ["negative small half", -0.005, -0.01],
    ["negative classic", -2.675, -2.68],
    ["negative below the half stays put", -1.0049999, -1],
  ])("%s", (_label, input, expected) => {
    expect(roundCents(input)).toBe(expected);
  });

  it("is symmetric about zero", () => {
    for (const value of [1.005, 8.245, 2.675, 1234.565, 0.125]) {
      expect(roundCents(-value)).toBe(-roundCents(value));
    }
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("passes %s through untouched rather than coercing it to a number", (_label, input) => {
    expect(roundCents(input)).toBe(input);
  });

  it("is idempotent", () => {
    for (const value of [1.005, 8.245, 7.5, 0, 1234.565, -2.675]) {
      expect(roundCents(roundCents(value))).toBe(roundCents(value));
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  computePlatformFee                                                        */
/* -------------------------------------------------------------------------- */

const NON_CARD_METHODS: PaymentMethodForFees[] = [
  "ach",
  "same_day_ach",
  "rtp",
  "fednow",
  "check",
  "manual",
  "cash",
];

describe("computePlatformFee", () => {
  it("charges exactly 0.5% — $1,500 rent is a $7.50 platform fee", () => {
    const fee = computePlatformFee(1500, "ach");
    expect(fee.platformFee).toBe(7.5);
    expect(fee.cardFee).toBe(0);
    expect(fee.totalFees).toBe(7.5);
    expect(fee.tenantPays).toBe(1507.5);
    expect(fee.landlordReceives).toBe(1500);
  });

  it("defaults to ACH when no method is given", () => {
    expect(computePlatformFee(1500)).toEqual(computePlatformFee(1500, "ach"));
  });

  it.each(NON_CARD_METHODS)("adds no card fee for %s", (method) => {
    const fee = computePlatformFee(1500, method);
    expect(fee.cardFee).toBe(0);
    expect(fee.totalFees).toBe(fee.platformFee);
  });

  it("passes card cost through at 2.9% + $0.30", () => {
    const fee = computePlatformFee(1500, "card");
    expect(fee.platformFee).toBe(7.5);
    expect(fee.cardFee).toBe(43.8); // 1500 * 0.029 = 43.50, + 0.30
    expect(fee.totalFees).toBe(51.3);
    expect(fee.tenantPays).toBe(1551.3);
    // The landlord is made whole either way: the passthrough lands on the tenant.
    expect(fee.landlordReceives).toBe(1500);
  });

  it("does not add a card fee when passthrough is off", () => {
    const settings: FeeSettings = { ...DEFAULT_FEE_SETTINGS, cardFeePassthrough: false };
    const fee = computePlatformFee(1500, "card", settings);
    expect(fee.cardFee).toBe(0);
    expect(fee.totalFees).toBe(7.5);
  });

  it.each([
    [0, "ach"],
    [0.01, "ach"],
    [1, "card"],
    [950, "ach"],
    [1500, "card"],
    [2499.99, "ach"],
    [2499.99, "card"],
    [10_000, "card"],
  ] as const)("keeps the arithmetic self-consistent for $%s over %s", (amount, method) => {
    const fee = computePlatformFee(amount, method);
    expect(fee.amount).toBe(roundCents(amount));
    expect(fee.totalFees).toBe(roundCents(fee.platformFee + fee.cardFee));
    expect(fee.tenantPays).toBe(roundCents(amount + fee.totalFees));
    expect(fee.landlordReceives).toBe(roundCents(amount));
    // Fee allocation is "tenant": the spread between payer and payee IS the fee.
    expect(roundCents(fee.tenantPays - fee.landlordReceives)).toBe(fee.totalFees);
    expect(fee.platformFee).toBeGreaterThanOrEqual(0);
    expect(fee.cardFee).toBeGreaterThanOrEqual(0);
  });

  describe("minimum and cap", () => {
    const withMinimum: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeMinimum: 2.5 };
    const withCap: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeCap: 25 };

    it("raises a sub-minimum fee to the floor", () => {
      // 0.5% of $100 is $0.50, below the $2.50 floor.
      expect(computePlatformFee(100, "ach", withMinimum).platformFee).toBe(2.5);
    });

    it("leaves a fee already above the floor alone", () => {
      expect(computePlatformFee(1500, "ach", withMinimum).platformFee).toBe(7.5);
    });

    it("applies the floor even to a $0 amount", () => {
      const fee = computePlatformFee(0, "ach", withMinimum);
      expect(fee.platformFee).toBe(2.5);
      expect(fee.tenantPays).toBe(2.5);
    });

    it("caps a large fee", () => {
      // 0.5% of $10,000 is $50, capped to $25.
      expect(computePlatformFee(10_000, "ach", withCap).platformFee).toBe(25);
    });

    it("leaves a fee below the cap alone", () => {
      expect(computePlatformFee(1500, "ach", withCap).platformFee).toBe(7.5);
    });

    it("treats a null cap as no cap", () => {
      expect(computePlatformFee(1_000_000, "ach").platformFee).toBe(5000);
    });

    it("lets the cap win over the minimum when they conflict", () => {
      const conflicting: FeeSettings = {
        ...DEFAULT_FEE_SETTINGS,
        platformFeeMinimum: 5,
        platformFeeCap: 2,
      };
      expect(computePlatformFee(10, "ach", conflicting).platformFee).toBe(2);
    });

    it("does not cap the card passthrough, only the platform fee", () => {
      const fee = computePlatformFee(10_000, "card", withCap);
      expect(fee.platformFee).toBe(25);
      expect(fee.cardFee).toBe(290.3); // 10_000 * 0.029 + 0.30
    });
  });

  it.each([
    ["a negative amount", -1],
    ["a negative cent", -0.01],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("throws RangeError for %s", (_label, amount) => {
    expect(() => computePlatformFee(amount)).toThrow(RangeError);
    expect(() => computePlatformFee(amount)).toThrow("amount must be a non-negative number");
  });
});

/* -------------------------------------------------------------------------- */
/*  computeMarketplaceFee                                                     */
/* -------------------------------------------------------------------------- */

describe("computeMarketplaceFee", () => {
  it("charges 1% — $1,800 rent is an $18 marketplace fee", () => {
    expect(computeMarketplaceFee(1800)).toBe(18);
  });

  it.each([
    [0, 0],
    [1, 0.01],
    [1500, 15],
    [2450, 24.5],
    [3333.33, 33.33],
  ])("1%% of $%s is $%s", (rent, expected) => {
    expect(computeMarketplaceFee(rent)).toBe(expected);
  });

  it("honours a custom marketplace percentage", () => {
    const settings: FeeSettings = { ...DEFAULT_FEE_SETTINGS, marketplaceFeePercentage: 2.5 };
    expect(computeMarketplaceFee(1800, settings)).toBe(45);
  });

  it("ignores the platform minimum and cap (marketplace fee is a separate schedule)", () => {
    const settings: FeeSettings = {
      ...DEFAULT_FEE_SETTINGS,
      platformFeeMinimum: 500,
      platformFeeCap: 1,
    };
    expect(computeMarketplaceFee(1800, settings)).toBe(18);
  });

  it.each([
    ["a negative rent", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("throws RangeError for %s", (_label, rent) => {
    expect(() => computeMarketplaceFee(rent)).toThrow(RangeError);
    expect(() => computeMarketplaceFee(rent)).toThrow("monthlyRent must be a non-negative number");
  });
});

/* -------------------------------------------------------------------------- */
/*  feeSettingsFromRow                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Postgres `numeric` columns arrive over PostgREST as JSON STRINGS, but the
 * generated types in src/integrations/supabase/types.ts declare them `number`.
 * That mismatch is the whole reason `feeSettingsFromRow` coerces with Number().
 */
const pgNumeric = (value: string): number => value as unknown as number;

describe("feeSettingsFromRow", () => {
  it("coerces the numeric strings Postgres actually sends", () => {
    const row: Tables<"platform_settings"> = {
      id: true,
      platform_fee_percentage: pgNumeric("0.5000"),
      platform_fee_cap: pgNumeric("25.00"),
      platform_fee_minimum: pgNumeric("1.50"),
      card_fee_percentage: pgNumeric("2.9000"),
      card_fee_fixed: pgNumeric("0.30"),
      card_fee_passthrough: false,
      marketplace_fee_percentage: pgNumeric("1.0000"),
      fee_allocation: "tenant",
      updated_at: "2026-09-15T00:00:00.000Z",
    };

    expect(feeSettingsFromRow(row)).toEqual({
      platformFeePercentage: 0.5,
      platformFeeMinimum: 1.5,
      platformFeeCap: 25,
      cardFeePercentage: 2.9,
      cardFeeFixed: 0.3,
      cardFeePassthrough: false,
      marketplaceFeePercentage: 1,
    } satisfies FeeSettings);
  });

  it("feeds straight back into computePlatformFee", () => {
    const settings = feeSettingsFromRow({
      platform_fee_percentage: pgNumeric("0.5000"),
      platform_fee_cap: null,
    });
    expect(computePlatformFee(1500, "ach", settings).platformFee).toBe(7.5);
  });

  it("falls back to the defaults for every optional column left null", () => {
    expect(
      feeSettingsFromRow({
        platform_fee_percentage: 0.5,
        platform_fee_cap: null,
        platform_fee_minimum: null,
        card_fee_percentage: null,
        card_fee_fixed: null,
        card_fee_passthrough: null,
        marketplace_fee_percentage: null,
      }),
    ).toEqual(DEFAULT_FEE_SETTINGS);
  });

  it("falls back to the defaults for every optional column left absent", () => {
    expect(feeSettingsFromRow({ platform_fee_percentage: 0.5, platform_fee_cap: null })).toEqual(
      DEFAULT_FEE_SETTINGS,
    );
  });

  it("keeps a null cap null rather than coercing it to 0", () => {
    // Number(null) is 0, which would silently cap every fee at zero.
    expect(
      feeSettingsFromRow({ platform_fee_percentage: 0.5, platform_fee_cap: null }).platformFeeCap,
    ).toBeNull();
  });

  it("distinguishes an explicit zero cap from no cap", () => {
    const zeroCap = feeSettingsFromRow({
      platform_fee_percentage: 0.5,
      platform_fee_cap: pgNumeric("0.00"),
    });
    expect(zeroCap.platformFeeCap).toBe(0);
    expect(computePlatformFee(1500, "ach", zeroCap).platformFee).toBe(0);
  });

  it("respects card_fee_passthrough: false but not null", () => {
    expect(
      feeSettingsFromRow({
        platform_fee_percentage: 0.5,
        platform_fee_cap: null,
        card_fee_passthrough: false,
      }).cardFeePassthrough,
    ).toBe(false);
    expect(
      feeSettingsFromRow({
        platform_fee_percentage: 0.5,
        platform_fee_cap: null,
        card_fee_passthrough: null,
      }).cardFeePassthrough,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  TS ↔ SQL parity                                                            */
/* -------------------------------------------------------------------------- */

describe("agrees with public.compute_platform_fee()", () => {
  it.each([
    ["1500", "ach", 7.5],
    ["1500", "card", 51.3],
    ["1500", "check", 7.5],
    ["0", "ach", 0],
    ["0", "card", 0.3],
    ["1", "ach", 0.01],
    ["950", "ach", 4.75],
    ["1200", "ach", 6],
    ["1800", "ach", 9],
    ["2000", "card", 68.3],
    ["1499", "card", 51.27],
    ["1650", "ach", 8.25],
    ["1650", "card", 56.4],
    ["1234.56", "ach", 6.17],
  ])("$%s over %s is $%s in both", (amount, method, expected) => {
    expect(sqlComputePlatformFee(amount, method)).toBe(expected);
    expect(computePlatformFee(Number(amount), method as PaymentMethodForFees).totalFees).toBe(
      expected,
    );
  });

  it("agrees on an unknown method (both treat anything but 'card' as no passthrough)", () => {
    expect(sqlComputePlatformFee("1500", "wire_transfer")).toBe(7.5);
    expect(computePlatformFee(1500, "manual").totalFees).toBe(7.5);
  });

  it.each(["ach", "card"] as const)(
    "matches SQL on EVERY whole-dollar rent $1–$2,000 over %s",
    (method) => {
      const diverging: Array<{ dollars: number; ts: number; sql: number }> = [];
      for (let dollars = 1; dollars <= 2000; dollars += 1) {
        const ts = computePlatformFee(dollars, method).totalFees;
        const sql = sqlComputePlatformFee(String(dollars), method);
        if (ts !== sql) diverging.push({ dollars, ts, sql });
      }
      expect(diverging).toEqual([]);
    },
  );

  it("matches SQL at cent granularity, where the rounding boundaries actually live", () => {
    const diverging: Array<{ amount: string; method: string; ts: number; sql: number }> = [];
    // Step by a prime number of cents so the sweep lands on .x5 boundaries in
    // every residue class rather than only on round dollars.
    for (let cents = 1; cents <= 400_000; cents += 7) {
      const amount = (cents / 100).toFixed(2);
      for (const method of ["ach", "card"] as const) {
        const ts = computePlatformFee(Number(amount), method).totalFees;
        const sql = sqlComputePlatformFee(amount, method);
        if (ts !== sql) diverging.push({ amount, method, ts, sql });
      }
    }
    expect(diverging).toEqual([]);
  });

  it("matches SQL on the amounts that used to diverge before the parity fix", () => {
    // The old `roundCents` billed a cent light on these ACH rents...
    for (const dollars of [427, 435, 477, 485, 803, 1003, 1649, 1999]) {
      expect(computePlatformFee(dollars, "ach").totalFees).toBe(
        sqlComputePlatformFee(String(dollars), "ach"),
      );
    }
    expect(computePlatformFee(1649, "ach").totalFees).toBe(8.25);
    expect(computePlatformFee(427, "ach").totalFees).toBe(2.14);

    // ...and the old SQL rounded the card sum once instead of per component.
    expect(computePlatformFee(1501, "card").totalFees).toBe(51.34);
    expect(sqlComputePlatformFee("1501", "card")).toBe(51.34);
    expect(computePlatformFee(1649, "card").totalFees).toBe(56.37);
    expect(sqlComputePlatformFee("1649", "card")).toBe(56.37);
  });

  it("adds the ROUNDED components, so the breakdown adds up to its own total", () => {
    // This is the convention both sides now share: round each part once, then
    // sum. Re-rounding the raw sum would reintroduce the card divergence.
    //
    // Compared in whole cents: `7.51 + 43.83` is 51.339999999999996 as a float,
    // so `totalFees` re-rounds the sum to kill that drift. What must hold is
    // that the parts and the total agree to the cent.
    const cents = (dollars: number) => Math.round(dollars * 100);
    for (const dollars of [1, 1401, 1501, 1649, 2000]) {
      const fee = computePlatformFee(dollars, "card");
      expect(cents(fee.platformFee) + cents(fee.cardFee)).toBe(cents(fee.totalFees));
      expect(fee.totalFees).toBe(sqlComputePlatformFee(String(dollars), "card"));
    }
  });

  describe("with a cap configured", () => {
    const capped: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeCap: 25 };
    const sqlCapped: SqlFeeSettings = { ...SQL_SEEDED_SETTINGS, platformFeeCap: "25.00" };

    it("caps the platform fee identically on both sides", () => {
      expect(computePlatformFee(10_000, "ach", capped).totalFees).toBe(25);
      expect(sqlComputePlatformFee("10000", "ach", sqlCapped)).toBe(25);
    });

    it("caps the platform fee but not the card passthrough, on both sides", () => {
      const fee = computePlatformFee(10_000, "card", capped);
      expect(fee.platformFee).toBe(25);
      expect(fee.cardFee).toBe(290.3); // 10_000 * 0.029 + 0.30, uncapped
      expect(fee.totalFees).toBe(315.3);
      expect(sqlComputePlatformFee("10000", "card", sqlCapped)).toBe(315.3);
    });

    it("agrees across the whole range, above and below the cap", () => {
      const diverging: number[] = [];
      for (let dollars = 1; dollars <= 20_000; dollars += 3) {
        for (const method of ["ach", "card"] as const) {
          if (
            computePlatformFee(dollars, method, capped).totalFees !==
            sqlComputePlatformFee(String(dollars), method, sqlCapped)
          ) {
            diverging.push(dollars);
          }
        }
      }
      expect(diverging).toEqual([]);
    });

    it("leaves an uncapped (null) cap uncapped on both sides", () => {
      expect(computePlatformFee(10_000, "ach").totalFees).toBe(50);
      expect(sqlComputePlatformFee("10000", "ach")).toBe(50);
    });
  });

  it("agrees when a minimum is configured", () => {
    const withMinimum: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeMinimum: 2.5 };
    const sqlSettings: SqlFeeSettings = { ...SQL_SEEDED_SETTINGS, platformFeeMinimum: "2.50" };
    const diverging: number[] = [];
    for (let dollars = 0; dollars <= 2000; dollars += 1) {
      for (const method of ["ach", "card"] as const) {
        if (
          computePlatformFee(dollars, method, withMinimum).totalFees !==
          sqlComputePlatformFee(String(dollars), method, sqlSettings)
        ) {
          diverging.push(dollars);
        }
      }
    }
    expect(diverging).toEqual([]);
  });

  /**
   * These are exactly the assertions in scripts/db/tests/090_fee_parity.sql,
   * which runs against a real Postgres in CI. Keeping the same numbers here
   * means the TS module, this oracle and the deployed function are pinned to
   * one set of values — if the DB test is ever changed, this fails too.
   */
  it.each([
    ["1500", "ach", 7.5],
    ["1649", "ach", 8.25],
    ["427", "ach", 2.14],
    ["1999", "ach", 10],
    ["0", "ach", 0],
    ["1500", "card", 51.3],
    ["1501", "card", 51.34],
    ["1649", "card", 56.37],
  ])("matches 090_fee_parity.sql: %s over %s is %s", (amount, method, expected) => {
    expect(computePlatformFee(Number(amount), method as PaymentMethodForFees).totalFees).toBe(
      expected,
    );
    expect(sqlComputePlatformFee(amount, method)).toBe(expected);
  });

  it("matches 090_fee_parity.sql on the cap and floor cases", () => {
    const capped: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeCap: 25 };
    expect(computePlatformFee(10_000, "ach", capped).totalFees).toBe(25);
    expect(computePlatformFee(10_000, "card", capped).totalFees).toBe(25 + 290.3);

    const floored: FeeSettings = { ...DEFAULT_FEE_SETTINGS, platformFeeMinimum: 2.5 };
    expect(computePlatformFee(100, "ach", floored).totalFees).toBe(2.5);
    expect(computePlatformFee(1500, "ach", floored).totalFees).toBe(7.5);
  });

  it("agrees when the floor and the cap are both set and the cap wins", () => {
    const conflicting: FeeSettings = {
      ...DEFAULT_FEE_SETTINGS,
      platformFeeMinimum: 5,
      platformFeeCap: 2,
    };
    const sqlConflicting: SqlFeeSettings = {
      ...SQL_SEEDED_SETTINGS,
      platformFeeMinimum: "5.00",
      platformFeeCap: "2.00",
    };
    for (const dollars of [0, 10, 1000, 10_000]) {
      expect(computePlatformFee(dollars, "ach", conflicting).platformFee).toBe(2);
      expect(sqlComputePlatformFee(String(dollars), "ach", sqlConflicting)).toBe(2);
    }
  });
});

describe("agrees with public.compute_marketplace_fee()", () => {
  it("charges 1% on both sides — $1,800 rent is $18", () => {
    expect(computeMarketplaceFee(1800)).toBe(18);
    expect(sqlComputeMarketplaceFee("1800")).toBe(18);
  });

  it("matches SQL on every whole-dollar rent $0–$5,000", () => {
    const diverging: number[] = [];
    for (let dollars = 0; dollars <= 5000; dollars += 1) {
      if (computeMarketplaceFee(dollars) !== sqlComputeMarketplaceFee(String(dollars))) {
        diverging.push(dollars);
      }
    }
    expect(diverging).toEqual([]);
  });

  it("matches SQL at cent granularity", () => {
    const diverging: string[] = [];
    for (let cents = 1; cents <= 400_000; cents += 7) {
      const amount = (cents / 100).toFixed(2);
      if (computeMarketplaceFee(Number(amount)) !== sqlComputeMarketplaceFee(amount)) {
        diverging.push(amount);
      }
    }
    expect(diverging).toEqual([]);
  });

  it("agrees on a custom marketplace percentage", () => {
    const settings: FeeSettings = { ...DEFAULT_FEE_SETTINGS, marketplaceFeePercentage: 2.5 };
    const sqlSettings: SqlFeeSettings = {
      ...SQL_SEEDED_SETTINGS,
      marketplaceFeePercentage: "2.5000",
    };
    for (const dollars of [0, 1, 1800, 1649, 5000]) {
      expect(computeMarketplaceFee(dollars, settings)).toBe(
        sqlComputeMarketplaceFee(String(dollars), sqlSettings),
      );
    }
  });
});
