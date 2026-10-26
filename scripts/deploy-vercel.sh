#!/usr/bin/env bash
# Initialize a NEW Supabase database for an ARC preview deployment.
# Run only after reviewing DATABASE_URL and DIRECT_URL in your own shell.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Set DATABASE_URL to the Supabase transaction pooler URL}"
: "${DIRECT_URL:?Set DIRECT_URL to the Supabase direct or session pooler URL}"
: "${SEED_ADMIN_PASSWORD:?Set a unique admin password of at least 16 characters}"
if (( ${#SEED_ADMIN_PASSWORD} < 16 )); then
  echo "SEED_ADMIN_PASSWORD must have at least 16 characters." >&2
  exit 1
fi

export NODE_ENV=production
npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx prisma/seed.ts --clinic
echo "Database initialized. Set Vercel environment variables in the dashboard and deploy the reviewed Git commit."
