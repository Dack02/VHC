-- =============================================================================
-- Resource Manager — P4 (physical resources)
--
-- Adds resource_assets: per-site, per-day caps for non-hour resources that gate
-- bookings independently of labour hours — loan cars (concurrent courtesy
-- bookings/day), waiter seats (concurrent waiters/day), MOT bay (slots/day).
-- Booked counts come free from diary_day_summary (total_loans / total_waiting /
-- total_mots), so this is a thin config layer the engine reads.
--
-- Deferred (documented in GMS/RESOURCE_MANAGER.md §12): overbook factor tuned
-- from DMS show-rate, utilisation/override reporting, what-if simulation.
--
-- Plan: GMS/RESOURCE_MANAGER.md (§7, §12). ADDITIVE ONLY — idempotent.
-- Deploy via the pipeline (supabase db push).
-- =============================================================================

CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS resource_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  asset_type VARCHAR(20) NOT NULL,        -- loan_car | waiter_seat | mot_bay | ramp ...
  name VARCHAR(60),
  quantity INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, site_id, asset_type)
);

CREATE INDEX IF NOT EXISTS idx_resource_assets_site
  ON resource_assets(organization_id, site_id, is_active);

DROP TRIGGER IF EXISTS trg_resource_assets_updated_at ON resource_assets;
CREATE TRIGGER trg_resource_assets_updated_at
  BEFORE UPDATE ON resource_assets
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE resource_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org resource assets" ON resource_assets;
CREATE POLICY "Users can view own org resource assets"
  ON resource_assets FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));
