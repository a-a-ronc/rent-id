-- =====================================================================
-- RentID — planned Row Level Security policies (NOT YET APPLIED)
--
-- Security model
--   landlord / property_manager : reach data only through organization
--                                 membership (organizations.owner_id or
--                                 organization_members)
--   tenant                      : reach data only through tenancies where
--                                 tenant_user_id = auth.uid()
--   admin                       : separate, explicit, and every admin write
--                                 lands in audit_logs
--
-- Frontend visibility is never a security control: every table below is
-- deny-by-default with RLS enabled and policies scoped to auth.uid().
-- Helper functions (public.has_role, public.is_org_member,
-- public.is_tenancy_tenant) are SECURITY DEFINER so member checks never
-- recurse through the policies they support.
-- =====================================================================

-- ------------------------------ profiles -----------------------------
create policy "profiles_select_self" on public.profiles
  for select to authenticated using (id = auth.uid());

-- A landlord may read the profile of a tenant they have a tenancy with, and
-- vice versa — nothing broader.
create policy "profiles_select_counterparty" on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.tenancies t
      where (t.tenant_user_id = profiles.id and public.is_org_member(t.organization_id, auth.uid()))
         or (t.tenant_user_id = auth.uid() and t.organization_id in (
              select o.id from public.organizations o where o.owner_id = profiles.id))
    )
  );

create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_read" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- ----------------------------- user_roles ----------------------------
-- Read-only to the owner; role grants happen server-side (service role) so a
-- client can never escalate itself to admin.
create policy "user_roles_select_self" on public.user_roles
  for select to authenticated using (user_id = auth.uid());
create policy "user_roles_admin_read" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- --------------------------- organizations ---------------------------
create policy "organizations_select_member" on public.organizations
  for select to authenticated using (
    owner_id = auth.uid() or public.is_org_member(id, auth.uid())
  );

-- A tenant can read the identity of the organization that holds their tenancy.
create policy "organizations_select_tenant" on public.organizations
  for select to authenticated using (
    exists (
      select 1 from public.tenancies t
      where t.organization_id = organizations.id and t.tenant_user_id = auth.uid()
    )
  );

create policy "organizations_insert_owner" on public.organizations
  for insert to authenticated with check (
    owner_id = auth.uid() and public.has_role(auth.uid(), 'landlord')
  );
create policy "organizations_update_owner" on public.organizations
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "organizations_admin_read" on public.organizations
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- ------------------------ organization_members -----------------------
create policy "organization_members_select_self_or_org" on public.organization_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_org_member(organization_id, auth.uid())
  );
-- Only the organization owner manages membership (property managers cannot
-- add themselves or widen their own access).
create policy "organization_members_write_owner" on public.organization_members
  for all to authenticated using (
    exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = auth.uid())
  );

-- --------------------------- properties ------------------------------
create policy "properties_select_org" on public.properties
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));

-- Tenants see only the property their own tenancy is attached to.
create policy "properties_select_tenant" on public.properties
  for select to authenticated using (
    exists (
      select 1 from public.tenancies t
      where t.property_id = properties.id and t.tenant_user_id = auth.uid()
    )
  );

create policy "properties_write_org" on public.properties
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- ------------------------------- units -------------------------------
create policy "units_select_org" on public.units
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "units_select_tenant" on public.units
  for select to authenticated using (
    exists (select 1 from public.tenancies t where t.unit_id = units.id and t.tenant_user_id = auth.uid())
  );
create policy "units_write_org" on public.units
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- ----------------------------- tenancies -----------------------------
create policy "tenancies_select_org" on public.tenancies
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "tenancies_select_tenant" on public.tenancies
  for select to authenticated using (tenant_user_id = auth.uid());
create policy "tenancies_write_org" on public.tenancies
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));
-- Tenants may not claim or edit tenancy rows directly; acceptance runs in a
-- server function that validates the invitation before linking the account.

-- ------------------------------- leases ------------------------------
create policy "leases_select_org" on public.leases
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "leases_select_tenant" on public.leases
  for select to authenticated using (public.is_tenancy_tenant(tenancy_id, auth.uid()));
create policy "leases_write_org" on public.leases
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- ------------------------- tenant_invitations ------------------------
create policy "tenant_invitations_select_org" on public.tenant_invitations
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
-- An invited user sees only invitations addressed to their own email.
create policy "tenant_invitations_select_invitee" on public.tenant_invitations
  for select to authenticated using (
    lower(email) = lower((select u.email from auth.users u where u.id = auth.uid()))
  );
create policy "tenant_invitations_write_org" on public.tenant_invitations
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- ----------------------------- documents -----------------------------
create policy "documents_select_org" on public.documents
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "documents_select_tenant" on public.documents
  for select to authenticated using (
    visible_to_tenant and tenancy_id is not null and public.is_tenancy_tenant(tenancy_id, auth.uid())
  );
create policy "documents_write_org" on public.documents
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- Storage: private "documents" bucket, keyed <organization_id>/<tenancy_id>/<file>
create policy "documents_storage_read_org" on storage.objects
  for select to authenticated using (
    bucket_id = 'documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );
create policy "documents_storage_read_tenant" on storage.objects
  for select to authenticated using (
    bucket_id = 'documents'
    and exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.visible_to_tenant
        and d.tenancy_id is not null
        and public.is_tenancy_tenant(d.tenancy_id, auth.uid())
    )
  );
create policy "documents_storage_write_org" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- ------------------------------ payments -----------------------------
create policy "payments_select_org" on public.payments
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "payments_select_tenant" on public.payments
  for select to authenticated using (public.is_tenancy_tenant(tenancy_id, auth.uid()));
create policy "payments_write_org" on public.payments
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

create policy "payment_schedules_select_org" on public.payment_schedules
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "payment_schedules_select_tenant" on public.payment_schedules
  for select to authenticated using (public.is_tenancy_tenant(tenancy_id, auth.uid()));
create policy "payment_schedules_write_org" on public.payment_schedules
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));

-- --------------------------- maintenance -----------------------------
create policy "maintenance_select_org" on public.maintenance_requests
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "maintenance_select_tenant" on public.maintenance_requests
  for select to authenticated using (
    tenancy_id is not null and public.is_tenancy_tenant(tenancy_id, auth.uid())
  );
create policy "maintenance_write_org" on public.maintenance_requests
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));
-- Tenants may open a request on their own tenancy but not change its status.
create policy "maintenance_insert_tenant" on public.maintenance_requests
  for insert to authenticated with check (
    tenancy_id is not null
    and public.is_tenancy_tenant(tenancy_id, auth.uid())
    and status = 'open'
    and created_by = auth.uid()
  );

-- ---------------------------- messaging ------------------------------
create policy "conversations_select_org" on public.conversations
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "conversations_select_tenant" on public.conversations
  for select to authenticated using (
    tenancy_id is not null and public.is_tenancy_tenant(tenancy_id, auth.uid())
  );
create policy "conversations_write_org" on public.conversations
  for all to authenticated
  using (public.is_org_member(organization_id, auth.uid()))
  with check (public.is_org_member(organization_id, auth.uid()));
create policy "conversations_insert_tenant" on public.conversations
  for insert to authenticated with check (
    tenancy_id is not null and public.is_tenancy_tenant(tenancy_id, auth.uid())
  );

create policy "messages_select_participant" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (
          public.is_org_member(c.organization_id, auth.uid())
          or (c.tenancy_id is not null and public.is_tenancy_tenant(c.tenancy_id, auth.uid()))
        )
    )
  );
create policy "messages_insert_participant" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (
          public.is_org_member(c.organization_id, auth.uid())
          or (c.tenancy_id is not null and public.is_tenancy_tenant(c.tenancy_id, auth.uid()))
        )
    )
  );
-- Marking a message read is the only permitted update.
create policy "messages_update_read_participant" on public.messages
  for update to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (
          public.is_org_member(c.organization_id, auth.uid())
          or (c.tenancy_id is not null and public.is_tenancy_tenant(c.tenancy_id, auth.uid()))
        )
    )
  ) with check (true);

-- ------------------------ reviews & disputes -------------------------
-- Reputation features are not implemented yet; policies stay tight so nothing
-- becomes publicly readable by accident.
create policy "reviews_select_participants" on public.reviews
  for select to authenticated using (
    public.is_org_member(organization_id, auth.uid())
    or public.is_tenancy_tenant(tenancy_id, auth.uid())
  );
create policy "reviews_insert_participants" on public.reviews
  for insert to authenticated with check (
    author_id = auth.uid()
    and (
      (direction = 'landlord_to_tenant' and public.is_org_member(organization_id, auth.uid()))
      or (direction = 'tenant_to_landlord' and public.is_tenancy_tenant(tenancy_id, auth.uid()))
    )
  );
create policy "review_disputes_select_participants" on public.review_disputes
  for select to authenticated using (
    exists (
      select 1 from public.reviews r
      where r.id = review_disputes.review_id
        and (public.is_org_member(r.organization_id, auth.uid()) or public.is_tenancy_tenant(r.tenancy_id, auth.uid()))
    )
  );
create policy "review_disputes_insert_participants" on public.review_disputes
  for insert to authenticated with check (
    raised_by = auth.uid()
    and exists (
      select 1 from public.reviews r
      where r.id = review_disputes.review_id
        and (public.is_org_member(r.organization_id, auth.uid()) or public.is_tenancy_tenant(r.tenancy_id, auth.uid()))
    )
  );

-- ------------------------ verification records -----------------------
create policy "verification_records_select_org" on public.verification_records
  for select to authenticated using (public.is_org_member(organization_id, auth.uid()));
create policy "verification_records_select_tenant" on public.verification_records
  for select to authenticated using (
    tenancy_id is not null and public.is_tenancy_tenant(tenancy_id, auth.uid())
  );
create policy "verification_records_insert_org" on public.verification_records
  for insert to authenticated with check (public.is_org_member(organization_id, auth.uid()));

-- --------------------------- notifications ---------------------------
create policy "notifications_select_self" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications_update_self" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------- audit logs ----------------------------
-- Administrative visibility is deliberately separate: only admins read the
-- audit trail, and only server-side (service role) code writes to it.
create policy "audit_logs_select_admin" on public.audit_logs
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "audit_logs_select_org_owner" on public.audit_logs
  for select to authenticated using (
    organization_id is not null
    and exists (select 1 from public.organizations o where o.id = organization_id and o.owner_id = auth.uid())
  );

-- =====================================================================
-- Property manager notes
--   A property manager is an organization_members row with role 'manager'.
--   Because every landlord-side policy routes through public.is_org_member,
--   a manager automatically sees exactly the organizations assigned to them
--   and nothing else. Managers cannot edit organization_members, so they can
--   never assign themselves to another landlord's portfolio.
--
-- Administrator notes
--   Admin access is granted only through public.user_roles (role = 'admin'),
--   never through a column on profiles. Client code may not insert roles;
--   the admin path is service-role only and every admin mutation must write
--   an audit_logs row (action prefix 'admin.').
-- =====================================================================

-- =====================================================================
-- Marketplace, ownership and management authority policies
-- Review only — not applied until the backend is reachable.
-- =====================================================================

-- A PM organization may only read/operate a property whose owner has
-- confirmed its authority. Ownership and authority stay separate.
create or replace function public.has_management_authority(_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.management_assignments a
    where a.property_id = _property_id
      and a.authority_status = 'verified'
      and a.revoked_at is null
      and public.is_org_member(a.organization_id)
  );
$$;

-- owner_accounts: visible only inside the managing organization.
create policy "owner_accounts_select_org" on public.owner_accounts
  for select to authenticated using (public.is_org_member(organization_id));
create policy "owner_accounts_write_org" on public.owner_accounts
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy "owner_accounts_update_org" on public.owner_accounts
  for update to authenticated using (public.is_org_member(organization_id));

-- management_assignments: the PM may request; only the property's owning
-- organization may confirm, dispute or revoke authority.
create policy "management_assignments_select" on public.management_assignments
  for select to authenticated using (
    public.is_org_member(organization_id) or public.can_manage_property(property_id)
  );
create policy "management_assignments_insert_pm" on public.management_assignments
  for insert to authenticated with check (public.is_org_member(organization_id));
create policy "management_assignments_update_owner" on public.management_assignments
  for update to authenticated using (public.can_manage_property(property_id));

-- listings: published listings are world-readable; only the owning
-- organization (or an authorized manager) may create or change them.
create policy "listings_select_public" on public.listings
  for select to anon, authenticated using (status = 'published' and deleted_at is null);
create policy "listings_select_org" on public.listings
  for select to authenticated using (
    public.is_org_member(organization_id) or public.has_management_authority(property_id)
  );
create policy "listings_insert_org" on public.listings
  for insert to authenticated with check (
    public.is_org_member(organization_id) or public.has_management_authority(property_id)
  );
create policy "listings_update_org" on public.listings
  for update to authenticated using (
    public.is_org_member(organization_id) or public.has_management_authority(property_id)
  );

-- rental_applications: an applicant sees only their own; the listing side
-- sees applications to its own listings. Applicant contact data is never
-- readable by unrelated organizations.
create policy "applications_select_applicant" on public.rental_applications
  for select to authenticated using (applicant_user_id = auth.uid());
create policy "applications_select_org" on public.rental_applications
  for select to authenticated using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (public.is_org_member(l.organization_id) or public.has_management_authority(l.property_id))
    )
  );
create policy "applications_insert_self" on public.rental_applications
  for insert to authenticated with check (
    applicant_user_id = auth.uid()
    and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published')
  );
create policy "applications_update_org" on public.rental_applications
  for update to authenticated using (
    exists (
      select 1 from public.listings l
      where l.id = listing_id
        and (public.is_org_member(l.organization_id) or public.has_management_authority(l.property_id))
    )
  );

-- Anonymous applications (a renter applying before signing up) must go
-- through a server function with the service role, which creates the user
-- record first and writes an audit_logs row.

-- =====================================================================
-- Student-housing policies (business map §25-§38)
--
-- Two access shapes: the operator side (org members plus verified management
-- authority on the property) and the resident side (their own occupancy).
-- A roommate never reads another roommate's money or documents.
-- =====================================================================

create or replace function public.can_operate_property(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties p
    where p.id = _property_id
      and (public.is_org_member(p.organization_id) or public.has_management_authority(p.id))
  )
$$;

create or replace function public.is_my_occupancy(_occupancy_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.occupancies o
    where o.id = _occupancy_id and o.resident_user_id = auth.uid()
  )
$$;

-- configuration + terms + beds: operators write, residents read their property
create policy "student_config_select" on public.student_housing_configs
  for select to authenticated using (
    public.can_operate_property(property_id)
    or exists (select 1 from public.occupancies o
               where o.property_id = student_housing_configs.property_id
                 and o.resident_user_id = auth.uid())
  );
create policy "student_config_write" on public.student_housing_configs
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

create policy "academic_terms_select" on public.academic_terms
  for select to authenticated using (
    public.can_operate_property(property_id)
    or exists (select 1 from public.occupancies o
               where o.property_id = academic_terms.property_id and o.resident_user_id = auth.uid())
  );
create policy "academic_terms_write" on public.academic_terms
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

create policy "room_beds_select" on public.room_beds
  for select to authenticated using (
    public.can_operate_property(property_id)
    or exists (select 1 from public.occupancies o
               where o.unit_id = room_beds.unit_id and o.resident_user_id = auth.uid())
  );
create policy "room_beds_write" on public.room_beds
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

-- occupancies: a resident sees only their own record; operators see the property
create policy "occupancies_select" on public.occupancies
  for select to authenticated using (
    resident_user_id = auth.uid() or public.can_operate_property(property_id)
  );
create policy "occupancies_write_operator" on public.occupancies
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

-- roommate groups: a member sees their own group, operators see the property
create policy "roommate_groups_select" on public.roommate_groups
  for select to authenticated using (
    public.can_operate_property(property_id)
    or exists (select 1 from public.roommate_group_members m
               where m.group_id = roommate_groups.id and m.user_id = auth.uid())
  );
create policy "roommate_groups_write_operator" on public.roommate_groups
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

create policy "roommate_members_select" on public.roommate_group_members
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.roommate_groups g
               where g.id = group_id and public.can_operate_property(g.property_id))
  );
create policy "roommate_members_write_operator" on public.roommate_group_members
  for all to authenticated using (
    exists (select 1 from public.roommate_groups g
            where g.id = group_id and public.can_operate_property(g.property_id))
  ) with check (
    exists (select 1 from public.roommate_groups g
            where g.id = group_id and public.can_operate_property(g.property_id))
  );

-- guarantors: the guarantor, the resident they back, and the operator
create policy "guarantors_select" on public.guarantor_relationships
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_my_occupancy(occupancy_id)
    or public.is_org_member(organization_id)
    or exists (select 1 from public.occupancies o
               where o.id = occupancy_id and public.can_operate_property(o.property_id))
  );
create policy "guarantors_write_operator" on public.guarantor_relationships
  for all to authenticated using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- money: a resident reads only charges allocated to them, never a roommate's
create policy "charges_select" on public.charges
  for select to authenticated using (
    public.can_operate_property(property_id)
    or public.is_my_occupancy(occupancy_id)
    or exists (select 1 from public.charge_allocations a
               where a.charge_id = charges.id and public.is_my_occupancy(a.occupancy_id))
  );
create policy "charges_write_operator" on public.charges
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

create policy "charge_allocations_select" on public.charge_allocations
  for select to authenticated using (
    public.is_my_occupancy(occupancy_id)
    or exists (select 1 from public.charges c
               where c.id = charge_id and public.can_operate_property(c.property_id))
  );
create policy "charge_allocations_write_operator" on public.charge_allocations
  for all to authenticated using (
    exists (select 1 from public.charges c
            where c.id = charge_id and public.can_operate_property(c.property_id))
  ) with check (
    exists (select 1 from public.charges c
            where c.id = charge_id and public.can_operate_property(c.property_id))
  );

-- payers: a resident sees their own payers (self, parent, guarantor)
create policy "payers_select" on public.payers
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_my_occupancy(linked_occupancy_id)
    or public.is_org_member(organization_id)
  );
create policy "payers_write_operator" on public.payers
  for all to authenticated using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "student_payments_select" on public.student_payments
  for select to authenticated using (
    public.is_org_member(organization_id)
    or exists (select 1 from public.payers p
               where p.id = payer_id
                 and (p.user_id = auth.uid() or public.is_my_occupancy(p.linked_occupancy_id)))
  );
create policy "student_payments_insert" on public.student_payments
  for insert to authenticated with check (
    public.is_org_member(organization_id)
    or exists (select 1 from public.payers p
               where p.id = payer_id and p.authorized
                 and (p.user_id = auth.uid() or public.is_my_occupancy(p.linked_occupancy_id)))
  );
create policy "student_payments_update_operator" on public.student_payments
  for update to authenticated using (public.is_org_member(organization_id));

create policy "payment_allocations_select" on public.payment_allocations
  for select to authenticated using (
    exists (select 1 from public.charges c
            where c.id = charge_id
              and (public.can_operate_property(c.property_id) or public.is_my_occupancy(c.occupancy_id)))
  );
create policy "payment_allocations_insert_operator" on public.payment_allocations
  for insert to authenticated with check (
    exists (select 1 from public.charges c
            where c.id = charge_id and public.can_operate_property(c.property_id))
  );

-- ledger: readable by the parties, insert-only, never updated or deleted
create policy "ledger_events_select" on public.ledger_events
  for select to authenticated using (
    public.is_org_member(organization_id) or public.is_my_occupancy(occupancy_id)
  );
create policy "ledger_events_insert" on public.ledger_events
  for insert to authenticated with check (public.is_org_member(organization_id));

-- lease changes: the resident may request; only operators may decide
create policy "lease_changes_select" on public.lease_change_requests
  for select to authenticated using (
    public.can_operate_property(property_id) or public.is_my_occupancy(occupancy_id)
  );
create policy "lease_changes_insert_resident" on public.lease_change_requests
  for insert to authenticated with check (
    public.is_my_occupancy(occupancy_id) or public.can_operate_property(property_id)
  );
create policy "lease_changes_update_operator" on public.lease_change_requests
  for update to authenticated using (public.can_operate_property(property_id));

create policy "approval_steps_select" on public.approval_steps
  for select to authenticated using (
    exists (select 1 from public.lease_change_requests r
            where r.id = request_id
              and (public.can_operate_property(r.property_id) or public.is_my_occupancy(r.occupancy_id)))
  );
create policy "approval_steps_write_operator" on public.approval_steps
  for all to authenticated using (
    exists (select 1 from public.lease_change_requests r
            where r.id = request_id and public.can_operate_property(r.property_id))
  ) with check (
    exists (select 1 from public.lease_change_requests r
            where r.id = request_id and public.can_operate_property(r.property_id))
  );

-- turnover is operator-only
create policy "turn_tasks_all_operator" on public.turn_tasks
  for all to authenticated using (public.can_operate_property(property_id))
  with check (public.can_operate_property(property_id));

-- maintenance: residents see their own unit's cases (shared areas included)
create policy "student_cases_select" on public.student_maintenance_cases
  for select to authenticated using (
    public.can_operate_property(property_id)
    or exists (select 1 from public.occupancies o
               where o.unit_id = student_maintenance_cases.unit_id and o.resident_user_id = auth.uid())
  );
create policy "student_cases_insert_resident" on public.student_maintenance_cases
  for insert to authenticated with check (
    public.can_operate_property(property_id) or public.is_my_occupancy(requester_occupancy_id)
  );
-- Damage allocation is an operator decision; the resident's dispute response
-- is written through a server function that appends an audit_logs row.
create policy "student_cases_update_operator" on public.student_maintenance_cases
  for update to authenticated using (public.can_operate_property(property_id));

-- ============================================================
-- Listing syndication policies (review only, not applied)
-- ============================================================

-- Distribution state of a published listing is public information;
-- drafts and paused listings stay inside the operating organization.
create policy "listing_channels_select_public" on public.listing_channels
  for select to anon using (
    exists (select 1 from public.listings l
            where l.id = listing_channels.listing_id and l.status = 'published')
  );
create policy "listing_channels_select_member" on public.listing_channels
  for select to authenticated using (public.is_org_member(organization_id));
create policy "listing_channels_write_member" on public.listing_channels
  for all to authenticated using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Sync history is an operator audit trail: never public, never editable.
create policy "listing_sync_events_select_member" on public.listing_sync_events
  for select to authenticated using (
    exists (select 1 from public.listings l
            where l.id = listing_sync_events.listing_id and public.is_org_member(l.organization_id))
  );
create policy "listing_sync_events_insert_member" on public.listing_sync_events
  for insert to authenticated with check (
    exists (select 1 from public.listings l
            where l.id = listing_sync_events.listing_id and public.is_org_member(l.organization_id))
  );

-- Leads belong to the organization that owns the listing. Applicants never
-- read the lead table; their own record is the rental_applications row.
create policy "listing_leads_select_member" on public.listing_leads
  for select to authenticated using (public.is_org_member(organization_id));
create policy "listing_leads_update_member" on public.listing_leads
  for update to authenticated using (public.is_org_member(organization_id));
-- Lead capture on a public listing page runs through a server function using
-- the service role, so no anon insert policy is granted here.
create policy "listing_leads_insert_member" on public.listing_leads
  for insert to authenticated with check (public.is_org_member(organization_id));
