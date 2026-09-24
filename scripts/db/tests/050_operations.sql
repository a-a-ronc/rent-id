-- Operations + finance service guarantees (src/lib/services/operations.ts,
-- finance.ts, src/lib/storage.ts): documents + storage objects, leases,
-- maintenance, messaging, notifications, payments recording, audit logs.
-- Transactional, rolls back.
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000b1', 'll@ops.rentid',       '{"full_name":"Ops Landlord","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000b2', 'tn@ops.rentid',       '{"full_name":"Ops Tenant","role":"tenant"}'),
  ('00000000-0000-4000-8000-0000000000b3', 'other@ops.rentid',    '{"full_name":"Other Landlord","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000b4', 'stranger@ops.rentid', '{"full_name":"Stranger","role":"tenant"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
select public.create_organization('Ops Org', 'landlord') as org_l \gset
select set_config('test.org_l', :'org_l', true) as _ \gset

insert into public.properties (id, organization_id, name, street_address, city, state, zip)
  values ('10000000-0000-4000-8000-0000000000b1', :'org_l', 'Ops House', '2 Main', 'SLC', 'UT', '84101');
insert into public.units (id, property_id, name, monthly_rent)
  values ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'A', 1200);
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, status, monthly_rent)
  values ('50000000-0000-4000-8000-0000000000b1', :'org_l', '10000000-0000-4000-8000-0000000000b1',
          '20000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Ops Tenant', 'active', 1200);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated","email":"other@ops.rentid"}';
select public.create_organization('Other Org', 'landlord') as org_x \gset
select set_config('test.org_x', :'org_x', true) as _ \gset

-- ------------------------------------------- documents + storage objects
-- Object paths are <organization_id>/<uuid>-<file>; storage RLS keys off the first segment.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
insert into storage.objects (bucket_id, name) values
  ('documents', :'org_l' || '/aaaaaaaa-0000-4000-8000-000000000001-lease.pdf'),
  ('documents', :'org_l' || '/aaaaaaaa-0000-4000-8000-000000000002-inspection.pdf');
insert into public.documents (id, organization_id, tenancy_id, property_id, unit_id, kind, title, storage_path, mime_type, size_bytes, visible_to_tenant, uploaded_by) values
  ('70000000-0000-4000-8000-0000000000b1', :'org_l', '50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
   'lease', 'Lease 2026', :'org_l' || '/aaaaaaaa-0000-4000-8000-000000000001-lease.pdf', 'application/pdf', 1024, true, '00000000-0000-4000-8000-0000000000b1'),
  ('70000000-0000-4000-8000-0000000000b2', :'org_l', '50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
   'inspection', 'Private inspection', :'org_l' || '/aaaaaaaa-0000-4000-8000-000000000002-inspection.pdf', 'application/pdf', 2048, false, '00000000-0000-4000-8000-0000000000b1'),
  ('70000000-0000-4000-8000-0000000000b3', :'org_l', null, null, null,
   'other', 'Metadata only', 'pending-upload/aaaaaaaa-0000-4000-8000-000000000003', null, null, true, '00000000-0000-4000-8000-0000000000b1');

do $$ begin
  assert (select count(*) from storage.objects where bucket_id = 'documents') = 2, 'landlord sees own organization objects';
  begin
    insert into storage.objects (bucket_id, name)
      values ('documents', current_setting('test.org_x') || '/aaaaaaaa-0000-4000-8000-000000000009-sneaky.pdf');
    raise exception 'ASSERT FAILED: landlord uploaded into another organization folder';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('documents', 'no-folder.pdf');
    raise exception 'ASSERT FAILED: object stored outside an organization folder';
  exception when insufficient_privilege or invalid_text_representation then null;
  end;
end $$;

-- tenant: only tenant-visible document rows and their objects
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.documents) = 1, 'tenant sees only visible_to_tenant documents on own tenancy';
  assert (select title from public.documents) = 'Lease 2026', 'the visible document is the lease';
  assert (select count(*) from storage.objects) = 1, 'tenant reads only the object behind a visible document';
  assert (select name from storage.objects) like current_setting('test.org_l') || '/%lease.pdf', 'tenant-readable object is the lease file';
  begin
    insert into storage.objects (bucket_id, name)
      values ('documents', current_setting('test.org_l') || '/aaaaaaaa-0000-4000-8000-000000000008-tenant.pdf');
    raise exception 'ASSERT FAILED: tenant uploaded into the landlord organization folder';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where name like '%lease.pdf';   -- RLS filters the row: nothing deleted
  assert (select count(*) from storage.objects) = 1, 'tenant cannot delete a landlord object';
end $$;
update public.documents set visible_to_tenant = true where id = '70000000-0000-4000-8000-0000000000b2';  -- tenant cannot flip visibility
do $$ begin
  assert (select count(*) from public.documents) = 1, 'tenant update on documents affects no rows';
end $$;

-- other landlord: nothing
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated","email":"other@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.documents) = 0, 'other organization sees no documents';
  assert (select count(*) from storage.objects) = 0, 'other organization sees no objects';
end $$;

-- landlord archives (soft delete) and removes the object
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
update public.documents set deleted_at = now() where id = '70000000-0000-4000-8000-0000000000b2';
delete from storage.objects where name like '%inspection.pdf';
do $$ begin
  assert (select deleted_at from public.documents where id = '70000000-0000-4000-8000-0000000000b2') is not null, 'landlord archived the document';
  assert (select count(*) from storage.objects) = 1, 'landlord deleted the object';
end $$;

-- ------------------------------------------------------------------ leases
-- Both foreign keys the lease read model relies on exist (the embed is
-- disambiguated with documents!leases_document_id_fkey).
do $$ begin
  assert exists (select 1 from pg_constraint where conname = 'leases_document_id_fkey'), 'leases.document_id fk';
  assert exists (select 1 from pg_constraint where conname = 'documents_lease_id_fkey'), 'documents.lease_id fk';
end $$;

insert into public.leases (id, organization_id, tenancy_id, unit_id, status, start_date, end_date, monthly_rent, rent_due_day, document_id, signed_at)
  values ('80000000-0000-4000-8000-0000000000b1', :'org_l', '50000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
          'active', '2025-09-01', '2026-08-31', 1150, 1, null, now());
-- uploadLease(): supersede live leases, insert the new one, back-link the document, align the tenancy
update public.leases set status = 'ended'
 where tenancy_id = '50000000-0000-4000-8000-0000000000b1' and deleted_at is null and status in ('draft', 'active', 'expiring');
insert into public.leases (id, organization_id, tenancy_id, unit_id, status, start_date, end_date, monthly_rent, rent_due_day, document_id, document_path, signed_at)
  values ('80000000-0000-4000-8000-0000000000b2', :'org_l', '50000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
          'active', '2026-09-01', '2027-08-31', 1200, 1, '70000000-0000-4000-8000-0000000000b1',
          :'org_l' || '/aaaaaaaa-0000-4000-8000-000000000001-lease.pdf', now());
update public.documents set lease_id = '80000000-0000-4000-8000-0000000000b2' where id = '70000000-0000-4000-8000-0000000000b1';
update public.tenancies set start_date = '2026-09-01', end_date = '2027-08-31', monthly_rent = 1200 where id = '50000000-0000-4000-8000-0000000000b1';
do $$ begin
  assert (select status from public.leases where id = '80000000-0000-4000-8000-0000000000b1') = 'ended', 'previous lease superseded';
  assert (select count(*) from public.leases where tenancy_id = '50000000-0000-4000-8000-0000000000b1' and status = 'active') = 1, 'exactly one active lease';
  assert (select lease_id from public.documents where id = '70000000-0000-4000-8000-0000000000b1') = '80000000-0000-4000-8000-0000000000b2', 'document back-linked to the lease';
  assert (select end_date from public.tenancies where id = '50000000-0000-4000-8000-0000000000b1') = '2027-08-31', 'tenancy term follows the lease';
  -- expiring-within-60-days window used by getDashboardMetrics
  assert (select count(*) from public.leases where organization_id = current_setting('test.org_l')::uuid and deleted_at is null
            and status not in ('ended', 'terminated') and end_date between current_date and current_date + 60) = 0,
    'no lease expiring in the next 60 days';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
update public.leases set monthly_rent = 1 where tenancy_id = '50000000-0000-4000-8000-0000000000b1';
do $$ begin
  assert (select count(*) from public.leases) = 2, 'tenant sees the leases on own tenancy';
  assert (select count(*) from public.leases where monthly_rent = 1) = 0, 'tenant cannot edit leases';
end $$;

-- ------------------------------------------------------------- maintenance
-- tenant raises a request on own tenancy; landlord-only requests are refused
insert into public.maintenance_requests (id, organization_id, tenancy_id, property_id, unit_id, created_by, title, priority, status)
  values ('90000000-0000-4000-8000-0000000000b1', :'org_l', '50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1',
          '20000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2', 'Sink leaks', 'high', 'open');
do $$ begin
  begin
    insert into public.maintenance_requests (organization_id, tenancy_id, property_id, unit_id, created_by, title)
      values (current_setting('test.org_l')::uuid, null, '10000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
              '00000000-0000-4000-8000-0000000000b2', 'No tenancy');
    raise exception 'ASSERT FAILED: tenant logged a request outside a tenancy';
  exception when insufficient_privilege then null;
  end;
  -- the tenant can read the workspace owner (organizations_select_tenant) to address the notification
  assert (select owner_id from public.organizations where id = current_setting('test.org_l')::uuid) = '00000000-0000-4000-8000-0000000000b1',
    'tenant can resolve the workspace owner';
end $$;
update public.maintenance_requests set status = 'completed' where id = '90000000-0000-4000-8000-0000000000b1';
do $$ begin
  assert (select status from public.maintenance_requests where id = '90000000-0000-4000-8000-0000000000b1') = 'open', 'tenant cannot change request status';
end $$;
-- tenant → landlord notification (createMaintenanceRequest)
select public.notify_user('00000000-0000-4000-8000-0000000000b1', :'org_l', 'maintenance', 'Ops Tenant reported "Sink leaks"', 'Priority: high.') as n_ll \gset

-- landlord works the request and notifies the tenant on every status change
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.notifications where user_id = '00000000-0000-4000-8000-0000000000b1' and kind = 'maintenance') = 1,
    'landlord received the tenant request notification';
  assert (select count(*) from public.notifications) = 1, 'landlord sees only own notifications';
end $$;
update public.maintenance_requests
   set status = 'acknowledged', first_response_at = coalesce(first_response_at, now())
 where id = '90000000-0000-4000-8000-0000000000b1';
update public.maintenance_requests
   set status = 'completed', resolved_at = coalesce(resolved_at, now())
 where id = '90000000-0000-4000-8000-0000000000b1';
select public.notify_user('00000000-0000-4000-8000-0000000000b2', :'org_l', 'maintenance', '"Sink leaks" is now completed', 'Your landlord marked this request as done.') as n_tn \gset
do $$ declare m public.maintenance_requests%rowtype; begin
  select * into m from public.maintenance_requests where id = '90000000-0000-4000-8000-0000000000b1';
  assert m.status = 'completed' and m.first_response_at is not null and m.resolved_at is not null, 'first_response_at + resolved_at stamped';
  assert (select count(*) from public.maintenance_requests where organization_id = current_setting('test.org_l')::uuid
            and status in ('open', 'acknowledged', 'in_progress')) = 0, 'no open work left (dashboard metric)';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
update public.notifications set read_at = now() where id = :'n_tn';
update public.notifications set read_at = now() where id = :'n_ll';   -- not mine: no rows
do $$ begin
  assert (select count(*) from public.notifications) = 1, 'tenant sees only own notifications';
  assert (select count(*) from public.notifications where read_at is not null) = 1, 'tenant marked own notification read';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
do $$ begin
  assert (select read_at from public.notifications where user_id = '00000000-0000-4000-8000-0000000000b1') is null,
    'tenant could not mark the landlord notification read';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated","email":"other@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.maintenance_requests) = 0, 'other organization sees no maintenance requests';
end $$;

-- --------------------------------------------------------------- messaging
-- tenant starts the thread; sender_id must be the caller
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
insert into public.conversations (id, organization_id, tenancy_id, subject, last_message_at)
  values ('a0000000-0000-4000-8000-0000000000b1', :'org_l', '50000000-0000-4000-8000-0000000000b1', 'Ops House — A', now() - interval '1 day');
insert into public.messages (id, conversation_id, sender_id, sender_name, sender_role, body, created_at)
  values ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2',
          'Ops Tenant', 'tenant', 'Hi, when is the inspection?', now() + interval '1 minute');
do $$ begin
  begin
    insert into public.messages (conversation_id, sender_id, sender_name, sender_role, body)
      values ('a0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1', 'Ops Landlord', 'landlord', 'spoofed');
    raise exception 'ASSERT FAILED: message inserted with a foreign sender_id';
  exception when insufficient_privilege then null;
  end;
  assert (select last_message_at from public.conversations where id = 'a0000000-0000-4000-8000-0000000000b1')
         = (select created_at from public.messages where id = 'b0000000-0000-4000-8000-0000000000b1'),
    'last_message_at bumped by trigger';
end $$;
-- tenant → landlord message notification (sendMessage)
select public.notify_user('00000000-0000-4000-8000-0000000000b1', :'org_l', 'message', 'New message from Ops Tenant', 'Hi, when is the inspection?');

-- landlord reads, replies and marks the tenant's messages read
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
insert into public.messages (id, conversation_id, sender_id, sender_name, sender_role, body)
  values ('b0000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1',
          'Ops Landlord', 'landlord', 'Thursday at 10.');
update public.messages set read_at = now()
 where conversation_id = 'a0000000-0000-4000-8000-0000000000b1' and read_at is null
   and (sender_id <> '00000000-0000-4000-8000-0000000000b1' or sender_id is null);
do $$ begin
  assert (select count(*) from public.conversations) = 1, 'landlord sees the tenancy thread';
  assert (select count(*) from public.messages) = 2, 'landlord sees both messages';
  assert (select read_at from public.messages where id = 'b0000000-0000-4000-8000-0000000000b1') is not null, 'tenant message marked read';
  assert (select read_at from public.messages where id = 'b0000000-0000-4000-8000-0000000000b2') is null, 'own message stays unread-by-counterpart';
  assert (select count(*) from public.notifications where kind = 'message') = 1, 'landlord received the message notification';
end $$;

-- tenant marks the landlord reply read; strangers see and can write nothing
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
update public.messages set read_at = now()
 where conversation_id = 'a0000000-0000-4000-8000-0000000000b1' and read_at is null
   and (sender_id <> '00000000-0000-4000-8000-0000000000b2' or sender_id is null);
do $$ begin
  assert (select read_at from public.messages where id = 'b0000000-0000-4000-8000-0000000000b2') is not null, 'tenant marked the reply read';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated","email":"stranger@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.conversations) = 0, 'stranger sees no conversations';
  assert (select count(*) from public.messages) = 0, 'stranger sees no messages';
  begin
    insert into public.messages (conversation_id, sender_id, sender_name, sender_role, body)
      values ('a0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b4', 'Stranger', 'tenant', 'hello?');
    raise exception 'ASSERT FAILED: stranger posted into a private thread';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- payments
-- recordPayment(): landlord_reported, `verified` never sent, paid_at stamped
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
insert into public.payments (id, organization_id, tenancy_id, unit_id, amount, status, method, due_date, paid_at, period_label, verification_source, memo)
  values ('c0000000-0000-4000-8000-0000000000b1', :'org_l', '50000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
          1200, 'paid', 'check', current_date, now(), to_char(now(), 'FMMonth YYYY'), 'landlord_reported', 'Check #1042');
-- markPaymentPaid(): a scheduled row becomes paid + landlord_reported
insert into public.payments (id, organization_id, tenancy_id, unit_id, amount, status, method, due_date, period_label)
  values ('c0000000-0000-4000-8000-0000000000b2', :'org_l', '50000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
          1200, 'late', 'manual', current_date - 40, 'Last month');
update public.payments set status = 'paid', paid_at = now(), verification_source = 'landlord_reported'
 where id = 'c0000000-0000-4000-8000-0000000000b2' and status <> 'paid';
do $$ declare p public.payments%rowtype; begin
  select * into p from public.payments where id = 'c0000000-0000-4000-8000-0000000000b1';
  assert p.verified = false and p.verified_at is null, 'landlord-recorded payment is not verified';
  assert p.recorded_by = '00000000-0000-4000-8000-0000000000b1', 'recorded_by stamped from the session';
  assert p.organization_id = current_setting('test.org_l')::uuid, 'organization derived from the tenancy';
  select * into p from public.payments where id = 'c0000000-0000-4000-8000-0000000000b2';
  assert p.status = 'paid' and p.paid_at is not null and p.verification_source = 'landlord_reported' and not p.verified,
    'mark paid → landlord_reported, still unverified';
  -- getDashboardMetrics: paid this month by paid_at
  assert (select sum(amount) from public.payments where organization_id = current_setting('test.org_l')::uuid and status = 'paid'
            and paid_at >= date_trunc('month', now()) and paid_at < date_trunc('month', now()) + interval '1 month') = 2400,
    'rent collected this month';
end $$;
-- landlord → tenant payment notification
select public.notify_user('00000000-0000-4000-8000-0000000000b2', :'org_l', 'payment', 'Rent recorded', 'Your landlord recorded $1,200.00 as received (landlord-reported).');

-- recordTenantPayment(): tenant_reported by the tenant, then the landlord is notified
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
insert into public.payments (id, organization_id, tenancy_id, unit_id, amount, status, method, due_date, paid_at, period_label, verification_source)
  values ('c0000000-0000-4000-8000-0000000000b3', :'org_l', '50000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1',
          1200, 'paid', 'cash', current_date, now(), to_char(now(), 'FMMonth YYYY'), 'tenant_reported');
select public.notify_user('00000000-0000-4000-8000-0000000000b1', :'org_l', 'payment', 'Ops Tenant reported a rent payment', null);
update public.payments set status = 'paid', verification_source = 'landlord_reported' where id = 'c0000000-0000-4000-8000-0000000000b2';
do $$ declare p public.payments%rowtype; begin
  select * into p from public.payments where id = 'c0000000-0000-4000-8000-0000000000b3';
  assert p.verification_source = 'tenant_reported' and not p.verified and p.recorded_by = '00000000-0000-4000-8000-0000000000b2',
    'tenant-reported payment recorded, unverified';
  assert (select count(*) from public.payments) = 3, 'tenant sees the tenancy ledger';
  assert (select count(*) from public.notifications where kind = 'payment') = 1, 'tenant received the payment notification';
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.notifications where kind = 'payment' and user_id = '00000000-0000-4000-8000-0000000000b1') = 1,
    'landlord received the tenant-reported payment notification';
end $$;

-- -------------------------------------------------------------- audit logs
insert into public.audit_logs (actor_id, organization_id, action, entity_type, entity_id)
  values ('00000000-0000-4000-8000-0000000000b1', :'org_l', 'payment.recorded', 'payment', 'c0000000-0000-4000-8000-0000000000b1');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated","email":"tn@ops.rentid"}';
insert into public.audit_logs (actor_id, actor_role, organization_id, action, entity_type, entity_id)
  values ('00000000-0000-4000-8000-0000000000b2', 'tenant', :'org_l', 'maintenance.created', 'maintenance_request', '90000000-0000-4000-8000-0000000000b1');
do $$ begin
  assert (select count(*) from public.audit_logs) = 0, 'tenant cannot read the organization audit trail';
  begin
    insert into public.audit_logs (actor_id, organization_id, action, entity_type)
      values ('00000000-0000-4000-8000-0000000000b1', current_setting('test.org_l')::uuid, 'forged', 'x');
    raise exception 'ASSERT FAILED: audit row written on behalf of someone else';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated","email":"ll@ops.rentid"}';
do $$ begin
  assert (select count(*) from public.audit_logs where organization_id = current_setting('test.org_l')::uuid
            and action in ('payment.recorded', 'maintenance.created')) = 2,
    'landlord reads both audit rows (own and the tenant''s)';
end $$;

rollback;
