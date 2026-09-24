import { createFileRoute, Link } from "@tanstack/react-router";

import {
  AppShell,
  DataTable,
  EmptyState,
  InlineError,
  LoadingCard,
  PageHeader,
  StatusPill,
} from "@/components/rentid/patterns";
import { daysUntil, money, shortDate } from "@/lib/format";
import { useActiveOrg, useLeases } from "@/lib/rentid";
import type { LeaseDetail, LeaseStatus } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/leases/")({
  head: () => ({
    meta: [{ title: "Leases — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: LeasesPage,
});

const TONE: Record<LeaseStatus, "success" | "warning" | "neutral" | "danger"> = {
  draft: "neutral",
  active: "success",
  expiring: "warning",
  ended: "neutral",
  terminated: "danger",
};

function LeasesPage() {
  const active = useActiveOrg();
  const leases = useLeases(active.orgId);
  const rows = (leases.data ?? []).slice().sort((a, b) => a.end_date.localeCompare(b.end_date));

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Leases"
        subtitle={active.org ? `${active.org.name} · ${rows.length} leases` : undefined}
      />

      <div className="mt-5">
        {leases.isLoading ? (
          <LoadingCard label="Fetching leases…" />
        ) : leases.isError ? (
          <InlineError
            message={
              leases.error instanceof Error ? leases.error.message : "Could not load leases."
            }
            onRetry={() => leases.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No leases yet"
            description="Upload a lease from a tenant's page to see it here, alongside its term and status."
          />
        ) : (
          <DataTable<LeaseDetail>
            rows={rows}
            columns={[
              { key: "tenant", header: "Tenant", cell: (l) => l.tenancy?.tenant_name ?? "—" },
              { key: "unit", header: "Unit", cell: (l) => l.unit?.name ?? "—", hideOnMobile: true },
              { key: "rent", header: "Rent", cell: (l) => `${money(l.monthly_rent)}/mo` },
              {
                key: "term",
                header: "Term",
                cell: (l) => `${shortDate(l.start_date)} → ${shortDate(l.end_date)}`,
                hideOnMobile: true,
              },
              {
                key: "days",
                header: "Days left",
                cell: (l) => {
                  const d = daysUntil(l.end_date);
                  return d == null ? "—" : d < 0 ? "Past" : `${d}d`;
                },
              },
              {
                key: "status",
                header: "Status",
                cell: (l) => <StatusPill status={l.status} tone={TONE[l.status]} />,
              },
              {
                key: "link",
                header: "",
                align: "right",
                cell: (l) => (
                  <Link
                    to="/leases/$leaseId"
                    params={{ leaseId: l.id }}
                    className="text-[12.5px] font-medium text-brand"
                  >
                    View
                  </Link>
                ),
              },
            ]}
          />
        )}
      </div>
    </AppShell>
  );
}
