# Archived — do not apply

These four files were the September 2026 _proposed_ schema written while the
Supabase project was unreachable. They were never applied, and they cannot be
applied on top of the live database: they re-create tables and enums that
already exist and redefine `is_org_member` with a different signature.

Everything in them that the app needs has been carried forward as additive
migrations in `supabase/migrations/20260915*`:

| planned file                                             | superseded by                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0001_schema.sql (core tables)                            | 20260915000100_enum_additions.sql, 20260915000200_reconcile_core.sql                            |
| 0001_schema.sql (marketplace / management / syndication) | 20260915000300_marketplace_management.sql                                                       |
| 0001_schema.sql (student-housing tables)                 | **not carried forward** — the student vertical stays on mock data until it is a launch priority |
| 0002_rls.sql                                             | policies folded into the migrations above                                                       |
| 0003 / 0004 property verification                        | 20260915000400_property_verification.sql                                                        |

Kept for reference only. Delete this directory once nobody needs the history.
