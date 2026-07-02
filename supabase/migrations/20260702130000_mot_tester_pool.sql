-- MOT tester routing — Phase 1: the per-site designated MOT tester pool
-- =================================================================
-- Some garages have designated MOT tester(s). When a job carries an MOT plus
-- other repairs, the MOT line is assigned to a tester and the rest to another
-- technician (one jobsheet, split lines — see GMS/MOT_TESTER_ROUTING.md).
--
-- Designation is this list, NOT a certificate: being listed here for a site IS
-- the qualification. `technician_certifications` stays as optional metadata and
-- never gates membership or assignment.
--
-- Ordered pool: `priority` (1 = filled first) + optional `daily_mot_cap`
-- ("Ian's slots"). Phase 2 auto-assign walks the pool by priority until the
-- first cap bites — the tester's own cap OR the site bay cap
-- (resource_site_config.mot_daily_cap) — then overflows to the next tester.

CREATE TABLE IF NOT EXISTS site_mot_testers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  technician_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority        SMALLINT NOT NULL DEFAULT 1,   -- 1 = filled first
  daily_mot_cap   SMALLINT,                       -- null = no per-tester cap (bay cap still applies)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, technician_id)
);

COMMENT ON TABLE site_mot_testers IS
  'Per-site designated MOT tester pool. Membership = designation (no cert required). Ordered by priority; daily_mot_cap is the per-tester slot count for Phase 2 auto-assign overflow.';
COMMENT ON COLUMN site_mot_testers.priority IS 'Fill order for auto-assign; 1 = filled first, overflow to higher numbers.';
COMMENT ON COLUMN site_mot_testers.daily_mot_cap IS 'Max MOTs to route to this tester per day before overflow. NULL = no per-tester cap (site bay cap still applies).';

CREATE INDEX IF NOT EXISTS idx_site_mot_testers_site
  ON site_mot_testers(site_id, priority) WHERE is_active;
