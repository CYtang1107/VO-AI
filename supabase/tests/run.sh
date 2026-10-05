#!/usr/bin/env bash
# Runs the migrations and the RLS tests against a throwaway local Postgres
# (needs postgresql + pgvector; nothing here touches the real project).
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
db="voai_rls_test"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $db" -c "create database $db"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f supabase/tests/supabase-stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$db" -f supabase/tests/rls.test.sql
