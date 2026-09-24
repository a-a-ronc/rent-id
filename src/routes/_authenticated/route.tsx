import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { getSession } from "@/lib/services/auth";

export const Route = createFileRoute("/_authenticated")({
  // Client-rendered: the session lives in the browser (Supabase Auth). This
  // gate is a UX redirect only — every read/write behind it is enforced by
  // row-level security on the server, so a bypass here exposes nothing.
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/auth", search: { next: location.href } as never });
    }
    return { user: session.user, roles: session.roles };
  },
  component: () => <Outlet />,
});
