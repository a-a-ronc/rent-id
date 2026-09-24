import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure modules under src/lib (no DOM, no network, no DB).
 *
 * - `tsconfigPaths()` resolves the `@/*` → `./src/*` alias from tsconfig.json so
 *   the tests import modules exactly the way the app does.
 * - `TZ` is pinned so the date helpers in src/lib/format.ts are asserted in a
 *   fixed, negative-UTC-offset zone. Several assertions (a date-only string must
 *   not shift a day) are vacuous under UTC, so src/test/setup.ts fails loudly if
 *   this did not take effect.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    env: { TZ: "America/Denver" },
    restoreMocks: true,
    unstubEnvs: true,
    coverage: {
      // Scoped to the modules this suite actually targets, so the number means
      // something. NOTE: the `text` reporter prints only files with something
      // uncovered — a module missing from the table is at 100%, not untested.
      // Use `--coverage.reporter=json-summary` for the per-file breakdown.
      provider: "v8",
      include: [
        "src/lib/payments/fees.ts",
        "src/lib/verification/address.ts",
        "src/lib/security-headers.ts",
        "src/lib/db/mappers.ts",
        "src/lib/format.ts",
      ],
    },
  },
});
