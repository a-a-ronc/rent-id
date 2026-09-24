/**
 * Build configuration — plain Vite, no hosting-platform wrapper.
 *
 * This replaces `@lovable.dev/vite-tanstack-config`. Of the plugins that wrapper
 * injected, five do real work and are listed here; the rest only served the
 * Lovable editor sandbox (preview HMR gating, asset proxying, telemetry).
 *
 * Deploy target is Cloudflare Workers (`cloudflare-module`). `vite build` emits
 * `.output/server/wrangler.json`; deploy with `bun run deploy`.
 */
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Public Supabase values the server reads from `process.env` at runtime
 * (auth middleware). They are the same values already shipped to the browser,
 * so they go in the generated wrangler config as plain `vars`. Real secrets —
 * SUPABASE_SERVICE_ROLE_KEY, RENTID_ENCRYPTION_KEYS, RENTID_ADMIN_ACCESS_CODE —
 * never go here; set them with `wrangler secret put`.
 */
const PUBLIC_RUNTIME_VARS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PROJECT_ID"];

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const vars = Object.fromEntries(
    PUBLIC_RUNTIME_VARS.filter((k) => env[k]).map((k) => [k, env[k] as string]),
  );

  // Attach rentid.online only once its DNS zone is active on Cloudflare —
  // before that, a deploy with a custom-domain route fails. Until then the
  // Worker is reachable at rentid.<account>.workers.dev.
  const routes =
    env["DEPLOY_CUSTOM_DOMAIN"] === "1"
      ? [
          { pattern: "rentid.online", custom_domain: true },
          { pattern: "www.rentid.online", custom_domain: true },
        ]
      : undefined;

  return {
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        // src/server.ts is the SSR entry (our error wrapper).
        server: { entry: "server" },
        // Anything under a `server/` folder, or importing `server-only`, must never
        // reach the browser bundle.
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      // Nitro packages the SSR server for Workers. Build-only: `vite dev` serves
      // directly.
      ...(command === "build"
        ? [
            nitro({
              preset: "cloudflare-module",
              cloudflare: {
                nodeCompat: true,
                deployConfig: true,
                wrangler: {
                  name: "rentid",
                  compatibility_date: "2026-09-01",
                  vars,
                  ...(routes ? { routes } : {}),
                  observability: { enabled: true },
                },
              },
            }),
          ]
        : []),
      viteReact(),
    ],
    css: { transformer: "lightningcss" },
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
  };
});
