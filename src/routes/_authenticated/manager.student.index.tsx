import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AppShell,
  ListRow,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import {
  DataTable,
  DemoNotice,
  InlineError,
  LoadingCard,
  Modal,
  Select,
  Field,
} from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import {
  useManagementOrg,
  useStudentMetrics,
  useStudentProperties,
  useStudentRoster,
  useUpdateStudentConfig,
} from "@/lib/rentid";
import type { PolicyMode, StudentRosterRow } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/manager/student/")({
  head: () => ({
    meta: [{ title: "Student housing — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: StudentCommandCenter,
});

const PAYMENT_TONE: Record<
  StudentRosterRow["payment_state"],
  "success" | "warning" | "danger" | "accent"
> = {
  paid: "success",
  recorded_external: "accent",
  partial: "warning",
  unpaid: "danger",
};

const PAYMENT_LABEL: Record<StudentRosterRow["payment_state"], string> = {
  paid: "Paid",
  recorded_external: "Recorded external",
  partial: "Partial",
  unpaid: "Unpaid",
};

function StudentCommandCenter() {
  const active = useManagementOrg();
  const props = useStudentProperties(active.orgId);
  const metrics = useStudentMetrics(active.orgId);
  const [propertyId, setPropertyId] = useState<string>("all");
  const roster = useStudentRoster(active.orgId, propertyId === "all" ? undefined : { propertyId });
  const [configOpen, setConfigOpen] = useState<string | null>(null);

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
          description="This account isn't part of a management company yet."
        />
      </AppShell>
    );
  }

  const rows = roster.data ?? [];
  const m = metrics.data;
  const properties = props.data ?? [];
  const editing = properties.find((p) => p.property_id === configOpen) ?? null;

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title="Student housing"
        subtitle="Bed-level roster, payer separation and exceptions"
        action={
          <Link
            to="/manager/student/changes"
            className="inline-flex shrink-0 items-center rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-brand-foreground"
          >
            Lease changes
          </Link>
        }
      />

      <div className="mt-4">
        <DemoNotice>
          Student housing is a configuration on the same RentID graph — beds, roommates, payers and
          approvals reuse the platform's identity and lease records.
        </DemoNotice>
      </div>

      {m ? (
        <SummaryGrid
          className="mt-4"
          items={[
            { label: "Collected this month", value: money(m.collected_this_month) },
            {
              label: "Unpaid residents",
              value: m.unpaid_beds,
              tone: m.unpaid_beds ? "danger" : "success",
            },
            {
              label: "Partial payments",
              value: m.partial_residents,
              tone: m.partial_residents ? "warning" : "neutral",
            },
            { label: "Pending lease changes", value: m.pending_lease_changes, tone: "warning" },
            {
              label: "Guarantors incomplete",
              value: m.incomplete_guarantors,
              tone: m.incomplete_guarantors ? "warning" : "success",
            },
            {
              label: "Turn tasks open",
              value: m.turns_not_ready,
              tone: m.turns_not_ready ? "warning" : "success",
            },
            { label: "Beds tracked", value: m.beds_total },
            { label: "Student properties", value: properties.length },
          ]}
        />
      ) : (
        <div className="mt-4">
          <LoadingCard label="Loading metrics…" rows={2} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Eyebrow>Property</Eyebrow>
        <Select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          className="max-w-xs"
        >
          <option value="all">All student properties</option>
          {properties.map((p) => (
            <option key={p.property_id} value={p.property_id}>
              {p.property_name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard title="Roommate & bed roster" aside={`${rows.length} residents`}>
          {roster.isLoading ? (
            <div className="p-4">
              <LoadingCard label="Loading roster…" rows={4} />
            </div>
          ) : roster.isError ? (
            <div className="p-4">
              <InlineError message="Could not load the roster." onRetry={() => roster.refetch()} />
            </div>
          ) : (
            <DataTable
              rows={rows}
              empty={
                <EmptyState
                  title="No residents yet"
                  description="Add beds and occupancies to see the roster."
                />
              }
              columns={[
                {
                  key: "resident",
                  header: "Resident",
                  cell: (r) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.resident_name}</p>
                      <p className="num text-[11.5px] text-muted-foreground">
                        {r.unit_name} ·{" "}
                        {r.bed_label ? `Bed ${r.bed_label}` : `${r.share_pct ?? 0}% joint share`}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "property",
                  header: "Property",
                  hideOnMobile: true,
                  cell: (r) => <span className="text-muted-foreground">{r.property_name}</span>,
                },
                {
                  key: "payer",
                  header: "Paid by",
                  hideOnMobile: true,
                  cell: (r) => <span className="text-muted-foreground">{r.payer_summary}</span>,
                },
                {
                  key: "balance",
                  header: "Balance",
                  align: "right",
                  cell: (r) => <span className="num">{money(r.balance)}</span>,
                },
                {
                  key: "state",
                  header: "Status",
                  align: "right",
                  cell: (r) => (
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <StatusPill
                        status={PAYMENT_LABEL[r.payment_state]}
                        tone={PAYMENT_TONE[r.payment_state]}
                      />
                      {!r.guarantor_complete ? (
                        <StatusPill status="Guarantor" tone="warning" />
                      ) : null}
                      {r.pending_request ? (
                        <StatusPill
                          status={r.pending_request.request_type.replace(/_/g, " ")}
                          tone="accent"
                        />
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "open",
                  header: "",
                  align: "right",
                  cell: (r) => (
                    <Link
                      to="/manager/student/units/$unitId"
                      params={{ unitId: r.unit_id }}
                      className="text-[12px] font-semibold text-brand"
                    >
                      Ledger
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Property configuration" aside="Category-driven">
            {properties.length === 0 ? (
              <EmptyState
                title="No student properties"
                description="Turn on the student category on a property to configure it."
              />
            ) : (
              properties.map((p) => (
                <ListRow
                  key={p.property_id}
                  title={p.property_name}
                  subtitle={`${p.config.campus} · ${p.config.lease_model.replace(/_/g, " ")} · term ${p.current_term?.label ?? "—"}`}
                  pill={
                    <StatusPill
                      status={p.config.requires_owner_approval ? "Owner approval" : "PM approval"}
                      tone="accent"
                    />
                  }
                  onClick={() => setConfigOpen(p.property_id)}
                />
              ))
            )}
          </SectionCard>

          <Glass className="p-4">
            <Eyebrow>Exception queue</Eyebrow>
            <div className="mt-3 space-y-2">
              {rows
                .filter(
                  (r) => r.payment_state !== "paid" || !r.guarantor_complete || !r.move_in_ready,
                )
                .slice(0, 6)
                .map((r) => (
                  <div
                    key={r.occupancy_id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{r.resident_name}</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {r.payment_state !== "paid" && r.payment_state !== "recorded_external"
                          ? `${money(r.balance)} outstanding`
                          : !r.guarantor_complete
                            ? "Guarantor packet incomplete"
                            : "Bed not move-in ready"}
                      </p>
                    </div>
                    <Pill>{r.unit_name}</Pill>
                  </div>
                ))}
              {rows.every(
                (r) => r.payment_state === "paid" && r.guarantor_complete && r.move_in_ready,
              ) ? (
                <p className="text-[12.5px] text-muted-foreground">No exceptions right now.</p>
              ) : null}
            </div>
          </Glass>
        </div>
      </div>

      <ConfigModal property={editing} onClose={() => setConfigOpen(null)} />
    </AppShell>
  );
}

const POLICY_OPTIONS: PolicyMode[] = ["allowed", "conditional", "prohibited"];

function ConfigModal({
  property,
  onClose,
}: {
  property: {
    property_id: string;
    property_name: string;
    config: import("@/lib/types").StudentHousingConfig;
  } | null;
  onClose: () => void;
}) {
  const update = useUpdateStudentConfig();
  if (!property) return null;
  const c = property.config;

  const setPolicy = (
    key:
      "sublease_policy" | "assignment_policy" | "replacement_policy" | "early_termination_policy",
    value: PolicyMode,
  ) => update.mutate({ propertyId: property.property_id, patch: { [key]: value } });

  return (
    <Modal
      open
      onClose={onClose}
      title={property.property_name}
      description="Policies decide which lease changes residents may request and who must approve them."
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["sublease_policy", "Sublease"],
              ["assignment_policy", "Assignment"],
              ["replacement_policy", "Replacement resident"],
              ["early_termination_policy", "Early termination"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Select value={c[key]} onChange={(e) => setPolicy(key, e.target.value as PolicyMode)}>
                {POLICY_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        <Field label="Owner approval required">
          <Select
            value={c.requires_owner_approval ? "yes" : "no"}
            onChange={(e) =>
              update.mutate({
                propertyId: property.property_id,
                patch: { requires_owner_approval: e.target.value === "yes" },
              })
            }
          >
            <option value="no">Property manager only</option>
            <option value="yes">Owner approval required</option>
          </Select>
        </Field>
        <div className="rounded-xl bg-secondary/50 p-3">
          <Eyebrow>Accepted rails</Eyebrow>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {c.accepted_payment_rails.join(" · ")}
          </p>
          <Eyebrow className="mt-3">Required documents</Eyebrow>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {c.required_documents.join(" · ")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
