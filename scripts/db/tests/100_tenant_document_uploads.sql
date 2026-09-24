-- Tenant document uploads: a tenancy party may write under their own
-- `tenancy/<id>/` prefix and nowhere else. Transactional, rolls back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000f1', 'll@upload.rentid', '{"full_name":"Landlord","role":"landlord"}'),
  ('00000000-0000-4000-8000-0000000000f2', 'tn@upload.rentid', '{"full_name":"Tenant","role":"tenant"}'),
  ('00000000-0000-4000-8000-0000000000f3', 'nosy@upload.rentid', '{"full_name":"Stranger","role":"tenant"}');

-- ------------------------------------------------------- the bucket exists
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'documents') then
    raise exception 'FAIL: the documents bucket was not created by a migration';
  end if;
  if (select public from storage.buckets where id = 'documents') then
    raise exception 'FAIL: the documents bucket must be private';
  end if;
end $$;

-- ---------------------------------------------------------------- landlord
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated","email":"ll@upload.rentid"}';
select public.create_organization('Upload Org', 'landlord') as org \gset
insert into public.properties (id, organization_id, name, street_address, city, state, zip)
  values ('10000000-0000-4000-8000-0000000000f1', :'org', 'Upload House', '11 Main', 'SLC', 'UT', '84101');
insert into public.units (id, property_id, name, monthly_rent)
  values ('20000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'A', 1500);
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, tenant_email, status, monthly_rent)
  values ('40000000-0000-4000-8000-0000000000f1', :'org', '10000000-0000-4000-8000-0000000000f1',
          '20000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f2',
          'Tenant', 'tn@upload.rentid', 'active', 1500);

-- ----------------------------------------------- prefix helper is defensive
do $$
begin
  if public.storage_tenancy_prefix('tenancy/not-a-uuid/lease.pdf') is not null then
    raise exception 'FAIL: a malformed uuid segment should yield null, not raise';
  end if;
  if public.storage_tenancy_prefix('tenancy') is not null then
    raise exception 'FAIL: a path with no second segment should yield null';
  end if;
  if public.storage_tenancy_prefix('someorg/abc.pdf') is not null then
    raise exception 'FAIL: a non-tenancy prefix should yield null';
  end if;
  if public.storage_tenancy_prefix('tenancy/40000000-0000-4000-8000-0000000000f1/lease.pdf')
     <> '40000000-0000-4000-8000-0000000000f1'::uuid then
    raise exception 'FAIL: a well-formed tenancy path should yield its tenancy id';
  end if;
end $$;

-- ------------------------------------------------------------ the tenant
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f2","role":"authenticated","email":"tn@upload.rentid"}';

-- may write under their own tenancy prefix
insert into storage.objects (bucket_id, name, owner)
  values ('documents', 'tenancy/40000000-0000-4000-8000-0000000000f1/renters-insurance.pdf',
          '00000000-0000-4000-8000-0000000000f2');

-- and read it back
do $$
begin
  if not exists (
    select 1 from storage.objects
     where bucket_id = 'documents'
       and name = 'tenancy/40000000-0000-4000-8000-0000000000f1/renters-insurance.pdf'
  ) then
    raise exception 'FAIL: a tenant cannot read back their own upload';
  end if;
end $$;

-- may NOT write into the organization's own folder
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
      values ('documents', (select id::text from public.organizations limit 1) || '/sneaky.pdf',
              '00000000-0000-4000-8000-0000000000f2');
    raise exception 'FAIL: a tenant wrote into the organization folder';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- ----------------------------------------------------------- the stranger
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated","email":"nosy@upload.rentid"}';

-- may not write under someone else's tenancy prefix
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
      values ('documents', 'tenancy/40000000-0000-4000-8000-0000000000f1/forged.pdf',
              '00000000-0000-4000-8000-0000000000f3');
    raise exception 'FAIL: a stranger wrote into another tenancy folder';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- and may not read what the tenant uploaded
do $$
begin
  if exists (
    select 1 from storage.objects
     where bucket_id = 'documents'
       and name = 'tenancy/40000000-0000-4000-8000-0000000000f1/renters-insurance.pdf'
  ) then
    raise exception 'FAIL: a stranger can read another tenancy''s document';
  end if;
end $$;

rollback;
