-- =============================================================================
-- Follow-Up: booking relatedness matcher + unrelated-booking escalation
-- -----------------------------------------------------------------------------
-- When a follow-up case is paused because the customer has an upcoming workshop
-- booking, we now score whether that booking actually INCLUDES the deferred work
-- (deterministic rules first, Claude for the ambiguous middle). The verdict is
-- cached on the case so the modal can render it instantly without an LLM call on
-- the hot path.
--
-- We also let an advisor flag a found booking as NOT related: instead of resuming
-- the cadence, the case drops straight onto the manual call list. dismissed_booking_ids
-- records those bookings so the daily sweep does not re-pause the case on the same
-- (unrelated) booking.
--
-- All additive + idempotent (IF NOT EXISTS) per the project database-safety rules.
-- =============================================================================

ALTER TABLE follow_up_cases
  ADD COLUMN IF NOT EXISTS booking_match_verdict   JSONB,
  ADD COLUMN IF NOT EXISTS booking_match_level     TEXT,          -- high | medium | low | none
  ADD COLUMN IF NOT EXISTS booking_match_source    TEXT,          -- deterministic | ai
  ADD COLUMN IF NOT EXISTS booking_match_booking_id UUID,         -- which booking the verdict is for (staleness guard)
  ADD COLUMN IF NOT EXISTS booking_match_hash      TEXT,          -- hash of (items + booking content) → skip recompute
  ADD COLUMN IF NOT EXISTS booking_match_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_booking_ids   UUID[] NOT NULL DEFAULT '{}';

-- Reporting/worklist filter: "how many paused cases look auto-confirmable?".
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_booking_match_level
  ON follow_up_cases (organization_id, booking_match_level)
  WHERE booking_match_level IS NOT NULL;
