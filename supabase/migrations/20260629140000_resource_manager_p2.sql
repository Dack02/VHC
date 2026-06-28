-- =============================================================================
-- Resource Manager — P2 (quota engine foundation)
--
-- Adds the per-category quota config + the skill-segmented capacity RPC the
-- supply-driven canBook engine needs, plus the booking columns for category
-- counting and override recording. The engine itself (canBook / recommendDay /
-- getDayCapacity) lives in the API service `resource-capacity.ts`; the heavy
-- per-tech shift math stays in SQL (this RPC) so it can't drift from the diary.
--
-- Plan: GMS/RESOURCE_MANAGER.md (§3-§4, §7). ADDITIVE ONLY — idempotent.
-- Deploy via the pipeline (supabase db push).
-- =============================================================================

CREATE OR REPLACE FUNCTION gms_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. Per-category (repair_type) quota rules per site. Protection size is derived
--    from staffing (primary_supply); these are overrides + physical caps + mode.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource_category_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  repair_type_id UUID NOT NULL REFERENCES repair_types(id) ON DELETE CASCADE,
  value_rank SMALLINT NOT NULL DEFAULT 100,        -- tie-break only (lower = preferred)
  protect_primary BOOLEAN NOT NULL DEFAULT true,   -- hold this pool's spare for its own work
  release_window_days INTEGER NOT NULL DEFAULT 5,  -- days over which the hold decays to 0
  min_hours NUMERIC(5,2),                          -- optional manual mix-guarantee floor
  hard_cap_jobs INTEGER, hard_cap_hours NUMERIC(5,2),  -- absolute SITE block (MOT bay / F-Gas)
  enforcement VARCHAR(8) NOT NULL DEFAULT 'soft',  -- 'soft' (warn+override) | 'hard' (block)
  allow_override BOOLEAN NOT NULL DEFAULT true,
  weekday_mask INTEGER NOT NULL DEFAULT 127,       -- bitmask Mon..Sun (which weekdays this rule applies)
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, site_id, repair_type_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_category_quotas_site
  ON resource_category_quotas(organization_id, site_id, is_active);

DROP TRIGGER IF EXISTS trg_resource_category_quotas_updated_at ON resource_category_quotas;
CREATE TRIGGER trg_resource_category_quotas_updated_at
  BEFORE UPDATE ON resource_category_quotas
  FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

ALTER TABLE resource_category_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own org category quotas" ON resource_category_quotas;
CREATE POLICY "Users can view own org category quotas"
  ON resource_category_quotas FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Booking columns: the category a booking counts toward + override recording.
-- ----------------------------------------------------------------------------
ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS primary_repair_type_id UUID REFERENCES repair_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT;

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS primary_repair_type_id UUID REFERENCES repair_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capacity_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT;

COMMENT ON COLUMN health_checks.primary_repair_type_id IS 'The booking dominant category for capacity/quota counting (Resource Manager).';

-- ----------------------------------------------------------------------------
-- 3. Skill-segmented capacity for a site on a date — per repair_type, the staffed
--    hours (primary vs eligible) and summed per-tech daily job cap. Mirrors the
--    per-tech CASE in diary_available_hours() so the magnitude can't drift, then
--    segments by technician_skills.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resource_skill_capacity(
  p_org_id  uuid,
  p_site_id uuid,
  p_date    date
)
RETURNS TABLE (
  repair_type_id  uuid,
  primary_hours   numeric,
  eligible_hours  numeric,
  job_cap_sum     int,
  uncapped_techs  int
)
LANGUAGE sql
STABLE
AS $$
  WITH cfg AS (
    SELECT bookable_hours_per_tech, default_tech_hours
    FROM workshop_board_config
    WHERE organization_id = p_org_id AND site_id = p_site_id
    LIMIT 1
  ),
  techs AS (
    SELECT wc.technician_id, wc.available_hours
    FROM workshop_columns wc
    WHERE wc.site_id = p_site_id
      AND wc.column_type = 'technician'
      AND wc.technician_id IS NOT NULL
      AND wc.is_visible
  ),
  tech_hours AS (
    SELECT t.technician_id,
      GREATEST(0,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM workshop_tech_absences a
            WHERE a.technician_id = t.technician_id AND a.site_id = p_site_id
              AND p_date BETWEEN a.start_date AND a.end_date AND a.all_day
          ) THEN 0
          WHEN EXISTS (SELECT 1 FROM workshop_tech_shifts s WHERE s.technician_id = t.technician_id)
           AND NOT EXISTS (
             SELECT 1 FROM workshop_tech_shifts s
             WHERE s.technician_id = t.technician_id
               AND s.weekday = (EXTRACT(isodow FROM p_date)::int - 1)
           ) THEN 0
          ELSE COALESCE(
            (SELECT bookable_hours_per_tech FROM cfg),
            (SELECT default_tech_hours      FROM cfg),
            t.available_hours, 8
          )
        END
        - COALESCE((
            SELECT SUM(EXTRACT(epoch FROM (a.end_time - a.start_time)) / 3600.0)
            FROM workshop_tech_absences a
            WHERE a.technician_id = t.technician_id AND a.site_id = p_site_id
              AND p_date BETWEEN a.start_date AND a.end_date
              AND NOT a.all_day AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
          ), 0)
      ) AS hours
    FROM techs t
  )
  SELECT
    ts.repair_type_id,
    COALESCE(SUM(th.hours) FILTER (WHERE ts.is_primary), 0)::numeric         AS primary_hours,
    COALESCE(SUM(th.hours), 0)::numeric                                      AS eligible_hours,
    COALESCE(SUM(ts.daily_job_cap) FILTER (WHERE ts.daily_job_cap IS NOT NULL), 0)::int AS job_cap_sum,
    COUNT(*) FILTER (WHERE ts.daily_job_cap IS NULL)::int                    AS uncapped_techs
  FROM technician_skills ts
  JOIN tech_hours th ON th.technician_id = ts.technician_id
  WHERE ts.organization_id = p_org_id AND ts.is_active
  GROUP BY ts.repair_type_id;
$$;

REVOKE ALL ON FUNCTION resource_skill_capacity(uuid, uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION resource_skill_capacity(uuid, uuid, date) TO service_role;
