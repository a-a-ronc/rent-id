import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Tenant layout route. The tenant surfaces live in the sibling
 * `tenant.*.tsx` leaves; this route only mounts them.
 */
export const Route = createFileRoute("/_authenticated/tenant")({
  head: () => ({
    meta: [{ title: "Tenant · RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <Outlet />,
});
