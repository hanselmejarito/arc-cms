-- Correct the previous default labels without overwriting custom branch hours.
-- These labels do not determine attendance or payroll schedules.
UPDATE "Branch"
SET "hours" = 'Daily 8AM–5PM'
WHERE "name" = 'Rizal'
  AND "hours" IN ('Daily 7AM–5PM', 'Daily 7AM-5PM');

UPDATE "Branch"
SET "hours" = 'Daily 8AM–6PM'
WHERE "name" = 'Palayan'
  AND "hours" IN ('Daily 8AM–5PM', 'Daily 8AM-5PM');
