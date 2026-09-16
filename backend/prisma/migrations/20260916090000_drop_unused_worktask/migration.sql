-- WorkTask was a whole feature that never shipped: the model, its /api/work-tasks
-- CRUD routes and four client methods existed, but no screen ever called any of
-- them. "Tasks & Trades" — the page that sounds like it would — runs on Checklist
-- rows instead. The table holds no rows in production (checked before writing
-- this), so it is dropped rather than left as a trap for the next person.
DROP TABLE IF EXISTS "WorkTask";
