/**
 * Property-management layer (business map §7) — Supabase-backed (RLS-scoped).
 *
 * A PM organization operates properties it does not own. Owner→property→PM
 * authority lives in `management_assignments`, separate from ownership, so an
 * owner can replace a manager without losing property, lease or payment
 * history. A manager may only REQUEST authority (the trigger forces `pending`);
 * the owning organization confirms, disputes or revokes it. Once confirmed,
 * the manager reads the property, its units, tenancies, rent ledger and work
 * orders (`*_select_managed` policies) — writes stay with the owner.
 */
import { db, DbError, logAudit, nowIso, unwrap, unwrapOne } from "@/lib/db";
import {
  toManagementAssignment,
  toMaintenance,
  toOrganization,
  toOwnerAccount,
  toPayment,
  toProperty,
  toUnit,
} from "@/lib/db/mappers";
import { providerProfilesFor } from "@/lib/services/marketplace";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import type {
  MaintenanceWithContext,
  ManagementAssignment,
  Organization,
  OwnerAccount,
  OwnerAccountWithContext,
  PaymentWithContext,
  PmPortfolioMetrics,
  PropertyWithUnits,
  UUID,
} from "@/lib/types";

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** First and last day of the current month (ISO dates, UTC). */
function currentMonth() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

type PropertyRowWithUnits = Tables<"properties"> & { units: Tables<"units">[] };

function hydrateProperty(row: PropertyRowWithUnits): PropertyWithUnits {
  return {
    ...toProperty(row),
    units: row.units
      .filter((u) => u.deleted_at === null)
      .map(toUnit)
      .sort(byName),
  };
}

/** The property-management workspaces this user belongs to (RLS-scoped; `userId` kept for hook compatibility). */
export async function getManagementOrganizations(userId: UUID | null): Promise<Organization[]> {
  if (!userId) return [];
  const rows = unwrap(
    await db
      .from("organizations")
      .select("*")
      .eq("kind", "property_manager")
      .is("deleted_at", null)
      .order("is_demo", { ascending: true })
      .order("created_at", { ascending: false }),
  );
  return rows.map(toOrganization);
}

/**
 * Properties assigned to a PM organization (not revoked). RLS only returns
 * the property rows once the owner has confirmed the authority, so pending
 * assignments contribute nothing here.
 */
async function managedPropertyIds(orgId: UUID): Promise<UUID[]> {
  const rows = unwrap(
    await db
      .from("management_assignments")
      .select("property_id")
      .eq("organization_id", orgId)
      .is("revoked_at", null),
  );
  return [...new Set(rows.map((r) => r.property_id))];
}

/** Properties a PM organization is authorized to manage, with their units. */
export async function getManagedProperties(orgId: UUID | null): Promise<PropertyWithUnits[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("management_assignments")
      .select("property:properties(*, units(*))")
      .eq("organization_id", orgId)
      .is("revoked_at", null),
  ) as unknown as { property: PropertyRowWithUnits | null }[];
  const seen = new Set<UUID>();
  const properties: PropertyWithUnits[] = [];
  for (const row of rows) {
    const property = row.property;
    if (!property || property.deleted_at !== null || seen.has(property.id)) continue;
    seen.add(property.id);
    properties.push(hydrateProperty(property));
  }
  return properties.sort(byName);
}

type OwnerRow = Tables<"owner_accounts"> & {
  assignments: (Tables<"management_assignments"> & { property: PropertyRowWithUnits | null })[];
};

/** Rent collected this month per property, over the tenancies on the given properties. */
async function collectedThisMonthByProperty(propertyIds: UUID[]): Promise<Map<UUID, number>> {
  const collected = new Map<UUID, number>();
  if (propertyIds.length === 0) return collected;
  const tenancies = unwrap(
    await db.from("tenancies").select("id, property_id").in("property_id", propertyIds),
  );
  if (tenancies.length === 0) return collected;
  const propertyOfTenancy = new Map(tenancies.map((t) => [t.id, t.property_id] as const));
  const month = currentMonth();
  const payments = unwrap(
    await db
      .from("payments")
      .select("tenancy_id, amount")
      .in(
        "tenancy_id",
        tenancies.map((t) => t.id),
      )
      .eq("status", "paid")
      .gte("due_date", month.start)
      .lte("due_date", month.end),
  );
  for (const p of payments) {
    const propertyId = propertyOfTenancy.get(p.tenancy_id);
    if (!propertyId) continue;
    collected.set(propertyId, (collected.get(propertyId) ?? 0) + Number(p.amount ?? 0));
  }
  return collected;
}

export async function getOwnerAccounts(orgId: UUID | null): Promise<OwnerAccountWithContext[]> {
  if (!orgId) return [];
  const owners = unwrap(
    await db
      .from("owner_accounts")
      .select("*, assignments:management_assignments(*, property:properties(*, units(*)))")
      .eq("organization_id", orgId),
  ) as unknown as OwnerRow[];

  const propertyIds = [
    ...new Set(
      owners.flatMap((o) =>
        (o.assignments ?? [])
          .filter((a) => a.revoked_at === null && a.property && a.property.deleted_at === null)
          .map((a) => a.property_id),
      ),
    ),
  ];
  const collected = await collectedThisMonthByProperty(propertyIds);

  return owners
    .map((owner) => {
      const active = (owner.assignments ?? [])
        .filter((a) => a.revoked_at === null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const properties = active
        .map((a) => a.property)
        .filter((p): p is PropertyRowWithUnits => Boolean(p) && p!.deleted_at === null)
        .map(hydrateProperty)
        .sort(byName);
      const units = properties.flatMap((p) => p.units);
      return {
        ...toOwnerAccount(owner),
        properties: properties.map(({ units: _units, ...property }) => property),
        units_managed: units.length,
        occupied_units: units.filter((u) => u.occupancy_status === "occupied").length,
        collected_this_month: properties.reduce((sum, p) => sum + (collected.get(p.id) ?? 0), 0),
        authority_status: active[0]?.authority_status ?? "pending",
      };
    })
    .sort((a, b) => b.units_managed - a.units_managed);
}

export async function createOwnerAccount(input: {
  organizationId: UUID;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  managementFeePct?: number | null;
  actorId?: UUID | null;
}): Promise<OwnerAccount> {
  void input.actorId; // the audit trail uses the session user
  const row = unwrapOne(
    await db
      .from("owner_accounts")
      .insert({
        organization_id: input.organizationId,
        name: input.name.trim(),
        contact_name: input.contactName?.trim() || null,
        contact_email: input.contactEmail?.trim().toLowerCase() || null,
        contract_start: nowIso().slice(0, 10),
        management_fee_pct: input.managementFeePct ?? null,
      })
      .select("*")
      .single(),
    "Owner account",
  );
  const owner = toOwnerAccount(row);
  await logAudit({
    organization_id: input.organizationId,
    actor_role: "property_manager",
    action: "owner_account.created",
    entity_type: "owner_account",
    entity_id: owner.id,
    metadata: { name: owner.name },
  });
  return owner;
}

/**
 * Record owner-granted authority to manage a property. Authority starts
 * `pending` (forced by trigger for anyone but the owner or the platform) until
 * the owner confirms — badges and listings stay gated.
 */
export async function assignPropertyToManager(input: {
  organizationId: UUID;
  ownerAccountId: UUID;
  propertyId: UUID;
  actorId?: UUID | null;
}): Promise<ManagementAssignment> {
  void input.actorId;
  const row = unwrapOne(
    await db
      .from("management_assignments")
      .insert({
        organization_id: input.organizationId,
        owner_account_id: input.ownerAccountId,
        property_id: input.propertyId,
        authority_status: "pending",
      })
      .select("*")
      .single(),
    "Management assignment",
  );
  const assignment = toManagementAssignment(row);
  await logAudit({
    organization_id: input.organizationId,
    actor_role: "property_manager",
    action: "management_authority.requested",
    entity_type: "management_assignment",
    entity_id: assignment.id,
  });
  return assignment;
}

/**
 * Owner confirms, disputes or revokes management authority. The database only
 * lets the property's owning organization (or the platform) change the
 * status; a manager confirming itself is refused (42501).
 */
export async function setManagementAuthority(
  assignmentId: UUID,
  status: "verified" | "disputed" | "revoked",
  actorId?: UUID | null,
): Promise<ManagementAssignment> {
  void actorId;
  const update: TablesUpdate<"management_assignments"> =
    status === "revoked" ? { revoked_at: nowIso() } : { authority_status: status };
  const row = unwrapOne(
    await db
      .from("management_assignments")
      .update(update)
      .eq("id", assignmentId)
      .select("*")
      .single(),
    "Management assignment",
  );
  const assignment = toManagementAssignment(row);
  await logAudit({
    organization_id: assignment.organization_id,
    action: `management_authority.${status}`,
    entity_type: "management_assignment",
    entity_id: assignment.id,
  });
  return assignment;
}

/** Portfolio-level operating KPIs for the PM dashboard. */
export async function getPmPortfolioMetrics(orgId: UUID | null): Promise<PmPortfolioMetrics> {
  const empty: PmPortfolioMetrics = {
    units_managed: 0,
    owners: 0,
    collected_this_month: 0,
    open_work_orders: 0,
    urgent_work_orders: 0,
    median_first_response_hours: 0,
    resolved_under_72h_pct: 0,
    collection_rate_pct: 0,
  };
  if (!orgId) return empty;

  const propertyIds = await managedPropertyIds(orgId);
  const [ownersRes, profiles] = await Promise.all([
    db
      .from("owner_accounts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    providerProfilesFor([orgId]),
  ]);
  if (ownersRes.error) throw new DbError(ownersRes.error);
  const profile = profiles.get(orgId) ?? null;
  const metrics: PmPortfolioMetrics = {
    ...empty,
    owners: ownersRes.count ?? 0,
    median_first_response_hours: profile?.median_first_response_hours ?? 0,
    resolved_under_72h_pct: profile?.resolved_under_72h_pct ?? 0,
    collection_rate_pct: profile?.collection_rate_pct ?? 0,
  };
  if (propertyIds.length === 0) return metrics;

  const [unitsRes, workRes, collected] = await Promise.all([
    db.from("units").select("id").in("property_id", propertyIds).is("deleted_at", null),
    db
      .from("maintenance_requests")
      .select("priority")
      .in("property_id", propertyIds)
      .not("status", "in", "(completed,cancelled)"),
    collectedThisMonthByProperty(propertyIds),
  ]);
  const work = unwrap(workRes);
  metrics.units_managed = unwrap(unitsRes).length;
  metrics.collected_this_month = [...collected.values()].reduce((sum, amount) => sum + amount, 0);
  metrics.open_work_orders = work.length;
  metrics.urgent_work_orders = work.filter(
    (m) => m.priority === "high" || m.priority === "emergency",
  ).length;
  return metrics;
}

/* ----------------------- managed-portfolio operations ---------------------- */

type ManagedTenancyRow = {
  id: string;
  tenant_name: string;
  property: { name: string } | null;
  unit: { name: string } | null;
};

/**
 * Rent ledger for the properties a PM is authorized to manage. Payments belong
 * to the owning landlord organization, so they are scoped by property authority
 * (`payments_select_managed`) rather than by `organization_id`.
 */
export async function getManagedPayments(orgId: UUID | null): Promise<PaymentWithContext[]> {
  if (!orgId) return [];
  const propertyIds = await managedPropertyIds(orgId);
  if (propertyIds.length === 0) return [];
  const tenancies = unwrap(
    await db
      .from("tenancies")
      .select("id, tenant_name, property:properties(name), unit:units(name)")
      .in("property_id", propertyIds),
  ) as unknown as ManagedTenancyRow[];
  if (tenancies.length === 0) return [];
  const byTenancy = new Map(tenancies.map((t) => [t.id, t] as const));
  const rows = unwrap(
    await db
      .from("payments")
      .select("*")
      .in(
        "tenancy_id",
        tenancies.map((t) => t.id),
      )
      .order("due_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
  );
  return rows
    .map((row) => {
      const tenancy = byTenancy.get(row.tenancy_id);
      return {
        ...toPayment(row),
        tenant_name: tenancy?.tenant_name ?? "Tenant",
        property_name: tenancy?.property?.name ?? "—",
        unit_name: tenancy?.unit?.name ?? "—",
      };
    })
    .sort((a, b) => b.due_date.localeCompare(a.due_date));
}

type ManagedMaintenanceRow = Tables<"maintenance_requests"> & {
  property: { name: string } | null;
  unit: { name: string } | null;
  tenancy: { tenant_name: string } | null;
};

/** Work orders across the managed portfolio, newest first. */
export async function getManagedWorkOrders(orgId: UUID | null): Promise<MaintenanceWithContext[]> {
  if (!orgId) return [];
  const propertyIds = await managedPropertyIds(orgId);
  if (propertyIds.length === 0) return [];
  const rows = unwrap(
    await db
      .from("maintenance_requests")
      .select("*, property:properties(name), unit:units(name), tenancy:tenancies(tenant_name)")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false }),
  ) as unknown as ManagedMaintenanceRow[];
  return rows.map((row) => ({
    ...toMaintenance(row),
    property_name: row.property?.name ?? "—",
    unit_name: row.unit?.name ?? "—",
    tenant_name: row.tenancy?.tenant_name ?? null,
  }));
}
