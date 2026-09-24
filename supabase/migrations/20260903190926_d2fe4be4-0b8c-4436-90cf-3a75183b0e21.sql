-- ============ ENUMS ============
create type public.app_role as enum ('landlord','tenant','property_manager','admin');
create type public.property_type as enum ('single_family','multi_family','condo','townhouse','apartment','other');
create type public.occupancy_status as enum ('occupied','vacant','upcoming_vacancy');
create type public.tenancy_status as enum ('pending','active','ended','cancelled');
create type public.invitation_status as enum ('pending','accepted','expired','revoked');
create type public.payment_status as enum ('scheduled','pending','paid','late','failed','refunded','returned');
create type public.maintenance_status as enum ('open','in_progress','resolved','closed');
create type public.maintenance_priority as enum ('low','normal','high','urgent');
create type public.document_kind as enum ('lease','move_in_inspection','move_out_inspection','notice','receipt','photo','maintenance','other');
create type public.review_subject as enum ('tenant','landlord');

-- ============ UTIL ============
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  onboarding_completed boolean not null default false,
  portfolio_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select, insert on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;

create policy user_roles_select_own on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy user_roles_insert_self on public.user_roles for insert to authenticated
  with check (user_id = auth.uid() and role in ('landlord','tenant','property_manager'));

-- new user bootstrap
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email, new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ ORGANIZATIONS (ownership entities) ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_entity_name text,
  owner_id uuid references auth.users on delete set null,
  is_demo boolean not null default false,
  stripe_connect_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.organizations to authenticated;
grant all on public.organizations to service_role;
alter table public.organizations enable row level security;
create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.app_role not null default 'landlord',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);
grant select, insert, delete on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organization_members m
                 where m.organization_id = _org_id and m.user_id = auth.uid())
      or exists (select 1 from public.organizations o
                 where o.id = _org_id and o.owner_id = auth.uid());
$$;

create or replace function public.is_demo_org(_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o where o.id = _org_id and o.is_demo);
$$;

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or is_demo or public.has_role(auth.uid(),'admin'));
create policy organizations_insert on public.organizations for insert to authenticated
  with check (owner_id = auth.uid() and not is_demo);
create policy organizations_update on public.organizations for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy org_members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(organization_id));
create policy org_members_insert on public.organization_members for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy org_members_delete on public.organization_members for delete to authenticated
  using (public.is_org_member(organization_id));

-- ============ PROPERTIES / UNITS ============
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null,
  street_address text not null,
  city text not null,
  state text not null,
  zip text not null,
  property_type public.property_type not null default 'single_family',
  unit_count integer not null default 1,
  photo_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_org_idx on public.properties(organization_id);
grant select, insert, update, delete on public.properties to authenticated;
grant all on public.properties to service_role;
alter table public.properties enable row level security;
create trigger properties_touch before update on public.properties for each row execute function public.touch_updated_at();

create or replace function public.can_manage_property(_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.properties p
                 where p.id = _property_id and public.is_org_member(p.organization_id));
$$;

create table public.units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties on delete cascade,
  name text not null,
  bedrooms numeric(3,1),
  bathrooms numeric(3,1),
  square_feet integer,
  monthly_rent numeric(12,2),
  security_deposit numeric(12,2),
  rent_due_day integer default 1,
  occupancy_status public.occupancy_status not null default 'vacant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index units_property_idx on public.units(property_id);
grant select, insert, update, delete on public.units to authenticated;
grant all on public.units to service_role;
alter table public.units enable row level security;
create trigger units_touch before update on public.units for each row execute function public.touch_updated_at();

create or replace function public.can_manage_unit(_unit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.units u where u.id = _unit_id and public.can_manage_property(u.property_id));
$$;

-- ============ TENANCIES ============
create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  property_id uuid not null references public.properties on delete cascade,
  unit_id uuid not null references public.units on delete cascade,
  tenant_user_id uuid references auth.users on delete set null,
  tenant_name text,
  tenant_email text,
  tenant_phone text,
  status public.tenancy_status not null default 'pending',
  monthly_rent numeric(12,2),
  start_date date,
  end_date date,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenancies_org_idx on public.tenancies(organization_id);
create index tenancies_tenant_idx on public.tenancies(tenant_user_id);
create index tenancies_unit_idx on public.tenancies(unit_id);
grant select, insert, update, delete on public.tenancies to authenticated;
grant all on public.tenancies to service_role;
alter table public.tenancies enable row level security;
create trigger tenancies_touch before update on public.tenancies for each row execute function public.touch_updated_at();

create or replace function public.is_tenancy_party(_tenancy_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenancies t
    where t.id = _tenancy_id
      and (t.tenant_user_id = auth.uid() or public.is_org_member(t.organization_id) or public.is_demo_org(t.organization_id)));
$$;

create or replace function public.is_tenant_of_unit(_unit_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenancies t where t.unit_id = _unit_id and t.tenant_user_id = auth.uid());
$$;

create policy properties_select on public.properties for select to authenticated
  using (public.is_org_member(organization_id) or public.is_demo_org(organization_id)
         or exists (select 1 from public.tenancies t where t.property_id = properties.id and t.tenant_user_id = auth.uid()));
create policy properties_write on public.properties for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy properties_update on public.properties for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy properties_delete on public.properties for delete to authenticated
  using (public.is_org_member(organization_id));

create policy units_select on public.units for select to authenticated
  using (public.can_manage_property(property_id) or public.is_tenant_of_unit(id)
         or exists (select 1 from public.properties p where p.id = units.property_id and public.is_demo_org(p.organization_id)));
create policy units_insert on public.units for insert to authenticated
  with check (public.can_manage_property(property_id));
create policy units_update on public.units for update to authenticated
  using (public.can_manage_property(property_id)) with check (public.can_manage_property(property_id));
create policy units_delete on public.units for delete to authenticated
  using (public.can_manage_property(property_id));

create policy tenancies_select on public.tenancies for select to authenticated
  using (tenant_user_id = auth.uid() or public.is_org_member(organization_id) or public.is_demo_org(organization_id));
create policy tenancies_insert on public.tenancies for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy tenancies_update on public.tenancies for update to authenticated
  using (public.is_org_member(organization_id) or tenant_user_id = auth.uid())
  with check (public.is_org_member(organization_id) or tenant_user_id = auth.uid());
create policy tenancies_delete on public.tenancies for delete to authenticated
  using (public.is_org_member(organization_id));

-- ============ INVITATIONS ============
create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  property_id uuid references public.properties on delete cascade,
  unit_id uuid references public.units on delete cascade,
  tenancy_id uuid references public.tenancies on delete set null,
  invited_by uuid references auth.users on delete set null,
  full_name text,
  email text,
  phone text,
  token text not null unique default encode(gen_random_bytes(16),'hex'),
  status public.invitation_status not null default 'pending',
  monthly_rent numeric(12,2),
  lease_start date,
  lease_end date,
  accepted_by uuid references auth.users on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_invitations_email_idx on public.tenant_invitations(lower(email));
grant select, insert, update, delete on public.tenant_invitations to authenticated;
grant all on public.tenant_invitations to service_role;
alter table public.tenant_invitations enable row level security;
create trigger tenant_invitations_touch before update on public.tenant_invitations for each row execute function public.touch_updated_at();
create policy invitations_select on public.tenant_invitations for select to authenticated
  using (public.is_org_member(organization_id) or lower(email) = lower(coalesce(auth.jwt()->>'email','')) or accepted_by = auth.uid());
create policy invitations_insert on public.tenant_invitations for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy invitations_update on public.tenant_invitations for update to authenticated
  using (public.is_org_member(organization_id) or lower(email) = lower(coalesce(auth.jwt()->>'email','')))
  with check (public.is_org_member(organization_id) or lower(email) = lower(coalesce(auth.jwt()->>'email','')));
create policy invitations_delete on public.tenant_invitations for delete to authenticated
  using (public.is_org_member(organization_id));

-- ============ LEASES ============
create table public.leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid not null references public.tenancies on delete cascade,
  unit_id uuid not null references public.units on delete cascade,
  start_date date,
  end_date date,
  monthly_rent numeric(12,2),
  security_deposit numeric(12,2),
  rent_due_day integer default 1,
  late_fee_terms text,
  document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leases_tenancy_idx on public.leases(tenancy_id);
grant select, insert, update, delete on public.leases to authenticated;
grant all on public.leases to service_role;
alter table public.leases enable row level security;
create trigger leases_touch before update on public.leases for each row execute function public.touch_updated_at();
create policy leases_select on public.leases for select to authenticated using (public.is_tenancy_party(tenancy_id));
create policy leases_insert on public.leases for insert to authenticated with check (public.is_org_member(organization_id));
create policy leases_update on public.leases for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy leases_delete on public.leases for delete to authenticated using (public.is_org_member(organization_id));

-- ============ DOCUMENTS ============
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid references public.tenancies on delete cascade,
  property_id uuid references public.properties on delete cascade,
  unit_id uuid references public.units on delete cascade,
  lease_id uuid references public.leases on delete cascade,
  kind public.document_kind not null default 'other',
  title text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  visible_to_tenant boolean not null default true,
  uploaded_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_org_idx on public.documents(organization_id);
create index documents_tenancy_idx on public.documents(tenancy_id);
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
alter table public.documents enable row level security;
create trigger documents_touch before update on public.documents for each row execute function public.touch_updated_at();
create policy documents_select on public.documents for select to authenticated
  using (public.is_org_member(organization_id)
         or (visible_to_tenant and tenancy_id is not null and public.is_tenancy_party(tenancy_id)));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_org_member(organization_id) or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));
create policy documents_update on public.documents for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_org_member(organization_id));

-- ============ PAYMENTS ============
create table public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid not null references public.tenancies on delete cascade,
  amount numeric(12,2) not null,
  due_day integer not null default 1,
  autopay_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.payment_schedules to authenticated;
grant all on public.payment_schedules to service_role;
alter table public.payment_schedules enable row level security;
create trigger payment_schedules_touch before update on public.payment_schedules for each row execute function public.touch_updated_at();
create policy payment_schedules_select on public.payment_schedules for select to authenticated using (public.is_tenancy_party(tenancy_id));
create policy payment_schedules_write on public.payment_schedules for insert to authenticated with check (public.is_org_member(organization_id));
create policy payment_schedules_update on public.payment_schedules for update to authenticated
  using (public.is_tenancy_party(tenancy_id)) with check (public.is_tenancy_party(tenancy_id));

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid not null references public.tenancies on delete cascade,
  unit_id uuid references public.units on delete set null,
  amount numeric(12,2) not null,
  platform_fee_amount numeric(12,2),
  currency text not null default 'usd',
  status public.payment_status not null default 'scheduled',
  method text,
  due_date date,
  paid_at timestamptz,
  days_late integer,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_org_idx on public.payments(organization_id);
create index payments_tenancy_idx on public.payments(tenancy_id);
create index payments_due_idx on public.payments(due_date);
grant select, insert, update, delete on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();
create policy payments_select on public.payments for select to authenticated using (public.is_tenancy_party(tenancy_id));
create policy payments_insert on public.payments for insert to authenticated with check (public.is_org_member(organization_id));
create policy payments_update on public.payments for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ============ MAINTENANCE ============
create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid references public.tenancies on delete cascade,
  property_id uuid references public.properties on delete cascade,
  unit_id uuid references public.units on delete cascade,
  created_by uuid references auth.users on delete set null,
  title text not null,
  description text,
  priority public.maintenance_priority not null default 'normal',
  status public.maintenance_status not null default 'open',
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maintenance_org_idx on public.maintenance_requests(organization_id);
grant select, insert, update, delete on public.maintenance_requests to authenticated;
grant all on public.maintenance_requests to service_role;
alter table public.maintenance_requests enable row level security;
create trigger maintenance_touch before update on public.maintenance_requests for each row execute function public.touch_updated_at();
create policy maintenance_select on public.maintenance_requests for select to authenticated
  using (public.is_org_member(organization_id) or public.is_demo_org(organization_id)
         or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));
create policy maintenance_insert on public.maintenance_requests for insert to authenticated
  with check (public.is_org_member(organization_id) or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));
create policy maintenance_update on public.maintenance_requests for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- ============ MESSAGING ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  tenancy_id uuid references public.tenancies on delete cascade,
  subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_org_member(organization_id) or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));
create policy conversations_insert on public.conversations for insert to authenticated
  with check (public.is_org_member(organization_id) or (tenancy_id is not null and public.is_tenancy_party(tenancy_id)));

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations on delete cascade,
  sender_id uuid references auth.users on delete set null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);
grant select, insert, update on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;

create or replace function public.can_access_conversation(_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c
    where c.id = _conversation_id
      and (public.is_org_member(c.organization_id) or (c.tenancy_id is not null and public.is_tenancy_party(c.tenancy_id))));
$$;
create policy messages_select on public.messages for select to authenticated using (public.can_access_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_access_conversation(conversation_id));

-- ============ REVIEWS (verified tenancy only) ============
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies on delete cascade,
  author_id uuid not null references auth.users on delete cascade,
  subject_type public.review_subject not null,
  subject_user_id uuid references auth.users on delete set null,
  rating integer not null check (rating between 1 and 5),
  body text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenancy_id, author_id, subject_type)
);
grant select, insert, update on public.reviews to authenticated;
grant all on public.reviews to service_role;
alter table public.reviews enable row level security;
create trigger reviews_touch before update on public.reviews for each row execute function public.touch_updated_at();

create or replace function public.is_verified_tenancy(_tenancy_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenancies t where t.id = _tenancy_id and t.verified);
$$;
create policy reviews_select on public.reviews for select to authenticated
  using (published or author_id = auth.uid() or subject_user_id = auth.uid());
create policy reviews_insert on public.reviews for insert to authenticated
  with check (author_id = auth.uid() and public.is_tenancy_party(tenancy_id) and public.is_verified_tenancy(tenancy_id));
create policy reviews_update on public.reviews for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create table public.review_disputes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews on delete cascade,
  raised_by uuid not null references auth.users on delete cascade,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert on public.review_disputes to authenticated;
grant all on public.review_disputes to service_role;
alter table public.review_disputes enable row level security;
create policy review_disputes_select on public.review_disputes for select to authenticated
  using (raised_by = auth.uid() or public.has_role(auth.uid(),'admin'));
create policy review_disputes_insert on public.review_disputes for insert to authenticated
  with check (raised_by = auth.uid());

-- ============ VERIFICATION RECORDS (objective signals) ============
create table public.verification_records (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies on delete cascade,
  subject_user_id uuid references auth.users on delete set null,
  record_type text not null,
  label text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index verification_records_tenancy_idx on public.verification_records(tenancy_id);
grant select, insert on public.verification_records to authenticated;
grant all on public.verification_records to service_role;
alter table public.verification_records enable row level security;
create policy verification_records_select on public.verification_records for select to authenticated
  using (public.is_tenancy_party(tenancy_id) or subject_user_id = auth.uid());
create policy verification_records_insert on public.verification_records for insert to authenticated
  with check (public.is_tenancy_party(tenancy_id));

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  organization_id uuid references public.organizations on delete cascade,
  title text not null,
  body text,
  severity text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
grant select, insert, update on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert to authenticated with check (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ AUDIT LOGS ============
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users on delete set null,
  organization_id uuid references public.organizations on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_role(auth.uid(),'admin') or (organization_id is not null and public.is_org_member(organization_id)));
create policy audit_logs_insert on public.audit_logs for insert to authenticated with check (actor_id = auth.uid());

-- ============ PLATFORM SETTINGS ============
create table public.platform_settings (
  id boolean primary key default true check (id),
  platform_fee_percentage numeric(6,4) not null default 0.5000,
  platform_fee_cap numeric(12,2),
  fee_allocation text not null default 'tenant',
  updated_at timestamptz not null default now()
);
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;
alter table public.platform_settings enable row level security;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);
create policy platform_settings_update on public.platform_settings for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
insert into public.platform_settings (id) values (true);