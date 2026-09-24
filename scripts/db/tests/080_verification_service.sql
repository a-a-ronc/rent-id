-- Guarantees the Supabase-backed verification service (src/lib/services/
-- verification.ts) depends on, beyond what 030 covers:
--
--   * the three supplements added by 20260915000810
--     (queue_verification_case_for_review, record_verification_risk_event,
--      require_property_reverification) and the admin review-queue read of
--     `properties`, with their refusals;
--   * the read shapes the service actually issues under RLS — the reused-
--     document lookup, the permissionsFor lookup, and what a signed-out
--     visitor on the public listing / apply pages can and cannot select.
--
-- One transaction, rolled back at the end. Literal ids because psql :'vars'
-- do not interpolate inside $$ blocks.
--
--   users  O 00000000-0000-4000-8000-000000000301  landlord, owns org O + properties 1/2/3
--          R 00000000-0000-4000-8000-000000000302  property manager, owns org R
--          T 00000000-0000-4000-8000-000000000303  tenant of property 1
--          A 00000000-0000-4000-8000-000000000304  RentID admin
--          S 00000000-0000-4000-8000-000000000305  unrelated landlord, owns org S + property 4
--   cases  C1 c0000000-0000-4000-8000-000000000301 (property 1, O)
--          C2 c0000000-0000-4000-8000-000000000302 (property 2, O)
--          C3 c0000000-0000-4000-8000-000000000303 (property 4, S)
\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000301', 'owner-o@test.rentid',    '{"full_name":"Owner O","role":"landlord"}'),
  ('00000000-0000-4000-8000-000000000302', 'rep-r@test.rentid',      '{"full_name":"Rep R","role":"property_manager"}'),
  ('00000000-0000-4000-8000-000000000303', 'tenant-t3@test.rentid',  '{"full_name":"Tenant T","role":"tenant"}'),
  ('00000000-0000-4000-8000-000000000304', 'admin-a@test.rentid',    '{"full_name":"Admin A","role":"admin"}'),
  ('00000000-0000-4000-8000-000000000305', 'stranger-s@test.rentid', '{"full_name":"Stranger S","role":"landlord"}');
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000304', 'admin');

insert into public.organizations (id, name, owner_id, kind) values
  ('60000000-0000-4000-8000-000000000301', 'O Holdings',   '00000000-0000-4000-8000-000000000301', 'landlord'),
  ('60000000-0000-4000-8000-000000000302', 'R Management', '00000000-0000-4000-8000-000000000302', 'property_manager'),
  ('60000000-0000-4000-8000-000000000303', 'S Rentals',    '00000000-0000-4000-8000-000000000305', 'landlord');
insert into public.organization_members (organization_id, user_id, role) values
  ('60000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000301', 'landlord'),
  ('60000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000302', 'property_manager'),
  ('60000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000305', 'landlord');
insert into public.properties (id, organization_id, name, street_address, city, state, zip, normalized_address, county, parcel_number) values
  ('10000000-0000-4000-8000-000000000301', '60000000-0000-4000-8000-000000000301', 'Orchard House', '31 Orchard St', 'Ogden', 'UT', '84401', '31 orchard st|ogden|ut|84401', 'Weber', '01-001-0001'),
  ('10000000-0000-4000-8000-000000000302', '60000000-0000-4000-8000-000000000301', 'Orchard Rear',  '33 Orchard St', 'Ogden', 'UT', '84401', '33 orchard st|ogden|ut|84401', 'Weber', '01-001-0002'),
  ('10000000-0000-4000-8000-000000000303', '60000000-0000-4000-8000-000000000301', 'Never Claimed', '35 Orchard St', 'Ogden', 'UT', '84401', '35 orchard st|ogden|ut|84401', 'Weber', '01-001-0003'),
  ('10000000-0000-4000-8000-000000000304', '60000000-0000-4000-8000-000000000303', 'S Bungalow',    '7 Stranger Ln', 'Logan', 'UT', '84321', '7 stranger ln|logan|ut|84321', 'Cache', '02-002-0002');
insert into public.units (id, property_id, name, monthly_rent) values
  ('20000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000301', 'Main', 1500);
insert into public.tenancies (id, organization_id, property_id, unit_id, tenant_user_id, tenant_name, tenant_email, status, monthly_rent) values
  ('30000000-0000-4000-8000-000000000301', '60000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000301',
   '20000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000303', 'Tenant T', 'tenant-t3@test.rentid', 'active', 1500);
-- What the county record says (platform-imported).
insert into public.property_ownership_records (property_id, owner_party_type, raw_owner_name, normalized_owner_name, ownership_capacity, recorded_at, source_type, source_provider) values
  ('10000000-0000-4000-8000-000000000301', 'individual', 'OWNER O', 'owner o', 'sole_owner', '2020-04-01', 'recorded_document', 'county-recorder');

-- ------------------------------------- 1. openPropertyClaim(): insert only
-- The service inserts the case and lets the trigger do the rest; it must not
-- write the relationship or the history row itself.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated","email":"owner-o@test.rentid"}';
insert into public.verification_cases (id, property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
  values ('c0000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000301', '60000000-0000-4000-8000-000000000301',
          '00000000-0000-4000-8000-000000000301', 'Owner O', 'individual_owner', 'collecting_evidence', '1.0.0');
do $$ begin
  assert (select count(*) from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000301') = 1,
    'the trigger creates exactly one relationship row — the service must not insert a second';
  assert (select count(*) from public.verification_status_events where case_id = 'c0000000-0000-4000-8000-000000000301') = 1,
    'the trigger writes exactly one history row for the opened case';
  -- readCase() after the insert
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000301') = 'collecting_evidence',
    'a claim opens in a pre-verification state';
end $$;

-- ------------------------- 2. runAutomatedChecks(): park the case, nothing else
do $$ begin
  perform public.queue_verification_case_for_review(
    'c0000000-0000-4000-8000-000000000301',
    'Recorded deed search is not configured yet. This case needs manual review.');
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000301') = 'manual_review',
    'an unautomatable claim is parked with a human';
  assert (select count(*) from public.verification_status_events
           where case_id = 'c0000000-0000-4000-8000-000000000301' and action = 'verification.automated_checks'
             and from_status = 'collecting_evidence' and to_status = 'manual_review') = 1,
    'parking the case is in the append-only history';
  -- idempotent: running the checks again adds no status and no history noise
  perform public.queue_verification_case_for_review('c0000000-0000-4000-8000-000000000301', 'again');
  assert (select count(*) from public.verification_status_events
           where case_id = 'c0000000-0000-4000-8000-000000000301' and action = 'verification.automated_checks') = 1,
    'a case already with a human is left alone';
  -- and it is still the only way in: the client cannot write a status by hand
  update public.verification_cases set status = 'ownership_verified' where id = 'c0000000-0000-4000-8000-000000000301';
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000301') = 'manual_review',
    'the claimant still cannot move its own case';
end $$;

-- ------------------------------ 3. reused-document lookup (submitEvidence)
-- The service looks for the same document summary on another case it can see.
insert into public.verification_cases (id, property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
  values ('c0000000-0000-4000-8000-000000000302', '10000000-0000-4000-8000-000000000302', '60000000-0000-4000-8000-000000000301',
          '00000000-0000-4000-8000-000000000301', 'Owner O', 'individual_owner', 'collecting_evidence', '1.0.0');
insert into public.verification_evidence (case_id, proposition, evidence_type, summary, submitted_by) values
  ('c0000000-0000-4000-8000-000000000301', 'property', 'recorded_deed', 'Warranty deed, April 2020', '00000000-0000-4000-8000-000000000301'),
  ('c0000000-0000-4000-8000-000000000302', 'property', 'recorded_deed', 'Warranty deed, April 2020', '00000000-0000-4000-8000-000000000301');
do $$ begin
  assert (select count(*) from public.verification_evidence
           where summary = 'Warranty deed, April 2020' and case_id <> 'c0000000-0000-4000-8000-000000000302') = 1,
    'the claimant sees the same document on another of its own cases';
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000302') = 'manual_review',
    'submitted evidence sends the case to a human (trigger, not the service)';
end $$;

-- An unrelated landlord's identical document stays invisible: cross-account
-- reuse is a platform sweep, not something the browser can see.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000305","role":"authenticated","email":"stranger-s@test.rentid"}';
insert into public.verification_cases (id, property_id, organization_id, claimant_user_id, claimant_name, claim_relationship, status, rules_version)
  values ('c0000000-0000-4000-8000-000000000303', '10000000-0000-4000-8000-000000000304', '60000000-0000-4000-8000-000000000303',
          '00000000-0000-4000-8000-000000000305', 'Stranger S', 'individual_owner', 'collecting_evidence', '1.0.0');
insert into public.verification_evidence (case_id, proposition, evidence_type, summary, submitted_by)
  values ('c0000000-0000-4000-8000-000000000303', 'property', 'recorded_deed', 'Warranty deed, April 2020', '00000000-0000-4000-8000-000000000305');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated","email":"owner-o@test.rentid"}';
do $$ begin
  assert (select count(*) from public.verification_evidence where summary = 'Warranty deed, April 2020') = 2,
    'the claimant sees only its own two copies, never the stranger''s';
end $$;

-- --------------------------------------------- 4. recordRiskEvent() the RPC
do $$ declare e public.verification_risk_events%rowtype; begin
  perform public.record_verification_risk_event(
    '10000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-000000000301',
    'reused_document', 'medium', 'The same supporting document was submitted for another property.');
  assert (select count(*) from public.verification_risk_events) = 0,
    'the filer still cannot read risk events back — they are admin-only';
  begin
    insert into public.verification_risk_events (property_id, kind, detail)
      values ('10000000-0000-4000-8000-000000000301', 'identity_reuse', 'x');
    raise exception 'ASSERT FAILED: client inserted a risk event directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_verification_risk_event(null, null, 'not_a_real_signal', 'medium', 'x');
    raise exception 'ASSERT FAILED: unknown risk kind accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_verification_risk_event(null, null, 'identity_reuse', 'catastrophic', 'x');
    raise exception 'ASSERT FAILED: unknown severity accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.record_verification_risk_event(null, null, 'identity_reuse', 'low', '   ');
    raise exception 'ASSERT FAILED: risk signal without a detail accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;
-- a signal can only be filed about a case/property the caller is a party to
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000305","role":"authenticated","email":"stranger-s@test.rentid"}';
do $$ begin
  begin
    perform public.record_verification_risk_event(null, 'c0000000-0000-4000-8000-000000000301', 'reused_document', 'high', 'x');
    raise exception 'ASSERT FAILED: risk signal filed on someone else''s case';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_verification_risk_event('10000000-0000-4000-8000-000000000301', null, 'identity_reuse', 'high', 'x');
    raise exception 'ASSERT FAILED: risk signal filed on someone else''s property';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
reset request.jwt.claims;
do $$ declare e public.verification_risk_events%rowtype; begin
  select * into e from public.verification_risk_events where kind = 'reused_document';
  assert e.user_id = '00000000-0000-4000-8000-000000000301', 'the signal is pinned to the caller, never to another user';
  assert e.case_id = 'c0000000-0000-4000-8000-000000000301' and e.property_id = '10000000-0000-4000-8000-000000000301',
    'the signal keeps its case and property';
  assert e.severity = 'medium' and e.resolved_at is null, 'severity is carried through, unresolved';
  assert e.metadata ->> 'reported_by' = 'client',
    'a client-reported signal is labelled as such so a reviewer never reads it as a platform finding';
  assert (select count(*) from public.verification_risk_events) = 1, 'the refused calls wrote nothing';
end $$;

-- ------------------------- 5. the review queue can see its property (0810)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000304","role":"authenticated","email":"admin-a@test.rentid"}';
do $$ begin
  assert exists (select 1 from public.properties where id = '10000000-0000-4000-8000-000000000301'),
    'a reviewer reads the property a case is about (name + address in the queue)';
  assert not exists (select 1 from public.properties where id = '10000000-0000-4000-8000-000000000303'),
    'and only that one: a property with no verification case stays invisible to an admin';
  assert (select count(*) from public.verification_cases) = 3, 'a reviewer sees every open case';
  -- the review read is SELECT only: no update policy matches, so this changes nothing
  update public.properties set name = 'Renamed by admin' where id = '10000000-0000-4000-8000-000000000301';
  assert (select name from public.properties where id = '10000000-0000-4000-8000-000000000301') = 'Orchard House',
    'a reviewer reads the property but never writes to it';
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000305","role":"authenticated","email":"stranger-s@test.rentid"}';
do $$ begin
  assert not exists (select 1 from public.properties where id = '10000000-0000-4000-8000-000000000301'),
    'the review read is admin-only';
end $$;

-- ------------------------------------ 6. decideVerificationCase() + badge
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000304","role":"authenticated","email":"admin-a@test.rentid"}';
select public.decide_verification_case('c0000000-0000-4000-8000-000000000301', 'verify_ownership', 'Recorded deed and identity match the claimant.') as decided \gset
do $$ declare r public.property_party_relationships%rowtype; begin
  assert (select status from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000301') = 'ownership_verified',
    'only the RPC issues the badge';
  select * into r from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000301';
  assert r.status = 'ownership_verified' and r.recorded_owner_name = 'OWNER O',
    'the badge carries the recorded owner name the public read model shows';
end $$;

-- What a signed-out visitor (public listing / apply page) can actually read.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert (select count(*) from public.property_party_relationships
           where property_id = '10000000-0000-4000-8000-000000000301') = 1,
    'getPropertyBadges(): anon reads the verified badge row';
  assert (select recorded_owner_name from public.property_party_relationships
           where property_id = '10000000-0000-4000-8000-000000000301') = 'OWNER O',
    'and the owner name behind it, which is all the anon verification_version is built from';
  assert (select count(*) from public.property_party_relationships
           where property_id = '10000000-0000-4000-8000-000000000302') = 0,
    'an unverified property shows anon nothing at all';
  -- everything else in the read model is skipped when signed out, because it
  -- is not merely filtered for anon — it is not granted
  begin
    perform count(*) from public.representative_authorizations;
    raise exception 'ASSERT FAILED: anon read representative authorizations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.property_ownership_records;
    raise exception 'ASSERT FAILED: anon read ownership records';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.properties;
    raise exception 'ASSERT FAILED: anon read properties';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------- 7. permissionsFor() reads a live grant only
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated","email":"owner-o@test.rentid"}';
insert into public.representative_authorizations (id, property_id, owner_user_id, owner_name, representative_user_id, representative_organization_id, representative_name, permissions)
  values ('f0000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000301', 'Owner O',
          '00000000-0000-4000-8000-000000000302', '60000000-0000-4000-8000-000000000302', 'R Management', '{manage_listing,manage_property_records}');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000302","role":"authenticated","email":"rep-r@test.rentid"}';
do $$ begin
  assert (select count(*) from public.representative_authorizations
           where property_id = '10000000-0000-4000-8000-000000000301'
             and representative_user_id = '00000000-0000-4000-8000-000000000302'
             and status = 'active' and revoked_at is null) = 0,
    'permissionsFor() finds nothing while the invitation is pending';
end $$;
update public.representative_authorizations set status = 'active' where id = 'f0000000-0000-4000-8000-000000000301';
do $$ declare perms text[]; begin
  select a.permissions into perms from public.representative_authorizations a
   where a.property_id = '10000000-0000-4000-8000-000000000301'
     and a.representative_user_id = '00000000-0000-4000-8000-000000000302'
     and a.status = 'active' and a.revoked_at is null;
  assert perms = '{manage_listing,manage_property_records}', 'permissionsFor() reads the accepted grant';
  assert (select granted_at is not null from public.representative_authorizations where id = 'f0000000-0000-4000-8000-000000000301'),
    'acceptAuthorization() lets the trigger stamp granted_at';
end $$;

-- ----------------------------------------- 8. requireReverification() (0810)
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated","email":"owner-o@test.rentid"}';
do $$ begin
  begin
    perform public.require_property_reverification('10000000-0000-4000-8000-000000000301', 'I sold it');
    raise exception 'ASSERT FAILED: a landlord suspended its own verification';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000304","role":"authenticated","email":"admin-a@test.rentid"}';
do $$ begin
  begin
    perform public.require_property_reverification('10000000-0000-4000-8000-000000000301', '  ');
    raise exception 'ASSERT FAILED: re-verification required without a reason';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.require_property_reverification('10000000-0000-4000-8000-000000000399', 'unknown property');
    raise exception 'ASSERT FAILED: re-verification required on a property that does not exist';
  exception when no_data_found then null;
  end;
end $$;
select public.require_property_reverification('10000000-0000-4000-8000-000000000301', 'Recorded transfer to a new owner.') as touched \gset
do $$ declare c public.verification_cases%rowtype; r public.property_party_relationships%rowtype; begin
  select * into c from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000301';
  assert c.status = 'suspended', 'a live badge is suspended until it is re-verified';
  assert c.reverification_required, 'and the case is flagged for a new look';
  select * into r from public.property_party_relationships where case_id = 'c0000000-0000-4000-8000-000000000301';
  assert r.status = 'suspended' and r.revoked_at is null, 'the badge relationship is suspended, not erased';
  assert (select reverification_required from public.verification_cases where id = 'c0000000-0000-4000-8000-000000000302') = false,
    'another property''s case is untouched';
  assert (select count(*) from public.verification_status_events
           where property_id = '10000000-0000-4000-8000-000000000301'
             and action = 'verification.reverification_required' and to_status = 'suspended') = 1,
    're-verification is in the append-only history';
  assert (select count(*) from public.audit_logs
           where action = 'property_verification.reverification_required'
             and entity_id = '10000000-0000-4000-8000-000000000301') = 1,
    're-verification is in audit_logs';
end $$;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  assert (select count(*) from public.property_party_relationships) = 0,
    'the public badge is gone the moment re-verification is required';
end $$;

rollback;
