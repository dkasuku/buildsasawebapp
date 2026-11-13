-- Fewer paid photo questions per day (OpenAI cost): 25 for paying companies, 10 on trial,
-- in admin-saved AI settings too (no change when those limits were never saved).
UPDATE "SiteContent" SET "value" = jsonb_set(jsonb_set("value"::jsonb, '{daily,paid,upload}', '25'::jsonb), '{daily,trial,upload}', '10'::jsonb)::text
  WHERE "key" = 'ai_credits' AND ("value"::jsonb) #> '{daily,paid}' IS NOT NULL AND ("value"::jsonb) #> '{daily,trial}' IS NOT NULL;
