#!/usr/bin/env bash
# Run the SQL-level security tests in scripts/db/tests/*.sql against the local
# verification database (bun run db:reset first, or let this script do it).
#
# Each test file is plain psql: it opens a transaction, impersonates users with
#   set local role authenticated;
#   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated","email":"..."}';
# asserts with `do $$ begin assert ...; end $$;` and ends with ROLLBACK, so the
# database is left exactly as it was.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${LOCAL_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/rentid_local}"
export PGOPTIONS="-c client_min_messages=warning"

if [ "${1:-}" = "--fresh" ] || ! psql "${URL}" -tAc "select 1" >/dev/null 2>&1; then
  bash "${ROOT}/scripts/db/reset-local.sh"
fi

pass=0; fail=0
for f in $(ls "${ROOT}"/scripts/db/tests/*.sql | sort); do
  name="$(basename "${f}")"
  if out=$(psql "${URL}" -v ON_ERROR_STOP=1 -q -f "${f}" 2>&1); then
    echo "PASS  ${name}"; pass=$((pass+1))
  else
    echo "FAIL  ${name}"; echo "${out}" | sed 's/^/      /'; fail=$((fail+1))
  fi
done
echo "==> ${pass} passed, ${fail} failed"
[ "${fail}" -eq 0 ]
