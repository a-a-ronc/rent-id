# Scaling RentID

Honest framing first: RentID has zero users. Most "scale" work at this stage is
waste, and the failure mode that actually kills seed-stage products is spending
six months on architecture for traffic that never arrives.

So this document is deliberately split. Part 1 is what has been done, because
it is cheap now and expensive to retrofit. Part 2 is the ceiling of the current
design with real numbers. Part 3 is what to do when a specific number is hit —
and only then.

---

## 1. What is already in place

### The data model is the asset

Identity, property, relationship, lease, money and history events are separate
tables with independently changeable relationships. An owner can replace a
property manager without losing the property's lease or payment history; a
property keeps its history across an ownership change. That was in the business
map and it is what the schema does. It matters for scale because the expensive
kind of growth is a remodel, and this model does not need one to add a bed-level
student vertical, a second payment provider, or a portfolio-level PM tier.

### Indexes match the queries, not the columns

`supabase/migrations/20260915001000_scale_indexes.sql` adds composite and
partial indexes for the access paths the services actually issue. Two cases
worth calling out:

**Partial indexes on the public marketplace.** Published listings are indexed
separately from the table:

```sql
create index listings_search_idx on public.listings (monthly_rent, available_on)
  where status = 'published' and deleted_at is null;
```

The index a visitor's search touches only ever contains live listings, so it
stays small no matter how much leased history accumulates. Same pattern for
open maintenance, unpaid rent, and the verification queue.

**Indexes under the RLS helpers.** Every policy calls `is_org_member()` or
`is_tenancy_party()`, which run _per candidate row_. Without an index on the
column the helper probes, reads degrade to a sequential scan the moment a table
outgrows a demo dataset. This is the single most common way an RLS-heavy
Postgres app falls over, and it looks like "the database got slow" rather than
"a policy is unindexed".

**Statistics targets.** `organization_id` is in almost every filter and its
distribution is very skewed — a few large PMs, a long tail of one-property
landlords. The default 100-bucket histogram misestimates the large tenants
badly enough to flip the planner to a sequential scan, so those columns are set
to 500.

### Round trips are bounded

Read models are assembled in one PostgREST request with embedded selects rather
than a query per row. A tenancy detail page — property, unit, organization,
lease, payments, maintenance, documents — is one request. The dashboard is four.
The N+1 that would otherwise appear in `getApplications` (one passport per
applicant) is batched.

### Integrity constraints instead of defensive code

One live tenancy per unit, one live listing per unit, one open application per
applicant per listing, no paid payment without a timestamp, no verified payment
without a platform source, no lease ending before it starts. These are unique
partial indexes and check constraints. Writing them now means no batch job ever
has to clean up the state, and no report ever has to guess which of two "active"
tenancies on a unit is real.

### Money is append-only

`ledger_entries` is an immutable journal. Balances are derived, never stored and
mutated. This is what makes reconciliation with a payment provider tractable at
any volume, and it is why settlement is idempotent on
`(provider, provider_reference)` — a webhook delivered three times produces one
set of entries.

---

## 2. The ceiling of the current design

Concrete numbers, because "it scales" is not an answer.

| Dimension                | Current design handles                         | What breaks first                                                                                                                             |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Rent payments            | ~100k/month comfortably on a mid-tier Postgres | Nothing in the schema. The constraint is the payment provider's throughput and your reconciliation staffing.                                  |
| Units under management   | ~500k                                          | The PM portfolio dashboard, which aggregates across all managed properties on every load. Fix: a materialized rollup, refreshed on write.     |
| Listings + public search | ~200k live listings                            | `listings_search_place_idx` stops being selective for a broad "any price in Utah" query. Fix: Postgres full-text or a dedicated search index. |
| Concurrent users         | ~2–5k                                          | PostgREST connection pool. Supabase's Supavisor handles this; the app must use the pooled connection string for serverless.                   |
| Documents                | Unbounded                                      | Nothing — object storage. Watch the bill, not the architecture.                                                                               |
| History depth            | Unbounded reads; writes unaffected             | A tenant with 10 years of payments loads them all on the profile page. Fix: paginate (see below).                                             |

**The honest bottleneck is not the database.** At 100k payments/month RentID is
processing roughly $150M of rent and earning ~$750k/month at 0.5%. Long before
that, the operational load — disputes, returns, verification review, support —
requires people. Plan headcount before shards.

---

## 3. What to do, and when

Ordered by the trigger that should cause you to do it. Do not do these early.

**When any list view can exceed ~200 rows → paginate.**
Cursor pagination on `(created_at, id)`, not `OFFSET`. Offset degrades linearly
and the tenant payment ledger is the first place it will show. The services
already sort on indexed columns, so this is a parameter change plus a "load
more" control, not a rewrite.

**When the PM dashboard exceeds ~300ms → materialize the rollups.**
A `portfolio_metrics` table keyed by organization, updated by trigger on
payment/maintenance writes, replacing the per-load aggregation. Keep the live
query as the source of truth and reconcile nightly so a drifted rollup is
detectable.

**When public search feels slow → `pg_trgm` + a tsvector column.**
Before reaching for Elasticsearch. Postgres full-text will carry RentID well
past its first hundred thousand listings, and one fewer system to secure and
keep in sync is worth a lot at this size.

**When a provider webhook backlog appears → a queue.**
Today `payment_events` _is_ the queue: rows land, `processed_at` marks them
done, and `payment_events_unprocessed_idx` finds the backlog. That is correct
and sufficient. Move to a real queue when a single worker cannot keep up, not
before.

**When read traffic dominates → a read replica** for reporting and the public
marketplace, keeping writes on the primary. Supabase supports this; the app
would need a second client pointed at the replica for explicitly read-only
paths.

**When the student-housing vertical becomes real.** It is currently ~4,000 lines
on mock data, parked. Its tables (bed-level occupancy, roommate groups,
guarantors, ledger events) were designed but never applied, deliberately: it is
the largest feature in the repo and the least relevant to the first paying
landlord. Bring it back when a student-housing PM signs, not before.

---

## 4. Frontend

Already sensible: TanStack Query caches and dedupes, the route tree code-splits,
and the production build is checked in CI. Two things to fix when they start to
matter:

1. `useInvalidateRentId()` invalidates 27 query keys on every mutation. It is fine at demo scale and wasteful at real scale — narrow it to the keys a given mutation actually affects.
2. The `_authenticated` layout is `ssr: false`, so every app page is client-rendered despite the framework supporting SSR. Fine for an app behind a login; revisit if time-to-interactive on mobile becomes a complaint.

---

## 5. Cost

At 1,000 units under management and ~1,000 payments/month:

| Item                                  | Monthly                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Supabase Pro                          | $25                                                                                                                            |
| Hosting (Cloudflare Workers / Vercel) | $0–20                                                                                                                          |
| Microsoft 365 mailboxes               | ~$7/user                                                                                                                       |
| Identity verification                 | $1.50–3.00 per verified person, one-off                                                                                        |
| Payment provider                      | Moov has a $500/month minimum; Column, Worldpay and Adyen are custom; Stripe has none but the worst economics for a 0.5% model |
| **Total fixed**                       | **~$550–600/month once a provider is live**                                                                                    |

Revenue at 1,000 payments × $1,500 × 0.5% is $7,500/month. Infrastructure is
not the constraint on this business at any plausible early scale — provider
approval and landlord acquisition are.
