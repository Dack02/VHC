-- =============================================================================
-- Technician Job Clocking — schema foundation
-- Spec: docs/technician-job-clocking-spec.md (§3)
--
-- Expands technician clocking from a single inspection timer to a job-level
-- model: configurable time categories (productive vs indirect), a carved-out
-- health-check time, optional shop-level indirect time (no job), and the
-- columns the stale-clock auto-close needs.
--
-- Fully additive + idempotent. No destructive operations.
-- =============================================================================

-- 1. Configurable, org-scoped time categories -------------------------------
CREATE TABLE IF NOT EXISTS time_entry_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,                 -- stable slug, e.g. 'inspection'
  label VARCHAR(100) NOT NULL,              -- display label
  kind VARCHAR(20) NOT NULL,                -- 'productive' | 'indirect'
  is_health_check BOOLEAN DEFAULT false,    -- carves out HC time; max one per org
  counts_toward_job BOOLEAN DEFAULT true,   -- productive => true; indirect => false
  colour VARCHAR(7),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,          -- seeded Inspection/Repair: renamable, not deletable
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_time_entry_categories_org ON time_entry_categories(organization_id);
-- At most one health-check category per organisation
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entry_categories_health_check
  ON time_entry_categories(organization_id) WHERE is_health_check;

-- 2. technician_time_entries — new columns + relax health_check_id -----------
-- health_check_id becomes nullable so a shop-level indirect segment (cleaning,
-- training) can exist with no job. Productive segments still require a job —
-- enforced in the API.
ALTER TABLE technician_time_entries ALTER COLUMN health_check_id DROP NOT NULL;

ALTER TABLE technician_time_entries
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES time_entry_categories(id),
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id),
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(30);  -- 'manual' | 'auto_eod' | 'reclock'

CREATE INDEX IF NOT EXISTS idx_time_entries_category ON technician_time_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_org ON technician_time_entries(organization_id);

-- 3. organization_settings — master toggle + auto-close config ---------------
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS indirect_time_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_segment_stale_minutes INTEGER DEFAULT 600, -- ignore/close open segments older than this
  ADD COLUMN IF NOT EXISTS auto_close_at_eod BOOLEAN DEFAULT true;

-- 4. Seed default categories per organisation -------------------------------
-- Inspection + Repair are system (productive); indirect rows ship disabled so
-- existing orgs see no behaviour change until they opt in.
INSERT INTO time_entry_categories
  (organization_id, key, label, kind, is_health_check, counts_toward_job, colour, sort_order, is_active, is_system)
SELECT o.id, c.key, c.label, c.kind, c.is_health_check, c.counts_toward_job, c.colour, c.sort_order, c.is_active, c.is_system
FROM organizations o
CROSS JOIN (VALUES
  ('inspection',            'Inspection',                'productive', true,  true,  '#6366F1', 10, true,  true),
  ('repair',                'Repair',                    'productive', false, true,  '#0D9488', 20, true,  true),
  ('waiting_parts',         'Waiting for parts',         'indirect',   false, false, '#D97706', 30, false, false),
  ('waiting_authorisation', 'Waiting for authorisation', 'indirect',   false, false, '#CA8A04', 40, false, false),
  ('break',                 'Break',                     'indirect',   false, false, '#64748B', 50, false, false),
  ('internal',              'Internal',                  'indirect',   false, false, '#7C3AED', 60, false, false)
) AS c(key, label, kind, is_health_check, counts_toward_job, colour, sort_order, is_active, is_system)
ON CONFLICT (organization_id, key) DO NOTHING;

-- 5. Backfill existing entries to Inspection + populate org/site from the HC --
UPDATE technician_time_entries te
SET category_id = tec.id,
    organization_id = hc.organization_id,
    site_id = hc.site_id
FROM health_checks hc
JOIN time_entry_categories tec
  ON tec.organization_id = hc.organization_id AND tec.key = 'inspection'
WHERE te.health_check_id = hc.id
  AND te.category_id IS NULL;
