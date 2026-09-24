import { createFileRoute } from "@tanstack/react-router";

import {
  AppShell,
  DataTable,
  PageHeader,
  SectionCard,
  StatusPill,
  TrustBadge,
} from "@/components/rentid/patterns";
import { DemoNotice, EmptyState } from "@/components/rentid/patterns";
import { DisclosureNotice } from "@/components/rentid/verification-ui";
import { money, shortDate } from "@/lib/format";
import { useMyTenancies } from "@/lib/rentid";
import type { Payment } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/tenant/pay")({
  head: () => ({ meta: [{ title: "Payments — RentID" }, { name: "robots", content: "noindex" }] }),
  component: PayPage,
});

const STATUS_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  paid: "success",
  late: "danger",
  pending: "warning",
  scheduled: "neutral",
  failed: "danger",
  refunded: "neutral",
};

function PayPage() {
  const tenancies = useMyTenancies();
  const active =
    (tenancies.data ?? []).find((t) => t.status === "active") ?? (tenancies.data ?? [])[0];
  const payments = [...(active?.payments ?? [])].sort((a, b) =>
    b.due_date.localeCompare(a.due_date),
  );
  const upcoming = payments
    .filter((p) => p.status !== "paid")
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  return (
    <AppShell subtitle="Tenant">
      <PageHeader title="Payments" subtitle={active?.property?.name} />

      <div className="mt-4">
        <DisclosureNotice propertyId={active?.property?.id ?? null} context="payment" />
      </div>

      <div className="mt-4">
        <DemoNotice>
          Online rent payments arrive with Stripe. For now, rent is recorded by your landlord once
          received — this page shows that record, not a place to pay.
        </DemoNotice>
      </div>

      {tenancies.isLoading ? (
        <div className="mt-4">
          <EmptyState title="Loading…" description="Fetching payment history." />
        </div>
      ) : !active ? (
        <div className="mt-4">
          <EmptyState
            title="No tenancy yet"
            description="Payment history will appear once you have an active tenancy."
          />
        </div>
      ) : (
        <>
          {upcoming && (
            <SectionCard title="Upcoming rent" className="mt-4">
              <div className="flex items-center justify-between px-4 py-4">
                <div>
                  <p className="text-[13.5px] font-medium">Due {shortDate(upcoming.due_date)}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {upcoming.period_label}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill
                    status={upcoming.status}
                    tone={STATUS_TONE[upcoming.status] ?? "neutral"}
                  />
                  <span className="num text-[16px] font-semibold">{money(upcoming.amount)}</span>
                </div>
              </div>
            </SectionCard>
          )}

          <SectionCard
            title="Payment history"
            aside={`${payments.length} records`}
            className="mt-4"
          >
            <div className="px-2 py-2">
              <DataTable<Payment>
                rows={payments}
                empty={
                  <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                    No payments recorded yet.
                  </p>
                }
                columns={[
                  { key: "period", header: "Period", cell: (p) => p.period_label },
                  {
                    key: "due",
                    header: "Due",
                    cell: (p) => shortDate(p.due_date),
                    hideOnMobile: true,
                  },
                  { key: "amount", header: "Amount", cell: (p) => money(p.amount), align: "right" },
                  {
                    key: "status",
                    header: "Status",
                    cell: (p) =>
                      p.verified ? (
                        <TrustBadge kind="verified_payment" />
                      ) : (
                        <StatusPill status={p.status} tone={STATUS_TONE[p.status] ?? "neutral"} />
                      ),
                  },
                ]}
              />
            </div>
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
