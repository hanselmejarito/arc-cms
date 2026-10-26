# ARC Clinic Management System Requirements

Current system baseline 1.2 | 26 October 2026 | For implementation and UAT

This document describes the current ARC application as the latest system baseline. The October 14, 2026 v1.1 document is historical reference where its rules differ from the implemented system. Requirements below reflect the current workflow; incomplete features and unverified runtime behavior remain explicit. This review does not claim that workflows have passed testing.

## 1 Scope and evidence

The system is a centralized web application and database for 12 ARC branches. The current repository uses Next.js, React, API route handlers, Prisma and PostgreSQL. It contains clinical, inventory, payments, finance, attendance, payroll, administration and reporting modules. The current code is the primary source for this baseline. The earlier v1.1 document and README are historical references where they conflict with the current implementation.

| Status | Meaning |
| --- | --- |
| Implemented in code | A UI or server path exists; runtime behavior still needs testing. |
| Partial | A stated requirement is missing or limited. |
| Documentation update | Older documents conflict with the current system and must be synchronized. |
| Unverified | The repository alone cannot prove production or UAT success. |

## 2 Accounts branches and access

ACC-01  Each active employee using the system shall have an individual login linked to an employee record. Superadmin is a system login without an employee record or attendance duty.

ACC-02  The roles are Superadmin, Admin, Nurse, PhilHealth Officer and Secretary. Superadmin and Admin have all-branch access; other roles are limited to assigned branch and permitted pages. Owner and Cashier are not separate roles in the current role list.

ACC-03  Server endpoints shall enforce authentication, page permissions and branch access. Document the current create, view, update, delete and export matrix and test it before UAT.

ACC-04  Branch records shall hold operating hours, accreditation, shift availability, contact and status. Material transactions shall retain servicing branch and responsible user.

## 3 Patients admissions and clinical records

PAT-01  Maintain one reusable patient master. Search by name, contact and registry. Warn on likely same-person matches across branches; staff decide whether to reuse the record.

PAT-02  Create a new admission and registry for a new exposure after a completed case. Continue an ongoing or For RER case under its existing registry. An accepted referral creates a linked receiving-branch registry while preserving history.

PAT-03  Issue registry numbers in a database transaction, unique by branch and year, using ARC{branch code}-YY-0001. The server-issued number is authoritative.

PAT-04  Capture demographics, contact, address, guardian or signer, patient flags and branch. Guardian details are optional; a minor may sign where clinic policy permits.

RER-01  Capture animal, exposure, wound and body site, category, history, vitals, consent, doctor and other approved ARC RER fields. Staff make the clinical assessment; the system shall not diagnose.

RER-02  Record multiple dated SOAP progress notes with author and branch. Display exposure, treatment, payment and referral history in the patient profile.

## 4 Treatment schedules and safeguards

TRT-01  Record every administered anti-rabies dose against encounter, protocol day, date, route, brand, batch, branch and active Nurse vaccinator. Record TT and ERIG or HRIG details where applicable.

TRT-02  The current protocols are ID D0/D3/D7/D28; IM D0/D3/D7/D14/D28; booster D0/D3; and PrEP D0/D7/D21. ID adds D14 when the animal is reported dead or lost within the 14-day observation window. UAT shall validate representative dates and cases.

TRT-03  A late administered dose recalculates remaining due dates from its actual date. More than seven days past the next due date marks the case Incomplete, but a late dose can still be recorded. The README now records this current rule.

TRT-04  Day 0 is attempted when the RER is saved. A walk-in case requiring payment must be paid before a dose. PhilHealth and For PhilHealth have no patient charge. Category I or non-PEP cases do not receive automatic anti-rabies Day 0.

TRT-05  Show due, upcoming and missed follow-ups in the schedule and in-app alerts. Staff contact patients using the listed number. Automated SMS or email is outside the current implemented workflow.

## 5 Inventory and operations

INV-01  Maintain stock per branch, item, batch, expiration and shift, with Stock In, Stock Out, adjustment, movement history, low-stock and expiry visibility.

INV-02  PCEC accumulates 10 injection uses per vial; PVRV and Bioshoot accumulate five. IM consumes a full vial. TT uses one vial per treatment. ERIG (serum) is recorded through manual Stock Out based on actual vials used.

INV-03  The current item list includes ChiroRab, VaxiRab N, Bioshoot, Speeda, Abhayrab, ERIG (serum), Tetanus Toxoid, Influvac and Pneumococcal. Verify configured thresholds and initial balances against clinic records. Flu and Pneumococcal treatment deduction remains an implementation gap to assess.

INV-04  Reject vaccine use if usable stock is absent or expired. Preserve batch, quantity, reason, user and audit information for movements and adjustments.

## 6 Payments referrals refunds and finance

SAL-01  Classify admissions as Walk-in, PhilHealth or For PhilHealth. Record service lines, amount, date and branch. Apply the walk-in payment gate before vaccine administration.

SAL-02  Record referral source and destination, status and reason; link the receiving encounter to the original patient and treatment history.

SAL-03  Preserve original payment when a refund is approved. Create a separate linked refund with amount, reason, status, approving user and originating branch. Enforce the approved eligibility cutoff.

FIN-01  Record branch income and expenses and show sales, expense and simple balance summaries by branch and period. Full accounting and official receipt generation remain excluded.

## 7 Employees attendance and payroll

HR-01  Store employee branch, role, status, daily rate, hours, shift, payroll and benefit eligibility. Login and attendance are separate actions: employees explicitly Time In and Time Out.

HR-02  Use server time for attendance. Keep originals when corrections are made; authorized correction requires reason and audit entry. Bundy clock remains an independent verification source.

HR-03  Compute duty days, late minutes, undertime and eligible night hours from attendance. Overtime is filed after Time Out and included in payroll only after approval.

HR-04  Support semimonthly cutoffs, daily-rate basic pay, approved overtime, 10 percent night differential, holiday pay, PHP 500 officer allowance per cutoff, statutory deductions and authorized adjustments. Compare results with clinic sample calculations and current effective contribution tables during UAT.

HR-05  Provide payroll history and printable payslips for authorized users. Full HRIS, paid leave computation and biometric integration remain excluded.

## 8 Reports administration and security

REP-01  Generate Rabies Exposure Registry and Animal Bite and Rabies aggregate reports from encoded transactions, filtered by branch and period. Validate counts and classifications against approved DOH templates.

REP-02  Provide print and Excel export where implemented. Generic PDF export currently reports that download is unavailable; PDF remains incomplete until implemented and tested.

ADM-01  Persist clinic settings intended to govern live behavior. Current settings toggles save only on the screen and are incomplete.

SEC-01  Use authenticated sessions, production HTTPS, server-side role and branch enforcement, material-change audit trails, patient-data protection and tested database backup and recovery.

SEC-02  Before release, run type checks, lint where configured, migrations, permission and branch tests, clinical and financial workflow tests, backup restore and UAT. Current build configuration suppresses TypeScript and ESLint build errors.

## 9 Remaining implementation and validation work

| Priority | Work item | Current evidence |
| --- | --- | --- |
| High | Test ID, IM, booster and PrEP schedules, including conditional ID D14. | Code and README now describe the same protocols. |
| High | Test late-dose rescheduling and Incomplete cases. | Code and README now describe the same late-dose rule. |
| High | Verify the current role matrix for each operation and branch. | README now matches the current role list; endpoint behavior still needs testing. |
| High | Document and test current permissions for clinical, finance and payroll data. | Page access exists; an operation-level matrix is outstanding. |
| High | Reconcile starting stock and test consumption, thresholds and non-rabies products. | Core inventory exists; product coverage requires testing. |
| High | Compare payroll with clinic examples and verify current contribution tables and approvers. | Calculation paths exist; signed examples are needed for UAT. |
| Medium | Complete required PDF export and persistent settings, and validate report templates. | Print and some Excel exist; generic PDF/settings incomplete. |

## 10 UAT exit criteria

- A new patient, returning completed patient and ongoing case follow the approved registry rules across two branches.

- RER, payment, Day 0, later dose, referral, refund and stock effects reconcile and remain auditable.

- Approved schedule cases match expected dates, including late and missed doses and animal status changes.

- Attendance, corrections, overtime and payroll match signed examples for both shifts and cutoffs.

- DOH figures match manually checked cases and required print or export functions work.

- Permissions, branch isolation, backup restore and production configuration checks pass before go-live.

## 11 Source basis

Historical reference: ARC Clinic Management System Final Business System Requirements v1.1, modified 14 October 2026. Code inspected: README.md; Prisma schema; lib/clinical.ts, inventory.ts, doses.ts and auth.ts; clinical and operations API routes; src/data.js; Clinical, People, Reports and Admin screens. Validation on 26 October 2026: TypeScript check and Next.js production build passed. The local health endpoint and main page returned HTTP 200; the clinical API returned HTTP 401 without login. An isolated test database passed migration and schema-diff checks. The local app database already matched the current schema, so its migration history was marked in sync without rerunning SQL. An API smoke test passed login, admission, RER, payment gate, payment, Day 0 vaccine and stock movement, referral acceptance, refund creation, payroll input and contribution override persistence, branch restriction and hydration. Full inventory operations, payroll calculations, finance, DOH reports and production data remain untested.
