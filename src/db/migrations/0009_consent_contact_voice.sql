-- CONS-3: consent categories now include "contact" and "voice". Consents granted before this change shared everything
-- the office needed, so existing active rows get both (a citizen can narrow them from My data).
UPDATE "consents"
SET "data_categories" = (SELECT array_agg(DISTINCT c) FROM unnest("data_categories" || ARRAY['contact', 'voice']) AS c)
WHERE "purpose" = 'eligibility_verification' AND "status" = 'active' AND NOT ("data_categories" @> ARRAY['contact', 'voice']);
