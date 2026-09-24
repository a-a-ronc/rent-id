#!/usr/bin/env bash
# Recreate the local verification database and apply every migration in order:
#   1. scripts/db/supabase-shim.sql   (auth/storage/roles stand-ins)
#   2. supabase/migrations/*.sql      (the hosted project's applied + pending migrations)
#   (interest_registrations, once drizzle-only, is now 20260924000100.)
#
# Usage:  bun run db:reset            (LOCAL_DATABASE_URL defaults to postgres://postgres:postgres@localhost:5432/rentid_local)
# Fails fast on the first SQL error — a failing migration here will also fail on Supabase.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${LOCAL_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/rentid_local}"
export PGOPTIONS="-c client_min_messages=warning"

# Split the URL into an admin URL (postgres db) so we can drop/create the target db.
DBNAME="${URL##*/}"
DBNAME="${DBNAME%%\?*}"
ADMIN_URL="${URL%/*}/postgres"

echo "==> Recreating database ${DBNAME}"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -qc "drop database if exists \"${DBNAME}\" with (force);" >/dev/null
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -qc "create database \"${DBNAME}\";" >/dev/null

apply() {
  local file="$1"
  echo "  -> $(basename "${file}")"
  psql "${URL}" -v ON_ERROR_STOP=1 -q -f "${file}" >/dev/null
}

echo "==> Supabase shim"
apply "${ROOT}/scripts/db/supabase-shim.sql"

echo "==> supabase/migrations"
for f in $(ls "${ROOT}"/supabase/migrations/*.sql | sort); do apply "${f}"; done


TABLES=$(psql "${URL}" -tAc "select count(*) from information_schema.tables where table_schema='public'")
POLICIES=$(psql "${URL}" -tAc "select count(*) from pg_policies where schemaname='public'")
echo "==> OK: ${TABLES} public tables, ${POLICIES} RLS policies"
