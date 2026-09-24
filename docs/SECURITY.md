# RentID security posture

RentID holds three things that make it a target: money in motion, bank payout
destinations, and a rental history that decides whether someone gets housing.
The third is the one people underestimate — a corrupted history record does
lasting harm to a real person long after the incident is closed.

This document is the honest state of the system: what is enforced today, where
it is enforced, and what is still open. It is written to be read by an engineer
joining the project and by a payment partner's diligence team.

---

## 1. The one principle

**The database, not the application, is the security boundary.**

Every table has row-level security on, every policy denies by default, and the
browser talks to Postgres directly through PostgREST with the signed-in user's
JWT. A bug in a React component, a tampered request from a modified client, or
a service function someone forgets to guard cannot read or write another
tenant's data, because the permission check does not live in the code that a
client can influence.

`supabase/migrations/20260915000600_security_hardening.sql` ends with a check
that fails the migration if any table in `public` lacks RLS. That is the one
mistake that has sunk comparable products, so it is impossible to make here by
accident.

Enforcement is proven, not asserted: `scripts/db/tests/*.sql` are nine suites
that impersonate real users (`set local role authenticated` plus a JWT claims
string) and assert what each one can and cannot do. They run in CI against a
real Postgres 16 on every push.

---

## 2. Identity and access

| Concern                                      | How it works                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords                                    | Supabase Auth (GoTrue), bcrypt. RentID never sees a password. Minimum 12 characters, enforced client- and server-side.                                                                                                                                                                                          |
| Sessions                                     | JWT, short-lived access token with refresh. Route guards are UX only; RLS is the real gate.                                                                                                                                                                                                                     |
| Roles                                        | `public.user_roles`, a separate table — never a column on the profile, which is the classic privilege-escalation hole. A user may self-assign tenant / landlord / property_manager; **admin can never be self-assigned** (RLS `with check` refuses it, and the signup trigger filters it out of user metadata). |
| Admin actions on money and platform settings | Require a second factor. `is_admin_mfa()` checks `has_role(admin)` **and** JWT `aal = aal2`, so an admin session without a TOTP challenge cannot change the fee schedule or read raw payment events.                                                                                                            |
| Organization membership                      | `is_org_member()` — a SECURITY DEFINER function, so member policies cannot recurse. Every landlord/PM policy routes through it.                                                                                                                                                                                 |
| Property-manager access                      | Only after the owning organization confirms the assignment. A PM cannot self-verify its own authority; revoking it removes read access immediately.                                                                                                                                                             |

---

## 3. What is never stored

The cheapest way to not leak something is not to have it.

| Data                                      | Where it lives instead                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank account + routing numbers            | The payment provider. `payout_accounts` holds a provider token, a nickname, and the last four digits. A trigger **rejects** any `provider_account_ref` that looks like an 8–17 digit account number, so a careless integration cannot quietly start storing them. |
| Card numbers / CVV                        | The provider's hosted fields. RentID's servers never see card data, which keeps the company out of PCI-DSS scope beyond SAQ-A.                                                                                                                                    |
| Government ID numbers, ID images, selfies | The identity provider. RentID stores the provider's reusable reference, the result, and the timestamp — `20260915000400_property_verification.sql` is explicit that raw documents are not retained when the provider offers a token.                              |
| Credit reports and screening results      | The screening partner, behind a consent record. RentID stores that a check was run, when, and its disposition.                                                                                                                                                    |
| Passwords                                 | Hashed by GoTrue.                                                                                                                                                                                                                                                 |

For the small set of references that must be stored but should be unreadable in
a dump — provider webhook secrets, identity subject references — there is
`src/lib/crypto/envelope.ts`: AES-256-GCM, a fresh data key per value wrapped
under a master key from the environment (a KMS in production), with the record
identity bound in as additional authenticated data so a ciphertext cannot be
moved between rows. Keys rotate by listing the new key first and keeping the
old ones; `rewrap()` migrates values without downtime.

---

## 4. Encryption

| Layer                       | Status                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In transit, browser → app   | TLS 1.2+, HSTS `max-age=63072000; includeSubDomains; preload`.                                                                                                                                              |
| In transit, app → database  | TLS, enforced by the platform.                                                                                                                                                                              |
| At rest, database           | AES-256, managed by the platform, including backups.                                                                                                                                                        |
| At rest, uploaded documents | Private storage bucket, encrypted at rest. No public URLs anywhere: access is a signed URL with a five-minute expiry, issued only after the RLS policy on the `documents` row has already allowed the read. |
| Field level                 | `src/lib/crypto/envelope.ts` for the references above.                                                                                                                                                      |
| Key management              | `RENTID_ENCRYPTION_KEYS` holds `<key-id>:<base64 32 bytes>` entries, newest first. Move this to a KMS before processing real money.                                                                         |

---

## 5. Application hardening

`src/lib/security-headers.ts`, applied to every response including error pages:

- **CSP** limited to the app's own origin plus the Supabase project. No wildcards. `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` in production. `'unsafe-eval'` only in dev.
- **HSTS** two years, includeSubDomains, preload.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera, microphone, geolocation and payment, `Cross-Origin-Opener-Policy: same-origin`.

Also in place:

- **CSRF** middleware on every server function (`src/start.ts`).
- **Rate limits in the database**, so they hold no matter which client calls: 10 invitation-acceptance attempts per hour per user (token guessing — and acceptance _soft-fails_ so a wrong token still counts against the limit, which a thrown exception would have rolled back), 20 applications per day, 30 leads per hour, 50 invitations per day.
- **Input validation** with zod at the server-function boundary; PostgREST parameterizes everything, so SQL injection is not reachable through the data path, and the few places that build a filter string validate the input against a character class first.
- **File uploads**: 25 MB cap, mime allowlist (pdf, png, jpeg, webp, heic, doc, docx), content type taken from the file rather than the extension, stored under `<organization-id>/<uuid>-<name>` so the storage policy can authorize by path prefix.

---

## 6. Integrity of the rental history

This is the part that is specific to RentID rather than generic web security.

**A payment is verified only if the platform settled it.** `payments.verified`
is derived by a trigger from `verification_source`, which a client can only set
to `landlord_reported` or `tenant_reported`. `platform_settled`, `bank_linked`
and `imported` are refused unless the caller is the service role — that is,
the webhook handler or a settlement job. A landlord clicking "mark paid"
produces a landlord-reported record, clearly labelled, which is honest and
still useful, but it is not the verified badge another landlord will rely on.

**Verified history is append-only for clients.** A settled payment cannot be
downgraded, re-amounted, re-pointed at another tenancy or deleted; only the
memo stays editable. A verified tenancy cannot be deleted or soft-deleted, only
ended. Reviews are editable for one hour, then withdraw-only, and never
deletable. `ledger_entries`, `audit_logs` and `verification_status_events` have
triggers that reject `UPDATE` and `DELETE` outright.

**A tenancy is verified only when both parties confirm it.** The landlord
creates it; the flag flips inside `accept_invitation()` when the tenant accepts
from their own account. Neither side can set it by hand, and a tenancy with no
tenant account can never be verified.

**Ownership badges come from one place.** `decide_verification_case()` is the
only path that marks a property relationship verified, it is admin- or
platform-only, it requires a reason, and it writes a status event and an audit
row every time. An organization cannot verify its own property. Evidence
documents are never readable by tenants. Every identity/records provider is
currently `not_configured` and the system **fails closed** — no provider, no
badge, the case waits for a human.

**An applicant cannot forge their history.** When a tenant shares their profile
with an application, the passport snapshot is computed server-side from their
own account at insert time and then frozen. A client that posts
`{"verified_payments": 999}` gets it overwritten.

---

## 7. Auditability

`audit_logs` is append-only and carries actor, action, entity, and metadata.
Money movement additionally writes `ledger_entries` (also append-only) and a
`verification_records` row. Verification decisions write
`verification_status_events`. The internal principle from the business map — no
staff member can silently alter payment history, review status, damage records
or relationship history — is enforced by triggers, not by policy documents.

---

## 8. CI

Every push runs: typecheck, lint, 545 unit tests, production build, all nine
SQL security suites against a real Postgres 16, and `bun audit` for known
vulnerable dependencies. A dependency with a known high-severity advisory fails
the build.

---

## 9. What is NOT done yet

Stating this plainly is part of the posture.

1. **No penetration test.** Budget one before real money moves.
2. **CSP still allows `'unsafe-inline'` for scripts**, because TanStack Start streams hydration state as inline script tags. Moving to per-request nonces is the fix.
3. **No WAF / edge rate limiting.** The database limiter stops abuse of specific endpoints; it does not stop a volumetric attack. Cloudflare in front of the app closes this.
4. **No secret scanning or automated dependency upgrades** (Dependabot/Renovate + gitleaks) — one afternoon of work.
5. **No formal incident-response runbook** and no on-call. Needed before a payment partner will sign.
6. **No SOC 2.** Not required to launch; will be required by any property-management company above a few hundred units. The controls above are most of the evidence, but the process (access reviews, vendor management, change management) does not exist yet.
7. **FCRA exposure is unreviewed.** The moment landlord-authored reviews and verified payment history influence a leasing decision, RentID is arguably a consumer reporting agency, which brings accuracy, dispute, and adverse-action obligations. **Get a lawyer's opinion before the reviews feature ships.** The dispute workflow is built; the legal framing is not.
8. **Backups are the platform's defaults.** Set an explicit retention and, more importantly, _test a restore_.
9. **The `anon` role can read published listings and public verification badges.** That is intentional, and deliberately narrow: `20260915000600` revokes everything else from `anon` and re-grants only those, plus three aggregate-only functions.
10. **No MFA requirement for landlords and PMs**, only for admins. Worth revisiting once a payout account can be changed from the UI — that is the step an account takeover would target.

---

## 10. If something happens

1. Rotate `SUPABASE_SERVICE_ROLE_KEY` and `RENTID_ENCRYPTION_KEYS` (add the new key first, rewrap, then drop the old one).
2. `audit_logs`, `ledger_entries` and `payment_events` are append-only — they are the forensic record, and they cannot have been edited by an attacker using the app's own credentials.
3. Suspend affected payout accounts (`status = 'disabled'`) before suspending user accounts; the money path matters more than the login path.
4. Utah requires notification of affected residents for breaches of personal information; several other states' rules apply based on where the affected renters live, not where the company is.
