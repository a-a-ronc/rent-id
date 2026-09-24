import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import {
  AppShell,
  EmptyState,
  InlineError,
  ListRow,
  LoadingCard,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
  ToolbarButton,
  TrustBadge,
} from "@/components/rentid/patterns";
import { useProfile } from "@/lib/auth";
import { daysUntil, greeting, money, monthLabel, shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useDashboardMetrics,
  useLeases,
  useMaintenance,
  useNotifications,
  usePayments,
  useTenancies,
} from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Dashboard — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const active = useActiveOrg();
  const profile = useProfile();
  const orgId = active.orgId;

  const metrics = useDashboardMetrics(orgId);
  const payments = usePayments(orgId);
  const tenancies = useTenancies(orgId);
  const maintenance = useMaintenance(orgId);
  const leases = useLeases(orgId);
  const notifications = useNotifications();

  const loading =
    metrics.isLoading ||
    payments.isLoading ||
    tenancies.isLoading ||
    maintenance.isLoading ||
    leases.isLoading;
  const isError =
    metrics.isError ||
    payments.isError ||
    tenancies.isError ||
    maintenance.isError ||
    leases.isError;

  const recentPayments = (payments.data ?? [])
    .slice()
    .sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""))
    .slice(0, 5);

  const upcomingRent = (payments.data ?? [])
    .filter((p) => p.status === "scheduled" || p.status === "pending")
    .slice()
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 5);

  const lateTenants = (payments.data ?? []).filter((p) => p.status === "late").slice(0, 5);

  const openMaintenance = (maintenance.data ?? [])
    .filter((m) => m.status !== "completed" && m.status !== "cancelled")
    .slice(0, 5);

  const expiringLeases = (leases.data ?? [])
    .filter((l) => {
      const d = daysUntil(l.end_date);
      return d != null && d >= 0 && d <= 60;
    })
    .slice(0, 5);

  const recentNotifications = (notifications.data ?? []).slice(0, 5);

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title={`${greeting()}${profile.data?.full_name ? `, ${profile.data.full_name.split(" ")[0]}` : ""}`}
        subtitle={active.org ? `${active.org.name} · ${monthLabel(new Date())}` : undefined}
        action={<ToolbarButton to="/properties" label="Add property" icon={ArrowRight} />}
      />

      {isError ? (
        <div className="mt-5">
          <InlineError message="Couldn't load your dashboard data." />
        </div>
      ) : loading ? (
        <div className="mt-5">
          <LoadingCard label="Loading dashboard…" />
        </div>
      ) : (
        <>
          <SummaryGrid
            className="mt-5"
            items={[
              {
                label: "Rent collected",
                value: money(metrics.data?.rent_collected),
                tone: "success" as const,
                hint: "This month",
              },
              {
                label: "Outstanding rent",
                value: money(metrics.data?.outstanding_rent),
                tone:
                  (metrics.data?.outstanding_rent ?? 0) > 0
                    ? ("warning" as const)
                    : ("neutral" as const),
                hint: "Past due",
              },
              {
                label: "Occupied units",
                value: `${metrics.data?.occupied_units ?? 0} / ${metrics.data?.total_units ?? 0}`,
                tone: "neutral" as const,
                hint: "Across your portfolio",
              },
              {
                label: "Late payments",
                value: String(metrics.data?.late_payments ?? 0),
                tone:
                  (metrics.data?.late_payments ?? 0) > 0
                    ? ("danger" as const)
                    : ("neutral" as const),
                hint: "This month",
              },
              {
                label: "Open maintenance",
                value: String(metrics.data?.open_maintenance ?? 0),
                tone:
                  (metrics.data?.open_maintenance ?? 0) > 0
                    ? ("warning" as const)
                    : ("neutral" as const),
                hint: "Requests",
              },
              {
                label: "Leases expiring",
                value: String(metrics.data?.leases_expiring ?? 0),
                tone:
                  (metrics.data?.leases_expiring ?? 0) > 0
                    ? ("warning" as const)
                    : ("neutral" as const),
                hint: "Next 60 days",
              },
            ]}
          />

          <SectionCard title="Recent payments" aside="Latest 5" className="mt-6">
            {recentPayments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Rent records appear once tenancies are set up."
              />
            ) : (
              recentPayments.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.tenant_name}
                  subtitle={`${p.property_name} · ${p.unit_name} · ${shortDate(p.due_date)}`}
                  value={money(Number(p.amount))}
                  pill={
                    <div className="flex items-center gap-2">
                      {p.verified ? <TrustBadge kind="verified_payment" /> : null}
                      <StatusPill
                        status={p.status}
                        tone={
                          p.status === "paid"
                            ? "success"
                            : p.status === "late"
                              ? "danger"
                              : "neutral"
                        }
                      />
                    </div>
                  }
                />
              ))
            )}
          </SectionCard>

          <SectionCard title="Upcoming rent" aside="Next due" className="mt-4">
            {upcomingRent.length === 0 ? (
              <EmptyState title="Nothing scheduled" description="No upcoming rent is scheduled." />
            ) : (
              upcomingRent.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.tenant_name}
                  subtitle={`${p.property_name} · ${p.unit_name} · Due ${shortDate(p.due_date)}`}
                  value={money(Number(p.amount))}
                  pill={<StatusPill status={p.status} tone="neutral" />}
                />
              ))
            )}
          </SectionCard>

          <SectionCard title="Late tenants" aside={`${lateTenants.length} late`} className="mt-4">
            {lateTenants.length === 0 ? (
              <EmptyState
                title="All caught up"
                description="No tenants are currently late on rent."
              />
            ) : (
              lateTenants.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.tenant_name}
                  subtitle={`${p.property_name} · ${p.unit_name} · Due ${shortDate(p.due_date)}`}
                  value={money(Number(p.amount))}
                  pill={<StatusPill status="Late" tone="danger" />}
                />
              ))
            )}
          </SectionCard>

          <SectionCard title="Maintenance requests" aside="Open" className="mt-4">
            {openMaintenance.length === 0 ? (
              <EmptyState
                title="Nothing open"
                description="Units are quiet — no open maintenance requests."
              />
            ) : (
              openMaintenance.map((m) => (
                <ListRow
                  key={m.id}
                  title={m.title}
                  subtitle={`${m.property_name} · ${m.unit_name}`}
                  pill={
                    <StatusPill
                      status={m.status.replace("_", " ")}
                      tone={m.status === "open" ? "warning" : "neutral"}
                    />
                  }
                />
              ))
            )}
          </SectionCard>

          <SectionCard title="Lease expirations" aside="Next 60 days" className="mt-4">
            {expiringLeases.length === 0 ? (
              <EmptyState
                title="Nothing expiring"
                description="No leases expire in the next 60 days."
              />
            ) : (
              expiringLeases.map((l) => {
                const days = daysUntil(l.end_date);
                return (
                  <ListRow
                    key={l.id}
                    title={l.tenancy?.tenant_name ?? "Tenant"}
                    subtitle={`${l.property?.name ?? ""} · ${l.unit?.name ?? ""} · Ends ${shortDate(l.end_date)}`}
                    pill={<StatusPill status={`${days} days`} tone="warning" />}
                  />
                );
              })
            )}
          </SectionCard>

          <SectionCard title="Notifications" aside="Recent" className="mt-4">
            {recentNotifications.length === 0 ? (
              <EmptyState title="No notifications" description="You're all caught up." />
            ) : (
              recentNotifications.map((n) => (
                <ListRow
                  key={n.id}
                  title={n.title}
                  subtitle={n.body ?? undefined}
                  pill={n.read_at ? undefined : <StatusPill status="New" tone="accent" />}
                />
              ))
            )}
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
