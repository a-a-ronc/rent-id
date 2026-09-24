import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell, PageHeader } from "@/components/rentid/patterns";
import { SectionCard, ListRow, StatusPill, SummaryGrid } from "@/components/rentid/patterns";
import { DemoNotice, InlineError, LoadingCard } from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import {
  useManagedPayments,
  useManagedWorkOrders,
  useManagementOrg,
  useOwnerAccounts,
  usePmMetrics,
} from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/manager/")({
  head: () => ({
    meta: [{ title: "Manager overview — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerOverview,
});

function ManagerOverview() {
  const active = useManagementOrg();
  const metrics = usePmMetrics(active.orgId);
  const owners = useOwnerAccounts(active.orgId);
  const payments = useManagedPayments(active.orgId);
  const work = useManagedWorkOrders(active.orgId);

  if (active.isPending) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <LoadingCard label="Loading workspace…" rows={4} />
      </AppShell>
    );
  }

  if (!active.orgId) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <EmptyState
          title="No management workspace"
          description="This account isn't part of a property-management company yet."
        />
      </AppShell>
    );
  }

  // Exceptions first: what needs a human before month end.
  const exceptions = (payments.data ?? []).filter(
    (p) => p.status === "late" || p.status === "failed",
  );
  const urgent = (work.data ?? []).filter(
    (w) => (w.priority === "high" || w.priority === "emergency") && w.status !== "completed",
  );

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader title="Portfolio overview" subtitle={active.org?.name} />

      {active.isDemo ? (
        <div className="mt-4">
          <DemoNotice>
            You're viewing the demo management company. Owners, authority and reconciliation are
            live; the student-housing screens still run on sample data.
          </DemoNotice>
        </div>
      ) : null}

      <div className="mt-5">
        {metrics.isPending ? (
          <LoadingCard label="Loading metrics…" rows={2} />
        ) : metrics.isError ? (
          <InlineError message="Metrics unavailable." onRetry={() => void metrics.refetch()} />
        ) : (
          <SummaryGrid
            items={[
              { label: "Units managed", value: metrics.data?.units_managed ?? 0 },
              { label: "Owners", value: metrics.data?.owners ?? 0 },
              {
                label: "Collected this month",
                value: money(metrics.data?.collected_this_month ?? 0),
                tone: "success",
              },
              {
                label: "Open work orders",
                value: metrics.data?.open_work_orders ?? 0,
                hint: `${metrics.data?.urgent_work_orders ?? 0} urgent`,
                tone: (metrics.data?.urgent_work_orders ?? 0) > 0 ? "warning" : "neutral",
              },
            ]}
          />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["Collection rate", `${metrics.data?.collection_rate_pct ?? 0}%`],
          ["Median first response", `${metrics.data?.median_first_response_hours ?? 0} h`],
          ["Resolved under 72h", `${metrics.data?.resolved_under_72h_pct ?? 0}%`],
        ].map(([label, value]) => (
          <Glass key={label} className="p-4">
            <Eyebrow>{label}</Eyebrow>
            <p className="num mt-2 text-[20px] leading-none font-medium">{value}</p>
          </Glass>
        ))}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <SectionCard
          title="Exceptions"
          aside="Needs attention"
          footer={
            <Link to="/payments" className="text-[12.5px] font-medium text-accent">
              Open rent ledger
            </Link>
          }
        >
          {payments.isPending ? (
            <div className="p-4">
              <LoadingCard rows={2} />
            </div>
          ) : exceptions.length === 0 ? (
            <ListRow
              title="Nothing unreconciled"
              subtitle="Every payment this period matches the ledger"
            />
          ) : (
            exceptions
              .slice(0, 5)
              .map((p, i) => (
                <ListRow
                  key={p.id}
                  title={`${p.tenant_name} · ${p.unit_name}`}
                  subtitle={`${p.period_label} · due ${p.due_date}`}
                  value={money(p.amount)}
                  pill={<StatusPill status={p.status} tone="danger" />}
                  delay={i * 40}
                />
              ))
          )}
        </SectionCard>

        <SectionCard
          title="Urgent work orders"
          aside="SLA at risk"
          footer={
            <Link to="/maintenance" className="text-[12.5px] font-medium text-accent">
              Open work orders
            </Link>
          }
        >
          {work.isPending ? (
            <div className="p-4">
              <LoadingCard rows={2} />
            </div>
          ) : urgent.length === 0 ? (
            <ListRow title="No urgent work" subtitle="All high-priority requests are closed" />
          ) : (
            urgent
              .slice(0, 5)
              .map((w, i) => (
                <ListRow
                  key={w.id}
                  title={w.title}
                  subtitle={`${w.property_name} · ${w.unit_name}`}
                  pill={<StatusPill status={w.priority} tone="warning" />}
                  delay={i * 40}
                />
              ))
          )}
        </SectionCard>

        <SectionCard
          title="Owners"
          aside={`${owners.data?.length ?? 0} under contract`}
          footer={
            <Link to="/manager/owners" className="text-[12.5px] font-medium text-accent">
              Manage owners
            </Link>
          }
          className="lg:col-span-2"
        >
          {owners.isPending ? (
            <div className="p-4">
              <LoadingCard rows={3} />
            </div>
          ) : owners.data && owners.data.length > 0 ? (
            owners.data.map((owner, i) => (
              <ListRow
                key={owner.id}
                title={owner.name}
                subtitle={`${owner.units_managed} units · ${owner.occupied_units} occupied · fee ${owner.management_fee_pct ?? 0}%`}
                value={money(owner.collected_this_month)}
                pill={
                  <StatusPill
                    status={
                      owner.authority_status === "verified" ? "authorized" : owner.authority_status
                    }
                    tone={owner.authority_status === "verified" ? "success" : "warning"}
                  />
                }
                delay={i * 40}
              />
            ))
          ) : (
            <ListRow
              title="No owners yet"
              subtitle="Add an owner to record a management contract"
            />
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
