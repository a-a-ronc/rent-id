import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  securityHeaders,
  withSecurityHeaders,
} from "@/lib/security-headers";

const SUPABASE_URL = "https://abcdefghijklm.supabase.co";
const SUPABASE_ORIGIN = "https://abcdefghijklm.supabase.co";
const SUPABASE_WS = "wss://abcdefghijklm.supabase.co";

/** Parse a CSP string into `{ directive: [source, ...] }`. */
function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of csp.split(";")) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = parts;
    if (name) out[name] = sources;
  }
  return out;
}

const prodCsp = () =>
  parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: false }));
const devCsp = () => parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: true }));

/* -------------------------------------------------------------------------- */
/*  Content-Security-Policy                                                   */
/* -------------------------------------------------------------------------- */

describe("buildContentSecurityPolicy", () => {
  it("allows the Supabase origin for XHR and its wss: variant for Realtime", () => {
    expect(prodCsp()["connect-src"]).toEqual(["'self'", SUPABASE_ORIGIN, SUPABASE_WS]);
  });

  it("allows the Supabase origin for Storage images", () => {
    expect(prodCsp()["img-src"]).toEqual(["'self'", "data:", "blob:", SUPABASE_ORIGIN]);
  });

  it("derives the ORIGIN, not the raw URL — a path or query never leaks in", () => {
    const csp = parseCsp(
      buildContentSecurityPolicy({
        supabaseUrl: "https://abcdefghijklm.supabase.co/rest/v1/profiles?select=*",
        dev: false,
      }),
    );
    expect(csp["connect-src"]).toEqual(["'self'", SUPABASE_ORIGIN, SUPABASE_WS]);
  });

  it("keeps a non-default port on the origin (local Supabase)", () => {
    const csp = parseCsp(
      buildContentSecurityPolicy({ supabaseUrl: "http://127.0.0.1:54321", dev: true }),
    );
    expect(csp["connect-src"]).toContain("http://127.0.0.1:54321");
    expect(csp["connect-src"]).toContain("ws://127.0.0.1:54321"); // http → ws, not wss
  });

  describe("'unsafe-eval'", () => {
    it("is absent in production", () => {
      expect(prodCsp()["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
      expect(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: false })).not.toContain(
        "unsafe-eval",
      );
    });

    it("is present in dev (the Vite dev server needs it)", () => {
      expect(devCsp()["script-src"]).toContain("'unsafe-eval'");
    });

    it("defaults to production when `dev` is omitted", () => {
      expect(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL })).not.toContain(
        "unsafe-eval",
      );
    });
  });

  it("never allows 'unsafe-eval' in style-src, in either mode", () => {
    expect(prodCsp()["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(devCsp()["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it.each([true, false])("forbids framing outright (dev=%s)", (dev) => {
    const csp = parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev }));
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
  });

  it.each([true, false])("forbids plugins and objects (dev=%s)", (dev) => {
    const csp = parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev }));
    expect(csp["object-src"]).toEqual(["'none'"]);
  });

  it.each([true, false])("pins base-uri and form-action to 'self' (dev=%s)", (dev) => {
    const csp = parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev }));
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  describe("upgrade-insecure-requests", () => {
    it("is emitted as a valueless directive in production", () => {
      const csp = buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: false });
      expect(csp).toContain("upgrade-insecure-requests");
      // Valueless: it must not be followed by a source list.
      expect(parseCsp(csp)["upgrade-insecure-requests"]).toEqual([]);
      expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
    });

    it("is absent in dev, where http://localhost has to keep working", () => {
      expect(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: true })).not.toContain(
        "upgrade-insecure-requests",
      );
    });
  });

  it("opens localhost websockets in dev only", () => {
    expect(devCsp()["connect-src"]).toEqual([
      "'self'",
      SUPABASE_ORIGIN,
      SUPABASE_WS,
      "ws:",
      "wss:",
      "http://localhost:*",
      "ws://localhost:*",
    ]);
    expect(prodCsp()["connect-src"]).not.toContain("ws:");
    expect(prodCsp()["connect-src"]).not.toContain("http://localhost:*");
  });

  describe("degrades safely when the Supabase URL is unusable", () => {
    const broken: Array<[string, { supabaseUrl?: string | undefined; dev?: boolean }]> = [
      ["absent", {}],
      ["explicitly undefined", { supabaseUrl: undefined }],
      ["empty string", { supabaseUrl: "" }],
      ["not a URL at all", { supabaseUrl: "not a url" }],
      ["the literal string 'undefined'", { supabaseUrl: "undefined" }],
      ["the literal string 'null'", { supabaseUrl: "null" }],
      ["a bare hostname with no scheme", { supabaseUrl: "abcdefghijklm.supabase.co" }],
      ["a scheme with no host", { supabaseUrl: "https://" }],
    ];

    it.each(broken)("%s → no Supabase source, and no bogus token", (_label, env) => {
      const csp = buildContentSecurityPolicy(env);
      const parsed = parseCsp(csp);

      expect(parsed["connect-src"]).toEqual(["'self'"]);
      expect(parsed["img-src"]).toEqual(["'self'", "data:", "blob:"]);

      // Nothing stringified a null/undefined into a source position.
      for (const sources of Object.values(parsed)) {
        for (const source of sources) {
          expect(source).not.toBe("null");
          expect(source).not.toBe("undefined");
          expect(source).not.toBe("ws");
          expect(source).not.toBe("");
        }
      }
      expect(csp).not.toMatch(/\bnull\b/);
      expect(csp).not.toMatch(/\bundefined\b/);
      // A degraded CSP is still a real CSP, not an empty string.
      expect(parsed["default-src"]).toEqual(["'self'"]);
      expect(parsed["frame-ancestors"]).toEqual(["'none'"]);
    });
  });

  it("never emits a directive with a dangling separator or an empty source", () => {
    for (const env of [
      { supabaseUrl: SUPABASE_URL, dev: false },
      { supabaseUrl: SUPABASE_URL, dev: true },
      {},
    ]) {
      const csp = buildContentSecurityPolicy(env);
      expect(csp).not.toMatch(/;\s*;/);
      expect(csp).not.toMatch(/;\s*$/);
      expect(csp).not.toMatch(/ {2}/);
    }
  });

  it("never widens a fetch directive to the wildcard", () => {
    for (const env of [
      { supabaseUrl: SUPABASE_URL, dev: false },
      { supabaseUrl: SUPABASE_URL, dev: true },
    ]) {
      for (const sources of Object.values(parseCsp(buildContentSecurityPolicy(env)))) {
        expect(sources).not.toContain("*");
        expect(sources).not.toContain("https:");
        expect(sources).not.toContain("'unsafe-hashes'");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  securityHeaders                                                           */
/* -------------------------------------------------------------------------- */

describe("securityHeaders", () => {
  const headers = securityHeaders({ supabaseUrl: SUPABASE_URL, dev: false });

  it("sends HSTS for two years, across subdomains, preload-eligible", () => {
    const hsts = headers["Strict-Transport-Security"];
    expect(hsts).toBe("max-age=63072000; includeSubDomains; preload");
    // 63072000s is exactly 730 days — the preload list's two-year minimum.
    const maxAge = Number(/max-age=(\d+)/.exec(hsts ?? "")?.[1]);
    expect(maxAge / 86_400).toBe(730);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000); // preload requires ≥ 1 year
  });

  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Cross-Origin-Opener-Policy", "same-origin"],
    ["Cross-Origin-Resource-Policy", "same-origin"],
    ["X-Permitted-Cross-Domain-Policies", "none"],
  ])("sets %s: %s", (name, value) => {
    expect(headers[name]).toBe(value);
  });

  it("denies the hardware and payment permissions the app never uses", () => {
    const policy = headers["Permissions-Policy"] ?? "";
    for (const feature of [
      "camera",
      "geolocation",
      "microphone",
      "payment",
      "usb",
      "accelerometer",
      "gyroscope",
      "magnetometer",
      "interest-cohort",
    ]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("carries the CSP built for the same env", () => {
    expect(headers["Content-Security-Policy"]).toBe(
      buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: false }),
    );
    expect(
      securityHeaders({ supabaseUrl: SUPABASE_URL, dev: true })["Content-Security-Policy"],
    ).toBe(buildContentSecurityPolicy({ supabaseUrl: SUPABASE_URL, dev: true }));
  });

  it("keeps every non-CSP header identical in dev and production", () => {
    const dev = securityHeaders({ supabaseUrl: SUPABASE_URL, dev: true });
    for (const [name, value] of Object.entries(headers)) {
      if (name === "Content-Security-Policy") continue;
      expect(dev[name]).toBe(value);
    }
  });

  it("still returns the full header set when the Supabase URL is missing", () => {
    expect(Object.keys(securityHeaders({}))).toEqual(Object.keys(headers));
  });

  it("returns a fresh object each call, so a caller cannot poison the next response", () => {
    const first = securityHeaders({ supabaseUrl: SUPABASE_URL });
    first["X-Frame-Options"] = "SAMEORIGIN";
    expect(securityHeaders({ supabaseUrl: SUPABASE_URL })["X-Frame-Options"]).toBe("DENY");
  });
});

/* -------------------------------------------------------------------------- */
/*  withSecurityHeaders                                                       */
/* -------------------------------------------------------------------------- */

describe("withSecurityHeaders", () => {
  const env = { supabaseUrl: SUPABASE_URL, dev: false };

  it("adds every header to a bare response", () => {
    const out = withSecurityHeaders(new Response("hi"), env);
    for (const [name, value] of Object.entries(securityHeaders(env))) {
      expect(out.headers.get(name)).toBe(value);
    }
  });

  it("returns the same Response instance rather than a copy", async () => {
    const input = new Response("body text", { status: 201 });
    const out = withSecurityHeaders(input, env);
    expect(out).toBe(input);
    expect(out.status).toBe(201);
    await expect(out.text()).resolves.toBe("body text");
  });

  it("does not clobber a header the app already set", () => {
    const out = withSecurityHeaders(
      new Response("hi", {
        headers: {
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy": "default-src 'none'",
          "Referrer-Policy": "no-referrer",
        },
      }),
      env,
    );
    expect(out.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(out.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(out.headers.get("Referrer-Policy")).toBe("no-referrer");
    // ...while everything it did NOT set is still applied.
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("matches header names case-insensitively, per the Headers spec", () => {
    const out = withSecurityHeaders(
      new Response("hi", { headers: { "x-frame-options": "SAMEORIGIN" } }),
      env,
    );
    expect(out.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("leaves the app's own headers untouched", () => {
    const out = withSecurityHeaders(
      new Response("{}", {
        headers: { "Content-Type": "application/json", "X-Request-Id": "abc" },
      }),
      env,
    );
    expect(out.headers.get("Content-Type")).toBe("application/json");
    expect(out.headers.get("X-Request-Id")).toBe("abc");
  });

  it("survives a Response whose headers are immutable (a redirect)", () => {
    // Node/undici does not enforce the spec's "immutable" header guard, so
    // simulate one: every set() throws, exactly as a spec-compliant runtime
    // (Workers, Deno) does on a Response.redirect().
    const response = new Response(null, { status: 302 });
    const guarded: Pick<Headers, "has" | "set" | "get"> = {
      has: () => false,
      get: () => null,
      set: () => {
        throw new TypeError("immutable");
      },
    };
    Object.defineProperty(response, "headers", { value: guarded, configurable: true });

    expect(() => withSecurityHeaders(response, env)).not.toThrow();
    expect(withSecurityHeaders(response, env).status).toBe(302);
  });

  it("still applies the later headers when an earlier set() throws", () => {
    // A guard that only rejects the first header must not abort the whole loop.
    const response = new Response("hi");
    const applied = new Map<string, string>();
    let first = true;
    const guarded: Pick<Headers, "has" | "set" | "get"> = {
      has: (name: string) => applied.has(name),
      get: (name: string) => applied.get(name) ?? null,
      set: (name: string, value: string) => {
        if (first) {
          first = false;
          throw new TypeError("immutable");
        }
        applied.set(name, value);
      },
    };
    Object.defineProperty(response, "headers", { value: guarded, configurable: true });

    withSecurityHeaders(response, env);
    expect(applied.get("X-Content-Type-Options")).toBe("nosniff");
    expect(applied.get("X-Frame-Options")).toBe("DENY");
    expect(applied.has("Content-Security-Policy")).toBe(false); // the one that threw
  });

  it("degrades safely on a response when the Supabase URL is broken", () => {
    const out = withSecurityHeaders(new Response("hi"), { supabaseUrl: "not a url" });
    const csp = out.headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/\bnull\b/);
    expect(csp).not.toMatch(/\bundefined\b/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
