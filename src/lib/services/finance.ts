/**
 * Rent ledger + portfolio metrics — Supabase-backed (RLS-scoped).
 *
 * No money moves here. Off-platform rent is *recorded*: a landlord's record is
 * `landlord_reported`, a tenant's is `tenant_reported`. Neither is "verified" —
 * the database derives `payments.verified` from `verification_source` and only
 * the platform (settlement webhooks) can assert `platform_settled` /
 * `bank_linked`. The client therefore never writes `verified`.
 */
import { DbError, db, logAudit, nowIso, today, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import { toPayment } from "@/lib/db/mappers";
import { notifyOrganizationOwner, notifyUser } from "@/lib/services/operations";
import type { Tables } from "@/integrations/supabase/types";
import type { DashboardMetrics, Payment, PaymentWithContext, UUID } from "@/lib/types";

/** Tenant, property and unit names ride along on each row (one round-trip). */
const PAYMENT_SELECT =
  "*, tenancy:tenancies(tenant_name, tenant_user_id, property:properties(name), unit:units(name))";

type PaymentRow = Tables<"payments"> & {
  tenancy: {
    tenant_name: string;
    tenant_user_id: string | null;
    property: { name: string } | null;
    unit: { name: string } | null;
  } | null;
};

function hydratePayment(row: PaymentRow): PaymentWithContext {
  return {
    ...toPayment(row),
    tenant_name: row.tenancy?.tenant_name ?? "Tenant",
    property_name: row.tenancy?.property?.name ?? "—",
    unit_name: row.tenancy?.unit?.name ?? "—",
  };
}

const byDueDateDesc = <T extends { due_date: string }>(a: T, b: T) =>
  b.due_date.localeCompare(a.due_date);

/** "September 2026" for a due date — the same label accept_invitation() seeds. */
function periodLabel(dueDate: string): string {
  const date = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dueDate;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const money = (amount: number) =>
  `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* --------------------------------- reads ---------------------------------- */

export async function getPayments(orgId: UUID | null): Promise<PaymentWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("payments")
      .select(PAYMENT_SELECT)
      .eq("organization_id", orgId)
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as PaymentRow[]).map(hydratePayment).sort(byDueDateDesc);
}

export async function getPaymentsForTenancy(tenancyId: UUID): Promise<Payment[]> {
  const rows = unwrap(
    await db
      .from("payments")
      .select("*")
      .eq("tenancy_id", tenancyId)
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  );
  return rows.map(toPayment).sort(byDueDateDesc);
}

/* -------------------------------- writes ---------------------------------- */

/**
 * Landlord records rent received outside RentID. The row is
 * `landlord_reported`: it shows on the ledger and the tenant's history but is
 * not a verified payment (`verified` stays false — derived server-side).
 */
export async function recordPayment(input: {
  organizationId: UUID;
  tenancyId: UUID;
  amount: number;
  dueDate: string;
  method?: Payment["method"];
  memo?: string | null;
  actorId?: UUID | null;
}): Promise<Payment> {
  const tenancy = unwrapOne(
    await db
      .from("tenancies")
      .select("id, organization_id, unit_id, tenant_user_id, tenant_name")
      .eq("id", input.tenancyId)
      .single(),
    "Tenancy",
  );
  const row = unwrapOne(
    await db
      .from("payments")
      .insert({
        organization_id: input.organizationId, // re-derived from the tenancy by trigger
        tenancy_id: input.tenancyId,
        unit_id: tenancy.unit_id,
        amount: input.amount,
        status: "paid",
        method: input.method ?? "manual",
        due_date: input.dueDate,
        paid_at: nowIso(),
        period_label: periodLabel(input.dueDate),
        verification_source: "landlord_reported",
        memo: input.memo?.trim() || null,
      })
      .select("*")
      .single(),
    "Payment",
  );
  const payment = toPayment(row);

  await logAudit({
    organization_id: payment.organization_id,
    action: "payment.recorded",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: {
      amount: payment.amount,
      method: payment.method,
      source: payment.verification_source,
    },
  });
  await notifyUser({
    userId: tenancy.tenant_user_id,
    organizationId: payment.organization_id,
    kind: "payment",
    title: `Rent recorded for ${payment.period_label}`,
    body: `Your landlord recorded ${money(payment.amount)} as received (landlord-reported).`,
  });
  return payment;
}

type MarkPaidRow = Tables<"payments"> & { tenancy: { tenant_user_id: string | null } | null };

/**
 * Landlord marks a scheduled / pending / late payment as received. The row
 * becomes `landlord_reported` (never `platform_settled`) and `paid_at` is
 * stamped. Already-paid rows are left untouched so a platform-settled payment
 * can never be downgraded from here.
 */
export async function markPaymentPaid(paymentId: UUID, actorId?: UUID | null): Promise<Payment> {
  void actorId; // the audit trail and the trigger both use the session user
  const updated = unwrapMaybe(
    await db
      .from("payments")
      .update({ status: "paid", paid_at: nowIso(), verification_source: "landlord_reported" })
      .eq("id", paymentId)
      .neq("status", "paid")
      .select("*, tenancy:tenancies(tenant_user_id)")
      .maybeSingle(),
  ) as unknown as MarkPaidRow | null;

  if (!updated) {
    // Already paid (or not visible): return the current row unchanged.
    const current = unwrapOne(
      await db.from("payments").select("*").eq("id", paymentId).single(),
      "Payment",
    );
    return toPayment(current);
  }

  const payment = toPayment(updated);
  await logAudit({
    organization_id: payment.organization_id,
    action: "payment.marked_paid",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: { amount: payment.amount, source: payment.verification_source },
  });
  await notifyUser({
    userId: updated.tenancy?.tenant_user_id,
    organizationId: payment.organization_id,
    kind: "payment",
    title: `Rent for ${payment.period_label || "this period"} marked paid`,
    body: `Your landlord recorded ${money(payment.amount)} as received (landlord-reported).`,
  });
  return payment;
}

/**
 * Tenant records a payment they made outside RentID (`tenant_reported`,
 * unverified). RLS only allows this for the tenant on the tenancy; the
 * workspace owner is notified so they can confirm it.
 */
export async function recordTenantPayment(input: {
  tenancyId: UUID;
  amount: number;
  /** Rent period the payment covers; defaults to today. */
  dueDate?: string | null;
  /** When the tenant paid; defaults to now. */
  paidAt?: string | null;
  method?: Payment["method"];
  memo?: string | null;
  actorId?: UUID | null;
}): Promise<Payment> {
  if (!(input.amount > 0)) throw new Error("Enter the amount you paid.");
  const tenancy = unwrapOne(
    await db
      .from("tenancies")
      .select("id, organization_id, unit_id, tenant_name")
      .eq("id", input.tenancyId)
      .single(),
    "Tenancy",
  );
  const dueDate = input.dueDate ?? today();
  const row = unwrapOne(
    await db
      .from("payments")
      .insert({
        organization_id: tenancy.organization_id,
        tenancy_id: tenancy.id,
        unit_id: tenancy.unit_id,
        amount: input.amount,
        status: "paid",
        method: input.method ?? "manual",
        due_date: dueDate,
        paid_at: input.paidAt ?? nowIso(),
        period_label: periodLabel(dueDate),
        verification_source: "tenant_reported",
        memo: input.memo?.trim() || null,
      })
      .select("*")
      .single(),
    "Payment",
  );
  const payment = toPayment(row);

  await logAudit({
    organization_id: payment.organization_id,
    actor_role: "tenant",
    action: "payment.tenant_reported",
    entity_type: "payment",
    entity_id: payment.id,
    metadata: { amount: payment.amount, method: payment.method },
  });
  await notifyOrganizationOwner({
    organizationId: payment.organization_id,
    kind: "payment",
    title: `${tenancy.tenant_name} reported a rent payment`,
    body: `${money(payment.amount)} for ${payment.period_label} — tenant-reported, awaiting your confirmation.`,
  });
  return payment;
}

/* -------------------------------- metrics --------------------------------- */

const EMPTY_METRICS: DashboardMetrics = {
  rent_collected: 0,
  outstanding_rent: 0,
  occupied_units: 0,
  total_units: 0,
  late_payments: 0,
  open_maintenance: 0,
  leases_expiring: 0,
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Portfolio headline numbers, four queries:
 *   payments    — paid this month (by paid_at) + everything still owed
 *   units       — occupancy across the workspace
 *   maintenance — open / acknowledged / in progress count
 *   leases      — ending within 60 days
 */
export async function getDashboardMetrics(orgId: UUID | null): Promise<DashboardMetrics> {
  if (!orgId) return EMPTY_METRICS;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthEnd = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  const todayStr = today();
  const in60Days = isoDate(new Date(Date.now() + 60 * 86_400_000));

  const [paymentsRes, unitsRes, maintenanceRes, leasesRes] = await Promise.all([
    db
      .from("payments")
      .select("amount, status, due_date, paid_at")
      .eq("organization_id", orgId)
      .or(
        `and(status.eq.paid,paid_at.gte.${isoDate(monthStart)},paid_at.lt.${isoDate(nextMonthStart)}),` +
          `and(status.in.(scheduled,pending,late,failed),due_date.lte.${monthEnd})`,
      ),
    db.from("units").select("occupancy_status").eq("organization_id", orgId).is("deleted_at", null),
    db
      .from("maintenance_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("status", ["open", "acknowledged", "in_progress"]),
    db
      .from("leases")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .not("status", "in", "(ended,terminated)")
      .gte("end_date", todayStr)
      .lte("end_date", in60Days),
  ]);

  const payments = unwrap(paymentsRes);
  const units = unwrap(unitsRes);
  if (maintenanceRes.error) throw new DbError(maintenanceRes.error);
  if (leasesRes.error) throw new DbError(leasesRes.error);

  let rentCollected = 0;
  let outstanding = 0;
  let late = 0;
  for (const p of payments) {
    const amount = Number(p.amount ?? 0);
    if (p.status === "paid") {
      const paidAt = p.paid_at ? new Date(p.paid_at).getTime() : NaN;
      if (paidAt >= monthStart.getTime() && paidAt < nextMonthStart.getTime())
        rentCollected += amount;
      continue;
    }
    if (p.status === "late" || p.status === "failed") late += 1;
    if (
      (p.status === "scheduled" || p.status === "pending" || p.status === "late") &&
      p.due_date &&
      p.due_date <= monthEnd
    ) {
      outstanding += amount;
    }
  }

  return {
    rent_collected: rentCollected,
    outstanding_rent: outstanding,
    occupied_units: units.filter((u) => u.occupancy_status === "occupied").length,
    total_units: units.length,
    late_payments: late,
    open_maintenance: maintenanceRes.count ?? 0,
    leases_expiring: leasesRes.count ?? 0,
  };
}
