drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or owner_id = auth.uid() or is_demo or public.has_role(auth.uid(),'admin'));

delete from public.organizations where name in ('Test Co','Test B');