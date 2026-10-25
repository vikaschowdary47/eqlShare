#!/usr/bin/env bash
# Applies all migrations to a fresh database and runs the SQL authorization tests.
# Usage: PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=eqlshare_test
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
for f in supabase/tests/*.test.sql; do echo "== $f"; psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"; done
echo "All database tests passed"
