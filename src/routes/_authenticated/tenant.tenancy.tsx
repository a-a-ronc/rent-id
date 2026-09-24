import { createFileRoute } from "@tanstack/react-router";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  TrustBadge,
  VerificationChecklist,
} from "@/components/rentid/patterns";
import { EmptyState, Glass, Eyebrow } from "@/components/rentid/Surface";
import { money, shortDate } from "@/lib/format";
import { useMyTenancies, tenancyVerification } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenant/tenancy")({
  head: () => ({
    meta: [{ title: "My tenancy — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenancyPage,
});

function TenancyPage() {
  const tenancies = useMyTenancies();
  const active =
    (tenancies.data ?? []).find((t) => t.status === "active") ?? (tenancies.data ?? [])[0];

  return (
    <AppShell subtitle="Tenant">
      <PageHeader title="My tenancy" subtitle={active?.property?.name} />
      {tenancies.isLoading ? (
        <div className="mt-5">
          <EmptyState title="Loading…" description="Fetching your tenancy." />
        </div>
      ) : !active ? (
        <div className="mt-5">
          <EmptyState
            title="No tenancy yet"
            description="Your tenancy will appear here once a landlord invites you."
          />
        </div>
      ) : (
        <>
          <Glass className="mt-5 p-5">
            <Eyebrow>{active.organization?.name ?? "Landlord"}</Eyebrow>
            <h2 className="mt-1 font-display text-[18px] font-semibold">
              {active.property?.name} {active.unit?.name}
            </h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {active.property?.street_address}, {active.property?.city} {active.property?.state}
            </p>
            <div className="mt-3">
              {active.verified ? (
                <TrustBadge kind="verified_tenancy" />
              ) : (
                <TrustBadge kind="unverified" />
              )}
            </div>
          </Glass>

          <SectionCard title="Term & deposit" className="mt-4">
            <ListRow title="Start date" value={shortDate(active.start_date)} />
            <ListRow title="End date" value={shortDate(active.end_date)} />
            <ListRow title="Monthly rent" value={money(active.monthly_rent)} />
            <ListRow title="Security deposit" value={money(active.security_deposit)} />
          </SectionCard>

          <SectionCard title="Verification checklist" className="mt-4">
            <div className="px-4 py-4">
              <VerificationChecklist checks={tenancyVerification(active).checks} />
            </div>
          </SectionCard>

          <SectionCard title="Landlord contact" className="mt-4">
            <ListRow
              title={active.organization?.name ?? "Landlord"}
              subtitle="Message them from the Messages tab"
            />
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
