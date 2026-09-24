import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { withSecurityHeaders } from "./lib/security-headers";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const securityEnv = () => ({
  supabaseUrl: process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"],
  dev: process.env["NODE_ENV"] !== "production",
});

// Strict transport + CSP + frame/referrer/permissions policies on every
// response, including error pages. See src/lib/security-headers.ts.
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  if (result instanceof Response) return withSecurityHeaders(result, securityEnv());
  const maybe = result as { response?: Response };
  if (maybe && maybe.response instanceof Response)
    withSecurityHeaders(maybe.response, securityEnv());
  return result;
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return withSecurityHeaders(
      new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      securityEnv(),
    );
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware],
}));
