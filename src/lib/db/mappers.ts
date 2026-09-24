/**
 * Row → domain mappers.
 *
 * The ONLY place that knows both the database spelling and the domain
 * spelling of a field. Keep each mapper total (every domain field assigned) so
 * TypeScript catches drift when `src/integrations/supabase/types.ts` is
 * regenerated after a migration.
 */
import type { Tables } from "@/integrations/supabase/types";
import type {
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
  OwnerAccount,
  Payment,
  PaymentMethod,
  PaymentSchedule,
  Profile,
  Property,
  RentalApplication,
  Review,
  ReviewDispute,
  Tenancy,
  TenantInvitation,
  Unit,
  VerificationRecord,
} from "@/lib/types";

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const num0 = (v: number | string | null | undefined): number => Number(v ?? 0);

export const toProfile = (r: Tables<"profiles">): Profile => ({
  id: r.id,
  full_name: r.full_name,
  email: r.email,
  phone: r.phone,
  avatar_url: r.avatar_url,
  onboarded: r.onboarding_completed,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toOrganization = (r: Tables<"organizations">): Organization => ({
  id: r.id,
  name: r.name,
  legal_entity_name: r.legal_entity_name,
  owner_id: r.owner_id,
  kind: r.kind,
  verification_status: r.verification_status,
  is_demo: r.is_demo,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

export const toProperty = (r: Tables<"properties">): Property => ({
  id: r.id,
  organization_id: r.organization_id,
  name: r.name,
  property_type: r.property_type,
  management_category: r.management_category,
  street_address: r.street_address,
  unit_label: r.unit_label,
  city: r.city,
  state: r.state,
  zip: r.zip,
  year_built: r.year_built,
  notes: r.notes,
  normalized_address: r.normalized_address,
  county: r.county,
  parcel_number: r.parcel_number,
  recording_jurisdiction: r.recording_jurisdiction,
  legal_description: r.legal_description,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

export const toUnit = (r: Tables<"units">): Unit => ({
  id: r.id,
  organization_id: r.organization_id,
  property_id: r.property_id,
  name: r.name,
  bedrooms: num(r.bedrooms),
  bathrooms: num(r.bathrooms),
  square_feet: r.square_feet,
  monthly_rent: num(r.monthly_rent),
  security_deposit: num(r.security_deposit),
  rent_due_day: r.rent_due_day,
  occupancy_status: r.occupancy_status,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

export const toTenancy = (r: Tables<"tenancies">): Tenancy => ({
  id: r.id,
  organization_id: r.organization_id,
  property_id: r.property_id,
  unit_id: r.unit_id,
  tenant_user_id: r.tenant_user_id,
  tenant_name: r.tenant_name,
  tenant_email: r.tenant_email,
  tenant_phone: r.tenant_phone,
  status: r.status,
  verified: r.verified,
  verified_at: r.verified_at,
  start_date: r.start_date,
  end_date: r.end_date,
  monthly_rent: num(r.monthly_rent),
  security_deposit: num(r.security_deposit),
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

export const toLease = (r: Tables<"leases">): Lease => ({
  id: r.id,
  organization_id: r.organization_id,
  tenancy_id: r.tenancy_id,
  unit_id: r.unit_id,
  status: r.status,
  start_date: r.start_date,
  end_date: r.end_date,
  monthly_rent: num0(r.monthly_rent),
  security_deposit: num(r.security_deposit),
  rent_due_day: r.rent_due_day,
  late_fee: num(r.late_fee),
  late_fee_terms: r.late_fee_terms,
  document_id: r.document_id,
  document_path: r.document_path,
  signed_at: r.signed_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

export const toInvitation = (r: Tables<"tenant_invitations">): TenantInvitation => ({
  id: r.id,
  organization_id: r.organization_id,
  property_id: r.property_id ?? "",
  unit_id: r.unit_id ?? "",
  tenancy_id: r.tenancy_id,
  email: r.email ?? "",
  invited_name: r.full_name,
  phone: r.phone,
  monthly_rent: num(r.monthly_rent),
  lease_start: r.lease_start,
  lease_end: r.lease_end,
  status: r.status,
  token: r.token,
  expires_at: r.expires_at,
  accepted_at: r.accepted_at,
  accepted_by: r.accepted_by,
  created_by: r.invited_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toDocument = (r: Tables<"documents">): Document => ({
  id: r.id,
  organization_id: r.organization_id,
  property_id: r.property_id,
  unit_id: r.unit_id,
  tenancy_id: r.tenancy_id,
  lease_id: r.lease_id,
  kind: r.kind,
  title: r.title,
  storage_path: r.storage_path,
  mime_type: r.mime_type,
  size_bytes: r.size_bytes,
  visible_to_tenant: r.visible_to_tenant,
  uploaded_by: r.uploaded_by,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
});

const PAYMENT_METHODS: PaymentMethod[] = [
  "manual",
  "ach",
  "same_day_ach",
  "rtp",
  "fednow",
  "card",
  "cash",
  "check",
];

export const toPayment = (r: Tables<"payments">): Payment => ({
  id: r.id,
  organization_id: r.organization_id,
  tenancy_id: r.tenancy_id,
  unit_id: r.unit_id,
  amount: num0(r.amount),
  platform_fee_amount: num(r.platform_fee_amount),
  status: r.status,
  method: (PAYMENT_METHODS as string[]).includes(r.method ?? "")
    ? (r.method as PaymentMethod)
    : "manual",
  due_date: r.due_date ?? r.created_at.slice(0, 10),
  paid_at: r.paid_at,
  period_label: r.period_label ?? "",
  verified: r.verified,
  verification_source: r.verification_source,
  verified_at: r.verified_at,
  external_reference: r.external_reference,
  payout_id: r.payout_id,
  recorded_by: r.recorded_by,
  memo: r.memo,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toPaymentSchedule = (r: Tables<"payment_schedules">): PaymentSchedule => ({
  id: r.id,
  organization_id: r.organization_id,
  tenancy_id: r.tenancy_id,
  amount: num0(r.amount),
  cadence: r.cadence,
  due_day: r.due_day,
  starts_on: r.starts_on,
  ends_on: r.ends_on,
  active: r.active,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toMaintenance = (r: Tables<"maintenance_requests">): MaintenanceRequest => ({
  id: r.id,
  organization_id: r.organization_id,
  property_id: r.property_id ?? "",
  unit_id: r.unit_id ?? "",
  tenancy_id: r.tenancy_id,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  created_by: r.created_by,
  completed_at: r.resolved_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toConversation = (r: Tables<"conversations">): Conversation => ({
  id: r.id,
  organization_id: r.organization_id,
  tenancy_id: r.tenancy_id,
  subject: r.subject,
  last_message_at: r.last_message_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toMessage = (r: Tables<"messages">): Message => ({
  id: r.id,
  conversation_id: r.conversation_id,
  sender_id: r.sender_id,
  sender_name: r.sender_name,
  sender_role: r.sender_role,
  body: r.body,
  read_at: r.read_at,
  created_at: r.created_at,
});

export const toReview = (r: Tables<"reviews">): Review => ({
  id: r.id,
  organization_id: r.organization_id,
  tenancy_id: r.tenancy_id,
  direction: r.direction,
  author_id: r.author_id,
  author_name: r.author_name,
  rating: r.rating,
  body: r.body ?? "",
  status: r.status,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toReviewDispute = (r: Tables<"review_disputes">): ReviewDispute => ({
  id: r.id,
  review_id: r.review_id,
  raised_by: r.raised_by,
  reason: r.reason,
  status: (["open", "resolved", "rejected"].includes(r.status)
    ? r.status
    : "open") as ReviewDispute["status"],
  resolved_at: r.resolved_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toVerificationRecord = (r: Tables<"verification_records">): VerificationRecord => ({
  id: r.id,
  organization_id: r.organization_id ?? "",
  tenancy_id: r.tenancy_id,
  payment_id: r.payment_id,
  kind: r.kind,
  verified_by: r.verified_by,
  source: r.source,
  notes: r.notes ?? (r.label || null),
  created_at: r.created_at,
});

export const toNotification = (r: Tables<"notifications">): Notification => ({
  id: r.id,
  user_id: r.user_id,
  organization_id: r.organization_id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  read_at: r.read_at,
  created_at: r.created_at,
});

export const toAuditLog = (r: Tables<"audit_logs">): AuditLog => ({
  id: r.id,
  organization_id: r.organization_id,
  actor_id: r.actor_id,
  actor_role: r.actor_role,
  action: r.action,
  entity_type: r.entity_type ?? "",
  entity_id: r.entity_id,
  metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  created_at: r.created_at,
});

/* ------------------------------ marketplace ------------------------------- */

export const toListing = (r: Tables<"listings">): Listing => ({
  id: r.id,
  ...(r.public_ref ? { public_ref: r.public_ref } : {}),
  organization_id: r.organization_id,
  property_id: r.property_id,
  unit_id: r.unit_id,
  status: r.status,
  headline: r.headline,
  description: r.description,
  monthly_rent: num0(r.monthly_rent),
  security_deposit: num(r.security_deposit),
  available_on: r.available_on,
  lease_term_months: r.lease_term_months,
  amenities: r.amenities ?? [],
  screening_criteria: r.screening_criteria,
  syndicated_to: r.syndicated_to ?? [],
  published_at: r.published_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted_at: r.deleted_at,
  property_type: r.property_type,
  street_address: r.street_address,
  bedrooms: num(r.bedrooms),
  bathrooms: num(r.bathrooms),
  square_feet: r.square_feet,
  photos: r.photos ?? [],
  utilities_included: r.utilities_included ?? [],
  pet_policy: r.pet_policy,
  parking: r.parking,
  application_requirements: r.application_requirements ?? [],
  income_requirement: r.income_requirement,
  credit_requirement: r.credit_requirement,
  occupancy_limit: r.occupancy_limit,
  move_in_fees: r.move_in_fees,
  application_fee: num(r.application_fee),
  contact_name: r.contact_name,
  contact_email: r.contact_email,
  contact_phone: r.contact_phone,
  showing_instructions: r.showing_instructions,
  assigned_to: r.assigned_to,
  view_count: r.view_count,
});

export const toListingChannel = (r: Tables<"listing_channels">): ListingChannel => ({
  id: r.id,
  listing_id: r.listing_id,
  organization_id: r.organization_id,
  marketplace_id: r.marketplace_id,
  enabled: r.enabled,
  connection_status: r.connection_status as ListingChannel["connection_status"],
  listing_status: r.listing_status as ListingChannel["listing_status"],
  external_listing_id: r.external_listing_id,
  last_synced_at: r.last_synced_at,
  last_error: r.last_error,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toListingSyncEvent = (r: Tables<"listing_sync_events">): ListingSyncEvent => ({
  id: r.id,
  listing_id: r.listing_id,
  marketplace_id: r.marketplace_id,
  action: r.action as ListingSyncEvent["action"],
  result: r.result as ListingSyncEvent["result"],
  message: r.message,
  created_at: r.created_at,
});

export const toListingLead = (r: Tables<"listing_leads">): ListingLead => ({
  id: r.id,
  listing_id: r.listing_id,
  organization_id: r.organization_id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  message: r.message,
  source: r.source as ListingLead["source"],
  utm_source: r.utm_source,
  utm_medium: r.utm_medium,
  utm_campaign: r.utm_campaign,
  referrer: r.referrer,
  application_id: r.application_id,
  created_at: r.created_at,
});

export const toApplication = (r: Tables<"rental_applications">): RentalApplication => ({
  id: r.id,
  listing_id: r.listing_id,
  organization_id: r.organization_id,
  applicant_user_id: r.applicant_user_id,
  applicant_name: r.applicant_name,
  applicant_email: r.applicant_email,
  applicant_phone: r.applicant_phone,
  monthly_income: num(r.monthly_income),
  move_in_date: r.move_in_date,
  note: r.note,
  status: r.status,
  profile_shared: r.profile_shared,
  decided_at: r.decided_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
  source: (r.source || "rentid") as NonNullable<RentalApplication["source"]>,
  utm_source: r.utm_source,
  utm_campaign: r.utm_campaign,
  referrer: r.referrer,
  prefilled_from_resume: r.prefilled_from_resume,
  employer: r.employer,
  current_address: r.current_address,
  references: r.references_text,
});

export const toOwnerAccount = (r: Tables<"owner_accounts">): OwnerAccount => ({
  id: r.id,
  organization_id: r.organization_id,
  name: r.name,
  contact_name: r.contact_name,
  contact_email: r.contact_email,
  contract_start: r.contract_start,
  management_fee_pct: num(r.management_fee_pct),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export const toManagementAssignment = (
  r: Tables<"management_assignments">,
): ManagementAssignment => ({
  id: r.id,
  organization_id: r.organization_id,
  owner_account_id: r.owner_account_id,
  property_id: r.property_id,
  authority_status: r.authority_status,
  authorized_at: r.authorized_at,
  revoked_at: r.revoked_at,
  created_at: r.created_at,
});
