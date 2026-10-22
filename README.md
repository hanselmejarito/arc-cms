# ARC Anti Rabies Clinic

React / Vite UI plus an Express + TypeScript API and PostgreSQL. Clinic writes (patients, inventory, finance, refunds, employees, attendance, users, and branch settings) persist in the database. Theme may stay in browser localStorage.

Demo records are fictional. Prototype date remains **2026-10-14**.

## Stack

- Frontend: React + Vite (JavaScript)
- API: Node.js + Express + TypeScript + Prisma
- Database: PostgreSQL 16 (Docker)
- Auth: login + httpOnly cookie session (argon2). No JWT in localStorage. No Redis.

## Run locally

Docker Desktop must be running. Node.js 20+.

```bash
docker compose up -d
cp server/.env.example server/.env
cd server
npm install
npx prisma migrate deploy
npx prisma generate
npm run seed
npm run dev
```

In another terminal, from the project root:

```bash
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173). Vite proxies `/api` to the API on port 4000.

Production UI build:

```bash
npm run build
```

### Demo accounts

Password for all: `Demo@2026`

| Email | Role | Branch |
|---|---|---|
| admin@arc.local | Admin (super admin) | All branches |
| hr@arc.local | HR | All branches |
| nurse@arc.local | Nurse / Staff | Guimba |
| po@arc.local | PO / PhilHealth Officer | Guimba |
| secretary@arc.local | Secretary | Guimba |
| cashier@arc.local | Cashier | Cabanatuan |
| employee@arc.local | Employee | Guimba |

Signing in does not record attendance. Use **Time In** / **Time Out** inside the app. Every employee has a login (`{firstname}@arc.local` for the rest of the seed staff). The clinic does not encode OJT.

## Deploy notes

Serve the API and UI over **HTTPS**. Set `COOKIE_SECURE=true` and a long random `SESSION_SECRET` in `server/.env`. Do not commit `.env`. CORS `CLIENT_ORIGIN` must be the real UI origin.

## Structure

- `docker-compose.yml` — PostgreSQL 16
- `server/` — Express API, Prisma schema, seed
- `src/App.jsx` — shell, session, workspace fetch
- `src/api.js` — `fetch` helper (`credentials: 'include'`)
- `src/data.js` — protocols, branch master, mock seed source
- `src/pages/Clinical.jsx` — patients, admissions, RER, treatment, SOAP, schedule
- `src/pages/Operations.jsx` — inventory, payments, finance, referrals, refunds
- `src/pages/People.jsx` — employees, attendance, payroll
- `src/pages/Reports.jsx` — reports from loaded records
- `src/pages/Admin.jsx` — branches, users, audit, settings

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
