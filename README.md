# Careline Clinic Command Center

Frontend-only UI prototype for a centralized 12-branch animal bite clinic. It uses fictional records and browser-local state. There is no backend, database, real authentication, official receipt generation, government integration, or Bundy clock connection.

## Run locally

Use Node.js 20 or newer in the project directory:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. Enter any nonempty username and password on the demo login screen. Login does not record attendance; use the separate **Time In** and **Time Out** actions.

To create a production bundle:

```bash
npm run build
npm run preview
```

The checked-in `dist/` is a verified static build. If Node.js is unavailable, serve it with a local static server, for example:

```bash
python3 -m http.server 4173 --directory dist
```

Then open http://localhost:4173.

## Structure

- `src/App.jsx` — application shell, grouped navigation, role/branch demo controls, local state
- `src/components.jsx` — reusable cards, tables, fields, badges, tabs, modal, buttons
- `src/data.js` — fictional sample records and branch data
- `src/pages/Clinical.jsx` — dashboard, patients, profile, admissions, RER, treatment, SOAP notes, follow-up
- `src/pages/Operations.jsx` — inventory, payments, referrals, refunds
- `src/pages/People.jsx` — employees, attendance, payroll, payslips
- `src/pages/Reports.jsx` — reports center, rabies exposure registry, DOH aggregate
- `src/pages/Admin.jsx` — branches, users/roles, audit, settings
- `src/styles.css` — responsive design system with Tailwind included

## Demo interactions

Search and filter records; add and edit patients; create admissions and exposure records; record treatments and SOAP notes; update follow-ups; receive, use and adjust stock; record payments; send and accept referrals; request and process refunds; use Time In/Time Out; preview payroll and contribution overrides; print payslips and reports. Role switching in the profile menu shows representative access boundaries. Branch-level roles are scoped to Cuyapo in this demo.

## Prototype limitations

Mock changes stay in the current browser. Most major lists persist in localStorage; some form-only demo entries reset on reload. Figures and charts are illustrative, and report PDF/Excel controls are placeholders. Payroll contribution defaults and calculation rules need validation against current official tables before production use. Role visibility is a visual demonstration and does not provide security or authorization. The login accepts any nonempty values and does not authenticate users. All people and records are fictional.

