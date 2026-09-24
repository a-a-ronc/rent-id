-- Documents: create the bucket, and let a tenant upload their own paperwork.
--
-- Two gaps found while wiring the documents UI to real storage:
--
-- 1. The `documents` bucket was only ever created by the LOCAL test shim
--    (scripts/db/supabase-shim.sql). No migration created it, so on a fresh
--    Supabase project every upload fails with "Bucket not found" — and the
--    storage policies in 20260903191108 quietly reference a bucket that isn't
--    there. Creating it here makes the migration set self-sufficient.
--
-- 2. `documents_insert_org` requires `is_org_member(folder[1])`. The matching
--    SELECT policy was widened in 20260915000800 to let a tenancy party read
--    documents shared with them, but INSERT was never widened, so a tenant
--    could never upload anything — renters insurance, a signed addendum, proof
--    of a repair. Tenants write under their own `tenancy/<tenancy-id>/` prefix,
--    which keeps them out of the organization's folder entirely.

-- ------------------------------------------------------------------ bucket
-- Private. Access is always a short-lived signed URL minted after the RLS
-- policy on the documents row has already allowed the read.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ------------------------------------------------------- tenant uploads
-- A tenancy party may write under `tenancy/<tenancy-id>/…` for a tenancy they
-- are actually part of. `is_tenancy_party` is SECURITY DEFINER, so this does
-- not recurse through the tenancies policies.
--
-- The uuid cast is guarded: storage.foldername on a malformed path yields
-- something that is not a uuid, and an unguarded cast raises 22P02 instead of
-- simply denying the write.
create or replace function public.storage_tenancy_prefix(_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  parts text[] := storage.foldername(_name);
begin
  if array_length(parts, 1) is null or array_length(parts, 1) < 2 then
    return null;
  end if;
  if parts[1] <> 'tenancy' then
    return null;
  end if;
  begin
    return parts[2]::uuid;
  exception when others then
    return null;
  end;
end $$;

drop policy if exists "documents_insert_tenant" on storage.objects;
create policy "documents_insert_tenant" on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.storage_tenancy_prefix(name) is not null
  and public.is_tenancy_party(public.storage_tenancy_prefix(name))
);

-- A tenant can read back what they uploaded, whether or not the landlord has
-- marked it visible — it is their own file.
drop policy if exists "documents_read_tenant_own" on storage.objects;
create policy "documents_read_tenant_own" on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and public.storage_tenancy_prefix(name) is not null
  and public.is_tenancy_party(public.storage_tenancy_prefix(name))
);

-- Deliberately no DELETE policy for tenants: a document filed against a
-- tenancy is part of the record both sides rely on. Removal goes through the
-- organization, which already has `documents_delete_org`.

-- ------------------------------------------- harden the organization policies
-- Found by scripts/db/tests/100: the existing policies cast the first path
-- segment straight to uuid —
--
--   public.is_org_member(((storage.foldername(name))[1])::uuid)
--
-- so any object whose first segment is not a uuid raises 22P02 (invalid input
-- syntax for type uuid) instead of simply failing the check. That was
-- unreachable while every path started with an organization id; introducing the
-- `tenancy/…` prefix above makes it reachable, and a policy that *raises*
-- rather than denies is a bad failure either way — it turns a clean "no" into a
-- 500 and leaks the shape of the check.
--
-- Same guarded-cast treatment as storage_tenancy_prefix.
create or replace function public.storage_org_prefix(_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  parts text[] := storage.foldername(_name);
begin
  if array_length(parts, 1) is null then
    return null;
  end if;
  begin
    return parts[1]::uuid;
  exception when others then
    return null;
  end;
end $$;

drop policy if exists "documents_insert_org" on storage.objects;
create policy "documents_insert_org" on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.storage_org_prefix(name) is not null
  and public.is_org_member(public.storage_org_prefix(name))
);

drop policy if exists "documents_delete_org" on storage.objects;
create policy "documents_delete_org" on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and public.storage_org_prefix(name) is not null
  and public.is_org_member(public.storage_org_prefix(name))
);

-- Keeps the tenant read-through from 20260915000800, minus the unguarded cast.
drop policy if exists "documents_read_org_or_tenant" on storage.objects;
create policy "documents_read_org_or_tenant" on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (
    (
      public.storage_org_prefix(name) is not null
      and public.is_org_member(public.storage_org_prefix(name))
    )
    or exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.visible_to_tenant
        and d.deleted_at is null
        and d.tenancy_id is not null
        and public.is_tenancy_party(d.tenancy_id)
    )
  )
);
