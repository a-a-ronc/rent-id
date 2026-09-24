import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AppShell,
  PageHeader,
  SectionCard,
  StatusPill,
  SummaryGrid,
} from "@/components/rentid/patterns";
import {
  Button,
  DataTable,
  DemoNotice,
  Field,
  LoadingCard,
  Modal,
  Select,
  TextInput,
} from "@/components/rentid/kit";
import { EmptyState, Eyebrow, Glass, Pill } from "@/components/rentid/Surface";
import { money } from "@/lib/format";
import {
  useRecordStudentPayment,
  useStudentChargeContext,
  useStudentLedgerEvents,
  useStudentUnitLedger,
} from "@/lib/rentid";
import type { StudentPaymentMethod } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/manager/student/units/$unitId")({
  head: () => ({
    meta: [{ title: "Unit ledger — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: UnitLedgerPage,
});

function UnitLedgerPage() {
  const { unitId } = Route.useParams();
  const ledger = useStudentUnitLedger(unitId);
  const events = useStudentLedgerEvents(unitId);
  const [payChargeId, setPayChargeId] = useState<string | null>(null);

  if (ledger.isLoading) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <LoadingCard label="Loading unit ledger…" rows={5} />
      </AppShell>
    );
  }

  const data = ledger.data;
  if (!data) {
    return (
      <AppShell subtitle="Property manager" role="manager">
        <EmptyState
          title="Unit not found"
          description="This unit isn't part of a student-housing property."
        />
      </AppShell>
    );
  }

  return (
    <AppShell subtitle="Property manager" role="manager">
      <PageHeader
        title={`${data.unit_name} · ${data.property_name}`}
        subtitle={`${data.campus} · ${data.lease_model.replace(/_/g, " ")} · term ${data.term_label ?? "—"}`}
        action={
          <Link
            to="/manager/student"
            className="inline-flex shrink-0 items-center rounded-full border border-border px-4 py-2 text-[13px] font-semibold"
          >
            Back to roster
          </Link>
        }
      />

      <SummaryGrid
        className="mt-4"
        items={[
          {
            label: "Unit balance",
            value: money(data.total_balance),
            tone: data.total_balance ? "warning" : "success",
          },
          { label: "Residents", value: data.residents.length },
          { label: "Beds", value: data.beds.length || "Joint lease" },
          {
            label: "Open requests",
            value: data.requests.filter((r) => !["completed", "denied"].includes(r.state)).length,
          },
        ]}
      />

      <div className="mt-4">
        <DemoNotice>
          One resident's unpaid balance never hides another's payment: obligations are per person,
          and the payer is recorded separately from who owes it.
        </DemoNotice>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <SectionCard title="Beds & residents" aside={data.lease_model.replace(/_/g, " ")}>
            {data.beds.length > 0
              ? data.beds.map((bed) => (
                  <div key={bed.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">
                        Bed {bed.bed_label} · {bed.room_label}
                      </p>
                      <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                        {bed.resident ? bed.resident.resident_name : "Available"} ·{" "}
                        {money(bed.monthly_rent)} / month
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusPill
                        status={bed.status.replace(/_/g, " ")}
                        tone={bed.status === "occupied" ? "success" : "accent"}
                      />
                      <StatusPill
                        status={bed.ready ? "Ready" : "Not ready"}
                        tone={bed.ready ? "success" : "warning"}
                      />
                    </div>
                  </div>
                ))
              : data.residents.map((r) => (
                  <div key={r.occupancy_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium">{r.resident_name}</p>
                      <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                        {r.share_pct ?? 0}% of the joint household lease · paid by {r.payer_summary}
                      </p>
                    </div>
                    <span className="num text-[14px] font-medium">{money(r.balance)}</span>
                  </div>
                ))}
          </SectionCard>

          <SectionCard title="Charges" aside={`${data.charges.length} lines`}>
            <DataTable
              rows={data.charges}
              empty={
                <EmptyState
                  title="No charges"
                  description="Rent and fees for this unit will appear here."
                />
              }
              columns={[
                {
                  key: "label",
                  header: "Charge",
                  cell: (c) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.label}</p>
                      <p className="num text-[11.5px] text-muted-foreground">
                        {c.assigned_to} · due {c.due_date}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "source",
                  header: "Source",
                  hideOnMobile: true,
                  cell: (c) => <span className="text-muted-foreground">{c.source_status}</span>,
                },
                {
                  key: "amount",
                  header: "Amount",
                  align: "right",
                  cell: (c) => <span className="num">{money(c.amount)}</span>,
                },
                {
                  key: "balance",
                  header: "Balance",
                  align: "right",
                  cell: (c) => <span className="num">{money(c.balance)}</span>,
                },
                {
                  key: "act",
                  header: "",
                  align: "right",
                  cell: (c) =>
                    c.gated_on_request_id ? (
                      <StatusPill status="Gated" tone="warning" />
                    ) : c.balance > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPayChargeId(c.id)}
                        className="text-[12px] font-semibold text-brand"
                      >
                        Record
                      </button>
                    ) : (
                      <StatusPill status="Settled" tone="success" />
                    ),
                },
              ]}
            />
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Ledger history" aside="Append-only">
            {(events.data ?? []).length === 0 ? (
              <EmptyState
                title="No ledger events"
                description="Charges and payments will be recorded here."
              />
            ) : (
              (events.data ?? []).map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium capitalize">
                      {e.kind.replace(/_/g, " ")}
                    </p>
                    <span className="num text-[13px]">{money(e.amount)}</span>
                  </div>
                  <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString()} · balance after{" "}
                    {money(e.balance_after)}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                </div>
              ))
            )}
          </SectionCard>

          <Glass className="p-4">
            <Eyebrow>Open requests on this unit</Eyebrow>
            <div className="mt-3 space-y-2">
              {data.requests.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">No lease-change requests.</p>
              ) : (
                data.requests.map((r) => (
                  <div key={r.id} className="rounded-xl bg-secondary/50 px-3 py-2">
                    <p className="text-[13px] font-medium capitalize">
                      {r.request_type.replace(/_/g, " ")} · {r.resident_name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Pill>{r.state.replace(/_/g, " ")}</Pill>
                      <Pill>{r.policy_mode}</Pill>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Glass>

          <SectionCard title="Maintenance & damage" aside={`${data.maintenance.length} cases`}>
            {data.maintenance.length === 0 ? (
              <EmptyState
                title="No cases"
                description="Private-room and shared-area cases show up here."
              />
            ) : (
              data.maintenance.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium">{c.issue}</p>
                    <StatusPill
                      status={c.status.replace(/_/g, " ")}
                      tone={c.status === "disputed" ? "warning" : "accent"}
                    />
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {c.area_label} · {c.evidence.length} evidence file(s)
                    {c.damage_amount ? ` · ${money(c.damage_amount)} damage` : ""}
                  </p>
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>

      <RecordPaymentModal chargeId={payChargeId} onClose={() => setPayChargeId(null)} />
    </AppShell>
  );
}

const METHODS: { value: StudentPaymentMethod; label: string; processed: boolean }[] = [
  { value: "rentid_ach", label: "RentID bank transfer", processed: true },
  { value: "card", label: "RentID debit card", processed: true },
  { value: "check", label: "Check (recorded)", processed: false },
  { value: "bank_billpay", label: "Bank bill-pay (recorded)", processed: false },
  { value: "cash", label: "Cash (recorded)", processed: false },
  { value: "money_order", label: "Money order (recorded)", processed: false },
];

function RecordPaymentModal({
  chargeId,
  onClose,
}: {
  chargeId: string | null;
  onClose: () => void;
}) {
  const ctx = useStudentChargeContext(chargeId);
  const record = useRecordStudentPayment();
  const [payerId, setPayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<StudentPaymentMethod>("rentid_ach");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!chargeId) return null;
  const data = ctx.data;
  const chosen = METHODS.find((m) => m.value === method)!;
  const payers = data?.payers ?? [];
  const activePayer = payerId || payers[0]?.id || "";

  async function submit() {
    if (!data) return;
    setError(null);
    try {
      await record.mutateAsync({
        organizationId: data.charge.organization_id,
        chargeId: data.charge.id,
        payerId: activePayer,
        amount: Number(amount) || data.charge.amount - data.paid,
        method,
        processedByRentID: chosen.processed,
        reference: reference || null,
        proofLabel: chosen.processed ? null : "Proof attached",
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payment"
      description="External payments are recorded and reconciled — RentID never claims to have processed them."
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!data || record.isPending}>
            {record.isPending ? "Saving…" : "Save payment"}
          </Button>
        </>
      }
    >
      {!data ? (
        <LoadingCard label="Loading charge…" rows={2} />
      ) : (
        <div className="space-y-3">
          <Glass className="p-3">
            <p className="text-[13px] font-medium">{data.charge.label}</p>
            <p className="num mt-0.5 text-[11.5px] text-muted-foreground">
              {money(data.charge.amount)} charged · {money(data.paid)} paid · due{" "}
              {data.charge.due_date}
            </p>
          </Glass>
          <Field
            label="Paid by"
            hint="The payer is stored separately from the resident who owes the charge."
          >
            <Select value={activePayer} onChange={(e) => setPayerId(e.target.value)}>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.kind.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Method">
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as StudentPaymentMethod)}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount">
            <TextInput
              type="number"
              value={amount}
              placeholder={String(Math.max(0, data.charge.amount - data.paid))}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label={chosen.processed ? "Reference" : "Proof reference"}>
            <TextInput
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #1042"
            />
          </Field>
          {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
