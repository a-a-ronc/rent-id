import { createFileRoute } from "@tanstack/react-router";

import { AppShell, PageHeader } from "@/components/rentid/patterns";
import { ComingSoon } from "@/components/rentid/Surface";
import { useActiveOrg } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [{ title: "Reports — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const active = useActiveOrg();
  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader title="Reports" subtitle={active.org?.name} />
      <div className="mt-5">
        <ComingSoon
          title="Portfolio reporting"
          description="Cash flow, occupancy trends and owner statements across your portfolio."
          points={[
            "Monthly rent roll and collections",
            "Occupancy and vacancy trends",
            "Exportable owner statements",
          ]}
        />
      </div>
    </AppShell>
  );
}
