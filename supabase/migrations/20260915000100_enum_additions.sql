-- =====================================================================
-- Forward migration 1/5 — enum additions
--
-- Reconciles the LIVE schema (supabase/migrations/2026090[34]_*) with the
-- application's domain vocabulary in src/lib/types.ts. Enum values can only be
-- ADDED in Postgres, and a value added inside a transaction cannot be used in
-- that same transaction, so all enum changes live in this file and are used
-- by the migrations that follow.
--
-- Existing live values are kept (nothing removes or renames), so this is safe
-- to run against a database that already contains rows.
-- =====================================================================

-- ---- extend existing live enums with the values the app already uses ----
alter type public.occupancy_status add value if not exists 'off_market';

alter type public.maintenance_status add value if not exists 'acknowledged';
alter type public.maintenance_status add value if not exists 'completed';
alter type public.maintenance_status add value if not exists 'cancelled';

alter type public.maintenance_priority add value if not exists 'emergency';

alter type public.document_kind add value if not exists 'addendum';
alter type public.document_kind add value if not exists 'id_verification';
alter type public.document_kind add value if not exists 'inspection';

-- ---- new enums (previously text+check in supabase/planned, or missing) ----
create type public.org_kind as enum ('landlord', 'property_manager');

-- Shared claim/verification state for organizations, properties, authority.
create type public.verification_status as enum
  ('unverified', 'pending', 'verified', 'disputed', 'rejected', 'revoked');

create type public.lease_status as enum ('draft', 'active', 'expiring', 'ended', 'terminated');

create type public.payment_cadence as enum ('monthly', 'weekly', 'biweekly');

-- How a payment row came to be trusted. Only the platform (service role) may
-- assert platform_settled / bank_linked / imported — see payments trigger.
create type public.payment_verification_source as enum
  ('unverified', 'landlord_reported', 'tenant_reported', 'bank_linked', 'imported', 'platform_settled');

create type public.notification_kind as enum
  ('payment', 'maintenance', 'lease', 'invitation', 'message', 'system');

create type public.review_direction as enum ('landlord_to_tenant', 'tenant_to_landlord');
create type public.review_status as enum ('published', 'under_dispute', 'withdrawn');
create type public.dispute_status as enum ('open', 'resolved', 'rejected');

create type public.verification_kind as enum
  ('tenancy', 'payment', 'identity', 'lease_document', 'landlord_reported', 'tenant_reported');
create type public.verification_source as enum ('platform', 'landlord', 'tenant');

create type public.listing_status as enum ('draft', 'published', 'paused', 'leased', 'archived');

create type public.application_status as enum
  ('new', 'started', 'submitted', 'in_review', 'under_review', 'more_info_requested',
   'screening', 'qualified', 'approved', 'denied', 'withdrawn', 'lease_sent', 'lease_signed');

create type public.management_category as enum ('standard_residential', 'student_housing');

-- ---- payments foundation ----
create type public.payment_rail as enum
  ('ach', 'same_day_ach', 'rtp', 'fednow', 'card', 'check', 'manual');

create type public.payout_status as enum
  ('pending', 'processing', 'settled', 'returned', 'failed', 'cancelled');

create type public.payout_account_status as enum
  ('unverified', 'pending', 'verified', 'failed', 'disabled');

create type public.ledger_entry_type as enum
  ('rent_charge', 'rent_payment', 'platform_fee', 'processor_fee', 'payout',
   'payout_return', 'payment_return', 'refund', 'adjustment');
