/**
 * Leases, documents, maintenance, messaging, notifications, reviews and audit
 * logs — Supabase-backed (RLS-scoped).
 *
 * Read models are assembled with PostgREST embedded selects so each screen is
 * one round-trip. Cross-party notifications (landlord ↔ tenant) go through the
 * `notify_user` RPC because the notifications insert policy only allows
 * self-notifications; every notification is best-effort and never fails the
 * write that triggered it.
 */
import {
  currentUserId,
  db,
  DbError,
  logAudit,
  nowIso,
  unwrap,
  unwrapMaybe,
  unwrapOne,
} from "@/lib/db";
import {
  toAuditLog,
  toConversation,
  toDocument,
  toLease,
  toMaintenance,
  toMessage,
  toNotification,
  toProperty,
  toReview,
  toTenancy,
  toUnit,
} from "@/lib/db/mappers";
import {
  deleteDocumentFile,
  getDocumentUrl,
  placeholderStoragePath,
  uploadDocumentFile,
} from "@/lib/storage";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import type {
  AuditLog,
  ConversationWithContext,
  Document,
  DocumentKind,
  DocumentWithContext,
  LeaseDetail,
  MaintenanceRequest,
  MaintenanceStatus,
  MaintenanceWithContext,
  Message,
  Notification,
  Review,
  UUID,
} from "@/lib/types";

/* ------------------------------ notifications ----------------------------- */

/**
 * Notify another user through the `notify_user` RPC (SECURITY DEFINER; checks
 * that the two parties share an organization or tenancy). Best-effort: a
 * refused or failed notification is logged in DEV and otherwise ignored, so
 * the write that triggered it still succeeds.
 */
export async function notifyUser(input: {
  userId: UUID | null | undefined;
  organizationId: UUID;
  kind: Notification["kind"];
  title: string;
  body?: string | null;
}): Promise<void> {
  if (!input.userId) return;
  if (input.userId === (await currentUserId())) return; // the actor already knows
  const { error } = await db.rpc("notify_user", {
    _user_id: input.userId,
    _organization_id: input.organizationId,
    _kind: input.kind,
    _title: input.title,
    ...(input.body ? { _body: input.body } : {}),
  });
  if (error && import.meta.env.DEV) console.warn("[notify] not delivered:", error.message);
}

/** The workspace owner's user id (tenants can read it through organizations_select_tenant). */
export async function getOrganizationOwnerId(orgId: UUID): Promise<UUID | null> {
  const row = unwrapMaybe<{ owner_id: string | null }>(
    await db.from("organizations").select("owner_id").eq("id", orgId).maybeSingle(),
  );
  return row?.owner_id ?? null;
}

/** Notify the landlord / property manager who owns the workspace. */
export async function notifyOrganizationOwner(input: {
  organizationId: UUID;
  kind: Notification["kind"];
  title: string;
  body?: string | null;
}): Promise<void> {
  const ownerId = await getOrganizationOwnerId(input.organizationId);
  await notifyUser({ ...input, userId: ownerId });
}

/* --------------------------------- leases --------------------------------- */

/**
 * `leases` ↔ `documents` are linked in both directions (leases.document_id and
 * documents.lease_id), so the embed names the foreign key it follows.
 */
const LEASE_SELECT =
  "*, tenancy:tenancies(*, property:properties(*)), unit:units(*), document:documents!leases_document_id_fkey(*)";

type LeaseRow = Tables<"leases"> & {
  tenancy: (Tables<"tenancies"> & { property: Tables<"properties"> | null }) | null;
  unit: Tables<"units"> | null;
  document: Tables<"documents"> | null;
};

function hydrateLease(row: LeaseRow): LeaseDetail {
  return {
    ...toLease(row),
    tenancy: row.tenancy ? toTenancy(row.tenancy) : null,
    unit: row.unit ? toUnit(row.unit) : null,
    property: row.tenancy?.property ? toProperty(row.tenancy.property) : null,
    document: row.document ? toDocument(row.document) : null,
  };
}

export async function getLeases(orgId: UUID | null): Promise<LeaseDetail[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("leases")
      .select(LEASE_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("end_date")
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as LeaseRow[]).map(hydrateLease);
}

export async function getLease(leaseId: UUID): Promise<LeaseDetail | null> {
  const row = unwrapMaybe(
    await db.from("leases").select(LEASE_SELECT).eq("id", leaseId).maybeSingle(),
  ) as unknown as LeaseRow | null;
  return row ? hydrateLease(row) : null;
}

/** The most recent live lease of a tenancy. */
export async function getLeaseForTenancy(tenancyId: UUID): Promise<LeaseDetail | null> {
  const row = unwrapMaybe(
    await db
      .from("leases")
      .select(LEASE_SELECT)
      .eq("tenancy_id", tenancyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ) as unknown as LeaseRow | null;
  return row ? hydrateLease(row) : null;
}

/** Original file name when the caller gave us a `File` but no explicit name. */
function fileNameOf(file: File | Blob | null | undefined, explicit?: string | null): string | null {
  if (explicit) return explicit;
  return file && "name" in file && typeof file.name === "string" ? file.name : null;
}

/**
 * Create a lease for a tenancy and attach its document. Any live lease for the
 * tenancy is superseded (status → ended). When `file` is provided the bytes are
 * stored in the private `documents` bucket; without it (older callers only
 * send metadata) the documents row is still created with a
 * `pending-upload/<uuid>` placeholder path so nothing else changes.
 */
export async function uploadLease(input: {
  organizationId: UUID;
  tenancyId: UUID;
  unitId: UUID;
  actorId?: UUID | null;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit?: number | null;
  rentDueDay?: number;
  lateFee?: number | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  /** The lease file itself. Optional so existing callers keep compiling. */
  file?: File | Blob | null;
}): Promise<LeaseDetail> {
  if (input.endDate < input.startDate)
    throw new Error("The lease end date must be on or after the start date.");
  const now = nowIso();
  const actor = input.actorId ?? (await currentUserId());
  const tenancy = unwrapMaybe<{
    id: string;
    property_id: string;
    tenant_name: string;
    tenant_user_id: string | null;
  }>(
    await db
      .from("tenancies")
      .select("id, property_id, tenant_name, tenant_user_id")
      .eq("id", input.tenancyId)
      .maybeSingle(),
  );

  const fileName = fileNameOf(input.file, input.fileName);
  const stored = input.file
    ? await uploadDocumentFile(input.organizationId, input.file, fileName)
    : null;

  let documentRow: Tables<"documents">;
  try {
    documentRow = unwrapOne(
      await db
        .from("documents")
        .insert({
          organization_id: input.organizationId,
          property_id: tenancy?.property_id ?? null,
          unit_id: input.unitId,
          tenancy_id: input.tenancyId,
          kind: "lease",
          title: fileName ?? `${tenancy?.tenant_name ?? "Tenant"} — lease.pdf`,
          // No bytes were provided: placeholder path, never resolvable to an object.
          storage_path: stored?.path ?? placeholderStoragePath(),
          mime_type: stored?.mime ?? input.mimeType ?? "application/pdf",
          size_bytes: stored?.size ?? input.fileSize ?? null,
          visible_to_tenant: true,
          uploaded_by: actor,
        })
        .select("*")
        .single(),
      "Document",
    );
  } catch (error) {
    // Don't leave an orphaned object behind when the row could not be written.
    if (stored) await deleteDocumentFile(stored.path).catch(() => undefined);
    throw error;
  }

  // Supersede any live lease for this tenancy.
  unwrap(
    await db
      .from("leases")
      .update({ status: "ended" })
      .eq("tenancy_id", input.tenancyId)
      .is("deleted_at", null)
      .in("status", ["draft", "active", "expiring"]),
  );

  const leaseRow = unwrapOne(
    await db
      .from("leases")
      .insert({
        organization_id: input.organizationId,
        tenancy_id: input.tenancyId,
        unit_id: input.unitId,
        status: "active",
        start_date: input.startDate,
        end_date: input.endDate,
        monthly_rent: input.monthlyRent,
        security_deposit: input.securityDeposit ?? null,
        rent_due_day: input.rentDueDay ?? 1,
        late_fee: input.lateFee ?? null,
        document_id: documentRow.id,
        document_path: stored?.path ?? null,
        signed_at: now,
      })
      .select("id")
      .single(),
    "Lease",
  );

  // Back-link the document and align the tenancy's term with the lease.
  unwrap(await db.from("documents").update({ lease_id: leaseRow.id }).eq("id", documentRow.id));
  unwrap(
    await db
      .from("tenancies")
      .update({
        start_date: input.startDate,
        end_date: input.endDate,
        monthly_rent: input.monthlyRent,
      })
      .eq("id", input.tenancyId),
  );

  await logAudit({
    organization_id: input.organizationId,
    action: "lease.uploaded",
    entity_type: "lease",
    entity_id: leaseRow.id,
    metadata: { document_id: documentRow.id, has_file: Boolean(stored) },
  });
  await notifyUser({
    userId: tenancy?.tenant_user_id,
    organizationId: input.organizationId,
    kind: "lease",
    title: "Your lease was updated",
    body: `A lease running ${input.startDate} → ${input.endDate} is now on file for your tenancy.`,
  });

  const detail = await getLease(leaseRow.id);
  if (!detail) throw new DbError({ message: "Lease not found after upload." });
  return detail;
}

/* -------------------------------- documents ------------------------------- */

const DOCUMENT_SELECT =
  "*, property:properties(name), unit:units(name), tenancy:tenancies(tenant_name)";

type DocumentRow = Tables<"documents"> & {
  property: { name: string } | null;
  unit: { name: string } | null;
  tenancy: { tenant_name: string } | null;
};

function hydrateDocument(row: DocumentRow): DocumentWithContext {
  return {
    ...toDocument(row),
    property_name: row.property?.name ?? null,
    unit_name: row.unit?.name ?? null,
    tenant_name: row.tenancy?.tenant_name ?? null,
  };
}

export async function getDocuments(orgId: UUID | null): Promise<DocumentWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("documents")
      .select(DOCUMENT_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as DocumentRow[]).map(hydrateDocument);
}

/** Documents shared with the tenant on a tenancy. */
export async function getDocumentsForTenancy(tenancyId: UUID): Promise<DocumentWithContext[]> {
  const rows = unwrap(
    await db
      .from("documents")
      .select(DOCUMENT_SELECT)
      .eq("tenancy_id", tenancyId)
      .eq("visible_to_tenant", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as DocumentRow[]).map(hydrateDocument);
}

/**
 * File a document. With `file` the bytes go to the private `documents` bucket
 * under the organization's folder; without it the row is created with a
 * `pending-upload/<uuid>` placeholder path (metadata-only callers).
 */
export async function uploadDocument(input: {
  organizationId: UUID;
  propertyId?: UUID | null;
  unitId?: UUID | null;
  tenancyId?: UUID | null;
  kind: DocumentKind;
  title: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  visibleToTenant?: boolean;
  actorId?: UUID | null;
  /** The document file itself. Optional so existing callers keep compiling. */
  file?: File | Blob | null;
}): Promise<Document> {
  const actor = input.actorId ?? (await currentUserId());
  const fileName = fileNameOf(input.file, input.fileName);
  const stored = input.file
    ? await uploadDocumentFile(input.organizationId, input.file, fileName)
    : null;

  let row: Tables<"documents">;
  try {
    row = unwrapOne(
      await db
        .from("documents")
        .insert({
          organization_id: input.organizationId,
          property_id: input.propertyId ?? null,
          unit_id: input.unitId ?? null,
          tenancy_id: input.tenancyId ?? null,
          kind: input.kind,
          title: input.title.trim() || fileName || "Document",
          storage_path: stored?.path ?? placeholderStoragePath(),
          mime_type: stored?.mime ?? input.mimeType ?? null,
          size_bytes: stored?.size ?? input.fileSize ?? null,
          visible_to_tenant: input.visibleToTenant ?? false,
          uploaded_by: actor,
        })
        .select("*")
        .single(),
      "Document",
    );
  } catch (error) {
    if (stored) await deleteDocumentFile(stored.path).catch(() => undefined);
    throw error;
  }

  const document = toDocument(row);
  await logAudit({
    organization_id: input.organizationId,
    action: "document.uploaded",
    entity_type: "document",
    entity_id: document.id,
    metadata: { kind: document.kind, has_file: Boolean(stored) },
  });
  return document;
}

/** Soft delete. The stored object is kept so the record can be restored. */
export async function archiveDocument(documentId: UUID) {
  unwrapOne(
    await db
      .from("documents")
      .update({ deleted_at: nowIso() })
      .eq("id", documentId)
      .select("id")
      .single(),
    "Document",
  );
  await logAudit({ action: "document.archived", entity_type: "document", entity_id: documentId });
  return true;
}

/**
 * Short-lived signed URL to open/download a document, or `null` when the row
 * only holds a placeholder path (no bytes were uploaded). RLS on the row and on
 * the storage object both apply.
 */
export async function getDocumentDownloadUrl(
  documentId: UUID,
  expiresInSeconds = 300,
): Promise<string | null> {
  const row = unwrapOne(
    await db.from("documents").select("storage_path").eq("id", documentId).single(),
    "Document",
  );
  return getDocumentUrl(row.storage_path, expiresInSeconds);
}

/* ------------------------------- maintenance ------------------------------ */

const MAINTENANCE_SELECT =
  "*, property:properties(name), unit:units(name), tenancy:tenancies(tenant_name)";

type MaintenanceRow = Tables<"maintenance_requests"> & {
  property: { name: string } | null;
  unit: { name: string } | null;
  tenancy: { tenant_name: string } | null;
};

/** Statuses that close the request; they stamp `resolved_at` (domain `completed_at`). */
const RESOLVED_STATUSES: readonly MaintenanceStatus[] = ["completed", "resolved", "closed"];

const statusLabel = (status: MaintenanceStatus) => status.replace(/_/g, " ");

function hydrateMaintenance(row: MaintenanceRow): MaintenanceWithContext {
  return {
    ...toMaintenance(row),
    property_name: row.property?.name ?? "—",
    unit_name: row.unit?.name ?? "—",
    tenant_name: row.tenancy?.tenant_name ?? null,
  };
}

export async function getMaintenanceRequests(
  orgId: UUID | null,
): Promise<MaintenanceWithContext[]> {
  if (!orgId) return [];
  const rows = unwrap(
    await db
      .from("maintenance_requests")
      .select(MAINTENANCE_SELECT)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  );
  return (rows as unknown as MaintenanceRow[]).map(hydrateMaintenance);
}

export async function getMaintenanceForTenancy(tenancyId: UUID): Promise<MaintenanceRequest[]> {
  const rows = unwrap(
    await db
      .from("maintenance_requests")
      .select("*")
      .eq("tenancy_id", tenancyId)
      .order("created_at", { ascending: false }),
  );
  return rows.map(toMaintenance);
}

/**
 * Log a request. When the tenant on the tenancy raises it, the workspace
 * owner is notified through `notify_user`.
 */
export async function createMaintenanceRequest(input: {
  organizationId: UUID;
  propertyId: UUID;
  unitId: UUID;
  tenancyId?: UUID | null;
  title: string;
  description?: string | null;
  priority?: MaintenanceRequest["priority"];
  actorId?: UUID | null;
}): Promise<MaintenanceRequest> {
  const actor = input.actorId ?? (await currentUserId());
  const row = unwrapOne(
    await db
      .from("maintenance_requests")
      .insert({
        organization_id: input.organizationId,
        property_id: input.propertyId,
        unit_id: input.unitId,
        tenancy_id: input.tenancyId ?? null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: "open",
        priority: input.priority ?? "normal",
        created_by: actor,
      })
      .select("*")
      .single(),
    "Maintenance request",
  );
  const request = toMaintenance(row);

  let raisedByTenant = false;
  if (input.tenancyId && actor) {
    const tenancy = unwrapMaybe<{ tenant_user_id: string | null; tenant_name: string }>(
      await db
        .from("tenancies")
        .select("tenant_user_id, tenant_name")
        .eq("id", input.tenancyId)
        .maybeSingle(),
    );
    raisedByTenant = Boolean(tenancy?.tenant_user_id && tenancy.tenant_user_id === actor);
    if (raisedByTenant) {
      const urgent = request.priority === "emergency" || request.priority === "urgent";
      await notifyOrganizationOwner({
        organizationId: input.organizationId,
        kind: "maintenance",
        title: `${urgent ? "Urgent: " : ""}${tenancy?.tenant_name ?? "A tenant"} reported "${request.title}"`,
        body: request.description ?? `Priority: ${request.priority}.`,
      });
    }
  }

  await logAudit({
    organization_id: input.organizationId,
    actor_role: raisedByTenant ? "tenant" : null,
    action: "maintenance.created",
    entity_type: "maintenance_request",
    entity_id: request.id,
    metadata: { title: request.title, priority: request.priority },
  });
  return request;
}

type MaintenanceStatusRow = Pick<
  Tables<"maintenance_requests">,
  "id" | "organization_id" | "tenancy_id" | "title" | "status" | "first_response_at" | "resolved_at"
> & { tenancy: { tenant_user_id: string | null } | null };

/**
 * Move a request through its workflow. Leaving `open` stamps the first
 * response time; completed / resolved / closed stamp `resolved_at`. The tenant
 * on the tenancy is notified of every change.
 */
export async function updateMaintenanceStatus(
  id: UUID,
  status: MaintenanceRequest["status"],
): Promise<MaintenanceRequest> {
  const current = unwrapOne(
    await db
      .from("maintenance_requests")
      .select(
        "id, organization_id, tenancy_id, title, status, first_response_at, resolved_at, tenancy:tenancies(tenant_user_id)",
      )
      .eq("id", id)
      .single(),
    "Request",
  ) as unknown as MaintenanceStatusRow;

  const now = nowIso();
  const update: TablesUpdate<"maintenance_requests"> = { status };
  if (current.status === "open" && status !== "open" && !current.first_response_at)
    update.first_response_at = now;
  update.resolved_at = RESOLVED_STATUSES.includes(status) ? (current.resolved_at ?? now) : null;

  const row = unwrapOne(
    await db.from("maintenance_requests").update(update).eq("id", id).select("*").single(),
    "Request",
  );

  if (current.status !== status) {
    await notifyUser({
      userId: current.tenancy?.tenant_user_id,
      organizationId: current.organization_id,
      kind: "maintenance",
      title: `"${current.title}" is now ${statusLabel(status)}`,
      body:
        status === "completed" || status === "resolved"
          ? "Your landlord marked this request as done."
          : `Your maintenance request moved from ${statusLabel(current.status)} to ${statusLabel(status)}.`,
    });
  }

  await logAudit({
    organization_id: current.organization_id,
    action: "maintenance.status_changed",
    entity_type: "maintenance_request",
    entity_id: id,
    metadata: { from: current.status, to: status },
  });
  return toMaintenance(row);
}

/* -------------------------------- messaging ------------------------------- */

const CONVERSATION_SELECT =
  "*, messages(*), tenancy:tenancies(tenant_name), organization:organizations(name)";

type ConversationRow = Tables<"conversations"> & {
  messages: Tables<"messages">[];
  tenancy: { tenant_name: string } | null;
  organization: { name: string } | null;
};

function hydrateConversation(
  row: ConversationRow,
  viewerRole: "landlord" | "tenant",
  viewerId: UUID | null,
): ConversationWithContext {
  const messages = row.messages
    .map(toMessage)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const mine = (m: Message) =>
    viewerId
      ? m.sender_id === viewerId
      : viewerRole === "landlord"
        ? m.sender_role !== "tenant"
        : m.sender_role === "tenant";
  return {
    ...toConversation(row),
    messages,
    counterpart_name:
      viewerRole === "landlord"
        ? (row.tenancy?.tenant_name ?? "Tenant")
        : (row.organization?.name ?? "Landlord"),
    unread: messages.filter((m) => !m.read_at && !mine(m)).length,
  };
}

/**
 * Threads for a landlord workspace (`orgId`) or for a tenant's tenancies
 * (`tenancyIds` / `tenancyId`), newest activity first. `unread` counts messages
 * sent by someone other than `userId` (defaults to the signed-in user) that
 * have not been read.
 */
export async function getConversations(input: {
  orgId?: UUID | null;
  tenancyIds?: UUID[];
  tenancyId?: UUID | null;
  viewerRole?: "landlord" | "tenant";
  userId?: UUID | null;
}): Promise<ConversationWithContext[]> {
  const viewerRole = input.viewerRole ?? (input.orgId ? "landlord" : "tenant");
  const tenancyIds = [...(input.tenancyIds ?? []), ...(input.tenancyId ? [input.tenancyId] : [])];

  let query = db
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .order("last_message_at", { ascending: false });
  if (viewerRole === "landlord") {
    if (!input.orgId) return [];
    query = query.eq("organization_id", input.orgId);
    if (tenancyIds.length > 0) query = query.in("tenancy_id", tenancyIds);
  } else {
    if (tenancyIds.length === 0) return [];
    query = query.in("tenancy_id", tenancyIds);
  }

  const viewerId = input.userId ?? (await currentUserId());
  const rows = unwrap(await query);
  return (rows as unknown as ConversationRow[]).map((row) =>
    hydrateConversation(row, viewerRole, viewerId),
  );
}

/**
 * Post a message. The sender is always the signed-in user (RLS requires
 * `sender_id = auth.uid()`). Without a `conversationId` the tenancy's existing
 * thread is reused, or a new one is created. The counterpart is notified.
 */
export async function sendMessage(input: {
  conversationId?: UUID | null;
  organizationId: UUID;
  tenancyId?: UUID | null;
  subject?: string;
  senderId: UUID | null;
  senderName: string;
  senderRole: Message["sender_role"];
  body: string;
}): Promise<Message> {
  const uid = await currentUserId();
  if (!uid) throw new Error("Sign in to send messages.");
  const body = input.body.trim();
  if (!body) throw new Error("Write a message first.");

  let conversationId = input.conversationId ?? null;
  if (!conversationId && input.tenancyId) {
    const existing = unwrapMaybe<{ id: string }>(
      await db
        .from("conversations")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("tenancy_id", input.tenancyId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    conversationId = existing?.id ?? null;
  }
  if (!conversationId) {
    const created = unwrapOne(
      await db
        .from("conversations")
        .insert({
          organization_id: input.organizationId,
          tenancy_id: input.tenancyId ?? null,
          subject: input.subject?.trim() || "New conversation",
        })
        .select("id")
        .single(),
      "Conversation",
    );
    conversationId = created.id;
  }

  const senderName =
    input.senderName.trim() || (input.senderRole === "tenant" ? "Tenant" : "Landlord");
  const row = unwrapOne(
    await db
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: uid,
        sender_name: senderName,
        sender_role: input.senderRole,
        body,
      })
      .select("*")
      .single(),
    "Message",
  );

  // Let the other side know (landlord ↔ tenant only; never self-notify).
  const preview = body.length > 140 ? `${body.slice(0, 137)}…` : body;
  if (input.senderRole === "tenant") {
    await notifyOrganizationOwner({
      organizationId: input.organizationId,
      kind: "message",
      title: `New message from ${senderName}`,
      body: preview,
    });
  } else if (input.tenancyId) {
    const tenancy = unwrapMaybe<{ tenant_user_id: string | null }>(
      await db.from("tenancies").select("tenant_user_id").eq("id", input.tenancyId).maybeSingle(),
    );
    if (tenancy?.tenant_user_id && tenancy.tenant_user_id !== uid) {
      await notifyUser({
        userId: tenancy.tenant_user_id,
        organizationId: input.organizationId,
        kind: "message",
        title: `New message from ${senderName}`,
        body: preview,
      });
    }
  }

  return toMessage(row);
}

/** Mark every message in the thread that the signed-in user did not send as read. */
export async function markConversationRead(conversationId: UUID) {
  const uid = await currentUserId();
  let query = db
    .from("messages")
    .update({ read_at: nowIso() })
    .eq("conversation_id", conversationId)
    .is("read_at", null);
  if (uid) query = query.or(`sender_id.neq.${uid},sender_id.is.null`);
  unwrap(await query);
  return true;
}

/* ------------------------- notifications & reviews ------------------------ */

export async function getNotifications(userId: UUID | null): Promise<Notification[]> {
  if (!userId) return [];
  const rows = unwrap(
    await db
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  );
  return rows.map(toNotification);
}

export async function markNotificationRead(id: UUID) {
  unwrap(
    await db.from("notifications").update({ read_at: nowIso() }).eq("id", id).is("read_at", null),
  );
  return true;
}

/** Reviews on the given tenancies, newest first (read-only — the UI is ComingSoon). */
export async function getReviews(tenancyIds: UUID[]): Promise<Review[]> {
  if (tenancyIds.length === 0) return [];
  const rows = unwrap(
    await db
      .from("reviews")
      .select("*")
      .in("tenancy_id", tenancyIds)
      .order("created_at", { ascending: false }),
  );
  return rows.map(toReview);
}

/** Latest audit entries for a workspace (RLS: organization members and admins). */
export async function getAuditLogs(orgId: UUID | null): Promise<AuditLog[]> {
  let query = db
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (orgId) query = query.eq("organization_id", orgId);
  return unwrap(await query).map(toAuditLog);
}
