import { createFileRoute } from "@tanstack/react-router";

import { AppShell, PageHeader } from "@/components/rentid/patterns";
import { ComingSoon } from "@/components/rentid/Surface";
import { useActiveOrg } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/applications")({
  head: () => ({
    meta: [{ title: "Applications — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ApplicationsPage,
});

function ApplicationsPage() {
  const active = useActiveOrg();
  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader title="Applications" subtitle={active.org?.name} />
      <div className="mt-5">
        <ComingSoon
          title="Rental applications"
          description="Tenants will apply directly to your units with screening and RentID history attached."
          points={[
            "Apply with a verified RentID profile",
            "Income and reference review in one place",
            "Accept an application to start a tenancy",
          ]}
        />
      </div>
    </AppShell>
  );
}
