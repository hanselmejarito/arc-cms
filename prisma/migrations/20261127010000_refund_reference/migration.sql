ALTER TABLE "Refund" ADD COLUMN "reference" TEXT;
WITH named AS (
 SELECT id, requested, CASE branch
  WHEN 'Guimba' THEN 'GUI' WHEN 'Baloc' THEN 'BAL' WHEN 'Talavera' THEN 'TAV'
  WHEN 'Cabanatuan' THEN 'CAB' WHEN 'Palayan' THEN 'PAL' WHEN 'Laur' THEN 'LAU'
  WHEN 'Paniqui' THEN 'PAN' WHEN 'Rizal' THEN 'RIZ' WHEN 'Talugtug' THEN 'TLG'
  WHEN 'Gapan' THEN 'GAP' WHEN 'Muñoz' THEN 'MUN' WHEN 'Cuyapo' THEN 'CUY'
  ELSE NULL END AS code
 FROM "Refund" WHERE requested ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
), numbered AS (
 SELECT id, code, substring(requested from 3 for 2) AS yr,
 row_number() OVER (PARTITION BY code, substring(requested from 3 for 2) ORDER BY requested, id) AS seq
 FROM named WHERE code IS NOT NULL
)
UPDATE "Refund" AS r SET "reference" = 'RFD' || n.code || '-' || n.yr || '-' || CASE WHEN length(n.seq::text)<4 THEN lpad(n.seq::text,4,'0') ELSE n.seq::text END
FROM numbered AS n WHERE r.id = n.id;
CREATE UNIQUE INDEX "Refund_reference_key" ON "Refund"("reference");
