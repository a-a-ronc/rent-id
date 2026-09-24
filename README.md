<div align="center">

# RentID

**Rent history that belongs to the renter.**

A rental-identity network: verified tenancies, portable payment history, rent
collection, and the property-management tools around them.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TanStack Start](https://img.shields.io/badge/TanStack%20Start-1.168-FF4154?logo=reactquery&logoColor=white)](https://tanstack.com/start)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)

</div>

---

## The problem

A renter can pay rent on time for six years and arrive at their next application
with nothing to show for it. The landlord who watched them do it has no way to
vouch that scales, and the next landlord has no reason to believe a PDF of bank
statements.

RentID makes that history **portable and verifiable** — and, critically, makes
it mean something.

## The one idea that matters

> **A payment is verified only if the platform settled it.**

`payments.verified` is not a column anyone can write. It is derived by a
database trigger from `verification_source`, and a client can only ever assert
`landlord_reported` or `tenant_reported`. `platform_settled` is reserved for the
service role — the webhook handler that watched money actually move.

A landlord clicking "mark paid" produces a landlord-reported record. That is
honest, and still useful. It is not the badge another landlord will rely on.

The same principle runs through the rest of the trust model:

| Guarantee                                                   | How it is enforced                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A tenancy is verified only when **both** parties confirm it | The flag flips inside `accept_invitation()` when the tenant accepts from their own account               |
| Verified history is **append-only** for clients             | Settled payments can't be downgraded, re-amounted or deleted; verified tenancies can only be ended       |
| An applicant can't inflate their own record                 | The passport snapshot is computed server-side at insert, then frozen                                     |
| Ownership badges come from **one** path                     | `decide_verification_case()`, admin- or platform-only, writes a status event and an audit row every time |
| No one can quietly rewrite the record                       | `ledger_entries`, `audit_logs` and `verification_status_events` reject `UPDATE` and `DELETE` outright    |

---

## Quick start

Requires [Bun](https://bun.sh) and, for the database suites, a local PostgreSQL 16.

```bash
bun install
cp .env.example .env          # fill in your Supabase project values
bun run dev
```

Verify everything before you push:

```bash
bun run check                 # typecheck · lint · 545 unit tests · production build
bun run db:reset              # apply every migration to a local Postgres
bun run test:rls              # 10 SQL security suites against that database
```

---

## Architecture

**The database, not the application, is the security boundary.**

The browser talks to Postgres directly through PostgREST with the signed-in
user's JWT. Every table has row-level security on and every policy denies by
default, so a bug in a React component, a tampered request from a modified
client, or a service function someone forgets to guard cannot reach another
tenant's data — the permission check does not live in code a client can
influence.

`20260915000600_security_hardening.sql` ends with a check that **fails the
migration** if any table in `public` lacks RLS. That is the one mistake that has
sunk comparable products, so it cannot be made here by accident.

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Framework  | TanStack Start 1.168 · TanStack Router (file-based) · React 19    |
| Build      | Vite 8 · Nitro (`cloudflare-module` preset)                       |
| Data       | Supabase — Postgres, Auth, Storage · PostgREST · TanStack Query 5 |
| UI         | Tailwind 4 · Radix primitives · a small in-repo component kit     |
| Validation | zod at every server-function boundary                             |
| Tests      | Vitest (545) · 10 SQL suites run against a real Postgres          |

### Project layout

```
src/
  routes/          55 file-based routes — public, landlord, tenant, manager, admin
  lib/
    services/      11 service modules; the only place that talks to the database
    db/            client wrapper, error handling, Row → domain mappers
    payments/      fee calculation, kept in parity with the SQL by a test
    crypto/        AES-256-GCM envelope encryption with key rotation
    verification/  address and owner-name normalisation for ownership claims
  components/rentid/   the design system and shared patterns
supabase/migrations/   17 migrations — 43 tables, 128 policies
scripts/db/            local Postgres harness: reset, type generation, RLS suites
docs/                  SECURITY.md · SCALING.md · PRODUCT-BRIEF.md
```

Components never touch a datasource. They use hooks from `src/lib/rentid.ts`,
which wrap the service layer, which owns every query.

---

## Scripts

| Command            | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `bun run dev`      | Development server                                            |
| `bun run check`    | Typecheck, lint, unit tests, production build                 |
| `bun run test`     | 545 unit tests                                                |
| `bun run test:rls` | 10 SQL security suites against a local Postgres               |
| `bun run db:reset` | Drop, recreate and migrate the local database                 |
| `bun run db:types` | Regenerate `src/integrations/supabase/types.ts`               |
| `bun run build`    | Production build (emits `.output/server/wrangler.json`)       |
| `bun run deploy`   | Build and deploy to Cloudflare Workers (see `docs/DEPLOY.md`) |

The local harness needs no Docker. `scripts/db/supabase-shim.sql` provides
stand-ins for the `auth` and `storage` schemas so hosted-Supabase migrations
apply to a plain PostgreSQL 16.

---

## Security

`docs/SECURITY.md` is the full posture, written to be read by an engineer
joining the project and by a payment partner's diligence team. The short
version:

- **Nothing sensitive is stored that doesn't have to be.** Bank and card details
  live with the payment provider; RentID holds a token, a nickname and the last
  four digits, and a trigger _rejects_ anything account-number-shaped. ID numbers
  and images stay with the identity provider.
- **Envelope encryption** (AES-256-GCM, per-value data keys, record identity
  bound in as AAD) for the few references that must be stored.
- **MFA** (`aal2`) required for admin actions on money and fee settings.
- **Database-backed rate limits**, so they hold regardless of which client calls.
- **CSP, HSTS** and the rest on every response, including error pages.

That document also carries an explicit list of what is **not** done — no
penetration test, no WAF, no SOC 2 — because a security document that only lists
strengths isn't one.

---

## Status

Verified on every push: `tsc` clean · 545 unit tests · 10 SQL security suites
against PostgreSQL 16 · production build · dependency audit.

**Working:** authentication and roles · properties and units · tenant
invitations and two-sided verification · rent ledger and manual recording ·
maintenance · documents with private storage and signed URLs · listings,
applications and syndication · property-ownership verification · the
management-company vertical.

**Not built yet:** live payment processing (the ledger, fee model, payout tables
and idempotency are in place and waiting on a provider) · reviews and disputes
(tables and policies exist; the UI is gated on an FCRA review) · the
student-housing vertical, which is parked on sample data on purpose.

---

## Documentation

| Document                                         | What's in it                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)               | Supabase, Cloudflare Workers and DNS — step by step                             |
| [`docs/SECURITY.md`](docs/SECURITY.md)           | Threat model, what's enforced and where, and what isn't                         |
| [`docs/SCALING.md`](docs/SCALING.md)             | The current design's real ceiling, with numbers, and what to do when you hit it |
| [`docs/PRODUCT-BRIEF.md`](docs/PRODUCT-BRIEF.md) | The original product brief, kept verbatim                                       |

---

<div align="center">
<sub>rentid.online · private repository</sub>
</div>
