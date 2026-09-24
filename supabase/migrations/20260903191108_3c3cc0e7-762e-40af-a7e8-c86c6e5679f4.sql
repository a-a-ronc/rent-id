create policy "documents_read_org_or_tenant" on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (
    public.is_org_member(((storage.foldername(name))[1])::uuid)
    or exists (
      select 1 from public.documents d
      where d.storage_path = storage.objects.name
        and d.visible_to_tenant
        and d.tenancy_id is not null
        and public.is_tenancy_party(d.tenancy_id)
    )
  )
);

create policy "documents_insert_org" on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy "documents_delete_org" on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);