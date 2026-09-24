import { afterEach, describe, expect, it, vi } from "vitest";

import {
  daysUntil,
  fullDate,
  greeting,
  initials,
  money,
  monthLabel,
  shortDate,
} from "@/lib/format";

/** U+2014 EM DASH — the "no value" placeholder the date helpers return. */
const EM_DASH = "—";
/** U+00B7 MIDDLE DOT ×2 — the avatar placeholder `initials` returns. */
const MIDDLE_DOTS = "··";

/**
 * vitest.config.ts pins TZ=America/Denver and src/test/setup.ts fails the run if
 * that did not take, so every local-time assertion below is deterministic.
 */

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/*  money                                                                     */
/* -------------------------------------------------------------------------- */

describe("money", () => {
  it.each([
    ["null becomes $0", null, "$0"],
    ["undefined becomes $0", undefined, "$0"],
    ["zero", 0, "$0"],
    ["whole dollars", 1500, "$1,500"],
    ["thousands separator", 1_234_567, "$1,234,567"],
    ["cents are dropped by default", 1234.56, "$1,235"],
    ["negatives keep the sign outside the symbol", -1500, "-$1,500"],
  ])("%s", (_label, input, expected) => {
    expect(money(input)).toBe(expected);
  });

  it.each([
    ["null", null, "$0.00"],
    ["undefined", undefined, "$0.00"],
    ["a round figure still shows .00", 1500, "$1,500.00"],
    ["real cents", 1234.56, "$1,234.56"],
    ["a single trailing digit is padded", 1234.5, "$1,234.50"],
    ["the platform fee on $1,500 rent", 7.5, "$7.50"],
    ["a card passthrough", 51.3, "$51.30"],
    ["negatives", -5.5, "-$5.50"],
  ])("with cents: %s", (_label, input, expected) => {
    expect(money(input, { cents: true })).toBe(expected);
  });

  it("rounds half away from zero when cents are hidden", () => {
    expect(money(0.5)).toBe("$1");
    expect(money(1.5)).toBe("$2");
    expect(money(2.5)).toBe("$3"); // not banker's rounding
    expect(money(0.4)).toBe("$0");
  });

  it("rounds to the cent when cents are shown", () => {
    expect(money(1.005, { cents: true })).toBe("$1.01");
    expect(money(0.129, { cents: true })).toBe("$0.13");
  });

  it("treats `{ cents: false }` the same as omitting the option", () => {
    expect(money(1234.56, { cents: false })).toBe(money(1234.56));
  });

  /**
   * A bare `Number(value ?? 0)` only guards null and undefined, and would render
   * the literal string "$NaN" (or "$∞") into a rent figure. NaN is exactly what
   * an upstream `Number("")` or a malformed Postgres numeric produces, so every
   * non-finite input has to land on the same $0 fallback as null.
   */
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("falls back to $0 for %s rather than rendering it", (_label, input) => {
    expect(money(input)).toBe("$0");
    expect(money(input, { cents: true })).toBe("$0.00");
  });

  it("gives non-finite input the same output as null", () => {
    expect(money(Number.NaN)).toBe(money(null));
    expect(money(Number.POSITIVE_INFINITY, { cents: true })).toBe(money(null, { cents: true }));
  });
});

/* -------------------------------------------------------------------------- */
/*  shortDate / fullDate                                                      */
/* -------------------------------------------------------------------------- */

describe("shortDate", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a non-date string", "not-a-date"],
    ["a ten-character non-date (same length as a date)", "abcdefghij"],
    ["a plausible-looking impossible date", "2026-13-45"],
  ])("returns an em dash for %s", (_label, input) => {
    expect(shortDate(input)).toBe(EM_DASH);
  });

  it("renders a date-only string as that calendar day", () => {
    expect(shortDate("2026-09-01")).toBe("Sep 1");
    expect(shortDate("2026-12-25")).toBe("Dec 25");
  });

  /**
   * The regression this guards: `new Date("2026-09-01")` is parsed as UTC
   * midnight, which is Aug 31 in every zone behind UTC. format.ts appends
   * "T00:00:00" so the string is parsed as LOCAL midnight instead. Under
   * TZ=America/Denver the two spellings visibly disagree, which is the whole
   * reason the test run pins that zone.
   */
  it("does NOT shift a date-only string back a day", () => {
    const naivelyParsed = new Date("2026-09-01").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    expect(naivelyParsed).toBe("Aug 31"); // what the bug would render
    expect(shortDate("2026-09-01")).toBe("Sep 1"); // what format.ts renders
    expect(shortDate("2026-09-01")).not.toBe(naivelyParsed);
  });

  it("does not shift a date-only string across a year boundary either", () => {
    expect(shortDate("2026-01-01")).toBe("Jan 1");
    expect(fullDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("renders a full timestamp in local time, which CAN be the previous day", () => {
    // 2026-09-01T02:00Z is 2026-08-31 20:00 in Denver. This is correct: a
    // timestamp is an instant, and the instant really did fall on Aug 31 locally.
    expect(shortDate("2026-09-01T02:00:00Z")).toBe("Aug 31");
    expect(shortDate("2026-09-01T12:00:00Z")).toBe("Sep 1");
  });

  it("accepts a timestamp without a zone as local time", () => {
    expect(shortDate("2026-09-01T00:30:00")).toBe("Sep 1");
  });

  it("never pads the day number", () => {
    expect(shortDate("2026-09-05")).toBe("Sep 5");
  });
});

describe("fullDate", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a non-date string", "nope"],
  ])("returns an em dash for %s", (_label, input) => {
    expect(fullDate(input)).toBe(EM_DASH);
  });

  it.each([
    ["2026-09-01", "Sep 1, 2026"],
    ["2027-08-31", "Aug 31, 2027"],
    ["2026-01-31", "Jan 31, 2026"],
  ])("renders %s as %s", (input, expected) => {
    expect(fullDate(input)).toBe(expected);
  });

  it("adds the year that shortDate omits, for the same input", () => {
    expect(fullDate("2026-09-01")).toBe(`${shortDate("2026-09-01")}, 2026`);
  });

  it("does not shift a lease end date back a day", () => {
    expect(fullDate("2027-08-31")).toBe("Aug 31, 2027");
  });

  it("renders a full timestamp in local time, like shortDate does", () => {
    // 2027-01-01T02:00Z is 2026-12-31 19:00 in Denver — including the year.
    expect(fullDate("2027-01-01T02:00:00Z")).toBe("Dec 31, 2026");
    expect(fullDate("2026-09-01T12:00:00Z")).toBe("Sep 1, 2026");
  });
});

/* -------------------------------------------------------------------------- */
/*  monthLabel                                                                */
/* -------------------------------------------------------------------------- */

describe("monthLabel", () => {
  it.each([
    [new Date(2026, 0, 1), "January 2026"],
    [new Date(2026, 8, 15), "September 2026"],
    [new Date(2026, 11, 31), "December 2026"],
  ])("labels %s", (date, expected) => {
    expect(monthLabel(date)).toBe(expected);
  });

  it("defaults to the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
    expect(monthLabel()).toBe("September 2026");
  });

  it("spells the month out, unlike shortDate", () => {
    expect(monthLabel(new Date(2026, 8, 1))).toContain("September");
  });
});

/* -------------------------------------------------------------------------- */
/*  initials                                                                  */
/* -------------------------------------------------------------------------- */

describe("initials", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("returns the middle-dot placeholder for %s", (_label, input) => {
    expect(initials(input)).toBe(MIDDLE_DOTS);
  });

  it.each([
    ["two names", "Aaron Cena", "AC"],
    ["a single name", "madonna", "M"],
    ["already uppercase", "AARON CENA", "AC"],
    ["three or more names take only the first two", "Mary Jane Watson", "MJ"],
    ["extra whitespace is ignored", "  Aaron   Cena  ", "AC"],
    ["a hyphenated given name counts as one token", "Jean-Luc Picard", "JP"],
    ["non-ASCII letters uppercase correctly", "ñoño test", "ÑT"],
    ["a leading title still counts as a name part", "Dr Reyes", "DR"],
  ])("%s → %s", (_label, input, expected) => {
    expect(initials(input)).toBe(expected);
  });

  it("always returns at most two characters for ASCII names", () => {
    for (const name of ["Aaron Cena", "madonna", "a b c d e f", "Mary Jane Watson"]) {
      expect(initials(name).length).toBeLessThanOrEqual(2);
    }
  });

  /**
   * A guard of `!name` alone would miss a whitespace-only name — what a
   * trimmed-to-nothing profile field looks like — and the avatar would render
   * blank, or worse, a raw control character. Every blank shape must reach the
   * same placeholder.
   */
  it.each([
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
    ["a non-breaking-free mix of whitespace", " \t \n "],
  ])("returns the placeholder for a whitespace-only name: %s", (_label, input) => {
    expect(initials(input)).toBe(MIDDLE_DOTS);
  });

  it.each([
    ["a tab separator", "Aaron\tCena"],
    ["a newline separator", "Aaron\nCena"],
    ["mixed whitespace", "Aaron \t Cena"],
  ])("splits on any whitespace, not just the literal space: %s", (_label, input) => {
    expect(initials(input)).toBe("AC");
  });

  it("never returns a control character", () => {
    for (const name of ["\t\n", "   ", "Aaron\tCena", "\tAaron"]) {
      const codePoints = [...initials(name)].map((char) => char.codePointAt(0) ?? 0);
      expect(codePoints.every((code) => code > 0x1f)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  greeting                                                                  */
/* -------------------------------------------------------------------------- */

describe("greeting", () => {
  /** Freeze LOCAL wall-clock time; the helper reads getHours(), not UTC hours. */
  const atLocalHour = (hour: number, minute = 0) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, hour, minute, 0));
  };

  it.each([
    [0, "Good morning"],
    [6, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [15, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [23, "Good evening"],
  ])("at %s:00 local it says %s", (hour, expected) => {
    atLocalHour(hour);
    expect(greeting()).toBe(expected);
  });

  it("flips exactly on the hour, not the minute before", () => {
    atLocalHour(11, 59);
    expect(greeting()).toBe("Good morning");
    atLocalHour(12, 0);
    expect(greeting()).toBe("Good afternoon");
    atLocalHour(17, 59);
    expect(greeting()).toBe("Good afternoon");
    atLocalHour(18, 0);
    expect(greeting()).toBe("Good evening");
  });

  it("appends the first name only", () => {
    atLocalHour(9);
    expect(greeting("Aaron Cena")).toBe("Good morning, Aaron");
    expect(greeting("Mary Jane Watson")).toBe("Good morning, Mary");
    expect(greeting("madonna")).toBe("Good morning, madonna");
  });

  it("preserves the name's own casing", () => {
    atLocalHour(9);
    expect(greeting("aaron cena")).toBe("Good morning, aaron");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a leading space (so the first token is empty)", " Aaron"],
  ])("drops the comma entirely for %s", (_label, name) => {
    atLocalHour(9);
    expect(greeting(name)).toBe("Good morning");
  });
});

/* -------------------------------------------------------------------------- */
/*  daysUntil                                                                 */
/* -------------------------------------------------------------------------- */

describe("daysUntil", () => {
  /** Freeze at LOCAL midnight so whole-day differences are exact. */
  const atLocalMidnight = (year: number, monthIndex: number, day: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, monthIndex, day, 0, 0, 0));
  };

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["a non-date string", "zzzzzzzzzz"],
  ])("returns null for %s", (_label, input) => {
    atLocalMidnight(2026, 8, 15);
    expect(daysUntil(input)).toBeNull();
  });

  it.each([
    ["today", "2026-09-15", 0],
    ["tomorrow", "2026-09-16", 1],
    ["next week", "2026-09-22", 7],
    ["a month out", "2026-10-15", 30],
    ["yesterday", "2026-09-14", -1],
    ["overdue by a week", "2026-09-08", -7],
    ["across a year boundary", "2027-01-15", 122],
  ])("%s → %s days", (_label, date, expected) => {
    atLocalMidnight(2026, 8, 15);
    expect(daysUntil(date)).toBe(expected);
  });

  it("uses only the date part of a timestamp", () => {
    atLocalMidnight(2026, 8, 15);
    // The time-of-day and the zone suffix are sliced off before parsing, so a
    // rent due date never drifts by a day because of a stored timestamp.
    expect(daysUntil("2026-09-20T23:59:59Z")).toBe(5);
    expect(daysUntil("2026-09-20T00:00:00-06:00")).toBe(5);
    expect(daysUntil("2026-09-20")).toBe(5);
  });

  it("counts from the current instant, not from local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 18, 0, 0)); // 6pm, 6h into the day
    // Sep 20 00:00 is 4 days 6 hours away → rounds to 4.
    expect(daysUntil("2026-09-20")).toBe(4);
  });

  it("is a number, never a string, so callers can compare it", () => {
    atLocalMidnight(2026, 8, 15);
    const result = daysUntil("2026-09-20");
    expect(typeof result).toBe("number");
    expect(Number.isInteger(result)).toBe(true);
  });
});
