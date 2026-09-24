-- Property ownership / authorized-representative verification guarantees
-- (20260915000400). One transaction, rolled back at the end. Literal ids
-- because psql :'vars' do not interpolate inside $$ blocks.
--
--   users  L 00000000-0000-4000-8000-000000000201  landlord, owns org L + property L
--          B 00000000-0000-4000-8000-000000000202  landlord, owns org B + property B
--          P 00000000-0000-4000-8000-000000000203  property manager, owns org P
--          T 00000000-0000-4000-8000-000000000204  tenant of property L
--          Z 00000000-0000-4000-8000-000000000205  RentID admin
--   orgs   L 60000000-0000-4000-8000-000000000201 / B ...0202 / P ...0203
--   property L 10000000-0000-4000-8000-000000000201 (unit 20000000-...-0201)
--   property B 10000000-0000-4000-8000-000000000202 (unit 20000000-...-0202)
--   case L  c0000000-0000-4000-8000-000000000201, case P c0000000-...-0202
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000201', 'landlord-l@test.rentid', '{"full_name":"Landlord L","role":"landlord"}'),
  ('00000000-0000-4000-8000-000000000202', 'landlord-b@test.rentid', '{"full_name":"Landlord B","role":"landlord"}'),
  ('00000000-0000-4000-8000-000000000203', 'manager-p@test.rentid',  '{"full_name":"Manager P","role":"property_manager"}'),
  ('00000000-0000-4000-8000-000000000204', 'tenant-t@test.rentid',   '{"full_name":"Tenant T","role":"tenant"}'),
  ('00000000-0000-4000-8000-000000000205', 'admin-z@test.rentid',    '{"full_name":"Admin Z","role":"admin"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000205', 'admin');

insert into public.organizations (id, name, owner_id, kind) values
  ('60000000-0000-4000-8000-000000000201', 'L Holdings',   '00000000-0000-4000-8000-000000000201', 'landlord'),
  ('60000000-0000-4000-8000-000000000202', 'B Rentals',    '00000000-0000-4000-8000-000000000202', 'landlord'),
  ('60000000-0000-4000-8000-000000000203', 'P Management', '00000000-0000-4000-8000-000000000203', 'property_manager');
insert into public.organization_members (organization_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'landlord'),
  ('60000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000202', 'landlord'),
  ('60000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000203', 'property_manager');
insert into public.properties (id, organization_id, name, street_address, city, state, zip, normalized_address, county, parcel_number) values
  ('10000000-0000-4000-8000-000000000201', '60000000-0000-4000-8000-000000000201', 'Alger House', '12 Alger Ave', 'Salt Lake City', 'UT', '84105', '12 alger ave|salt lake city|ut|84105', 'Salt Lake', '16-08-101-001'),
  ('10000000-0000-4000-8000-000000000202', '60000000-0000-4000-8000-000000000202', 'B Duplex',    '9 Bee St',      'Provo',          'UT', '84601', '9 bee st|provo|ut|84601', 'Utah', '21-03-200-002');
insert into public.units (id, property_id, name, monthly_rent) values
  ('20000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'Main', 1450),
  ('20000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000202', 'Left', 1100);
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, tenant_email, status, monthly_rent) values
  ('30000000-0000-4000-8000-000000000201', '60000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201',
   '20000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000204', 'Tenant T', 'tenant-t@test.rentid', 'active', 1450);
-- What the county record says (platform-imported).
insert into public.property_ownership_records (id, property_id, owner_party_type, raw_owner_name, normalized_owner_name, ownership_capacity, recorded_at, source_type, source_provider) values
  ('e0000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'individual', 'LANDLORD L', 'landlord l', 'sole_owner', '2021-06-01', 'recorded_document', 'county-recorder');

-- ----------------------------------------------- 1. landlord L opens a claim
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated","email":"landlord-l@test.rentid"}';
insert into public.verification_cases (id, property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
  values ('c0000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', '60000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000201', 'Landlord L', 'individual_owner', 'collecting_evidence', '1.0.0');
do $$ declare r public.property_party_relationships%rowtype; begin
  select * into r from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000201';
  assert r.id is not null and r.status = 'pending' and r.relationship = 'owner' and r.verified_at is null,
    'opening a case creates a pending, badge-less relationship';
  assert (select count(*) from public.verification_status_events where case_id = 'c0000000-0000-4000-8000-000000000201' and action = 'verification.case_opened') = 1,
    'opening a case writes a history entry';
  assert (select count(*) from public.property_ownership_records) = 1, 'claimant sees the recorded-owner data for its property';
  begin
    insert into public.verification_cases (property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
      values ('10000000-0000-4000-8000-000000000201', '60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'L again', 'individual_owner', 'pending', '1.0.0');
    raise exception 'ASSERT FAILED: two open cases on one property';
  exception when unique_violation then null;
  end;
  begin
    insert into public.verification_cases (property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
      values ('10000000-0000-4000-8000-000000000202', '60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'L', 'individual_owner', 'pending', '1.0.0');
    raise exception 'ASSERT FAILED: claim opened on a property the claimant has no relation to';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------ 2. an org can never self-verify its property
update public.verification_cases set status = 'ownership_verified' where id = 'c0000000-0000-4000-8000-000000000201';
update public.property_party_relationships set status = 'ownership_verified', verified_at = now() where case_id = 'c0000000-0000-4000-8000-000000000201';
do $$ begin
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000201') = 'collecting_evidence',
    'org member cannot change its own case status';
  assert (select status from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000201') = 'pending',
    'org member cannot mark its own property verified';
  begin
    insert into public.verification_cases (property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
      values ('10000000-0000-4000-8000-000000000202', '60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'L', 'individual_owner', 'ownership_verified', '1.0.0');
    raise exception 'ASSERT FAILED: case opened already verified';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.verification_cases (property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, property_confidence, rules_version)
      values ('10000000-0000-4000-8000-000000000202', '60000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'L', 'individual_owner', 'pending', 'strong', '1.0.0');
    raise exception 'ASSERT FAILED: case opened with self-asserted confidence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.property_party_relationships (property_id, user_id, relationship, status)
      values ('10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'owner', 'ownership_verified');
    raise exception 'ASSERT FAILED: org member inserted a verified relationship';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_verification_case('c0000000-0000-4000-8000-000000000201', 'verify_ownership', 'I say so');
    raise exception 'ASSERT FAILED: non-admin decided a verification case';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------------------------------- 3. L submits evidence
insert into public.verification_evidence (id, case_id, proposition, evidence_type, summary, storage_path, submitted_by)
  values ('d0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000201', 'property', 'deed_upload',
          'Warranty deed, June 2021', 'verification-evidence/c0000000-0000-4000-8000-000000000201/deed.pdf', '00000000-0000-4000-8000-000000000201');
do $$ declare e public.verification_evidence%rowtype; begin
  select * into e from public.verification_evidence where id = 'd0000000-0000-4000-8000-000000000201';
  assert e.property_id = '10000000-0000-4000-8000-000000000201', 'evidence property_id filled from the case';
  assert e.strength = 'unverified_upload' and e.source_type = 'user_upload', 'uploads are unverified until reviewed';
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000201') = 'manual_review',
    'uploaded evidence sends the case to a human';
  assert (select count(*) from public.verification_status_events where case_id = 'c0000000-0000-4000-8000-000000000201' and action = 'verification.evidence_submitted') = 1,
    'evidence submission is in the history';
  begin
    insert into public.verification_evidence (case_id, proposition, evidence_type, summary, strength, submitted_by)
      values ('c0000000-0000-4000-8000-000000000201', 'property', 'deed_upload', 'x', 'primary', '00000000-0000-4000-8000-000000000201');
    raise exception 'ASSERT FAILED: claimant submitted primary-strength evidence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.verification_evidence (case_id, proposition, evidence_type, summary, source_type, submitted_by)
      values ('c0000000-0000-4000-8000-000000000201', 'property', 'deed', 'x', 'recorded_document', '00000000-0000-4000-8000-000000000201');
    raise exception 'ASSERT FAILED: claimant submitted evidence as an official source';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------- 4. tenant T sees nothing private
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000204","role":"authenticated","email":"tenant-t@test.rentid"}';
do $$ begin
  assert (select count(*) from public.properties) = 1, 'tenant sees the property they rent';
  assert (select count(*) from public.verification_evidence) = 0, 'evidence is invisible to a tenant';
  assert (select count(*) from public.verification_cases) = 0, 'cases are invisible to a tenant';
  assert (select count(*) from public.verification_status_events) = 0, 'history is invisible to a tenant';
  assert (select count(*) from public.property_ownership_records) = 0, 'ownership records are invisible to a tenant';
  assert (select count(*) from public.property_party_relationships) = 0, 'no badge yet, so no relationship row is visible';
  begin
    insert into public.verification_evidence (case_id, proposition, evidence_type, summary, submitted_by)
      values ('c0000000-0000-4000-8000-000000000201', 'property', 'x', 'x', '00000000-0000-4000-8000-000000000204');
    raise exception 'ASSERT FAILED: tenant submitted evidence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.verification_cases (property_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
      values ('10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000204', 'T', 'individual_owner', 'pending', '1.0.0');
    raise exception 'ASSERT FAILED: tenant opened an ownership claim';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Unrelated landlord B sees nothing either.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000202","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verification_cases) = 0, 'other org cannot see the case';
  assert (select count(*) from public.verification_evidence) = 0, 'other org cannot see evidence';
  assert (select count(*) from public.property_ownership_records) = 0, 'other org cannot see ownership records';
end $$;

-- ------------------------------------------------- 5. admin Z decides via RPC
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000205","role":"authenticated","email":"admin-z@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verification_cases) = 1, 'admin sees the case';
  assert (select count(*) from public.verification_evidence) = 1, 'admin sees the evidence';
  begin
    perform public.decide_verification_case('c0000000-0000-4000-8000-000000000201', 'bogus', 'x');
    raise exception 'ASSERT FAILED: unknown decision accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.decide_verification_case('c0000000-0000-4000-8000-000000000201', 'verify_ownership', '   ');
    raise exception 'ASSERT FAILED: decision without a reason accepted';
  exception when invalid_parameter_value then null;
  end;
  -- even an admin cannot hand-edit a decision or a badge
  begin
    update public.verification_cases set status = 'ownership_verified' where id = 'c0000000-0000-4000-8000-000000000201';
    raise exception 'ASSERT FAILED: admin changed a case status without the RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.property_party_relationships set status = 'ownership_verified' where case_id = 'c0000000-0000-4000-8000-000000000201';
    raise exception 'ASSERT FAILED: admin issued a badge without the RPC';
  exception when insufficient_privilege then null;
  end;
end $$;
select public.decide_verification_case('c0000000-0000-4000-8000-000000000201', 'request_information', 'Please upload the recorded deed.') as d1 \gset
do $$ declare c public.verification_cases%rowtype; begin
  select * into c from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000201';
  assert c.status = 'collecting_evidence', 'request_information reopens evidence collection';
  assert c.reviewer_id = '00000000-0000-4000-8000-000000000205' and c.decided_at is not null, 'reviewer and decided_at recorded';
  assert c.decision_reason = 'Please upload the recorded deed.', 'reason recorded';
end $$;
select public.decide_verification_case('c0000000-0000-4000-8000-000000000201', 'verify_ownership', 'Deed and identity match the claimant.') as d2 \gset
do $$ declare c public.verification_cases%rowtype; r public.property_party_relationships%rowtype; begin
  select * into c from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000201';
  assert c.status = 'ownership_verified', 'verify_ownership sets the case status';
  assert c.last_verified_at is not null and c.next_review_at > now() and c.reverification_required = false, 'verification is scheduled for re-review';
  select * into r from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000201';
  assert r.status = 'ownership_verified' and r.verified_at is not null, 'badge relationship verified by the RPC';
  assert r.recorded_owner_name = 'LANDLORD L', 'recorded owner name copied from the county record';
  assert (select count(*) from public.verification_status_events where case_id = 'c0000000-0000-4000-8000-000000000201' and action = 'verification.verify_ownership' and from_status = 'collecting_evidence' and to_status = 'ownership_verified') = 1,
    'decision written to the append-only history';
  assert (select count(*) from public.audit_logs where action = 'property_verification.verify_ownership' and entity_id = 'c0000000-0000-4000-8000-000000000201') = 1,
    'decision written to audit_logs';
end $$;

-- ------------------------------------------ 6. the badge is public, nothing else
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert (select count(*) from public.property_party_relationships) = 1, 'anon reads the verified badge';
  assert (select status from public.property_party_relationships limit 1) = 'ownership_verified', 'only positive states are public';
  assert (select verified_properties from public.provider_public_profile('60000000-0000-4000-8000-000000000201')) = 1,
    'provider_public_profile() counts the verified property';
  begin
    perform count(*) from public.verification_cases;
    raise exception 'ASSERT FAILED: anon read verification cases';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.verification_evidence;
    raise exception 'ASSERT FAILED: anon read verification evidence';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000204","role":"authenticated","email":"tenant-t@test.rentid"}';
do $$ begin
  assert (select count(*) from public.property_party_relationships) = 1, 'tenant sees the badge';
  assert (select count(*) from public.verification_evidence) = 0, 'tenant still sees no evidence';
  assert (select count(*) from public.verification_cases) = 0, 'tenant still sees no case';
end $$;

-- ------------------------------ 7. representative authorization (owner → PM)
-- B's ownership is not verified: B cannot delegate.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000202","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  begin
    insert into public.representative_authorizations (property_id, owner_user_id, owner_name, representative_organization_id, representative_name, permissions)
      values ('10000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000202', 'Landlord B', '60000000-0000-4000-8000-000000000203', 'P Management', '{manage_listing}');
    raise exception 'ASSERT FAILED: unverified owner delegated authority';
  exception when insufficient_privilege then null;
  end;
end $$;
-- L (verified owner) invites P Management.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated","email":"landlord-l@test.rentid"}';
insert into public.representative_authorizations (id, property_id, owner_user_id, owner_name, representative_organization_id, representative_name, permissions)
  values ('f0000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'Landlord L',
          '60000000-0000-4000-8000-000000000203', 'P Management', '{manage_listing,manage_property_records}');
do $$ begin
  assert (select status from public.representative_authorizations where id = 'f0000000-0000-4000-8000-000000000201') = 'pending', 'authorization starts pending';
  assert (select count(*) from public.verification_status_events where action = 'authorization.invited' and property_id = '10000000-0000-4000-8000-000000000201') = 1,
    'invitation logged';
  begin
    insert into public.representative_authorizations (property_id, owner_user_id, owner_name, representative_organization_id, representative_name, status)
      values ('10000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000201', 'Landlord L', '60000000-0000-4000-8000-000000000203', 'P', 'active');
    raise exception 'ASSERT FAILED: authorization created already active';
  exception when insufficient_privilege then null;
  end;
end $$;

-- P accepts, cannot widen the scope, then opens its own claim.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000203","role":"authenticated","email":"manager-p@test.rentid"}';
do $$ begin
  assert (select count(*) from public.representative_authorizations) = 1, 'invited organization sees the authorization';
  assert not public.has_property_permission('10000000-0000-4000-8000-000000000201', 'manage_listing'), 'pending authorization grants no permission';
  begin
    update public.representative_authorizations set permissions = '{manage_listing,manage_payment_settings}' where id = 'f0000000-0000-4000-8000-000000000201';
    raise exception 'ASSERT FAILED: representative widened its own permissions';
  exception when insufficient_privilege then null;
  end;
end $$;
update public.representative_authorizations set status = 'active' where id = 'f0000000-0000-4000-8000-000000000201';
do $$ declare a public.representative_authorizations%rowtype; begin
  select * into a from public.representative_authorizations where id = 'f0000000-0000-4000-8000-000000000201';
  assert a.status = 'active' and a.granted_at is not null, 'representative accepted';
  assert a.representative_user_id = '00000000-0000-4000-8000-000000000203', 'accepting user bound to the authorization';
  assert public.has_property_permission('10000000-0000-4000-8000-000000000201', 'manage_listing'), 'active authorization grants its permissions';
  assert not public.has_property_permission('10000000-0000-4000-8000-000000000201', 'manage_payment_settings'), 'and only its permissions';
  assert (select count(*) from public.property_ownership_records) = 1, 'manage_property_records opens the verification workspace';
end $$;
insert into public.verification_cases (id, property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
  values ('c0000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000201', '60000000-0000-4000-8000-000000000203',
          '00000000-0000-4000-8000-000000000203', 'Manager P', 'authorized_representative', 'collecting_evidence', '1.0.0');
update public.representative_authorizations set verification_case_id = 'c0000000-0000-4000-8000-000000000202' where id = 'f0000000-0000-4000-8000-000000000201';
do $$ begin
  assert (select relationship from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000202') = 'authorized_representative',
    'representative claim creates a pending representative relationship';
  assert (select count(*) from public.verification_cases) = 1, 'representative sees only its own case, not the owner''s';
  assert (select count(*) from public.verification_evidence) = 0, 'representative cannot see the owner''s evidence';
end $$;

-- Admin verifies the representative; the PM organization now carries a badge.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000205","role":"authenticated","email":"admin-z@test.rentid"}';
select public.decide_verification_case('c0000000-0000-4000-8000-000000000202', 'verify_representative', 'Owner authorization on file.') as d3 \gset
do $$ begin
  assert (select status from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000202') = 'authorized_representative_verified',
    'verify_representative issues the representative badge';
  assert (select verified_properties from public.provider_public_profile('60000000-0000-4000-8000-000000000203')) = 1,
    'PM profile counts the property it is verified on';
end $$;

-- Owner revokes: badge and permissions go away, history stays.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated","email":"landlord-l@test.rentid"}';
update public.representative_authorizations set status = 'revoked', revoked_reason = 'Switching managers' where id = 'f0000000-0000-4000-8000-000000000201';
do $$ declare a public.representative_authorizations%rowtype; r public.property_party_relationships%rowtype; begin
  select * into a from public.representative_authorizations where id = 'f0000000-0000-4000-8000-000000000201';
  assert a.status = 'revoked' and a.revoked_at is not null, 'owner revoked the authorization';
  select * into r from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000202';
  assert r.status = 'revoked' and r.revoked_at is not null, 'representative badge withdrawn on revoke';
  assert (select status from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000201') = 'ownership_verified',
    'owner badge untouched by the revoke';
  assert (select count(*) from public.verification_status_events where action = 'authorization.revoked') = 1, 'revoke logged';
  assert (select verified_properties from public.provider_public_profile('60000000-0000-4000-8000-000000000203')) = 0,
    'PM profile no longer counts the property';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000203","role":"authenticated","email":"manager-p@test.rentid"}';
do $$ begin
  assert not public.has_property_permission('10000000-0000-4000-8000-000000000201', 'manage_listing'), 'revoked authorization grants nothing';
end $$;

-- ------------------------------------------ 8. tenant disclosure acknowledgement
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000204","role":"authenticated","email":"tenant-t@test.rentid"}';
insert into public.verification_acknowledgements (tenant_user_id, property_id, payee_reference, disclosure_version, verification_version, context)
  values ('00000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000201', 'org:60000000-0000-4000-8000-000000000201', '2026-09-11', 'none:landlord l:', 'payment');
do $$ begin
  assert (select count(*) from public.verification_acknowledgements) = 1, 'tenant reads own acknowledgement';
  begin
    insert into public.verification_acknowledgements (tenant_user_id, property_id, payee_reference, disclosure_version, verification_version, context)
      values ('00000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'x', 'v', 'v', 'lease');
    raise exception 'ASSERT FAILED: acknowledgement recorded for another user';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.verification_acknowledgements (tenant_user_id, property_id, payee_reference, disclosure_version, verification_version, context)
      values ('00000000-0000-4000-8000-000000000204', '10000000-0000-4000-8000-000000000201', 'org:60000000-0000-4000-8000-000000000201', '2026-09-11', 'none:landlord l:', 'lease');
    raise exception 'ASSERT FAILED: duplicate acknowledgement for the same payee/version';
  exception when unique_violation then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated","email":"landlord-l@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verification_acknowledgements) = 0, 'landlord cannot read tenant acknowledgements';
  begin
    insert into public.verification_risk_events (property_id, kind, detail) values ('10000000-0000-4000-8000-000000000201', 'identity_reuse', 'x');
    raise exception 'ASSERT FAILED: client wrote a risk event';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.verified_entities (legal_name, normalized_name) values ('Alger Holdings LLC', 'alger holdings llc');
    raise exception 'ASSERT FAILED: non-admin created an entity';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ----------------------------------------- 9. risk events + entities (admin)
reset role;
reset request.jwt.claims;
insert into public.verification_risk_events (id, property_id, case_id, user_id, kind, severity, detail)
  values ('e2000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000201',
          '00000000-0000-4000-8000-000000000201', 'reused_document', 'medium', 'Same deed hash seen on another property.');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000205","role":"authenticated","email":"admin-z@test.rentid"}';
insert into public.verified_entities (id, legal_name, normalized_name, entity_type, formation_state, file_number, registry_status)
  values ('e1000000-0000-4000-8000-000000000201', 'Alger Holdings LLC', 'alger holdings llc', 'Limited liability company', 'UT', '1234567-0160', 'Active');
update public.verification_risk_events set resolved_at = now() where id = 'e2000000-0000-4000-8000-000000000201';
update public.verification_cases set entity_id = 'e1000000-0000-4000-8000-000000000201' where id = 'c0000000-0000-4000-8000-000000000201';
do $$ begin
  assert (select count(*) from public.verification_risk_events where resolved_at is not null) = 1, 'admin reads and resolves risk events';
  assert (select entity_id from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000201') = 'e1000000-0000-4000-8000-000000000201',
    'admin can edit non-decision case fields directly';
  begin
    update public.verified_entities set verified = true where id = 'e1000000-0000-4000-8000-000000000201';
    raise exception 'ASSERT FAILED: admin hand-verified an entity';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000201","role":"authenticated","email":"landlord-l@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verification_risk_events) = 0, 'risk events are admin-only';
  assert (select count(*) from public.verified_entities) = 1, 'claimant sees the entity linked to its case';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000202","role":"authenticated","email":"landlord-b@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verified_entities) = 0, 'unlinked organizations cannot see entities';
end $$;

-- Platform registry check verifies the entity.
reset role;
reset request.jwt.claims;
update public.verified_entities set verified = true where id = 'e1000000-0000-4000-8000-000000000201';
do $$ begin
  assert (select verified_at from public.verified_entities where id = 'e1000000-0000-4000-8000-000000000201') is not null, 'platform verification stamps verified_at';
end $$;

rollback;
