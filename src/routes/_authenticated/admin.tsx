import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Administrator layout. Admin surfaces live in sibling `admin.*.tsx` leaves. */
export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [{ title: "Administration · RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: () => <Outlet />,
});
