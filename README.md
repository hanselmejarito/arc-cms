# ARC Anti Rabies Clinic

Next.js app (UI + `/api`) and PostgreSQL. The previous Vite + Express stack is in the sibling repo `cms_backup`.

## Stack

- Next.js 15 (React UI + `/api` route handlers)
- Prisma + PostgreSQL 16 (Docker)
- Auth: httpOnly cookie session (argon2)

## Run locally

```bash
docker compose up -d
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed:clinic
npm run dev
```

Open http://localhost:3000.

### Seed accounts

`npm run seed:clinic` creates an empty clinic with one Superadmin account: `superadmin@arc.clinic` / `Demo@2026`. Add real staff and stock before recording treatments. Signing in does not record attendance; employees use **Time In** / **Time Out**.

For sample records, run `npm run seed:demo` on a fresh database. Demo accounts include `nurse@arc.local`, `po@arc.local`, and `secretary@arc.local`; other seeded employees use `{firstname}@arc.local`. The demo password is `Demo@2026`. Both seed commands refuse to overwrite existing clinic data unless `--reset` is explicitly passed.

## Vercel + Supabase preview deployment

Use a **new Supabase project for the client demo**. Keep test records separate from real patient records. The current local database is not copied during deployment.

1. In Supabase, copy the **transaction pooler** URI into `DATABASE_URL` (port 6543, with `pgbouncer=true` and SSL). Copy the **direct connection** URI into `DIRECT_URL`; if direct IPv6 is unavailable, use the session pooler on port 5432. Keep both URLs private.
2. For a new empty Supabase database, export `DATABASE_URL`, `DIRECT_URL`, and a unique `SEED_ADMIN_PASSWORD` of at least 16 characters in your local shell. Run `bash scripts/deploy-vercel.sh`. It applies migrations and creates an empty clinic with `superadmin@arc.clinic`. It refuses to reseed an existing clinic database. Do not run `seed:demo` on a hosted database.
3. Import the reviewed Git commit into Vercel as a Next.js project. In **Preview** environment variables, set `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET` (a separate long random value), and `COOKIE_SECURE=true`. Set `CLIENT_ORIGIN` to the preview URL if used by a later integration. Do not put `SEED_ADMIN_PASSWORD` in Vercel; it is only needed for one-time database initialization.
4. Deploy Preview. Sign in, test admission, payment, stock, treatment, and a report export with fictional data. Only promote to Production after clinic acceptance and a review of access, backups, and patient-data handling.

The build command is `prisma generate && next build`. Environment variable updates require a new Vercel deployment. Never commit `.env` or paste connection strings into source code.
## Structure

- `src/app/` — Next.js layout, page, `/api` catch-all
- `lib/` — Prisma, auth, clinic rules, API routers dispatched through Next
- `prisma/` — schema, migrations, seed
- `src/screens/` — clinic UI
- `docker-compose.yml` — PostgreSQL 16
- `../cms_backup` — Vite + Express snapshot

## Current system rules

- Registry `ARC{CODE}-YY-0001` issued in a DB transaction per branch per year
- One patient master record; Complete + new bite = Returning patient + new admission + new registry
- Ongoing / For RER continues the same registry
- More than 7 days past the next due date marks the case Incomplete; a late dose can still be recorded
- Day 0 is attempted when RER is saved (walk-in cases requiring payment must be paid first). Protocols are ID D0/D3/D7/D28, IM D0/D3/D7/D14/D28, booster D0/D3, and PrEP D0/D7/D21. ID adds D14 when the animal is reported dead or lost within the 14-day observation window. A late administered dose recalculates remaining due dates from the actual date given
- Walk-in payment required before doses; PhilHealth / For PhilHealth = ₱0
- Accepted referral issues a new receiving registry, linked to origin
- Guardian optional; minor may sign
- Cross-branch same-person match is a warning only
- Reminders are in-app only (bell, schedule, stock, referrals). No SMS. Staff contacts patients from their own phone using the listed cellphone number
- Vaccinator is an active Nurse employee of the servicing branch, not a separate name list
- Superadmin and Admin have all-page and all-branch access. Superadmin is a login only, with no linked employee or Time In. Admin is linked to an employee. There is no Owner or Cashier role
- Every employee has a login and uses Time In / Time Out in the app. Linked employee is required except for Superadmin. The clinic does not encode OJT or intern records
- Payroll is computed from Time In / Time Out (duty days, late, undertime, night hours). Superadmin or Admin may update a cutoff with a reason. Overtime stays approved-only

## Persistence

After login, `GET /api/clinical` hydrates patients, encounters, doses, notes, payments, referrals, audit, inventory, ledger, received, movements, finance, refunds, employees, attendance, users, and branches.

Recording a vaccine or TT dose deducts stock in the API (PCEC 10 uses/vial, PVRV 5, IM = full vial, TT = 1 vial). ERIG (serum) is not auto-deducted; staff records actual vials in Stock Out.
