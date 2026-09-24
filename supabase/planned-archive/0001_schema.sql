-- =====================================================================
-- RentID — proposed schema (NOT YET APPLIED)
--
-- Review target. Apply through the migration tool once the backend is
-- reachable; this file is the source of truth for that migration.
-- Conventions: uuid primary keys, created_at/updated_at on every mutable
-- table, soft deletion (deleted_at) where history matters, constrained
-- status values via enums, indexes on every foreign key used for filtering.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ------------------------------- enums -------------------------------
create type public.app_role as enum ('landlord', 'tenant', 'property_manager', 'admin');
create type public.org_member_role as enum ('owner', 'manager', 'staff');
create type public.property_type as enum ('single_family', 'multi_family', 'condo', 'townhouse', 'apartment');
create type public.occupancy_status as enum ('vacant', 'occupied', 'off_market');
create type public.tenancy_status as enum ('pending', 'active', 'ended', 'cancelled');
create type public.lease_status as enum ('draft', 'active', 'expiring', 'ended', 'terminated');
create type public.invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');
create type public.document_kind as enum ('lease', 'addendum', 'id_verification', 'inspection', 'receipt', 'notice', 'other');
create type public.payment_status as enum ('scheduled', 'pending', 'paid', 'late', 'failed', 'refunded');
create type public.payment_method as enum ('manual', 'ach', 'card', 'cash', 'check');
create type public.payment_cadence as enum ('monthly', 'weekly', 'biweekly');
create type public.maintenance_status as enum ('open', 'acknowledged', 'in_progress', 'completed', 'cancelled');
create type public.maintenance_priority as enum ('low', 'normal', 'high', 'emergency');
create type public.review_direction as enum ('landlord_to_tenant', 'tenant_to_landlord');
create type public.review_status as enum ('published', 'under_dispute', 'withdrawn');
create type public.dispute_status as enum ('open', 'resolved', 'rejected');
create type public.verification_kind as enum ('tenancy', 'payment', 'identity', 'lease_document', 'landlord_reported', 'tenant_reported');
create type public.verification_source as enum ('platform', 'landlord', 'tenant');
create type public.notification_kind as enum ('payment', 'maintenance', 'lease', 'invitation', 'message', 'system');

-- --------------------------- shared triggers -------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------ profiles -----------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- --------------------------- roles (separate) ------------------------
-- Roles NEVER live on profiles: that would enable privilege escalation.
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- --------------------------- organizations ---------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_entity_name text,
  owner_id uuid references auth.users(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;
create index organizations_owner_id_idx on public.organizations(owner_id);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_member_role not null default 'staff',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
grant select, insert, update, delete on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
alter table public.organization_members enable row level security;
create index organization_members_user_id_idx on public.organization_members(user_id);
create index organization_members_organization_id_idx on public.organization_members(organization_id);

-- Membership helper (security definer so member policies never recurse).
create or replace function public.is_org_member(_org_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = _org_id and user_id = _user_id
  ) or exists (
    select 1 from public.organizations
    where id = _org_id and owner_id = _user_id
  )
$$;

-- Tenant-side helper: is this user the tenant on this tenancy?
create or replace function public.is_tenancy_tenant(_tenancy_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenancies
    where id = _tenancy_id and tenant_user_id = _user_id
  )
$$;

-- ---------------------------- properties -----------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  property_type public.property_type not null default 'single_family',
  street_address text not null,
  unit_label text,
  city text not null,
  state text not null,
  zip text not null,
  year_built integer check (year_built is null or (year_built between 1700 and 2100)),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.properties to authenticated;
grant all on public.properties to service_role;
alter table public.properties enable row level security;
create index properties_organization_id_idx on public.properties(organization_id);
create trigger properties_updated_at before update on public.properties
  for each row execute function public.set_updated_at();

create table public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms numeric(3,1) check (bathrooms is null or bathrooms >= 0),
  square_feet integer check (square_feet is null or square_feet > 0),
  monthly_rent numeric(12,2) check (monthly_rent is null or monthly_rent >= 0),
  security_deposit numeric(12,2) check (security_deposit is null or security_deposit >= 0),
  rent_due_day smallint not null default 1 check (rent_due_day between 1 and 28),
  occupancy_status public.occupancy_status not null default 'vacant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (property_id, name)
);
grant select, insert, update, delete on public.units to authenticated;
grant all on public.units to service_role;
alter table public.units enable row level security;
create index units_property_id_idx on public.units(property_id);
create index units_organization_id_idx on public.units(organization_id);
create trigger units_updated_at before update on public.units
  for each row execute function public.set_updated_at();

-- ----------------------------- tenancies -----------------------------
create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  tenant_user_id uuid references auth.users(id) on delete set null,
  tenant_name text not null,
  tenant_email text,
  tenant_phone text,
  status public.tenancy_status not null default 'pending',
  verified boolean not null default false,
  verified_at timestamptz,
  start_date date,
  end_date date,
  monthly_rent numeric(12,2) check (monthly_rent is null or monthly_rent >= 0),
  security_deposit numeric(12,2) check (security_deposit is null or security_deposit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.tenancies to authenticated;
grant all on public.tenancies to service_role;
alter table public.tenancies enable row level security;
create index tenancies_organization_id_idx on public.tenancies(organization_id);
create index tenancies_unit_id_idx on public.tenancies(unit_id);
create index tenancies_tenant_user_id_idx on public.tenancies(tenant_user_id);
create trigger tenancies_updated_at before update on public.tenancies
  for each row execute function public.set_updated_at();

-- Time-dependent validation belongs in a trigger, not a CHECK constraint.
create or replace function public.validate_tenancy_dates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.end_date is not null and new.start_date is not null and new.end_date < new.start_date then
    raise exception 'end_date must be on or after start_date';
  end if;
  return new;
end;
$$;
create trigger tenancies_validate_dates before insert or update on public.tenancies
  for each row execute function public.validate_tenancy_dates();

-- ------------------------------- leases ------------------------------
create table public.leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  status public.lease_status not null default 'draft',
  start_date date not null,
  end_date date not null,
  monthly_rent numeric(12,2) not null check (monthly_rent >= 0),
  security_deposit numeric(12,2) check (security_deposit is null or security_deposit >= 0),
  rent_due_day smallint not null default 1 check (rent_due_day between 1 and 28),
  late_fee numeric(12,2) check (late_fee is null or late_fee >= 0),
  document_id uuid,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.leases to authenticated;
grant all on public.leases to service_role;
alter table public.leases enable row level security;
create index leases_tenancy_id_idx on public.leases(tenancy_id);
create index leases_organization_id_idx on public.leases(organization_id);
create index leases_end_date_idx on public.leases(end_date);
create trigger leases_updated_at before update on public.leases
  for each row execute function public.set_updated_at();

-- ------------------------- tenant invitations ------------------------
create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  email text not null,
  invited_name text,
  status public.invitation_status not null default 'pending',
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);
grant select, insert, update on public.tenant_invitations to authenticated;
grant all on public.tenant_invitations to service_role;
alter table public.tenant_invitations enable row level security;
create index tenant_invitations_email_idx on public.tenant_invitations(lower(email));
create index tenant_invitations_organization_id_idx on public.tenant_invitations(organization_id);
create trigger tenant_invitations_updated_at before update on public.tenant_invitations
  for each row execute function public.set_updated_at();

-- ----------------------------- documents -----------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  kind public.document_kind not null default 'other',
  title text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  visible_to_tenant boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create index documents_tenancy_id_idx on public.documents(tenancy_id);
create index documents_organization_id_idx on public.documents(organization_id);
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.leases
  add constraint leases_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete set null;

-- ------------------------------ payments -----------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  status public.payment_status not null default 'scheduled',
  method public.payment_method not null default 'manual',
  due_date date not null,
  paid_at timestamptz,
  period_label text not null,
  verified boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;
create index payments_tenancy_id_idx on public.payments(tenancy_id);
create index payments_organization_id_idx on public.payments(organization_id);
create index payments_due_date_idx on public.payments(due_date);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  cadence public.payment_cadence not null default 'monthly',
  due_day smallint not null default 1 check (due_day between 1 and 28),
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.payment_schedules to authenticated;
grant all on public.payment_schedules to service_role;
alter table public.payment_schedules enable row level security;
create index payment_schedules_tenancy_id_idx on public.payment_schedules(tenancy_id);
create trigger payment_schedules_updated_at before update on public.payment_schedules
  for each row execute function public.set_updated_at();

-- --------------------------- maintenance -----------------------------
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  title text not null,
  description text,
  status public.maintenance_status not null default 'open',
  priority public.maintenance_priority not null default 'normal',
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.maintenance_requests to authenticated;
grant all on public.maintenance_requests to service_role;
alter table public.maintenance_requests enable row level security;
create index maintenance_requests_tenancy_id_idx on public.maintenance_requests(tenancy_id);
create index maintenance_requests_organization_id_idx on public.maintenance_requests(organization_id);
create trigger maintenance_requests_updated_at before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

-- ---------------------------- messaging ------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  subject text not null default 'Conversation',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create index conversations_organization_id_idx on public.conversations(organization_id);
create index conversations_tenancy_id_idx on public.conversations(tenancy_id);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_name text not null,
  sender_role public.app_role not null,
  body text not null check (length(btrim(body)) > 0),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create index messages_conversation_id_idx on public.messages(conversation_id);

-- --------------------- reviews & disputes (UI only) ------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  direction public.review_direction not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null,
  status public.review_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenancy_id, direction, author_id)
);
grant select, insert, update on public.reviews to authenticated;
grant all on public.reviews to service_role;
alter table public.reviews enable row level security;
create index reviews_tenancy_id_idx on public.reviews(tenancy_id);
create trigger reviews_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

create table public.review_disputes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  raised_by uuid references auth.users(id) on delete set null,
  reason text not null,
  status public.dispute_status not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.review_disputes to authenticated;
grant all on public.review_disputes to service_role;
alter table public.review_disputes enable row level security;
create index review_disputes_review_id_idx on public.review_disputes(review_id);
create trigger review_disputes_updated_at before update on public.review_disputes
  for each row execute function public.set_updated_at();

-- ------------------------ verification records -----------------------
create table public.verification_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  kind public.verification_kind not null,
  verified_by uuid references auth.users(id) on delete set null,
  source public.verification_source not null default 'platform',
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert on public.verification_records to authenticated;
grant all on public.verification_records to service_role;
alter table public.verification_records enable row level security;
create index verification_records_tenancy_id_idx on public.verification_records(tenancy_id);

-- --------------------------- notifications ---------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  kind public.notification_kind not null default 'system',
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create index notifications_user_id_idx on public.notifications(user_id);

-- ----------------------------- audit logs ----------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role public.app_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
-- Audit rows are written server-side only and read by admins.
grant select on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create index audit_logs_organization_id_idx on public.audit_logs(organization_id);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);

-- ------------------- profile bootstrap on signup ---------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
-- Trigger creation on auth.users is handled by the platform integration.

-- =====================================================================
-- Marketplace, ownership and management authority (business map §7-§9)
-- Review only — not applied until the backend is reachable.
-- =====================================================================

-- Organizations are either landlord-operated or a property-management company,
-- and each carries its own verification state (badges/listings gate on it).
alter table public.organizations
  add column if not exists kind text not null default 'landlord'
    check (kind in ('landlord', 'property_manager')),
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));

-- ------------------------------ owner_accounts ------------------------
-- The owners a property-management company works for. Ownership is recorded
-- separately from management authority so an owner can change managers
-- without losing property, lease or payment history.
create table if not exists public.owner_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contract_start date,
  management_fee_pct numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.owner_accounts to authenticated;
grant all on public.owner_accounts to service_role;
alter table public.owner_accounts enable row level security;
create index if not exists owner_accounts_organization_id_idx on public.owner_accounts(organization_id);

-- -------------------------- management_assignments --------------------
-- Owner-granted authority for a PM organization to operate a property.
-- Starts 'pending'; badges, listings and payout changes stay locked until
-- the owner confirms it.
create table if not exists public.management_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_account_id uuid not null references public.owner_accounts(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  authority_status text not null default 'pending'
    check (authority_status in ('pending', 'verified', 'disputed', 'revoked')),
  authorized_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, property_id)
);
grant select, insert, update on public.management_assignments to authenticated;
grant all on public.management_assignments to service_role;
alter table public.management_assignments enable row level security;
create index if not exists management_assignments_org_idx on public.management_assignments(organization_id);
create index if not exists management_assignments_property_idx on public.management_assignments(property_id);

-- --------------------------------- listings ---------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  headline text not null,
  description text,
  monthly_rent numeric(12,2) not null,
  security_deposit numeric(12,2),
  available_on date not null,
  lease_term_months integer not null default 12,
  amenities text[] not null default '{}',
  photo_urls text[] not null default '{}',
  requires_rentid_profile boolean not null default true,
  syndicated_to text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused', 'leased', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
grant select on public.listings to anon;            -- published listings are public
grant select, insert, update, delete on public.listings to authenticated;
grant all on public.listings to service_role;
alter table public.listings enable row level security;
create index if not exists listings_status_idx on public.listings(status);
create index if not exists listings_organization_id_idx on public.listings(organization_id);

-- ---------------------------- rental_applications ---------------------
create table if not exists public.rental_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  applicant_user_id uuid references auth.users(id) on delete set null,
  applicant_name text not null,
  applicant_email text not null,
  applicant_phone text,
  monthly_income numeric(12,2),
  move_in_date date,
  note text,
  shares_rentid_profile boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'in_review', 'approved', 'denied', 'withdrawn')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.rental_applications to authenticated;
grant all on public.rental_applications to service_role;
alter table public.rental_applications enable row level security;
create index if not exists rental_applications_listing_idx on public.rental_applications(listing_id);
create index if not exists rental_applications_applicant_idx on public.rental_applications(applicant_user_id);

create trigger owner_accounts_touch before update on public.owner_accounts
  for each row execute function public.touch_updated_at();
create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();
create trigger rental_applications_touch before update on public.rental_applications
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Student-housing vertical (business map §25-§38)
--
-- Student housing is a *category* on the same graph, not a separate app:
-- properties gain `management_category`, and the tables below add bed-level
-- inventory, roommate/guarantor structure, an immutable money ledger and
-- approval-first lease changes.
-- =====================================================================

alter table public.properties
  add column if not exists management_category text not null default 'standard_residential'
    check (management_category in ('standard_residential', 'student_housing'));
create index if not exists properties_management_category_idx
  on public.properties(management_category);

-- ------------------------- student_housing_configs ---------------------
create table if not exists public.student_housing_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null unique references public.properties(id) on delete cascade,
  campus text not null,
  campus_distance_miles numeric(5,2),
  lease_model text not null default 'individual_by_bed'
    check (lease_model in ('individual_by_bed', 'joint_household', 'mixed')),
  occupancy_limit_per_unit int,
  guarantor_required boolean not null default true,
  sublease_policy text not null default 'conditional'
    check (sublease_policy in ('allowed', 'conditional', 'prohibited')),
  assignment_policy text not null default 'conditional'
    check (assignment_policy in ('allowed', 'conditional', 'prohibited')),
  replacement_policy text not null default 'conditional'
    check (replacement_policy in ('allowed', 'conditional', 'prohibited')),
  early_termination_policy text not null default 'conditional'
    check (early_termination_policy in ('allowed', 'conditional', 'prohibited')),
  requires_owner_approval boolean not null default false,
  approval_sla_hours int not null default 48,
  lease_change_fee numeric(12,2),
  required_documents text[] not null default '{}',
  accepted_payment_rails text[] not null default '{}',
  external_payment_recording boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.student_housing_configs to authenticated;
grant all on public.student_housing_configs to service_role;
alter table public.student_housing_configs enable row level security;

-- ------------------------------ academic_terms -------------------------
create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  label text not null,
  campus text,
  application_opens_on date,
  renewal_deadline date,
  move_out_on date,
  turn_starts_on date,
  move_in_on date,
  term_rent numeric(12,2),
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.academic_terms to authenticated;
grant all on public.academic_terms to service_role;
alter table public.academic_terms enable row level security;
create index if not exists academic_terms_property_idx on public.academic_terms(property_id);

-- --------------------------------- room_beds ---------------------------
create table if not exists public.room_beds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  room_label text not null,
  bed_label text not null,
  monthly_rent numeric(12,2) not null,
  status text not null default 'available'
    check (status in ('occupied','renewing','notice_given','available','held','applied','approved','leased','offline')),
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, room_label, bed_label)
);
grant select, insert, update, delete on public.room_beds to authenticated;
grant all on public.room_beds to service_role;
alter table public.room_beds enable row level security;
create index if not exists room_beds_unit_idx on public.room_beds(unit_id);

-- -------------------------------- occupancies --------------------------
create table if not exists public.occupancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  bed_id uuid references public.room_beds(id) on delete set null,
  term_id uuid references public.academic_terms(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  resident_user_id uuid references auth.users(id) on delete set null,
  resident_name text not null,
  resident_email text,
  lease_model text not null default 'individual_by_bed',
  share_pct numeric(5,2),
  start_date date not null,
  end_date date,
  stage text not null default 'current' check (stage in ('upcoming','current','former')),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.occupancies to authenticated;
grant all on public.occupancies to service_role;
alter table public.occupancies enable row level security;
create index if not exists occupancies_unit_idx on public.occupancies(unit_id);
create index if not exists occupancies_resident_idx on public.occupancies(resident_user_id);

-- ------------------------- roommate groups + members -------------------
create table if not exists public.roommate_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  term_id uuid references public.academic_terms(id) on delete set null,
  label text not null,
  stage text not null default 'invited',
  created_by_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.roommate_groups to authenticated;
grant all on public.roommate_groups to service_role;
alter table public.roommate_groups enable row level security;

create table if not exists public.roommate_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.roommate_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  state text not null default 'invited'
    check (state in ('invited','profile_incomplete','guarantor_incomplete','complete','approved','denied')),
  identity_verified boolean not null default false,
  passport_shared boolean not null default false,
  first_time_renter boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.roommate_group_members to authenticated;
grant all on public.roommate_group_members to service_role;
alter table public.roommate_group_members enable row level security;
create index if not exists roommate_group_members_group_idx on public.roommate_group_members(group_id);

-- --------------------------- guarantor_relationships -------------------
create table if not exists public.guarantor_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occupancy_id uuid references public.occupancies(id) on delete cascade,
  group_member_id uuid references public.roommate_group_members(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  role text not null default 'guarantor'
    check (role in ('guarantor','authorized_payer','contact_only')),
  identity_verified boolean not null default false,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  check (occupancy_id is not null or group_member_id is not null)
);
grant select, insert, update on public.guarantor_relationships to authenticated;
grant all on public.guarantor_relationships to service_role;
alter table public.guarantor_relationships enable row level security;

-- ------------------------- charges + allocations -----------------------
-- A charge is the obligation. Who *pays* it is a separate record, so a
-- parent or third party never becomes a lease party by paying.
create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  occupancy_id uuid references public.occupancies(id) on delete set null,
  term_id uuid references public.academic_terms(id) on delete set null,
  charge_type text not null
    check (charge_type in ('rent','deposit','application','utilities','parking','pet','damage','late_fee','lease_change_fee')),
  scope text not null default 'resident' check (scope in ('resident','roommate_group','unit','lease')),
  label text not null,
  amount numeric(12,2) not null,
  credits numeric(12,2) not null default 0,
  due_date date not null,
  late_fee_rule text,
  state text not null default 'open'
    check (state in ('open','partial','paid','waived','reversed','not_yet_due')),
  gated_on_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.charges to authenticated;
grant all on public.charges to service_role;
alter table public.charges enable row level security;
create index if not exists charges_unit_idx on public.charges(unit_id);
create index if not exists charges_occupancy_idx on public.charges(occupancy_id);

create table if not exists public.charge_allocations (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete cascade,
  occupancy_id uuid references public.occupancies(id) on delete cascade,
  label text not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.charge_allocations to authenticated;
grant all on public.charge_allocations to service_role;
alter table public.charge_allocations enable row level security;
create index if not exists charge_allocations_charge_idx on public.charge_allocations(charge_id);

-- --------------------------- payers + payments -------------------------
create table if not exists public.payers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  linked_occupancy_id uuid references public.occupancies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  kind text not null check (kind in ('resident','guarantor','third_party','institution')),
  email text,
  authorized boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.payers to authenticated;
grant all on public.payers to service_role;
alter table public.payers enable row level security;

create table if not exists public.student_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payer_id uuid not null references public.payers(id) on delete restrict,
  amount numeric(12,2) not null,
  method text not null
    check (method in ('rentid_ach','card','check','cash','money_order','bank_billpay','other_external')),
  -- Recorded external payments are never presented as processed by RentID.
  processed_by_rentid boolean not null default false,
  reference text,
  proof_label text,
  state text not null
    check (state in ('initiated','pending','settled','returned','recorded','proof_attached','reconciled','rejected')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
grant select, insert, update on public.student_payments to authenticated;
grant all on public.student_payments to service_role;
alter table public.student_payments enable row level security;

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.student_payments(id) on delete cascade,
  charge_id uuid not null references public.charges(id) on delete cascade,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
grant select, insert on public.payment_allocations to authenticated;
grant all on public.payment_allocations to service_role;
alter table public.payment_allocations enable row level security;

-- --------------------------------- ledger ------------------------------
-- Append-only: no update/delete grant, ever.
create table if not exists public.ledger_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  charge_id uuid references public.charges(id) on delete set null,
  payment_id uuid references public.student_payments(id) on delete set null,
  occupancy_id uuid references public.occupancies(id) on delete set null,
  kind text not null
    check (kind in ('charge_created','payment_recorded','payment_allocated','credit_applied','charge_waived','charge_reversed','reminder_sent')),
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.ledger_events to authenticated;
grant all on public.ledger_events to service_role;
alter table public.ledger_events enable row level security;
create index if not exists ledger_events_charge_idx on public.ledger_events(charge_id);

-- ------------------- approval-first lease changes ----------------------
create table if not exists public.lease_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  occupancy_id uuid not null references public.occupancies(id) on delete cascade,
  bed_id uuid references public.room_beds(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  request_type text not null
    check (request_type in ('sublease','assignment','replacement_resident','add_occupant','remove_occupant','bed_transfer','room_transfer','renewal','early_termination','guarantor_change','payment_plan','addendum')),
  state text not null default 'submitted'
    check (state in ('draft','submitted','under_review','owner_review','approved','denied','documents_pending','signatures_pending','payment_pending','scheduled','effective','completed','withdrawn','expired','cancelled')),
  policy_mode text not null default 'conditional'
    check (policy_mode in ('allowed','conditional','prohibited')),
  reason text not null,
  requested_start date,
  requested_end date,
  candidate_name text,
  candidate_email text,
  -- A replacement listing must never go public on submission alone.
  replacement_listing_enabled boolean not null default false,
  requires_owner_approval boolean not null default false,
  fee_amount numeric(12,2),
  documents_complete boolean not null default false,
  signatures_complete boolean not null default false,
  payment_complete boolean not null default false,
  effective_date date,
  sla_hours int not null default 48,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.lease_change_requests to authenticated;
grant all on public.lease_change_requests to service_role;
alter table public.lease_change_requests enable row level security;
create index if not exists lease_change_requests_state_idx on public.lease_change_requests(state);

alter table public.charges
  add constraint charges_gated_request_fk
  foreign key (gated_on_request_id) references public.lease_change_requests(id) on delete set null;

-- Approval steps are an immutable trail: insert + select only.
create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.lease_change_requests(id) on delete cascade,
  role text not null check (role in ('pm','owner','resident','guarantor')),
  label text not null,
  state text not null default 'pending' check (state in ('pending','approved','denied','skipped')),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.approval_steps to authenticated;
grant all on public.approval_steps to service_role;
alter table public.approval_steps enable row level security;

-- --------------------------------- turnover ----------------------------
create table if not exists public.turn_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  bed_id uuid references public.room_beds(id) on delete set null,
  term_id uuid references public.academic_terms(id) on delete set null,
  area text not null check (area in ('bed','room','unit','shared')),
  label text not null,
  category text not null
    check (category in ('inspection','cleaning','repair','paint','flooring','keys','documents','money')),
  vendor text,
  due_date date not null,
  state text not null default 'not_started'
    check (state in ('not_started','in_progress','blocked','complete')),
  outgoing_occupancy_id uuid references public.occupancies(id) on delete set null,
  incoming_occupancy_id uuid references public.occupancies(id) on delete set null,
  blocker_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.turn_tasks to authenticated;
grant all on public.turn_tasks to service_role;
alter table public.turn_tasks enable row level security;

-- --------------------- student maintenance + damage --------------------
create table if not exists public.student_maintenance_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  bed_id uuid references public.room_beds(id) on delete set null,
  requester_occupancy_id uuid references public.occupancies(id) on delete set null,
  requester_name text not null,
  area text not null check (area in ('private_room','shared_area','unit','unknown')),
  area_label text not null,
  issue text not null,
  category text,
  priority text not null default 'normal' check (priority in ('low','normal','high','emergency')),
  status text not null default 'open'
    check (status in ('open','in_progress','resolved','disputed','closed')),
  assignment text,
  entry_permission boolean not null default false,
  evidence text[] not null default '{}',
  first_response_at timestamptz,
  resolved_at timestamptz,
  damage_allocation text not null default 'unassigned'
    check (damage_allocation in ('unassigned','single_resident','multiple_residents','household','owner')),
  damage_amount numeric(12,2),
  lease_basis text,
  tenant_response text,
  -- Only evidence-backed, resolved events may feed verified history.
  affects_verified_history boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.student_maintenance_cases to authenticated;
grant all on public.student_maintenance_cases to service_role;
alter table public.student_maintenance_cases enable row level security;

create trigger student_housing_configs_touch before update on public.student_housing_configs
  for each row execute function public.touch_updated_at();
create trigger room_beds_touch before update on public.room_beds
  for each row execute function public.touch_updated_at();
create trigger occupancies_touch before update on public.occupancies
  for each row execute function public.touch_updated_at();
create trigger charges_touch before update on public.charges
  for each row execute function public.touch_updated_at();
create trigger lease_change_requests_touch before update on public.lease_change_requests
  for each row execute function public.touch_updated_at();
create trigger turn_tasks_touch before update on public.turn_tasks
  for each row execute function public.touch_updated_at();
create trigger student_maintenance_cases_touch before update on public.student_maintenance_cases
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Listing syndication (review only, not applied)
-- One listing inside RentID is the source of truth; each supported
-- marketplace gets a channel row describing its distribution state.
-- ============================================================

alter table public.listings
  add column if not exists public_ref text unique,
  add column if not exists property_type text,
  add column if not exists street_address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text,
  add column if not exists bedrooms numeric(4,1),
  add column if not exists bathrooms numeric(4,1),
  add column if not exists square_feet integer,
  add column if not exists photos text[] not null default '{}',
  add column if not exists utilities_included text[] not null default '{}',
  add column if not exists pet_policy text,
  add column if not exists parking text,
  add column if not exists application_requirements text[] not null default '{}',
  add column if not exists income_requirement text,
  add column if not exists credit_requirement text,
  add column if not exists occupancy_limit integer,
  add column if not exists application_fee numeric(10,2),
  add column if not exists move_in_fees text,
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists showing_instructions text,
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists view_count integer not null default 0;

create index if not exists listings_public_ref_idx on public.listings (public_ref);

create table if not exists public.listing_channels (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (channel in ('rentid','zillow','apartments_com','other')),
  -- 'integration_pending' means RentID has no authorized API/feed yet:
  -- nothing is ever posted to that marketplace from this row.
  connection_status text not null default 'integration_pending'
    check (connection_status in ('connected','integration_pending','disconnected','error')),
  listing_status text not null default 'not_published'
    check (listing_status in ('not_published','queued','live','paused','removed','error')),
  enabled boolean not null default false,
  external_listing_id text,
  external_url text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, channel)
);
grant select, insert, update, delete on public.listing_channels to authenticated;
grant select on public.listing_channels to anon;
grant all on public.listing_channels to service_role;
alter table public.listing_channels enable row level security;

create table if not exists public.listing_sync_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  channel text not null,
  action text not null check (action in ('create','update','pause','resume','remove','resync')),
  result text not null check (result in ('success','pending_integration','failed','skipped')),
  message text,
  created_at timestamptz not null default now()
);
grant select, insert on public.listing_sync_events to authenticated;
grant all on public.listing_sync_events to service_role;
alter table public.listing_sync_events enable row level security;

create table if not exists public.listing_leads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source text not null default 'direct_link',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  email text,
  phone text,
  converted_application_id uuid references public.rental_applications(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.listing_leads to authenticated;
grant all on public.listing_leads to service_role;
alter table public.listing_leads enable row level security;
create index if not exists listing_leads_listing_idx on public.listing_leads (listing_id, created_at desc);

alter table public.rental_applications
  add column if not exists source text not null default 'rentid',
  add column if not exists utm_source text,
  add column if not exists utm_campaign text,
  add column if not exists referrer text,
  add column if not exists prefilled_from_resume boolean not null default false,
  add column if not exists employer text,
  add column if not exists current_address text,
  add column if not exists references_text text;

create index if not exists listing_channels_listing_idx on public.listing_channels (listing_id);
create index if not exists listing_sync_events_listing_idx on public.listing_sync_events (listing_id, created_at desc);

create trigger listing_channels_touch before update on public.listing_channels
  for each row execute function public.touch_updated_at();
