#!/usr/bin/env bash
# Deploy ARC Next.js to Vercel + Supabase.
# 1. Create a free Supabase project.
# 2. Settings → Database → copy:
#      DIRECT_URL  = Session pooler, port 5432 (for migrate)
#      DATABASE_URL = Transaction pooler, port 6543, add ?pgbouncer=true
# 3. Run this from the repo root after exporting those URLs.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" || -z "${DIRECT_URL:-}" ]]; then
  echo "Export DATABASE_URL (pooler :6543?pgbouncer=true) and DIRECT_URL (session :5432) first."
  exit 1
fi

export SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
export CLIENT_ORIGIN="${CLIENT_ORIGIN:-}"

npx prisma migrate deploy --schema prisma/schema.prisma
npx tsx prisma/seed.ts --clinic

npx vercel env add DATABASE_URL production <<< "$DATABASE_URL" || true
echo "Set these on Vercel (Project → Settings → Environment Variables):"
echo "  DATABASE_URL"
echo "  SESSION_SECRET=$SESSION_SECRET"
echo "  COOKIE_SECURE=true"
echo "  CLIENT_ORIGIN=https://<your-app>.vercel.app"
echo
echo "Then: npx vercel --prod"
echo "After first login, change Demo@2026."
echo "Wake the URL once before the presentation (cold start 15–40s)."
