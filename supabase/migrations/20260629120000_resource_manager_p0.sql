-- =============================================================================
-- Resource Manager — P0 (capacity foundation)
--
-- Turns the Booking Diary's capacity view from a hard-coded 85% threshold into a
-- per-site, configurable loading target, and lays the config table the later
-- phases (skills, category quotas, lead-time recommender, online booking) build
-- on. P0 ships ONLY this table — the diary then reads `target_loading_pct` from
-- it for RAG banding + an "underloaded" flag. No quotas, no skills yet.
--
-- Plan: GMS/RESOURCE_MANAGER.md (§7.1). ADDITIVE ONLY — idempotent, no
-- destructive statements. Deploy via the pipeline (supabase db push), never
-- out-of-band MCP SQL.
-- =============================================================================

-- gms_set_updated_at() already exists (jobsheets/repair_types migrations);
-- redefine idempotently so this migration is self-contained.
CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Per-site capacity & booking config (one row per org+site). All columns have
-- sensible defaults so the API can treat a missing row as "all defaults" and
-- only writes a row when an admin saves. The drop-off / lead-time / skills /
-- quota columns are inert in P0 (created now so we migrate the table once).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource_site_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,

  -- P0: the line we book *to* (e.g. 0.85 = book to 85% of available hours).
  target_loading_pct NUMERIC(4,3) NOT NULL DEFAULT 0.850,
  -- 1 / show_rate; 1.0 = no overbooking (tuned later from DMS arrival data).
  overbook_factor NUMERIC(4,3) NOT NULL DEFAULT 1.000,

  -- Lead time (later phases): advisor min-notice (days) vs online min-notice (hours).
  booking_lead_time_days INTEGER NOT NULL DEFAULT 0,
  online_lead_time_hours INTEGER NOT NULL DEFAULT 24,
  booking_max_days INTEGER NOT NULL DEFAULT 60,            -- booking horizon

  -- Protection decay window for the category-quota engine (later phase).
  release_window_days INTEGER NOT NULL DEFAULT 5,

  -- Morning drop-off window for `drop_off` repair types (later phase).
  dropoff_window_start TIME NOT NULL DEFAULT '08:00',
  dropoff_window_end   TIME NOT NULL DEFAULT '09:30',
  dropoff_slot_interval_minutes INTEGER NOT NULL DEFAULT 15,
  dropoff_slot_capacity INTEGER,                            -- max cars per drop-off time (NULL = ∞)

  -- Feature switches (later phases); off until opted in per site.
  enable_skill_routing   BOOLEAN NOT NULL DEFAULT false,
  enable_category_quotas BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, site_id)
);

COMMENT ON TABLE resource_site_config IS 'Resource Manager per-site capacity/booking config. Missing row = all defaults; see GMS/RESOURCE_MANAGER.md.';
COMMENT ON COLUMN resource_site_config.target_loading_pct IS 'Bookable ceiling = available_hours × this (default 0.85). Drives diary RAG banding.';

CREATE INDEX IF NOT EXISTS idx_resource_site_config_org
  ON resource_site_config(organization_id, site_id);

DROP TRIGGER IF EXISTS trg_resource_site_config_updated_at ON resource_site_config;
CREATE TRIGGER trg_resource_site_config_updated_at
  BEFORE UPDATE ON resource_site_config
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE resource_site_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org resource config" ON resource_site_config;
CREATE POLICY "Users can view own org resource config"
  ON resource_site_config FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));
