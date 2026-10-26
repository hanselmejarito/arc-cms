UPDATE "Payment"
SET "service" = replace("service", 'Anti-rabies vaccine dose', 'Anti-rabies vaccine')
WHERE "service" = 'Anti-rabies vaccine dose'
   OR "service" LIKE 'Anti-rabies vaccine dose × %';
