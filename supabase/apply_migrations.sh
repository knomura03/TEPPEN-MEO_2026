#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
files=(supabase/migrations/*.sql)

if [ ${#files[@]} -eq 0 ]; then
  echo "No migration files found in supabase/migrations"
  exit 0
fi

for file in "${files[@]}"; do
  echo "==> Applying ${file}"
  psql -v ON_ERROR_STOP=1 -f "${file}"
done
