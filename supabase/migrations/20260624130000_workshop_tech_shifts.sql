-- =============================================================================
-- Per-technician working hours (shifts) + one-off absences.
--
-- Replaces the flat workshop_columns.available_hours assumption with a real
-- weekly pattern per technician plus holiday/sick/training absences, so the
-- planner's capacity reflects who is actually in and for how long. Deliberately
-- small: a recurring weekday pattern + dated absences, not a full rota engine.
--
-- Fully additive + idempotent. No destructive operations. The API uses the
-- service role (bypasses RLS); the SELECT policies mirror the other workshop
-- tables as a safety net.
-- =============================================================================

-- Recurring weekly pattern: one row per (technician, weekday) they work.
-- weekday 0=Mon … 6=Sun (matches the Monday-anchored weekStart() helper).
-- A missing weekday row = that tech doesn't work that day (capacity 0).
CREATE TABLE IF NOT EXISTS workshop_tech_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL DEFAULT '08:00',
  end_time   TIME NOT NULL DEFAULT '17:30',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (technician_id, weekday),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_tech_shifts_lookup
  ON workshop_tech_shifts(organization_id, site_id, technician_id, weekday);

-- One-off absences: holiday / sick / training. Inclusive date range.
-- NULL times = all-day (all_day true); otherwise a partial-day window.
CREATE TABLE IF NOT EXISTS workshop_tech_absences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  start_time TIME,
  end_time   TIME,
  all_day BOOLEAN NOT NULL DEFAULT true,
  reason VARCHAR(40),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_tech_absences_range
  ON workshop_tech_absences(organization_id, site_id, technician_id, start_date, end_date);

ALTER TABLE workshop_tech_shifts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_tech_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own org tech shifts" ON workshop_tech_shifts;
CREATE POLICY "Users can view own org tech shifts"
  ON workshop_tech_shifts FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own org tech absences" ON workshop_tech_absences;
CREATE POLICY "Users can view own org tech absences"
  ON workshop_tech_absences FOR SELECT
  USING (organization_id IN (SELECT organization_id FROM users WHERE auth_id = auth.uid()));
