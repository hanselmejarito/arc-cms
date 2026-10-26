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

### Demo accounts

Password for all: `Demo@2026`

| Email | Role | Branch |
|---|---|---|
| superadmin@arc.clinic | Superadmin | All branches |
| hr@arc.local | HR | All branches |
| nurse@arc.local | Nurse / Staff | Guimba |
| po@arc.local | PO / PhilHealth Officer | Guimba |
| secretary@arc.local | Secretary | Guimba |
| cashier@arc.local | Cashier | Cabanatuan |
| employee@arc.local | Employee | Guimba |

Signing in does not record attendance. Use **Time In** / **Time Out** inside the app. Every employee has a login (`{firstname}@arc.local` for the rest of the seed staff). The clinic does not encode OJT.

## Deploy notes

Serve over **HTTPS**. Set `COOKIE_SECURE=true`, a long random `SESSION_SECRET`, and `CLIENT_ORIGIN` to the real URL. Do not commit `.env`.

## Structure

- `src/app/` — Next.js layout, page, `/api` catch-all
- `lib/` — Prisma, auth, clinic rules, Express routers (bridged into Next)
- `prisma/` — schema, migrations, seed
- `src/screens/` — clinic UI
- `docker-compose.yml` — PostgreSQL 16
- `../cms_backup` — Vite + Express snapshot

## Phase 1 rules (locked)

- Registry `ARC{CODE}-YY-0001` issued in a DB transaction per branch per year
- One patient master record; Complete + new bite = Returning patient + new admission + new registry
- Ongoing / For RER continues the same registry
- Incomplete after 7-day grace is locked
- Day 0 is recorded on the first visit when RER is saved (walk-in must be paid first). Succeeding protocol dates are computed from that Day 0 (ID D0/D3/D7/D28, IM +D14, booster D0/D3, PrEP D0/D2/D14). Early or late attendance does not move the scheduled date
- Walk-in payment required before doses; PhilHealth / For PhilHealth = ₱0
- Accepted referral issues a new receiving registry, linked to origin
- Guardian optional; minor may sign
- Cross-branch same-person match is a warning only
- Reminders are in-app only (bell, schedule, stock, referrals). No SMS. Staff contacts patients from their own phone using the listed cellphone number
- Vaccinator is an active Nurse / Staff employee of the servicing branch, not a separate name list
- Admin is the super admin (all pages, all branches). Admin is a login only — not an employee, no Time In. There is no Owner role
- Every employee has a login and uses Time In / Time Out in the app. Linked employee is required except for Admin. The clinic does not encode OJT or intern records
- Payroll is computed from Time In / Time Out (duty days, late, undertime, night hours). Admin or HR may update a cutoff with a reason. Overtime stays approved-only

## Persistence

After login, `GET /api/clinical` hydrates patients, encounters, doses, notes, payments, referrals, audit, inventory, ledger, received, movements, finance, refunds, employees, attendance, users, and branches.

Recording a vaccine or TT dose deducts stock in the API (PCEC 10 uses/vial, PVRV 5, IM = full vial, TT = 1 vial). Serum is not auto-deducted; staff records actual vials in Stock Out.
