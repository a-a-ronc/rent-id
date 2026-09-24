import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  InlineError,
  LoadingCard,
  Modal,
  PageHeader,
  SectionCard,
  Select,
  StatusPill,
  SummaryGrid,
  TextInput,
  ToolbarButton,
  TrustBadge,
} from "@/components/rentid/patterns";
import { money, monthLabel, shortDate } from "@/lib/format";
import {
  useActiveOrg,
  useMarkPaymentPaid,
  usePayments,
  useRecordPayment,
  useTenancies,
} from "@/lib/rentid";
import type { PaymentMethod, PaymentWithContext } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [{ title: "Payments — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: PaymentsPage,
});

const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  paid: "success",
  late: "danger",
  failed: "danger",
  pending: "warning",
  scheduled: "neutral",
  refunded: "neutral",
};

function PaymentsPage() {
  const active = useActiveOrg();
  const payments = usePayments(active.orgId);
  const markPaid = useMarkPaymentPaid();
  const [filter, setFilter] = useState<"all" | "due" | "paid">("all");

  const stats = useMemo(() => {
    const now = new Date();
    let collected = 0;
    let outstanding = 0;
    let upcoming = 0;
    let late = 0;
    for (const payment of payments.data ?? []) {
      const amount = Number(payment.amount);
      const due = payment.due_date ? new Date(`${payment.due_date}T00:00:00`) : null;
      if (payment.status === "paid") collected += amount;
      else if (due && due < now) {
        outstanding += amount;
        late += 1;
      } else upcoming += amount;
    }
    return { collected, outstanding, upcoming, late };
  }, [payments.data]);

  const rows = (payments.data ?? [])
    .filter((p) =>
      filter === "all" ? true : filter === "paid" ? p.status === "paid" : p.status !== "paid",
    )
    .slice()
    .sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""));

  async function pay(id: string) {
    try {
      await markPaid.mutateAsync(id);
      toast.success("Recorded as paid.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the payment.");
    }
  }

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader
        title="Payments"
        subtitle={active.org ? `${active.org.name} · ${monthLabel(new Date())}` : undefined}
        action={<RecordPaymentModal organizationId={active.orgId} />}
      />

      <SummaryGrid
        className="mt-5"
        items={[
          {
            label: "Collected",
            value: money(stats.collected),
            tone: "success",
            hint: "Recorded paid rent",
          },
          {
            label: "Outstanding",
            value: money(stats.outstanding),
            tone: stats.outstanding > 0 ? "warning" : "neutral",
            hint: "Past due",
          },
          { label: "Upcoming", value: money(stats.upcoming), tone: "neutral", hint: "Scheduled" },
          {
            label: "Late",
            value: String(stats.late),
            tone: stats.late > 0 ? "danger" : "neutral",
            hint: "Overdue records",
          },
        ]}
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {(["all", "due", "paid"] as const).map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={`rounded-full px-4 py-1.5 font-display text-[12px] font-medium capitalize transition-colors ${
              filter === option ? "bg-brand text-brand-foreground" : "glass text-muted-foreground"
            }`}
          >
            {option === "due" ? "Due / late" : option}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-4">
        {payments.isLoading ? (
          <LoadingCard label="Loading the rent ledger…" />
        ) : payments.isError ? (
          <InlineError
            message="Payments could not be loaded."
            onRetry={() => void payments.refetch()}
          />
        ) : (
          <SectionCard title="Rent ledger" aside={`${rows.length} records`}>
            <DataTable<PaymentWithContext>
              rows={rows}
              empty={
                <EmptyState
                  title="Nothing here"
                  description={
                    filter === "paid"
                      ? "No paid rent recorded yet."
                      : filter === "due"
                        ? "Everything is settled — no outstanding rent."
                        : "Rent records appear as tenancies are set up."
                  }
                />
              }
              columns={[
                {
                  key: "tenant",
                  header: "Tenant",
                  cell: (p) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.tenant_name}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {[p.property_name, p.unit_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "due",
                  header: "Due",
                  hideOnMobile: true,
                  cell: (p) => <span className="num">{shortDate(p.due_date)}</span>,
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (p) =>
                    p.status === "paid" ? (
                      <TrustBadge kind="verified_payment" label="Verified" />
                    ) : (
                      <StatusPill status={p.status} tone={TONE[p.status] ?? "neutral"} />
                    ),
                },
                {
                  key: "amount",
                  header: "Amount",
                  align: "right",
                  cell: (p) => <span className="num font-medium">{money(Number(p.amount))}</span>,
                },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  cell: (p) =>
                    p.status === "paid" ? null : (
                      <Button size="sm" onClick={() => void pay(p.id)}>
                        Mark paid
                      </Button>
                    ),
                },
              ]}
            />
          </SectionCard>
        )}
      </div>
    </AppShell>
  );
}

/* ----------------------------- record a payment ---------------------------- */

/**
 * Landlord records rent that arrived outside RentID — cash, check, Venmo, a
 * bank transfer. The row lands as `landlord_reported`, so it appears on both
 * ledgers and counts toward the tenant's history, but it never carries the
 * verified badge: that is reserved for money the platform itself settled.
 */
function RecordPaymentModal({ organizationId }: { organizationId: string | null }) {
  const tenancies = useTenancies(organizationId);
  const record = useRecordPayment();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    tenancyId: "",
    amount: "",
    dueDate: new Date().toISOString().slice(0, 10),
    method: "manual",
    memo: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const active = (tenancies.data ?? []).filter(
    (t) => t.status === "active" || t.status === "pending",
  );

  /** Prefill the amount from the tenancy's rent so the common case is one click. */
  function pickTenancy(id: string) {
    const tenancy = active.find((t) => t.id === id);
    setForm((f) => ({
      ...f,
      tenancyId: id,
      amount: f.amount || (tenancy?.monthly_rent ? String(tenancy.monthly_rent) : ""),
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !form.tenancyId) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    try {
      await record.mutateAsync({
        organizationId,
        tenancyId: form.tenancyId,
        amount,
        dueDate: form.dueDate,
        method: form.method as PaymentMethod,
        memo: form.memo.trim() || null,
      });
      toast.success("Payment recorded.");
      setOpen(false);
      setForm({
        tenancyId: "",
        amount: "",
        dueDate: new Date().toISOString().slice(0, 10),
        method: "manual",
        memo: "",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the payment.");
    }
  }

  return (
    <>
      <ToolbarButton label="Record rent" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Record rent received">
        <form onSubmit={submit} className="space-y-3.5">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            For rent paid outside RentID. It joins the tenant's history as landlord-reported —
            honest and useful, but not the verified badge another landlord relies on.
          </p>
          <Field label="Tenant" htmlFor="p-tenancy">
            <Select
              id="p-tenancy"
              value={form.tenancyId}
              onChange={(e) => pickTenancy(e.target.value)}
              required
            >
              <option value="">Select a tenancy…</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tenant_name}
                  {t.monthly_rent ? ` — ${money(t.monthly_rent)}/mo` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <FormGrid>
            <Field label="Amount" htmlFor="p-amount">
              <TextInput
                id="p-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                required
                placeholder="1400"
              />
            </Field>
            <Field label="Due date" htmlFor="p-due">
              <TextInput
                id="p-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
                required
              />
            </Field>
          </FormGrid>
          <Field label="Method" htmlFor="p-method">
            <Select
              id="p-method"
              value={form.method}
              onChange={(e) => set("method", e.target.value)}
            >
              <option value="manual">Manual / other</option>
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="ach">Bank transfer (ACH)</option>
            </Select>
          </Field>
          <Field label="Memo" htmlFor="p-memo">
            <TextInput
              id="p-memo"
              value={form.memo}
              onChange={(e) => set("memo", e.target.value)}
              placeholder="Check #1042"
            />
          </Field>
          <Button
            type="submit"
            loading={record.isPending}
            disabled={!form.tenancyId}
            className="w-full"
          >
            Record payment
          </Button>
        </form>
      </Modal>
    </>
  );
}
