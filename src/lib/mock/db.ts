/**
 * In-memory mock database with localStorage persistence.
 *
 * This is a stand-in for Postgres while the Supabase project is unavailable.
 * Only `src/lib/services/*` may touch it — UI code always goes through the
 * service layer, so swapping this for real queries touches no components.
 */
import type {
  AppRole,
  AuditLog,
  Conversation,
  Document,
  Lease,
  Listing,
  ListingChannel,
  ListingLead,
  ListingSyncEvent,
  MaintenanceRequest,
  ManagementAssignment,
  Message,
  Notification,
  Organization,
  OrganizationMember,
  OwnerAccount,
  Payment,
  PaymentSchedule,
  Profile,
  Property,
  RentalApplication,
  Review,
  ReviewDispute,
  Tenancy,
  TenantInvitation,
  Unit,
  User,
  UUID,
  VerificationRecord,
  AcademicTerm,
  ApprovalStep,
  Charge,
  ChargeAllocation,
  GuarantorRelationship,
  LeaseChangeRequest,
  LedgerEvent,
  Occupancy,
  Payer,
  PaymentAllocation,
  RoomBed,
  RoommateGroup,
  RoommateGroupMember,
  StudentHousingConfig,
  StudentMaintenanceCase,
  StudentPayment,
  TurnTask,
  PropertyOwnershipRecord,
  PropertyPartyRelationship,
  RepresentativeAuthorization,
  VerificationCase,
  VerificationDisclosureAck,
  VerificationEvidence,
  VerificationRiskEvent,
  VerificationStatusEvent,
  VerifiedEntity,
} from "@/lib/types";
import { seedDatabase } from "@/lib/mock/seed";

export type Credential = { user_id: UUID; email: string; password: string };
export type UserRole = { id: UUID; user_id: UUID; role: AppRole; created_at: string };

export type MockDatabase = {
  users: User[];
  credentials: Credential[];
  profiles: Profile[];
  user_roles: UserRole[];
  organizations: Organization[];
  organization_members: OrganizationMember[];
  properties: Property[];
  units: Unit[];
  tenancies: Tenancy[];
  leases: Lease[];
  tenant_invitations: TenantInvitation[];
  documents: Document[];
  payments: Payment[];
  payment_schedules: PaymentSchedule[];
  maintenance_requests: MaintenanceRequest[];
  conversations: Conversation[];
  messages: Message[];
  reviews: Review[];
  review_disputes: ReviewDispute[];
  verification_records: VerificationRecord[];
  notifications: Notification[];
  audit_logs: AuditLog[];
  listings: Listing[];
  rental_applications: RentalApplication[];
  /* ---- listing syndication (create once, distribute everywhere) ---- */
  listing_channels: ListingChannel[];
  listing_sync_events: ListingSyncEvent[];
  listing_leads: ListingLead[];
  owner_accounts: OwnerAccount[];
  management_assignments: ManagementAssignment[];
  /* ---- student housing vertical (business map §25-§38) ---- */
  student_housing_configs: StudentHousingConfig[];
  academic_terms: AcademicTerm[];
  room_beds: RoomBed[];
  occupancies: Occupancy[];
  roommate_groups: RoommateGroup[];
  roommate_group_members: RoommateGroupMember[];
  guarantor_relationships: GuarantorRelationship[];
  charges: Charge[];
  charge_allocations: ChargeAllocation[];
  payers: Payer[];
  student_payments: StudentPayment[];
  payment_allocations: PaymentAllocation[];
  ledger_events: LedgerEvent[];
  lease_change_requests: LeaseChangeRequest[];
  approval_steps: ApprovalStep[];
  turn_tasks: TurnTask[];
  student_maintenance_cases: StudentMaintenanceCase[];
  /* ---- property ownership & authorized-representative verification ---- */
  verified_entities: VerifiedEntity[];
  property_ownership_records: PropertyOwnershipRecord[];
  property_party_relationships: PropertyPartyRelationship[];
  verification_cases: VerificationCase[];
  verification_evidence: VerificationEvidence[];
  representative_authorizations: RepresentativeAuthorization[];
  verification_acknowledgements: VerificationDisclosureAck[];
  verification_risk_events: VerificationRiskEvent[];
  verification_status_events: VerificationStatusEvent[];
};

const STORAGE_KEY = "rentid.mock.db.v6";

let db: MockDatabase | null = null;
const listeners = new Set<() => void>();

function load(): MockDatabase {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MockDatabase;
    } catch {
      /* corrupt payload — fall through to a fresh seed */
    }
  }
  return seedDatabase();
}

export function getDb(): MockDatabase {
  if (!db) db = load();
  return db;
}

/** Persist the current snapshot and notify subscribers. */
export function commit() {
  if (typeof window !== "undefined" && db) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* storage full or unavailable — keep the in-memory copy */
    }
  }
  listeners.forEach((l) => l());
}

export function subscribeDb(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Wipe local changes and restore the demo portfolio. */
export function resetDb() {
  db = seedDatabase();
  commit();
}

/** RFC-4122-shaped v4 id so mock rows look like real Postgres uuids. */
export function uuid(): UUID {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Simulated network latency so loading states are exercised realistically. */
export function latency<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function logAudit(entry: {
  organization_id?: UUID | null;
  actor_id?: UUID | null;
  actor_role?: AppRole | null;
  action: string;
  entity_type: string;
  entity_id?: UUID | null;
  metadata?: Record<string, unknown> | null;
}) {
  getDb().audit_logs.unshift({
    id: uuid(),
    organization_id: entry.organization_id ?? null,
    actor_id: entry.actor_id ?? null,
    actor_role: entry.actor_role ?? null,
    action: entry.action,
    entity_type: entry.entity_type,
    entity_id: entry.entity_id ?? null,
    metadata: entry.metadata ?? null,
    created_at: nowIso(),
  });
}
