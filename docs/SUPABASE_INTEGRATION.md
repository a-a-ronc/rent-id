# RentID — backend integration checklist _(completed — historical)_

> **This document describes the mock-data era and is kept only as a record of
> how the backend was connected.** Every service listed here now runs real,
> RLS-scoped Supabase queries. For the current architecture see the
> [README](../README.md); for the security posture see [SECURITY.md](SECURITY.md).

---

The app currently runs entirely on a local mock data layer so no alternative
backend is introduced while the database is unavailable. Nothing in the UI talks
to a datasource directly, so connecting the real backend is a swap of service
bodies, not a rewrite.

## Architecture today

```text
routes / components
        │  (only hooks)
src/lib/rentid.ts          React Query hooks
        │
src/lib/services/*         auth · portfolio · tenancies · finance · operations
        │
src/lib/mock/db.ts         in-memory DB persisted to localStorage
src/lib/mock/seed.ts       centralized demo portfolio + demo credentials
```

- `src/lib/types.ts` holds the entity models (UUID ids, ISO timestamps) that
  mirror the planned SQL tables exactly.
- `src/lib/auth.tsx` exposes `useAuth` / `useProfile` / `useRoles` with the same
  shape a real session provider gives, so only this file and
  `src/lib/services/auth.ts` change when live auth returns.
- `supabase/planned/0001_schema.sql` — proposed schema (not applied).
- `supabase/planned/0002_rls.sql` — proposed RLS policies (not applied).

## Checklist — run in this order

1. **Connect the project.** Confirm the environment provides the project URL and
   publishable key; do not hand-edit generated integration files.
2. **Review and apply migrations.** Apply `supabase/planned/0001_schema.sql` as
   the first migration. Every `CREATE TABLE` in `public` already has its
   `GRANT` block; keep them in the same migration.
3. **Apply RLS.** Apply `supabase/planned/0002_rls.sql`. Verify each table
   reports RLS enabled and that no policy grants `anon` access to tenancy data.
4. **Enable authentication.** Email + password first, Google after. Do not
   enable anonymous sign-ups or email auto-confirm.
5. **Create storage.** Private `documents` bucket, paths
   `<organization_id>/<tenancy_id>/<file>`; the storage policies live in the RLS
   file.
6. **Replace the service bodies.** One file at a time, keeping signatures
   identical:
   - `services/auth.ts` → real session, profile row, `user_roles` read
   - `services/portfolio.ts` → organizations, properties, units
   - `services/tenancies.ts` → tenancies, invitations, verification
   - `services/finance.ts` → payments, dashboard metrics
   - `services/operations.ts` → leases, documents, maintenance, messaging
     Invitation acceptance must move to a server function (it writes a tenancy the
     caller does not yet own, which client RLS correctly refuses).
7. **Delete the mock layer.** Remove `src/lib/mock/` and the demo-notice copy
   once every service is live.
8. **Test landlord access:** sign up, onboard, create property, add unit.
9. **Test tenancy creation:** invite a tenant, accept from a second account,
   confirm the tenancy is active and verified and the unit shows occupied.
10. **Test lease upload:** upload a lease, confirm it associates with unit and
    tenant and appears on both the landlord and tenant screens.
11. **Test tenant access:** confirm a tenant sees only their own tenancy,
    lease, documents, payments and messages, and cannot read another tenancy.
12. **Test property-manager access:** a member of one organization must see
    nothing from another.
13. **Audit:** run the database linter, review every policy, and confirm admin
    actions write `audit_logs` rows.

## Explicitly out of scope for this milestone

Stripe / live payments / autopay, credit screening, background checks,
reputation scoring, AI tenant scores, native apps, marketplace listings,
QuickBooks.

## Student-housing layer (business map §25-§38)

The student vertical is a _category_, not a second product: `properties.management_category`
switches it on, and everything else hangs off the same identity/property/lease/payment graph.

When the backend is reachable:

1. Apply `supabase/planned/0001_schema.sql` (includes the student tables at the end)
   and then `0002_rls.sql` (includes `can_operate_property`, `is_my_occupancy` and the
   student policies).
2. Replace the bodies in `src/lib/services/student.ts` with queries. Signatures stay the
   same, so no screen changes.
3. Non-negotiables to preserve server-side:
   - `ledger_events`, `approval_steps` and `payment_allocations` are insert-only.
   - `charges` (obligation) stay separate from `payers` (funding source); paying never
     makes someone a lease party.
   - `student_payments.processed_by_rentid = false` is a _recorded_ external payment and
     must never be shown as processed by RentID.
   - A lease change only becomes effective when approvals, documents, signatures and money
     are all complete; `replacement_listing_enabled` gates any public replacement listing.
   - A roommate must never read another roommate's charges, payments or ledger events.
4. Verify with the student demo account (`student@rentid.demo`) that `/tenant/housing`
   shows only that resident's money.

## Listing syndication when partner access is approved

1. Apply the listing/channel/lead/sync tables from `supabase/planned/0001_schema.sql`
   and the policies from `0002_rls.sql`.
2. Store partner credentials as project secrets (never in code): one secret per
   marketplace, plus a feed URL where the partner uses feed ingestion.
3. Implement the partner adapter in `src/lib/syndication/adapters.ts` — replace the
   pending stub's `pending_integration` result with real API/feed calls made from a
   server function only. Only official APIs and approved feeds; no scraping and no
   unofficial posting.
4. Flip the channel's `connection_status` to `connected` once credentials verify;
   existing published listings then resync through the same code path.
5. Lead capture on public pages moves to a server function using the service role
   (no anon insert policy on `listing_leads`).

## Property ownership & authorized representative verification

Files: `supabase/planned/0003_property_verification.sql`,
`0004_property_verification_rls.sql`, `src/lib/verification-types.ts`,
`src/lib/verification/address.ts`, `src/lib/verification/providers.ts`,
`src/lib/services/verification.ts`.

1. Apply `0003_property_verification.sql`, then `0004_property_verification_rls.sql`.
2. Create the PRIVATE storage bucket `verification-evidence`. No public access; the
   app serves documents through short-lived signed URLs after
   `can_view_property_verification()` passes.
3. Configure providers in `src/lib/verification/providers.ts` — each one is
   `not_configured` today and every provider returns `ok: false`, which makes claims
   fail closed into manual review:
   - recorded documents (PRIMARY ownership evidence) from the recording authority;
   - assessor / parcel / GIS datasets (SUPPORTING only, never sufficient alone);
   - business registry lookups for entity ownership;
   - identity verification for the claimant;
   - document authenticity checks for uploads.
     Official APIs, licensed data, or manual review only — no scraping and no
     circumvention of access controls.
4. Non-negotiables to preserve server-side:
   - Verification is per property. A verified property never verifies another
     property, another user, or a whole portfolio.
   - Three propositions (property identity, claimant identity, authority) stay
     separate; never combine them into a single score.
   - Only two positive public badges exist: `Property Ownership Verified` and
     `Authorized Representative for Property`. Absence of a badge shows the neutral
     line "Property ownership has not been verified by RentID." — never an
     "Unverified" badge.
   - Claimants can open a case and submit evidence; only admin review or a
     verified provider chain can move a case to a verified status.
   - Uploaded documents are `user_upload` / `unverified` until a reviewer checks them.
   - Recent-purchase precedence: the most recently recorded deed wins over stale
     assessor data.
   - Trustee/executor capacity contradicts a personal-ownership claim — hard
     contradiction, manual review, no badge.
   - Representative authorizations are property-specific, permission-scoped,
     revocable and optionally expiring; revocation removes badge and permissions
     immediately while history is retained.
   - The tenant disclosure is shown once per tenant + property + payee +
     disclosure version + verification version, before application, lease or
     payment. A payee or verification change re-triggers it.
   - Evidence, identity data and risk events are never readable by tenants or
     anonymous callers.
   - **Never issue a production badge from mock or sandbox data.** The demo records in
     `src/lib/mock/verification-seed.ts` exist only for the local demo workspace.
5. Reverification: `verification_cases.reverify_after` drives periodic checks; a
   deed change, payout change or ownership dispute suspends the badge until review.
6. Admin review queue is `/admin/verification` (admin role only, every decision
   stored with reviewer id and reason plus an append-only status history).
