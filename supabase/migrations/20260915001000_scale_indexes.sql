-- =====================================================================
-- Forward migration — indexes and constraints for the queries the app
-- actually issues, plus the guardrails that keep them cheap as the graph
-- grows. See docs/SCALING.md for the reasoning and the numbers.
--
-- Three classes of work here:
--   1. Composite/partial indexes matching real access paths (the existing
--      single-column indexes force a sort or a filter on every dashboard).
--   2. Indexes under the RLS helper functions. A policy that calls
--      is_org_member() or is_tenancy_party() runs that function per candidate
--      row; without an index on the column it probes, every read degrades to
--      a sequential scan as soon as a table is bigger than a demo.
--   3. Data-integrity constraints that prevent the states the app would have
--      to defend against in application code forever.
-- =====================================================================

-- ------------------------------------------------- RLS helper hot paths
-- is_org_member() → organization_members(organization_id, user_id) exists as a
-- unique constraint, and organizations(owner_id) is indexed. is_tenancy_party()
-- probes tenancies by id and by tenant_user_id — both covered. The gap is
-- can_manage_property()/can_manage_unit(), which walk units → properties.
create index if not exists units_property_org_idx on public.units (property_id, organization_id);

-- ------------------------------------------------------- landlord views
-- "tenants in this workspace, alive, by name" — the default tenants screen.
create index if not exists tenancies_org_alive_idx
  on public.tenancies (organization_id, tenant_name)
  where deleted_at is null;

-- "my tenancies, newest first" — the tenant home screen.
create index if not exists tenancies_tenant_alive_idx
  on public.tenancies (tenant_user_id, created_at desc)
  where deleted_at is null and tenant_user_id is not null;

-- Dashboard money queries always filter org + a date window, and usually a
-- status. Two partial indexes beat one wide one here because the collected
-- and outstanding halves have disjoint statuses.
create index if not exists payments_org_paid_idx
  on public.payments (organization_id, paid_at desc)
  where status = 'paid';
create index if not exists payments_org_due_open_idx
  on public.payments (organization_id, due_date)
  where status in ('scheduled', 'pending', 'late', 'failed');
-- Tenant ledger: "my payments, newest first".
create index if not exists payments_tenancy_due_idx
  on public.payments (tenancy_id, due_date desc);

-- Open work orders per workspace (the PM desk counts these on every load).
create index if not exists maintenance_org_open_idx
  on public.maintenance_requests (organization_id, created_at desc)
  where status in ('open', 'acknowledged', 'in_progress');

-- Leases expiring in the next N days.
create index if not exists leases_org_expiring_idx
  on public.leases (organization_id, end_date)
  where deleted_at is null;

-- Documents list is org + newest-first, and the tenant view filters visibility.
create index if not exists documents_org_alive_idx
  on public.documents (organization_id, created_at desc)
  where deleted_at is null;
create index if not exists documents_tenancy_visible_idx
  on public.documents (tenancy_id, created_at desc)
  where deleted_at is null and visible_to_tenant;

-- Conversation list orders by last_message_at; unread counts probe messages
-- for rows the viewer did not send and has not read.
create index if not exists conversations_org_recent_idx
  on public.conversations (organization_id, last_message_at desc);
create index if not exists conversations_tenancy_recent_idx
  on public.conversations (tenancy_id, last_message_at desc)
  where tenancy_id is not null;
create index if not exists messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

-- Unread notification badge.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- Pending invitations addressed to a signed-in tenant (RLS matches on email).
create index if not exists tenant_invitations_pending_idx
  on public.tenant_invitations (lower(email), expires_at)
  where status = 'pending';
create index if not exists tenant_invitations_org_idx
  on public.tenant_invitations (organization_id, created_at desc);

-- ----------------------------------------------------------- marketplace
-- The public search: published listings, cheapest/newest first, filtered by
-- rent and bedrooms. A partial index keeps drafts and leased rows out of it
-- entirely — the public index stays small no matter how much history exists.
create index if not exists listings_search_idx
  on public.listings (monthly_rent, available_on)
  where status = 'published' and deleted_at is null;
create index if not exists listings_search_beds_idx
  on public.listings (bedrooms, monthly_rent)
  where status = 'published' and deleted_at is null;
-- City/state browse.
create index if not exists listings_search_place_idx
  on public.listings (lower(state), lower(city), monthly_rent)
  where status = 'published' and deleted_at is null;

-- Applicant's own applications, and the operator's open pipeline.
create index if not exists rental_applications_applicant_recent_idx
  on public.rental_applications (applicant_user_id, created_at desc)
  where applicant_user_id is not null;
create index if not exists rental_applications_open_idx
  on public.rental_applications (organization_id, created_at desc)
  where status not in ('approved', 'denied', 'withdrawn');

-- ------------------------------------------------------------ money ops
create index if not exists ledger_entries_type_idx
  on public.ledger_entries (organization_id, entry_type, occurred_at desc);
create index if not exists payouts_pending_idx
  on public.payouts (status, created_at)
  where status in ('pending', 'processing');
create index if not exists payment_events_unprocessed_idx
  on public.payment_events (received_at)
  where processed_at is null;

-- --------------------------------------------------------- verification
create index if not exists verification_cases_queue_idx
  on public.verification_cases (status, created_at)
  where status in ('pending', 'collecting_evidence', 'manual_review', 'fraud_review');
create index if not exists property_party_relationships_live_idx
  on public.property_party_relationships (property_id, relationship)
  where status = 'ownership_verified' and revoked_at is null;

-- -------------------------------------------------------- audit / history
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists verification_records_payment_idx
  on public.verification_records (payment_id)
  where payment_id is not null;

-- =====================================================================
-- Integrity constraints — states the app would otherwise defend against
-- in code forever, and which corrupt reporting if they ever occur.
-- =====================================================================

-- One live tenancy per unit. Two "active" tenancies on one unit means two
-- people believe they rent it, and every occupancy metric is wrong.
create unique index if not exists tenancies_one_active_per_unit
  on public.tenancies (unit_id)
  where status = 'active' and deleted_at is null;

-- One live listing per unit.
create unique index if not exists listings_one_live_per_unit
  on public.listings (unit_id)
  where status in ('draft', 'published', 'paused') and deleted_at is null;

-- A tenant applies to a listing once (they can withdraw and re-apply).
create unique index if not exists rental_applications_one_open_per_applicant
  on public.rental_applications (listing_id, applicant_user_id)
  where applicant_user_id is not null and status <> 'withdrawn';

-- A payment cannot be paid without a paid_at, or verified without a source.
alter table public.payments drop constraint if exists payments_paid_has_timestamp;
alter table public.payments add constraint payments_paid_has_timestamp
  check (status <> 'paid' or paid_at is not null) not valid;
alter table public.payments validate constraint payments_paid_has_timestamp;

alter table public.payments drop constraint if exists payments_verified_has_source;
alter table public.payments add constraint payments_verified_has_source
  check (not verified or verification_source in ('platform_settled', 'bank_linked')) not valid;
alter table public.payments validate constraint payments_verified_has_source;

-- A lease cannot end before it starts.
alter table public.leases drop constraint if exists leases_dates_ordered;
alter table public.leases add constraint leases_dates_ordered
  check (end_date >= start_date) not valid;
alter table public.leases validate constraint leases_dates_ordered;

-- =====================================================================
-- Statistics targets. `organization_id` is the column every RLS policy and
-- almost every query filters on, and its distribution is extremely skewed
-- (a handful of large PMs, a long tail of one-property landlords). The
-- default 100-bucket histogram misestimates the large tenants badly enough
-- to flip the planner to a sequential scan.
-- =====================================================================
alter table public.payments alter column organization_id set statistics 500;
alter table public.tenancies alter column organization_id set statistics 500;
alter table public.maintenance_requests alter column organization_id set statistics 500;
alter table public.documents alter column organization_id set statistics 500;
alter table public.listings alter column organization_id set statistics 500;
analyze public.payments;
analyze public.tenancies;
analyze public.maintenance_requests;
analyze public.documents;
analyze public.listings;
