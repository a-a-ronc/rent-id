/**
 * Vitest global setup.
 *
 * vitest.config.ts pins `TZ=America/Denver` (RentID's home market). The date
 * helpers in src/lib/format.ts parse date-only strings as LOCAL midnight
 * specifically so a `2026-09-01` lease date never renders as Aug 31. That
 * regression is only observable in a zone behind UTC — under `TZ=UTC` the
 * broken and the correct implementation produce identical output.
 *
 * So rather than let those assertions silently go vacuous on a machine where
 * the TZ did not take, fail the whole run here with an actionable message.
 */
const EXPECTED_TIME_ZONE = "America/Denver";

const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;

if (resolved !== EXPECTED_TIME_ZONE) {
  throw new Error(
    `Expected the test run to use TZ=${EXPECTED_TIME_ZONE} but the runtime resolved ` +
      `"${resolved}". The date assertions in src/lib/format.test.ts are only meaningful ` +
      `in a zone behind UTC. Check \`test.env.TZ\` in vitest.config.ts, or export ` +
      `TZ=${EXPECTED_TIME_ZONE} before running vitest.`,
  );
}

/** January is behind UTC in Denver (UTC-7); guards against a zone rename. */
const januaryOffsetMinutes = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)).getTimezoneOffset();

if (januaryOffsetMinutes <= 0) {
  throw new Error(
    `Expected a negative UTC offset so date-only parsing regressions are observable, ` +
      `got getTimezoneOffset()=${januaryOffsetMinutes}.`,
  );
}
