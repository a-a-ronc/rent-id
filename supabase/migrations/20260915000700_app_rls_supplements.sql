-- =====================================================================
-- RLS supplements discovered while porting the app to real queries.
-- Small, additive read policies; no new write paths.
-- =====================================================================

-- A tenant sees the organization (landlord workspace) behind their tenancy —
-- name, kind and verification badge — not other orgs.
drop policy if exists organizations_select_tenant on public.organizations;
create policy organizations_select_tenant on public.organizations for select to authenticated
  using (exists (select 1 from public.tenancies t
                  where t.organization_id = organizations.id and t.tenant_user_id = auth.uid()));
