/** Tenancies, tenant invitations and tenancy verification — Supabase-backed. */
import { db, DbError, logAudit, today, unwrap, unwrapMaybe, unwrapOne } from "@/lib/db";
import {
  toDocument,
  toInvitation,
  toLease,
  toMaintenance,
  toOrganization,
  toPayment,
  toProperty,
  toTenancy,
  toUnit,
  toVerificationRecord,
} from "@/lib/db/mappers";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import type {
  InvitationWithContext,
  Tenancy,
  TenancyDetail,
  TenantInvitation,
  UUID,
  VerificationRecord,
} from "@/lib/types";

/** Columns for a fully hydrated tenancy (one round-trip via PostgREST embedding). */
const TENANCY_DETAIL_SELECT =
  "*, property:properties(*), unit:units(*), organization:organizations(*), leases(*), payments(*), maintenance_requests(*), documents(*)";

type TenancyDetailRow = Tables<"tenancies"> & {
  property: Tables<"properties"> | null;
  unit: Tables<"units"> | null;
  organization: Tables<"organizations"> | null;
  leases: Tables<"leases">[];
  payments: Tables<"payments">[];
  maintenance_requests: Tables<"maintenance_requests">[];
  documents: Tables<"documents">[];
};

function hydrate(row: TenancyDetailRow): TenancyDetail {
  const desc = (a: string, b: string) => b.localeCompare(a);
  return {
    ...toTenancy(row),
    property: row.property ? toProperty(row.property) : null,
    unit: row.unit ? toUnit(row.unit) : null,
    organization: row.organization ? toOrganization(row.organization) : null,
    lease:
      row.leases
        .filter((l) => l.deleted_at === null)
        .sort((a, b) => desc(a.created_at, b.created_at))
        .map(toLease)[0] ?? null,
    payments: row.payments.map(toPayment).sort((a, b) => desc(a.due_date, b.due_date)),
    maintenance: row.maintenance_requests
      .map(toMaintenance)
      .sort((a, b) => desc(a.created_at, b.created_at)),
    documents: row.documents
      .filter((d) => d.deleted_at === null)
      .map(toDocument)
      .sort((a, b) => desc(a.created_at, b.created_at)),
  };
}

/** All tenancies in an organization (landlord view). */
export async function getTenancies(orgId: UUID | null): Promise<TenancyDetail[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("tenancies")
      .select(TENANCY_DETAIL_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("tenant_name"),
  );
  return (rows as unknown as TenancyDetailRow[]).map(hydrate);
}

/** Alias used by tenant-list screens. */
export const getTenants = getTenancies;

export async function getTenant(tenancyId: UUID): Promise<TenancyDetail | null> {
  const row = unwrapMaybe(
    await db.from("tenancies").select(TENANCY_DETAIL_SELECT).eq("id", tenancyId).maybeSingle(),
  );
  return row ? hydrate(row as unknown as TenancyDetailRow) : null;
}

export const getTenancy = getTenant;

/** Tenancies where the signed-in user is the tenant (tenant view). */
export async function getMyTenancies(userId: UUID | null): Promise<TenancyDetail[]> {
  if (!userId) return [];
  const rows = unwrap(
    await db
      .from("tenancies")
      .select(TENANCY_DETAIL_SELECT)
      .eq("tenant_user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as TenancyDetailRow[]).map(hydrate);
}

export async function createTenancy(input: {
  organizationId: UUID;
  propertyId: UUID;
  unitId: UUID;
  actorId?: UUID | null;
  tenantName: string;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  status?: Tenancy["status"];
}): Promise<Tenancy> {
  const row = unwrapOne(
    await db
      .from("tenancies")
      .insert({
        organization_id: input.organizationId,
        property_id: input.propertyId,
        unit_id: input.unitId,
        tenant_name: input.tenantName.trim(),
        tenant_email: input.tenantEmail?.trim().toLowerCase() || null,
        tenant_phone: input.tenantPhone?.trim() || null,
        status: input.status ?? "pending",
        start_date: input.startDate ?? today(),
        end_date: input.endDate ?? null,
        monthly_rent: input.monthlyRent ?? null,
        security_deposit: input.securityDeposit ?? null,
      })
      .select("*")
      .single(),
    "Tenancy",
  );
  const tenancy = toTenancy(row);
  await logAudit({
    organization_id: input.organizationId,
    action: "tenancy.created",
    entity_type: "tenancy",
    entity_id: tenancy.id,
    metadata: { tenant: tenancy.tenant_name },
  });
  return tenancy;
}

export async function updateTenancy(
  tenancyId: UUID,
  patch: Partial<
    Pick<
      Tenancy,
      | "tenant_name"
      | "tenant_email"
      | "tenant_phone"
      | "status"
      | "start_date"
      | "end_date"
      | "monthly_rent"
      | "security_deposit"
    >
  >,
): Promise<Tenancy> {
  const update: TablesUpdate<"tenancies"> = { ...patch };
  const row = unwrapOne(
    await db.from("tenancies").update(update).eq("id", tenancyId).select("*").single(),
    "Tenancy",
  );
  return toTenancy(row);
}

export async function endTenancy(tenancyId: UUID) {
  const row = unwrapOne(
    await db
      .from("tenancies")
      .update({ status: "ended", end_date: today() })
      .eq("id", tenancyId)
      .select("id, unit_id, organization_id")
      .single(),
    "Tenancy",
  );
  unwrap(await db.from("units").update({ occupancy_status: "vacant" }).eq("id", row.unit_id));
  await logAudit({
    organization_id: row.organization_id,
    action: "tenancy.ended",
    entity_type: "tenancy",
    entity_id: tenancyId,
  });
  return true;
}

/**
 * A tenancy becomes "Verified" only when BOTH parties confirmed it — the
 * landlord created it and the tenant accepted the invitation from their own
 * account (`accept_invitation()` flips the flag server-side). This call is
 * kept for the landlord's "Verify" button: it activates the tenancy and
 * explains what is still missing when the tenant has not accepted yet.
 */
export async function verifyTenancy(tenancyId: UUID, actorId?: UUID | null) {
  void actorId;
  const current = unwrapOne(
    await db.from("tenancies").select("*").eq("id", tenancyId).single(),
    "Tenancy",
  );
  if (current.verified) return toTenancy(current);
  if (!current.tenant_user_id) {
    throw new Error(
      "Verification completes when the tenant accepts their invitation from their own RentID account. Resend the invitation if they never received it.",
    );
  }
  // Tenant is linked but the flag is off (e.g. linked through an older path):
  // activate and occupy; the platform re-verification job handles the flag.
  const row = unwrapOne(
    await db
      .from("tenancies")
      .update({ status: "active" })
      .eq("id", tenancyId)
      .select("*")
      .single(),
    "Tenancy",
  );
  unwrap(await db.from("units").update({ occupancy_status: "occupied" }).eq("id", row.unit_id));
  return toTenancy(row);
}

/** Which of the five association requirements a tenancy satisfies. */
export function tenancyVerification(detail: TenancyDetail) {
  const checks = [
    { label: "Landlord", ok: Boolean(detail.organization) },
    { label: "Tenant account", ok: Boolean(detail.tenant_user_id) },
    { label: "Property", ok: Boolean(detail.property) },
    { label: "Unit", ok: Boolean(detail.unit) },
    { label: "Lease", ok: Boolean(detail.lease) },
  ];
  return { checks, complete: checks.every((c) => c.ok) && detail.verified };
}

/* ------------------------------- invitations ------------------------------ */

const INVITATION_SELECT = "*, property:properties(*), unit:units(*), organization:organizations(*)";

type InvitationRow = Tables<"tenant_invitations"> & {
  property: Tables<"properties"> | null;
  unit: Tables<"units"> | null;
  organization: Tables<"organizations"> | null;
};

function hydrateInvite(row: InvitationRow): InvitationWithContext {
  return {
    ...toInvitation(row),
    property: row.property ? toProperty(row.property) : null,
    unit: row.unit ? toUnit(row.unit) : null,
    organization: row.organization ? toOrganization(row.organization) : null,
  };
}

export async function getInvitations(orgId: UUID | null): Promise<InvitationWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("tenant_invitations")
      .select(INVITATION_SELECT)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as InvitationRow[]).map(hydrateInvite);
}

/** Pending invitations addressed to the signed-in tenant (RLS matches the JWT email). */
export async function getMyInvitations(email: string | null): Promise<InvitationWithContext[]> {
  if (!email) return [];
  const rows = unwrap(
    await db
      .from("tenant_invitations")
      .select(INVITATION_SELECT)
      .eq("status", "pending")
      .ilike("email", email.trim())
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as InvitationRow[]).map(hydrateInvite);
}

export async function getInvitationByToken(token: string): Promise<InvitationWithContext | null> {
  const row = unwrapMaybe(
    await db.from("tenant_invitations").select(INVITATION_SELECT).eq("token", token).maybeSingle(),
  );
  return row ? hydrateInvite(row as unknown as InvitationRow) : null;
}

/** Invite a tenant: creates a pending tenancy plus the invitation record. */
export async function inviteTenant(input: {
  organizationId: UUID;
  propertyId: UUID;
  unitId: UUID;
  actorId?: UUID | null;
  email: string;
  name: string;
  monthlyRent?: number | null;
  securityDeposit?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<{ invitation: TenantInvitation; tenancy: Tenancy }> {
  const tenancy = await createTenancy({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    unitId: input.unitId,
    actorId: input.actorId ?? null,
    tenantName: input.name,
    tenantEmail: input.email,
    monthlyRent: input.monthlyRent ?? null,
    securityDeposit: input.securityDeposit ?? null,
    startDate: input.startDate ?? today(),
    endDate: input.endDate ?? null,
    status: "pending",
  });

  const row = unwrapOne(
    await db
      .from("tenant_invitations")
      .insert({
        organization_id: input.organizationId,
        property_id: input.propertyId,
        unit_id: input.unitId,
        tenancy_id: tenancy.id,
        email: input.email.trim().toLowerCase(),
        full_name: input.name.trim(),
        monthly_rent: input.monthlyRent ?? null,
        lease_start: input.startDate ?? today(),
        lease_end: input.endDate ?? null,
        invited_by: input.actorId ?? null,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
      .select("*")
      .single(),
    "Invitation",
  );
  const invitation = toInvitation(row);

  if (input.actorId) {
    await db.from("notifications").insert({
      user_id: input.actorId,
      organization_id: input.organizationId,
      kind: "invitation",
      title: `Invitation sent to ${invitation.invited_name ?? invitation.email}`,
      body: `${invitation.email} has 7 days to accept.`,
    });
  }
  await logAudit({
    organization_id: input.organizationId,
    action: "invitation.sent",
    entity_type: "tenant_invitation",
    entity_id: invitation.id,
    metadata: { email: invitation.email },
  });
  return { invitation, tenancy };
}

export async function revokeInvitation(invitationId: UUID) {
  unwrapOne(
    await db
      .from("tenant_invitations")
      .update({ status: "revoked" })
      .eq("id", invitationId)
      .select("id")
      .single(),
    "Invitation",
  );
  await logAudit({
    action: "invitation.revoked",
    entity_type: "tenant_invitation",
    entity_id: invitationId,
  });
  return true;
}

const ACCEPT_ERRORS: Record<string, string> = {
  not_found: "Invitation not found.",
  expired: "This invitation has expired — ask your landlord to send a new one.",
  wrong_email:
    "This invitation was sent to a different email address. Sign in with that address to accept it.",
  already_accepted: "This invitation was already accepted.",
  already_revoked: "This invitation was withdrawn by the landlord.",
  already_expired: "This invitation has expired — ask your landlord to send a new one.",
};

/**
 * Tenant accepts an invitation. The hand-off is one atomic server-side step
 * (`accept_invitation()`): links the account, activates + verifies the
 * tenancy, occupies the unit, grants the tenant role and seeds the current
 * rent period.
 */
export async function acceptInvitation(input: {
  invitationId?: UUID;
  token?: string;
  userId: UUID;
  fullName?: string | null;
}): Promise<{ tenancyId: UUID }> {
  let token = input.token ?? null;
  if (!token) {
    if (!input.invitationId) throw new Error("Invitation not found.");
    const row = unwrapMaybe<{ token: string }>(
      await db
        .from("tenant_invitations")
        .select("token")
        .eq("id", input.invitationId)
        .maybeSingle(),
    );
    token = row?.token ?? null;
  }
  if (!token) throw new Error(ACCEPT_ERRORS["not_found"]!);

  const { data, error } = await db.rpc("accept_invitation", { _token: token });
  if (error) throw new DbError(error);
  const result = (data ?? {}) as { ok?: boolean; tenancy_id?: string; error?: string };
  if (!result.ok || !result.tenancy_id) {
    throw new Error(ACCEPT_ERRORS[result.error ?? ""] ?? "Could not accept this invitation.");
  }
  if (input.fullName) {
    await db
      .from("tenancies")
      .update({ tenant_name: input.fullName.trim() })
      .eq("id", result.tenancy_id);
  }
  return { tenancyId: result.tenancy_id };
}

export async function getVerificationRecords(tenancyId: UUID): Promise<VerificationRecord[]> {
  const rows = unwrap(
    await db
      .from("verification_records")
      .select("*")
      .eq("tenancy_id", tenancyId)
      .order("created_at", { ascending: false }),
  );
  return rows.map(toVerificationRecord);
}

/* --------------------------------------------------------------------------
 * Invitation preview
 *
 * Reads a pending invitation by its token so an invited tenant can see who is
 * inviting them, and to which unit, before accepting. The RPC is granted to
 * `authenticated` only, so the caller must be signed in; a signed-out visitor
 * on /invite is asked to create an account first.
 * ------------------------------------------------------------------------ */

export type InvitationPreview = {
  id: UUID;
  status: string;
  email: string;
  full_name: string | null;
  expires_at: string;
  monthly_rent: number | null;
  lease_start: string | null;
  lease_end: string | null;
  organization_name: string;
  property_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  unit_name: string | null;
};

export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  if (!token.trim()) return null;
  const { data, error } = await db.rpc("invitation_preview", { _token: token });
  if (error) throw new DbError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return (row as InvitationPreview | undefined) ?? null;
}
