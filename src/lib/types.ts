/**
 * RentID domain models.
 *
 * These mirror the LIVE PostgreSQL schema (`supabase/migrations/`) as the app
 * consumes it: UUID string ids, ISO-8601 timestamps, snake_case columns and the
 * same enum values. A few DB columns carry a different name than the domain
 * field (e.g. `profiles.onboarding_completed` ↔ `Profile.onboarded`); those are
 * translated in `src/lib/db/mappers.ts`, which is the only place allowed to
 * know both spellings. Regenerate `src/integrations/supabase/types.ts` with
 * `bun run db:reset && bun run db:types` after changing a migration.
 */

export type UUID = string;

import type { ManagementCategory } from "@/lib/student-types";

/** Student-housing vertical models live in their own module. */
export type * from "@/lib/student-types";

/** Property ownership / authorized-representative verification models. */
export type * from "@/lib/verification-types";

/** ISO-8601 timestamp, e.g. 2026-09-04T01:39:00.000Z */
export type Timestamp = string;
/** ISO date (no time), e.g. 2026-09-04 */
export type DateOnly = string;

export type AppRole = "landlord" | "tenant" | "property_manager" | "admin";

export type User = {
  id: UUID;
  email: string;
  created_at: Timestamp;
  last_sign_in_at: Timestamp | null;
};

export type Profile = {
  id: UUID;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  onboarded: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type Organization = {
  id: UUID;
  name: string;
  legal_entity_name: string | null;
  owner_id: UUID | null;
  /** Landlord workspace or property-management company (business map §7). */
  kind: OrganizationKind;
  /** Business/ownership verification gate for badges and public listings. */
  verification_status: VerificationStatus;
  is_demo: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

/** Live schema stores the member's app role on the membership row. */
export type OrganizationMemberRole = AppRole;

export type OrganizationMember = {
  id: UUID;
  organization_id: UUID;
  user_id: UUID;
  role: OrganizationMemberRole;
  created_at: Timestamp;
};

export type PropertyType =
  "single_family" | "multi_family" | "condo" | "townhouse" | "apartment" | "other";

export type Property = {
  id: UUID;
  organization_id: UUID;
  name: string;
  /** Physical asset type — kept separate from the operating model. */
  property_type: PropertyType;
  /** Operating model: standard residential or student housing (business map §25). */
  management_category: ManagementCategory;
  street_address: string;
  unit_label: string | null;
  city: string;
  state: string;
  zip: string;
  year_built: number | null;
  notes: string | null;
  /* ---- property identification for ownership verification (additive) ---- */
  /** Canonical address key so "Alger Ave" and "Alger Avenue" resolve as one. */
  normalized_address: string | null;
  county: string | null;
  /** Parcel / APN / PIN / folio number. */
  parcel_number: string | null;
  recording_jurisdiction: string | null;
  legal_description: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

export type OccupancyStatus = "vacant" | "occupied" | "off_market" | "upcoming_vacancy";

export type Unit = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  name: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  rent_due_day: number;
  occupancy_status: OccupancyStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

export type TenancyStatus = "pending" | "active" | "ended" | "cancelled";

export type Tenancy = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  tenant_user_id: UUID | null;
  tenant_name: string;
  tenant_email: string | null;
  tenant_phone: string | null;
  status: TenancyStatus;
  verified: boolean;
  verified_at: Timestamp | null;
  start_date: DateOnly | null;
  end_date: DateOnly | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

export type LeaseStatus = "draft" | "active" | "expiring" | "ended" | "terminated";

export type Lease = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID;
  unit_id: UUID;
  status: LeaseStatus;
  start_date: DateOnly;
  end_date: DateOnly;
  monthly_rent: number;
  security_deposit: number | null;
  rent_due_day: number;
  late_fee: number | null;
  /** Free-text late-fee terms from the live schema (kept alongside the numeric late_fee). */
  late_fee_terms?: string | null;
  document_id: UUID | null;
  /** Storage path of the signed lease when uploaded without a documents row. */
  document_path?: string | null;
  signed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type TenantInvitation = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  tenancy_id: UUID | null;
  email: string;
  invited_name: string | null;
  phone?: string | null;
  monthly_rent?: number | null;
  lease_start?: DateOnly | null;
  lease_end?: DateOnly | null;
  status: InvitationStatus;
  token: string;
  expires_at: Timestamp;
  accepted_at: Timestamp | null;
  accepted_by?: UUID | null;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type DocumentKind =
  | "lease"
  | "addendum"
  | "id_verification"
  | "inspection"
  | "move_in_inspection"
  | "move_out_inspection"
  | "photo"
  | "maintenance"
  | "receipt"
  | "notice"
  | "other";

export type Document = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID | null;
  unit_id: UUID | null;
  tenancy_id: UUID | null;
  lease_id?: UUID | null;
  kind: DocumentKind;
  title: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  visible_to_tenant: boolean;
  uploaded_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
};

export type PaymentStatus =
  "scheduled" | "pending" | "paid" | "late" | "failed" | "refunded" | "returned";
export type PaymentMethod =
  "manual" | "ach" | "same_day_ach" | "rtp" | "fednow" | "card" | "cash" | "check";

/**
 * How a payment row came to be trusted. Only `platform_settled` and
 * `bank_linked` count as verified; the database derives `verified` from this
 * and refuses client attempts to assert the platform-only sources.
 */
export type PaymentVerificationSource =
  | "unverified"
  | "landlord_reported"
  | "tenant_reported"
  | "bank_linked"
  | "imported"
  | "platform_settled";

export type Payment = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID;
  unit_id?: UUID | null;
  amount: number;
  platform_fee_amount?: number | null;
  status: PaymentStatus;
  method: PaymentMethod;
  due_date: DateOnly;
  paid_at: Timestamp | null;
  period_label: string;
  /** Derived server-side from verification_source — never set by the client. */
  verified: boolean;
  verification_source: PaymentVerificationSource;
  verified_at?: Timestamp | null;
  external_reference?: string | null;
  payout_id?: UUID | null;
  recorded_by?: UUID | null;
  memo: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type PaymentSchedule = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID;
  amount: number;
  cadence: "monthly" | "weekly" | "biweekly";
  due_day: number;
  starts_on: DateOnly;
  ends_on: DateOnly | null;
  active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type MaintenanceStatus =
  "open" | "acknowledged" | "in_progress" | "completed" | "resolved" | "closed" | "cancelled";
export type MaintenancePriority = "low" | "normal" | "high" | "urgent" | "emergency";

export type MaintenanceRequest = {
  id: UUID;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  tenancy_id: UUID | null;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  created_by: UUID | null;
  completed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type Conversation = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID | null;
  subject: string;
  last_message_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type Message = {
  id: UUID;
  conversation_id: UUID;
  sender_id: UUID | null;
  sender_name: string;
  sender_role: AppRole | null;
  body: string;
  read_at: Timestamp | null;
  created_at: Timestamp;
};

export type ReviewDirection = "landlord_to_tenant" | "tenant_to_landlord";
export type ReviewStatus = "published" | "under_dispute" | "withdrawn";

export type Review = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID;
  direction: ReviewDirection;
  author_id: UUID | null;
  author_name: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ReviewDispute = {
  id: UUID;
  review_id: UUID;
  raised_by: UUID | null;
  reason: string;
  status: "open" | "resolved" | "rejected";
  resolved_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type VerificationKind =
  "tenancy" | "payment" | "identity" | "lease_document" | "landlord_reported" | "tenant_reported";

export type VerificationRecord = {
  id: UUID;
  organization_id: UUID;
  tenancy_id: UUID | null;
  payment_id: UUID | null;
  kind: VerificationKind;
  verified_by: UUID | null;
  source: "platform" | "landlord" | "tenant";
  notes: string | null;
  created_at: Timestamp;
};

export type Notification = {
  id: UUID;
  user_id: UUID | null;
  organization_id: UUID | null;
  kind: "payment" | "maintenance" | "lease" | "invitation" | "message" | "system";
  title: string;
  body: string | null;
  read_at: Timestamp | null;
  created_at: Timestamp;
};

export type AuditLog = {
  id: UUID;
  organization_id: UUID | null;
  actor_id: UUID | null;
  actor_role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: UUID | null;
  metadata: Record<string, unknown> | null;
  created_at: Timestamp;
};

/* ---------------------------------------------------------------- *
 * Read models (joined shapes the UI consumes)
 * ---------------------------------------------------------------- */

export type PropertyWithUnits = Property & { units: Unit[] };

export type TenancyDetail = Tenancy & {
  property: Property | null;
  unit: Unit | null;
  organization: Organization | null;
  lease: Lease | null;
  payments: Payment[];
  maintenance: MaintenanceRequest[];
  documents: Document[];
};

export type LeaseDetail = Lease & {
  tenancy: Tenancy | null;
  unit: Unit | null;
  property: Property | null;
  document: Document | null;
};

export type PaymentWithContext = Payment & {
  tenant_name: string;
  property_name: string;
  unit_name: string;
};

export type MaintenanceWithContext = MaintenanceRequest & {
  property_name: string;
  unit_name: string;
  tenant_name: string | null;
};

export type DocumentWithContext = Document & {
  property_name: string | null;
  unit_name: string | null;
  tenant_name: string | null;
};

export type InvitationWithContext = TenantInvitation & {
  property: Property | null;
  unit: Unit | null;
  organization: Organization | null;
};

export type ConversationWithContext = Conversation & {
  messages: Message[];
  counterpart_name: string;
  unread: number;
};

export type DashboardMetrics = {
  rent_collected: number;
  outstanding_rent: number;
  occupied_units: number;
  total_units: number;
  late_payments: number;
  open_maintenance: number;
  leases_expiring: number;
};

/* ---------------------------------------------------------------- *
 * Verification, marketplace and property-management layer
 * (business map sections 3A, 7, 8 and 16-19)
 * ---------------------------------------------------------------- */

export type OrganizationKind = "landlord" | "property_manager";

/** Claim/verification state for people, businesses, properties and authority. */
export type VerificationStatus =
  "unverified" | "pending" | "verified" | "disputed" | "rejected" | "revoked";

export type ListingStatus = "draft" | "published" | "paused" | "leased" | "archived";

/**
 * A RentID listing is the master record. Every distribution channel is a copy
 * that RentID keeps in sync — see `ListingChannel`.
 */
export type Listing = {
  id: UUID;
  /** Short permanent public reference: rentid.online/listing/<public_ref>. */
  public_ref?: string;
  organization_id: UUID;
  property_id: UUID;
  unit_id: UUID;
  status: ListingStatus;
  headline: string;
  description: string | null;
  monthly_rent: number;
  security_deposit: number | null;
  available_on: DateOnly;
  lease_term_months: number;
  amenities: string[];
  screening_criteria: string | null;
  /** Legacy display field; the source of truth is `listing_channels`. */
  syndicated_to: string[];
  published_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;

  /* ---- listing detail (added with Listing Syndication) ---- */
  property_type?: PropertyType | null;
  street_address?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  square_feet?: number | null;
  photos?: string[];
  utilities_included?: string[];
  pet_policy?: string | null;
  parking?: string | null;
  application_requirements?: string[];
  income_requirement?: string | null;
  credit_requirement?: string | null;
  occupancy_limit?: number | null;
  move_in_fees?: string | null;
  application_fee?: number | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  showing_instructions?: string | null;
  /** Assigned leasing agent / employee (property-manager workflows). */
  assigned_to?: string | null;
  /** Public listing-page views, used for the applicant funnel. */
  view_count?: number;
};

/* ------------------------- listing syndication layer ---------------------- */

/** Registered distribution channels. New networks are added as adapters. */
export type MarketplaceId = "rentid" | "zillow" | "apartments_com" | (string & {});

/** Whether RentID has an approved API/feed partnership with the marketplace. */
export type ChannelConnectionStatus = "connected" | "integration_pending" | "error";

/** The listing's state on that specific marketplace. */
export type ChannelListingStatus =
  | "not_published"
  | "queued"
  | "pending_integration"
  | "live"
  | "pending_sync"
  | "removal_queued"
  | "removed"
  | "error";

export type ListingChannel = {
  id: UUID;
  listing_id: UUID;
  organization_id: UUID;
  marketplace_id: MarketplaceId;
  /** Landlord's publish choice for this channel. */
  enabled: boolean;
  connection_status: ChannelConnectionStatus;
  listing_status: ChannelListingStatus;
  external_listing_id: string | null;
  last_synced_at: Timestamp | null;
  last_error: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type SyncAction = "create" | "update" | "remove" | "resync";
export type SyncResult = "queued" | "succeeded" | "pending_integration" | "failed";

export type ListingSyncEvent = {
  id: UUID;
  listing_id: UUID;
  marketplace_id: MarketplaceId;
  action: SyncAction;
  result: SyncResult;
  message: string;
  created_at: Timestamp;
};

/** Where a lead or application came from. */
export type LeadSource =
  "rentid" | "zillow" | "apartments_com" | "direct_link" | "qr_code" | "facebook" | "other";

export type ListingLead = {
  id: UUID;
  listing_id: UUID;
  organization_id: UUID;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: LeadSource;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  referrer: string | null;
  application_id: UUID | null;
  created_at: Timestamp;
};

export type ApplicationStatus =
  | "new"
  | "started"
  | "submitted"
  | "in_review"
  | "under_review"
  | "more_info_requested"
  | "screening"
  | "qualified"
  | "approved"
  | "denied"
  | "withdrawn"
  | "lease_sent"
  | "lease_signed";

export type RentalApplication = {
  id: UUID;
  listing_id: UUID;
  organization_id: UUID;
  applicant_user_id: UUID | null;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  monthly_income: number | null;
  move_in_date: DateOnly | null;
  note: string | null;
  status: ApplicationStatus;
  profile_shared: boolean;
  decided_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  /* ---- syndication attribution + resume autofill ---- */
  source?: LeadSource;
  utm_source?: string | null;
  utm_campaign?: string | null;
  referrer?: string | null;
  /** How much of the form came from the applicant's RentID rental resume. */
  prefilled_from_resume?: boolean;
  employer?: string | null;
  current_address?: string | null;
  references?: string | null;
};

/** Funnel counters for one listing. */
export type ListingPipeline = {
  listing_id: UUID;
  views: number;
  leads: number;
  started: number;
  completed: number;
  qualified: number;
  approved: number;
};

/** An owner whose properties a property-management company operates. */
export type OwnerAccount = {
  id: UUID;
  organization_id: UUID; // the PM organization
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contract_start: DateOnly | null;
  management_fee_pct: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Owner → property → property-manager authority, stored separately from
 * ownership so an owner can replace a PM without losing history.
 */
export type ManagementAssignment = {
  id: UUID;
  organization_id: UUID; // the PM organization
  owner_account_id: UUID;
  property_id: UUID;
  authority_status: VerificationStatus;
  authorized_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_at: Timestamp;
};

/* ------------------------------ read models ------------------------------- */

export type ListingWithContext = Listing & {
  property: Property | null;
  unit: Unit | null;
  provider: ProviderProfile | null;
  application_count: number;
  channels: ListingChannel[];
  pipeline: ListingPipeline;
  owner_name: string | null;
};

export type ApplicationWithContext = RentalApplication & {
  listing: Listing | null;
  property_name: string;
  unit_name: string;
  passport: TenantPassport | null;
};

/** Tenant "rental passport" — verified history only, no scoring. */
export type TenantPassport = {
  tenant_name: string;
  verified_payments: number;
  on_time_payments: number;
  on_time_pct: number;
  late_payments: number;
  verified_tenancies: number;
  months_of_history: number;
  average_rent: number | null;
  open_disputes: number;
  reviews: Review[];
};

/** Public-facing landlord or property-manager profile. */
export type ProviderProfile = {
  organization_id: UUID;
  name: string;
  kind: OrganizationKind;
  verification_status: VerificationStatus;
  verified_properties: number;
  verified_units: number;
  owners_served: number;
  median_first_response_hours: number;
  resolved_under_72h_pct: number;
  collection_rate_pct: number;
  tenant_rating: number | null;
  owner_rating: number | null;
  reviews: Review[];
  open_disputes: number;
};

export type PmPortfolioMetrics = {
  units_managed: number;
  owners: number;
  collected_this_month: number;
  open_work_orders: number;
  urgent_work_orders: number;
  median_first_response_hours: number;
  resolved_under_72h_pct: number;
  collection_rate_pct: number;
};

export type OwnerAccountWithContext = OwnerAccount & {
  properties: Property[];
  units_managed: number;
  occupied_units: number;
  collected_this_month: number;
  authority_status: VerificationStatus;
};
