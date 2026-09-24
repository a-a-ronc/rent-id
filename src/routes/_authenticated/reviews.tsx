import { createFileRoute } from "@tanstack/react-router";

import { AppShell, PageHeader } from "@/components/rentid/patterns";
import { ComingSoon } from "@/components/rentid/Surface";
import { useActiveOrg } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/reviews")({
  head: () => ({
    meta: [{ title: "Reviews — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const active = useActiveOrg();
  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader title="Reviews" subtitle={active.org?.name} />
      <div className="mt-5">
        <ComingSoon
          title="Two-way reputation"
          description="Reviews between landlords and tenants, unlocked only by verified tenancies."
          points={[
            "Tenants review landlords after their lease",
            "Landlords review tenants at move-out",
            "Disputes handled by RentID, not the mob",
          ]}
        />
      </div>
    </AppShell>
  );
}
