-- =============================================================================
-- Follow-Up Module - Org-level settings (enable/disable, auto-sweep, simulation,
-- send window / quiet hours) plus sweep bookkeeping columns.
-- All additive on organization_settings; opt-in (follow_up_enabled defaults false)
-- so the automation stays off until an admin turns it on per organisation.
-- Spec: docs/follow-up-module-spec.md
-- =============================================================================

-- Master switch. OFF by default: the daily sweep skips the org entirely and the
-- manual "Run sweep now" action is refused until this is enabled.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN DEFAULT false;

-- Automatic processing by the scheduler. When false the org is only processed
-- when an admin clicks "Run sweep now" (manual-only mode).
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_auto_sweep_enabled BOOLEAN DEFAULT true;

-- Per-org dry-run: the sweep renders and logs every SMS/email it would send but
-- never actually sends. Equivalent to the global FOLLOW_UP_DRY_RUN env var, but
-- controllable per organisation for safe rollout.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_simulation_mode BOOLEAN DEFAULT false;

-- Send window / quiet hours (evaluated in the org timezone). When enabled, the
-- sweep defers customer SMS/email steps that fall outside the window instead of
-- sending; case creation and internal state still advance any time.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_send_window_enabled BOOLEAN DEFAULT false;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_send_window_start VARCHAR(5) DEFAULT '08:00';
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_send_window_end VARCHAR(5) DEFAULT '18:00';
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_skip_weekends BOOLEAN DEFAULT false;

-- Sweep bookkeeping. last_swept_at powers the status panel; last_created_on
-- gates the heavier deferred-item scan to once per org per local day even though
-- the scheduler now ticks several times an hour to honour the send window.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_last_swept_at TIMESTAMPTZ;
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS follow_up_last_created_on DATE;
