import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, DoorOpen } from "lucide-react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  EmptyState,
  Field,
  FormGrid,
  InlineError,
  ListRow,
  LoadingCard,
  Modal,
  PageHeader,
  SectionCard,
  StatusPill,
  TextInput,
  TrustBadge,
  VerificationChecklist,
} from "@/components/rentid/patterns";
import { money, shortDate } from "@/lib/format";
import {
  tenancyVerification,
  useEndTenancy,
  useTenancy,
  useUploadLease,
  useVerifyTenancy,
} from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenants/$tenancyId")({
  head: () => ({
    meta: [{ title: "Tenancy — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenancyDetail,
});

function TenancyDetail() {
  const { tenancyId } = Route.useParams();
  const tenancy = useTenancy(tenancyId);
  const verifyMutation = useVerifyTenancy();
  const endMutation = useEndTenancy();
  const uploadLease = useUploadLease();

  const [leaseOpen, setLeaseOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [securityDeposit, setSecurityDeposit] = useState("");
  const [rentDueDay, setRentDueDay] = useState("1");
  const [file, setFile] = useState<File | null>(null);

  if (tenancy.isLoading) {
    return (
      <AppShell>
        <LoadingCard label="Fetching tenancy…" />
      </AppShell>
    );
  }
  if (tenancy.isError) {
    return (
      <AppShell>
        <InlineError
          message={
            tenancy.error instanceof Error ? tenancy.error.message : "Could not load this tenancy."
          }
          onRetry={() => tenancy.refetch()}
        />
      </AppShell>
    );
  }
  const detail = tenancy.data;
  if (!detail) {
    return (
      <AppShell>
        <EmptyState
          title="Tenancy not found"
          description="This tenancy may belong to a different workspace."
          action={
            <Link
              to="/tenants"
              className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
            >
              Back to tenants
            </Link>
          }
        />
      </AppShell>
    );
  }

  const verification = tenancyVerification(detail);

  function openLeaseModal() {
    setStartDate(detail!.start_date ?? "");
    setEndDate(detail!.end_date ?? "");
    setMonthlyRent(detail!.monthly_rent != null ? String(detail!.monthly_rent) : "");
    setSecurityDeposit(detail!.security_deposit != null ? String(detail!.security_deposit) : "");
    setRentDueDay(String(detail!.lease?.rent_due_day ?? 1));
    setFile(null);
    setLeaseOpen(true);
  }

  function submitLease(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !startDate || !endDate || !monthlyRent) return;
    uploadLease.mutate(
      {
        organizationId: detail.organization_id,
        tenancyId: detail.id,
        unitId: detail.unit_id,
        startDate,
        endDate,
        monthlyRent: Number(monthlyRent),
        securityDeposit: securityDeposit ? Number(securityDeposit) : null,
        rentDueDay: Number(rentDueDay) || 1,
        fileName: file?.name ?? null,
        fileSize: file?.size ?? null,
        mimeType: file?.type ?? null,
        file: file ?? null,
      },
      {
        onSuccess: () => {
          setLeaseOpen(false);
          toast.success("Lease saved.");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Could not save the lease."),
      },
    );
  }

  return (
    <AppShell subtitle="Landlord">
      <PageHeader
        title={detail.tenant_name ?? "Tenant"}
        subtitle={[detail.property?.name ?? "", detail.unit?.name ?? ""]
          .filter(Boolean)
          .join(" · ")}
        action={
          detail.verified ? (
            <TrustBadge kind="verified_tenancy" size="md" />
          ) : (
            <Button
              onClick={() =>
                verifyMutation.mutate(detail.id, {
                  onSuccess: () => toast.success("Tenancy verified."),
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Could not verify this tenancy.",
                    ),
                })
              }
              loading={verifyMutation.isPending}
            >
              <BadgeCheck className="size-3.5" /> Mark verified
            </Button>
          )
        }
      />

      <SectionCard
        title="Verification"
        aside={verification.complete ? "Complete" : "Incomplete"}
        className="mt-5"
      >
        <div className="px-4 py-4">
          <VerificationChecklist checks={verification.checks} />
        </div>
      </SectionCard>

      <SectionCard title="Tenancy terms" className="mt-4">
        <ListRow
          title="Status"
          value={
            <StatusPill
              status={detail.status}
              tone={
                detail.status === "active"
                  ? "success"
                  : detail.status === "ended"
                    ? "neutral"
                    : "warning"
              }
            />
          }
        />
        <ListRow
          title="Term"
          subtitle={`${shortDate(detail.start_date)} → ${shortDate(detail.end_date)}`}
          value={
            detail.monthly_rent != null ? `${money(Number(detail.monthly_rent))}/mo` : undefined
          }
        />
        <ListRow
          title="Contact"
          subtitle={
            [detail.tenant_email ?? "", detail.tenant_phone ?? ""].filter(Boolean).join(" · ") ||
            "—"
          }
        />
        {detail.status !== "ended" ? (
          <div className="px-4 py-3">
            <Button tone="danger" size="sm" onClick={() => setEndOpen(true)}>
              <DoorOpen className="size-3.5" /> End tenancy
            </Button>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Lease"
        aside={detail.lease ? detail.lease.status : "None on file"}
        className="mt-4"
        footer={
          <Button tone="secondary" size="sm" onClick={openLeaseModal}>
            {detail.lease ? "Upload / replace lease" : "Upload lease"}
          </Button>
        }
      >
        {detail.lease ? (
          <ListRow
            title={`${shortDate(detail.lease.start_date)} → ${shortDate(detail.lease.end_date)}`}
            subtitle={`Rent due day ${detail.lease.rent_due_day} · deposit ${money(detail.lease.security_deposit ?? 0)}`}
            value={`${money(detail.lease.monthly_rent)}/mo`}
          />
        ) : (
          <div className="px-4 py-4 text-[12.5px] text-muted-foreground">
            No lease attached yet.
          </div>
        )}
      </SectionCard>

      <SectionCard title="Rent ledger" aside={`${detail.payments.length} entries`} className="mt-4">
        {detail.payments.length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-muted-foreground">
            No payments recorded yet.
          </div>
        ) : (
          detail.payments.map((p) => (
            <ListRow
              key={p.id}
              title={p.period_label}
              subtitle={`Due ${shortDate(p.due_date)}${p.paid_at ? ` · paid ${shortDate(p.paid_at)}` : ""}`}
              pill={
                <StatusPill
                  status={p.status}
                  tone={
                    p.status === "paid" ? "success" : p.status === "late" ? "danger" : "neutral"
                  }
                />
              }
              value={money(p.amount)}
            />
          ))
        )}
      </SectionCard>

      <SectionCard
        title="Maintenance history"
        aside={`${detail.maintenance.length} requests`}
        className="mt-4"
      >
        {detail.maintenance.length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-muted-foreground">
            No maintenance requests yet.
          </div>
        ) : (
          detail.maintenance.map((m) => (
            <ListRow
              key={m.id}
              title={m.title}
              subtitle={shortDate(m.created_at)}
              pill={
                <StatusPill
                  status={m.status.replace("_", " ")}
                  tone={m.status === "completed" ? "success" : "neutral"}
                />
              }
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="Documents" aside={`${detail.documents.length} on file`} className="mt-4">
        {detail.documents.length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-muted-foreground">No documents on file.</div>
        ) : (
          detail.documents.map((d) => (
            <ListRow
              key={d.id}
              title={d.title}
              subtitle={shortDate(d.created_at)}
              pill={<StatusPill status={d.kind} tone="neutral" />}
            />
          ))
        )}
      </SectionCard>

      <Modal
        open={leaseOpen}
        onClose={() => setLeaseOpen(false)}
        title="Upload / replace lease"
        description="File bytes are not persisted until Supabase Storage is connected — only lease metadata is saved for now."
      >
        <form onSubmit={submitLease} className="space-y-3.5">
          <FormGrid>
            <Field label="Start date" htmlFor="lease-start">
              <TextInput
                id="lease-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </Field>
            <Field label="End date" htmlFor="lease-end">
              <TextInput
                id="lease-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Monthly rent" htmlFor="lease-rent">
              <TextInput
                id="lease-rent"
                type="number"
                min="0"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                required
              />
            </Field>
            <Field label="Security deposit" htmlFor="lease-deposit" hint="Optional">
              <TextInput
                id="lease-deposit"
                type="number"
                min="0"
                value={securityDeposit}
                onChange={(e) => setSecurityDeposit(e.target.value)}
              />
            </Field>
            <Field label="Rent due day" htmlFor="lease-due-day">
              <TextInput
                id="lease-due-day"
                type="number"
                min="1"
                max="28"
                value={rentDueDay}
                onChange={(e) => setRentDueDay(e.target.value)}
              />
            </Field>
            <Field label="Lease file" htmlFor="lease-file" hint="Optional — metadata only for now">
              <TextInput
                id="lease-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          </FormGrid>
          <Button type="submit" className="w-full" loading={uploadLease.isPending}>
            Save lease
          </Button>
        </form>
      </Modal>

      <Modal
        open={endOpen}
        onClose={() => setEndOpen(false)}
        title="End this tenancy?"
        description="The unit will be marked vacant. This cannot be undone from here."
        footer={
          <>
            <Button tone="secondary" onClick={() => setEndOpen(false)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              loading={endMutation.isPending}
              onClick={() =>
                endMutation.mutate(detail.id, {
                  onSuccess: () => {
                    setEndOpen(false);
                    toast.success("Tenancy ended.");
                  },
                  onError: (err) =>
                    toast.error(err instanceof Error ? err.message : "Could not end this tenancy."),
                })
              }
            >
              End tenancy
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Ending {detail.tenant_name ?? "this tenant"}'s tenancy sets its status to ended and frees
          the unit.
        </p>
      </Modal>
    </AppShell>
  );
}
