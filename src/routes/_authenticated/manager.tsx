import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Property-manager layout route. The manager surfaces live in the sibling
 * `manager.*.tsx` leaves; this route only mounts them.
 */
export const Route = createFileRoute("/_authenticated/manager")({
  head: () => ({
    meta: [{ title: "Property manager · RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <Outlet />,
});
