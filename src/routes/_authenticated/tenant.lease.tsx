import { createFileRoute } from "@tanstack/react-router";

import { OpenDocumentButton } from "@/components/rentid/OpenDocumentButton";
import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/rentid/patterns";
import { EmptyState } from "@/components/rentid/Surface";
import { DisclosureNotice } from "@/components/rentid/verification-ui";
import { money, shortDate } from "@/lib/format";
import { useMyTenancies } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenant/lease")({
  head: () => ({ meta: [{ title: "Lease — RentID" }, { name: "robots", content: "noindex" }] }),
  component: LeasePage,
});

function LeasePage() {
  const tenancies = useMyTenancies();
  const active =
    (tenancies.data ?? []).find((t) => t.status === "active") ?? (tenancies.data ?? [])[0];
  const lease = active?.lease ?? null;
  const docs = (active?.documents ?? []).filter((d) => d.visible_to_tenant);

  return (
    <AppShell subtitle="Tenant">
      <PageHeader title="Lease" subtitle={active?.property?.name} />
      <div className="mt-4">
        <DisclosureNotice propertyId={active?.property?.id ?? null} context="lease" />
      </div>
      {tenancies.isLoading ? (
        <div className="mt-5">
          <EmptyState title="Loading…" description="Fetching your lease." />
        </div>
      ) : !lease ? (
        <div className="mt-5">
          <EmptyState
            title="No lease on file"
            description="Your landlord hasn't attached a lease yet."
          />
        </div>
      ) : (
        <>
          <SectionCard
            title="Lease terms"
            aside={
              <StatusPill
                status={lease.status}
                tone={lease.status === "active" ? "success" : "neutral"}
              />
            }
            className="mt-5"
          >
            <ListRow title="Start date" value={shortDate(lease.start_date)} />
            <ListRow title="End date" value={shortDate(lease.end_date)} />
            <ListRow title="Monthly rent" value={money(lease.monthly_rent)} />
            <ListRow title="Security deposit" value={money(lease.security_deposit)} />
            <ListRow title="Rent due day" value={String(lease.rent_due_day)} />
            {lease.late_fee != null && <ListRow title="Late fee" value={money(lease.late_fee)} />}
          </SectionCard>

          <SectionCard title="Documents" aside={`${docs.length} shared`} className="mt-4">
            {docs.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-muted-foreground">
                No documents shared yet.
              </p>
            ) : (
              docs.map((d) => (
                <ListRow
                  key={d.id}
                  title={d.title}
                  subtitle={shortDate(d.created_at.slice(0, 10))}
                  pill={<StatusPill status={d.kind.replace(/_/g, " ")} tone="neutral" />}
                  value={<OpenDocumentButton storagePath={d.storage_path} />}
                />
              ))
            )}
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
