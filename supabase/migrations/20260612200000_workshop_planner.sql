-- ============================================================================
-- Workshop Planner: technician timeline (explicit time slots)
--
-- Adds working-day bounds to the board config and a planned start time to
-- workshop cards. Block duration on the timeline comes from the job's labour
-- time (workshop_cards.estimated_hours, falling back to DMS booked repairs),
-- so no separate duration column is needed - resizing a block re-estimates.
-- ============================================================================

ALTER TABLE workshop_board_config
  ADD COLUMN IF NOT EXISTS day_start_time TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS day_end_time TIME NOT NULL DEFAULT '17:30',
  ADD COLUMN IF NOT EXISTS lunch_start_time TIME,
  ADD COLUMN IF NOT EXISTS lunch_end_time TIME;

COMMENT ON COLUMN workshop_board_config.day_start_time IS 'Workshop day start for the planner timeline';
COMMENT ON COLUMN workshop_board_config.day_end_time IS 'Workshop day end for the planner timeline';
COMMENT ON COLUMN workshop_board_config.lunch_start_time IS 'Optional lunch band start (shaded on the timeline)';
COMMENT ON COLUMN workshop_board_config.lunch_end_time IS 'Optional lunch band end';

ALTER TABLE workshop_cards
  ADD COLUMN IF NOT EXISTS planned_start_at TIMESTAMPTZ;

COMMENT ON COLUMN workshop_cards.planned_start_at IS 'Planned slot start on the technician timeline (NULL = not scheduled)';

CREATE INDEX IF NOT EXISTS idx_workshop_cards_planned
  ON workshop_cards(organization_id, planned_start_at)
  WHERE planned_start_at IS NOT NULL;
