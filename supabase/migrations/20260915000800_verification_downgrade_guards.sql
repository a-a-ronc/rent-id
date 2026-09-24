-- =====================================================================
-- Forward migration — close the "downgrade" holes in the trust model.
--
-- 20260915000200 stops a client from ASSERTING a platform-verified payment.
-- It did not stop a client from DOWNGRADING one: a landlord could take a
-- payment RentID actually settled and rewrite it as `landlord_reported`
-- (or move it back to unpaid), erasing a verified history event that another
-- user's housing decision may depend on. Same class of problem for a
-- verified tenancy and for archived documents whose bytes stayed readable.
--
-- Rule of thumb encoded here: verified history is append-only for clients.
-- Only the platform (service role: webhook handlers, settlement jobs,
-- support tooling with an audit trail) may move a row out of a verified state.
-- =====================================================================

-- --------------------------------------------------------------- payments
create or replace function public.payments_enforce_verification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  tenancy_org uuid;
begin
  -- a payment always belongs to its tenancy's organization, whatever the client sent
  select organization_id into tenancy_org from public.tenancies where id = new.tenancy_id;
  if tenancy_org is null then
    raise exception 'payment references unknown tenancy %', new.tenancy_id;
  end if;
  new.organization_id := tenancy_org;

  if not public.is_platform_actor() then
    -- asserting a platform source is platform-only. On UPDATE this fires only
    -- when the value actually changes, so a client may still annotate a row
    -- the platform already settled (see the immutability block below).
    if new.verification_source in ('platform_settled', 'bank_linked', 'imported')
       and (tg_op = 'INSERT' or new.verification_source is distinct from old.verification_source) then
      raise exception 'verification_source % can only be asserted by the platform', new.verification_source
        using errcode = '42501';
    end if;

    -- A settled payment is a verified history event. Clients may annotate
    -- it (memo) but may not un-verify it, re-point it, or change its money.
    if tg_op = 'UPDATE'
       and old.verification_source in ('platform_settled', 'bank_linked', 'imported') then
      if new.verification_source is distinct from old.verification_source then
        raise exception 'a platform-verified payment cannot be downgraded' using errcode = '42501';
      end if;
      if new.amount is distinct from old.amount
         or new.status is distinct from old.status
         or new.paid_at is distinct from old.paid_at
         or new.tenancy_id is distinct from old.tenancy_id
         or new.platform_fee_amount is distinct from old.platform_fee_amount
         or new.external_reference is distinct from old.external_reference
         or new.payout_id is distinct from old.payout_id then
        raise exception 'a platform-verified payment is immutable; open a dispute instead'
          using errcode = '42501';
      end if;
    end if;

    if new.verification_source = 'landlord_reported' and not public.is_org_member(new.organization_id) then
      raise exception 'only the housing provider can record a landlord-reported payment' using errcode = '42501';
    end if;
    if new.verification_source = 'tenant_reported'
       and not exists (select 1 from public.tenancies t where t.id = new.tenancy_id and t.tenant_user_id = actor) then
      raise exception 'only the tenant on this tenancy can record a tenant-reported payment' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.recorded_by := actor;
    end if;
  end if;

  new.verified := new.verification_source in ('platform_settled', 'bank_linked');
  if new.verified then
    new.verified_at := coalesce(new.verified_at, now());
  else
    new.verified_at := null;
  end if;
  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end $$;

-- Payments are never deleted by a client: history is the product.
drop policy if exists payments_delete on public.payments;
revoke delete on public.payments from authenticated;

-- ------------------------------------------------------------- tenancies
-- 20260915000600 stops a client setting `verified`. Also stop a client
-- silently un-verifying by soft-deleting the tenancy a verified history
-- event hangs off: a verified tenancy is archived, never erased.
create or replace function public.tenancies_guard_verified() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.is_trusted_write() then
    if tg_op = 'INSERT' and (new.verified or new.verified_at is not null) then
      new.verified := false; new.verified_at := null;
    elsif tg_op = 'UPDATE' and (new.verified is distinct from old.verified or new.verified_at is distinct from old.verified_at) then
      raise exception 'tenancy verification is set when the tenant accepts the invitation, not by hand' using errcode = '42501';
    end if;
    -- the landlord cannot re-point a tenancy at a different user account
    if tg_op = 'UPDATE' and new.tenant_user_id is distinct from old.tenant_user_id and old.tenant_user_id is not null then
      raise exception 'tenant account link cannot be changed once set' using errcode = '42501';
    end if;
    -- NEW: a verified tenancy cannot be soft-deleted away by a client
    if tg_op = 'UPDATE' and old.verified and new.deleted_at is not null and old.deleted_at is null then
      raise exception 'a verified tenancy cannot be deleted; end it instead' using errcode = '42501';
    end if;
  end if;
  if new.verified and new.tenant_user_id is null then
    raise exception 'a tenancy without a tenant account cannot be verified' using errcode = '22023';
  end if;
  return new;
end $$;

-- A verified tenancy is history for BOTH parties; deleting the row would take
-- the tenant's payment record with it.
create or replace function public.tenancies_block_verified_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.verified and not public.is_trusted_write() then
    raise exception 'a verified tenancy cannot be deleted; end it instead' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists tenancies_block_verified_delete on public.tenancies;
create trigger tenancies_block_verified_delete before delete on public.tenancies
  for each row execute function public.tenancies_block_verified_delete();

-- ------------------------------------------------------------- documents
-- The storage read policy (20260903191108) checks the documents row but not
-- `deleted_at`, so an archived document's bytes stayed readable to whoever
-- could read it before. Scope the tenant read-through to live rows.
drop policy if exists "documents_read_org_or_tenant" on storage.objects;
create policy "documents_read_org_or_tenant" on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (
    public.is_org_member(((storage.foldername(name))[1])::uuid)
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

-- --------------------------------------------------------------- reviews
-- A published review that another user's decision may rest on cannot be
-- silently rewritten: the author may withdraw it (status) or edit the body
-- within an hour, after which only a dispute changes it.
create or replace function public.reviews_guard_edits() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_trusted_write() then return new; end if;
  if tg_op = 'UPDATE' then
    if new.tenancy_id is distinct from old.tenancy_id or new.author_id is distinct from old.author_id then
      raise exception 'a review cannot be moved to another tenancy or author' using errcode = '42501';
    end if;
    if (new.rating is distinct from old.rating or new.body is distinct from old.body)
       and old.created_at < now() - interval '1 hour' then
      raise exception 'reviews can be edited for one hour; withdraw it or raise a dispute instead'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists reviews_guard_edits on public.reviews;
create trigger reviews_guard_edits before update on public.reviews
  for each row execute function public.reviews_guard_edits();
revoke delete on public.reviews from authenticated;
