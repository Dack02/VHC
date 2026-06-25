-- Recreate the awaiting_checkin partial index originally defined in
-- 20260125000001_checkin_mri_phase1.sql. It had to move to its own migration
-- because Postgres cannot reference an enum value in the same transaction
-- that added it, which broke fresh local bootstraps. Already-migrated
-- environments are unaffected (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS idx_health_checks_awaiting_checkin
  ON health_checks(arrived_at)
  WHERE status = 'awaiting_checkin';
