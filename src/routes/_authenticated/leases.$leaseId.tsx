import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

import { OpenDocumentButton } from "@/components/rentid/OpenDocumentButton";

import {
  AppShell,
  EmptyState,
  InlineError,
  ListRow,
  LoadingCard,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/rentid/patterns";
import { daysUntil, money, shortDate } from "@/lib/format";
import { useLease } from "@/lib/rentid";
import type { LeaseStatus } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/leases/$leaseId")({
  head: () => ({
    meta: [{ title: "Lease — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: LeaseDetailPage,
});

const TONE: Record<LeaseStatus, "success" | "warning" | "neutral" | "danger"> = {
  draft: "neutral",
  active: "success",
  expiring: "warning",
  ended: "neutral",
  terminated: "danger",
};

function LeaseDetailPage() {
  const { leaseId } = Route.useParams();
  const lease = useLease(leaseId);

  if (lease.isLoading) {
    return (
      <AppShell>
        <LoadingCard label="Fetching lease…" />
      </AppShell>
    );
  }
  if (lease.isError) {
    return (
      <AppShell>
        <InlineError
          message={
            lease.error instanceof Error ? lease.error.message : "Could not load this lease."
          }
          onRetry={() => lease.refetch()}
        />
      </AppShell>
    );
  }
  const detail = lease.data;
  if (!detail) {
    return (
      <AppShell>
        <EmptyState
          title="Lease not found"
          description="This lease may belong to a different workspace."
          action={
            <Link
              to="/leases"
              className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
            >
              Back to leases
            </Link>
          }
        />
      </AppShell>
    );
  }

  const daysLeft = daysUntil(detail.end_date);
  const expiringSoon =
    daysLeft != null &&
    daysLeft >= 0 &&
    daysLeft <= 30 &&
    detail.status !== "ended" &&
    detail.status !== "terminated";

  return (
    <AppShell subtitle="Landlord">
      <PageHeader
        title={`Lease · ${detail.tenancy?.tenant_name ?? "Tenant"}`}
        subtitle={[detail.property?.name ?? "", detail.unit?.name ?? ""]
          .filter(Boolean)
          .join(" · ")}
        action={<StatusPill status={detail.status} tone={TONE[detail.status]} />}
      />

      {expiringSoon ? (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-warning/25 bg-warning/8 px-4 py-3 text-[12.5px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            This lease ends in {daysLeft} day{daysLeft === 1 ? "" : "s"} — consider renewing or
            ending the tenancy.
          </span>
        </div>
      ) : null}

      <SectionCard title="Terms" className="mt-4">
        <ListRow
          title="Term"
          subtitle={`${shortDate(detail.start_date)} → ${shortDate(detail.end_date)}`}
          value={`${money(detail.monthly_rent)}/mo`}
        />
        <ListRow title="Security deposit" value={money(detail.security_deposit ?? 0)} />
        <ListRow title="Rent due day" value={String(detail.rent_due_day)} />
        <ListRow
          title="Late fee"
          value={detail.late_fee != null ? money(detail.late_fee) : "None"}
        />
        <ListRow
          title="Signed"
          value={detail.signed_at ? shortDate(detail.signed_at) : "Not signed"}
        />
      </SectionCard>

      <SectionCard title="Linked records" className="mt-4">
        <ListRow
          title="Tenant"
          subtitle={detail.tenancy?.tenant_name ?? "—"}
          value={
            detail.tenancy ? (
              <Link
                to="/tenants/$tenancyId"
                params={{ tenancyId: detail.tenancy.id }}
                className="text-[12.5px] font-medium text-brand"
              >
                View tenancy
              </Link>
            ) : undefined
          }
        />
        <ListRow title="Unit" subtitle={detail.unit?.name ?? "—"} />
        <ListRow title="Property" subtitle={detail.property?.name ?? "—"} />
      </SectionCard>

      <SectionCard title="Attached document" className="mt-4">
        {detail.document ? (
          <>
            <ListRow
              title={detail.document.title}
              subtitle={`${detail.document.mime_type ?? "unknown type"} · ${detail.document.size_bytes ? `${Math.round(detail.document.size_bytes / 1024)} KB` : "size unknown"}`}
              pill={<StatusPill status={detail.document.kind} tone="neutral" />}
              value={<OpenDocumentButton storagePath={detail.document.storage_path} />}
            />
          </>
        ) : (
          <div className="px-4 py-4 text-[12.5px] text-muted-foreground">
            No document attached to this lease.
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
