/**
 * HTTP security headers applied to every response by `src/start.ts`.
 *
 * Content-Security-Policy is deliberately tight: the app talks only to its
 * own origin and the Supabase project (REST, Auth, Storage, Realtime). Add a
 * host here when a new third party is introduced — never widen to `*`.
 *
 * Note on `script-src 'unsafe-inline'`: TanStack Start streams the router's
 * hydration state as inline scripts. Moving to nonces is tracked in
 * docs/SECURITY.md; until then inline scripts are allowed but eval is not.
 */
export function buildContentSecurityPolicy(env: {
  supabaseUrl?: string | undefined;
  dev?: boolean;
}) {
  const supabase = safeOrigin(env.supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : "";
  const dev = env.dev ?? false;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(supabase ? [supabase] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(supabase ? [supabase, supabaseWs] : []),
      ...(dev ? ["ws:", "wss:", "http://localhost:*", "ws://localhost:*"] : []),
    ],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

export function securityHeaders(env: {
  supabaseUrl?: string | undefined;
  dev?: boolean;
}): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy(env),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
}

/** Apply the headers to a Response without clobbering ones the app already set. */
export function withSecurityHeaders(
  response: Response,
  env: { supabaseUrl?: string | undefined; dev?: boolean },
): Response {
  const headers = securityHeaders(env);
  for (const [name, value] of Object.entries(headers)) {
    if (!response.headers.has(name)) {
      try {
        response.headers.set(name, value);
      } catch {
        // immutable Response (e.g. a redirect) — leave as is
      }
    }
  }
  return response;
}

function safeOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
