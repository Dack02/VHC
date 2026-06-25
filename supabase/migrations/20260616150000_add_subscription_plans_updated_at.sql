-- Add updated_at to subscription_plans
--
-- The admin "Edit Plan" save (PATCH /api/v1/admin/plans/:id, in
-- apps/api/src/routes/admin/stats.ts) sets `updated_at` on every update and
-- returns it in the response. But the original table (20250116000001) was
-- created with only `created_at`, so every plan save failed with the PostgREST
-- error "Could not find the 'updated_at' column of 'subscription_plans' in the
-- schema cache" and the handler returned a 500 — no plan ever saved.
--
-- Every other table in the schema carries `updated_at`; this brings
-- subscription_plans in line. Additive and idempotent.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows so the value is meaningful from the start
UPDATE subscription_plans
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;
