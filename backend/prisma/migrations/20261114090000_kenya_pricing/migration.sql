-- Kenyan pricing (Nov 2026): one plan with AI included.
-- Monthly KES 2,990 (USD 23 x 130), yearly KES 29,900; 3 users included, KES 500 per extra user;
-- 100 Sasa Credits a month. Starter plans are retired for new sign-ups (existing subscribers keep theirs).
UPDATE "SubscriptionPackage" SET "active" = false WHERE "tier" = 'starter';
UPDATE "SubscriptionPackage" SET "name" = 'Buildsasa — Monthly', "usd" = 23, "aiCredits" = 100, "includedUsers" = 3, "perUserUsd" = 3.846,
  "note" = 'Billed monthly. Cancel anytime.', "features" = NULL
  WHERE "tier" <> 'starter' AND "cycle" = 'monthly';
UPDATE "SubscriptionPackage" SET "name" = 'Buildsasa — Yearly', "usd" = 230, "aiCredits" = 100, "includedUsers" = 3, "perUserUsd" = 38.46,
  "note" = 'Billed once a year: 2 months free.', "features" = NULL
  WHERE "tier" <> 'starter' AND "cycle" = 'yearly';
-- Credit packs and the trial allowance, when an admin has saved credit settings.
UPDATE "SiteContent" SET "value" = jsonb_set(jsonb_set("value"::jsonb, '{packs}',
  '[{"id":"small","name":"Small pack","credits":60,"kes":300},{"id":"builder","name":"Builder pack","credits":220,"kes":1000},{"id":"pro","name":"Pro pack","credits":700,"kes":3000}]'::jsonb),
  '{trialCredits}', '40'::jsonb)::text
  WHERE "key" = 'ai_credits';
