-- Tyre Reference Data — canonical seed for every organization
-- =============================================================================
-- Purpose
--   New orgs were being provisioned with EMPTY tyre manufacturer/size lists, so
--   the technician tyre pickers showed nothing until someone hand-ran the old
--   apps/api/src/scripts/seed-tyre-data.ts. This migration makes the canonical
--   list a single source of truth in the database and wires it for reuse.
--
-- What it does
--   1. Extends the global load_ratings (111-120) — finishes folding the old
--      standalone script into migrations.
--   2. Defines seed_tyre_reference_for_org(org) — the canonical, INCLUSIVE UK
--      list of tyre makes (~65 + "Other") and sizes (~184: passenger 13"-22",
--      van/LCV "C" reinforced, and larger 4x4/SUV fitments). Called from
--      provisioning (services/provisioning.ts) for every new org.
--   3. One-off cleanup of a malformed hand-entered size ('255/65/R18').
--   4. Idempotent backfill: runs the seeder across all existing orgs so they are
--      topped up with the newly added makes/sizes.
--
-- Idempotency / safety
--   The seeder has NO whole-table guard (unlike seed_follow_up_config_for_org):
--   it relies on ON CONFLICT (organization_id, name|size) DO NOTHING so that
--   re-running it is both safe AND additive — existing rows (including any an
--   org has de-activated or re-sorted) are never overwritten, while genuinely
--   new canonical entries get added. Trade-off: sort_order on pre-existing rows
--   is left as-is, so an org seeded before this migration keeps its original
--   ordering for old rows and gets the computed ordering only on new rows.
-- =============================================================================

-- 1. Global load ratings 111-120 (idempotent) ---------------------------------
INSERT INTO load_ratings (code, max_load_kg, sort_order) VALUES
  ('111', 1090, 42),
  ('112', 1120, 43),
  ('113', 1150, 44),
  ('114', 1180, 45),
  ('115', 1215, 46),
  ('116', 1250, 47),
  ('117', 1285, 48),
  ('118', 1320, 49),
  ('119', 1360, 50),
  ('120', 1400, 51)
ON CONFLICT (code) DO NOTHING;

-- 2. Canonical per-org seeder --------------------------------------------------
CREATE OR REPLACE FUNCTION seed_tyre_reference_for_org(p_organization_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Tyre manufacturers (premium -> mid -> budget -> Other). sort_order in steps
  -- of 10 so future brands can slot between tiers without a renumber.
  INSERT INTO tyre_manufacturers (organization_id, name, sort_order, is_active)
  SELECT p_organization_id, m.name, m.sort_order, true
  FROM (VALUES
    -- Premium
    ('Michelin', 10), ('Continental', 20), ('Pirelli', 30), ('Bridgestone', 40),
    ('Dunlop', 50), ('Goodyear', 60),
    -- Mid-range (incl. brand-group value lines common in the UK)
    ('Hankook', 70), ('Yokohama', 80), ('Falken', 90), ('Kumho', 100),
    ('Toyo', 110), ('Nexen', 120), ('Avon', 130), ('Cooper', 140),
    ('BFGoodrich', 150), ('Firestone', 160), ('General', 170), ('GT Radial', 180),
    ('Maxxis', 190), ('Vredestein', 200), ('Uniroyal', 210), ('Nokian', 220),
    ('Sumitomo', 230), ('Apollo', 240), ('Barum', 250), ('Fulda', 260),
    ('Semperit', 270), ('Matador', 280), ('Kleber', 290), ('Riken', 300),
    ('Sava', 310), ('Marshal', 320),
    -- Budget / economy
    ('Nankang', 330), ('Federal', 340), ('Achilles', 350), ('Accelera', 360),
    ('Landsail', 370), ('Linglong', 380), ('Triangle', 390), ('Westlake', 400),
    ('Zeetex', 410), ('Davanti', 420), ('Churchill', 430), ('Roadstone', 440),
    ('Sailun', 450), ('Rotalla', 460), ('Aoteli', 470), ('Autogreen', 480),
    ('Event', 490), ('Minerva', 500), ('Sonar', 510), ('Hifly', 520),
    ('Imperial', 530), ('Tomket', 540), ('Radar', 550), ('Winrun', 560),
    ('RoadX', 570), ('iLink', 580), ('Pace', 590), ('Sunny', 600),
    ('Goodride', 610), ('Three-A', 620), ('Windforce', 630), ('Infinity', 640),
    ('Tracmax', 650),
    -- Catch-all (always last)
    ('Other', 999)
  ) AS m(name, sort_order)
  ON CONFLICT (organization_id, name) DO NOTHING;

  -- Tyre sizes. sort_order is computed (rim, then width, then profile) so the
  -- list reads naturally; the mobile picker also filters by rim diameter.
  INSERT INTO tyre_sizes (organization_id, size, width, profile, rim_size, sort_order, is_active)
  SELECT p_organization_id, s.size, s.width, s.profile, s.rim,
         s.rim * 100000 + s.width * 100 + s.profile, true
  FROM (VALUES
    -- 13"
    ('155/70R13',155,70,13), ('165/65R13',165,65,13), ('165/70R13',165,70,13),
    ('175/65R13',175,65,13), ('175/70R13',175,70,13), ('185/70R13',185,70,13),
    -- 14"
    ('155/65R14',155,65,14), ('165/60R14',165,60,14), ('165/65R14',165,65,14),
    ('165/70R14',165,70,14), ('175/65R14',175,65,14), ('175/70R14',175,70,14),
    ('185/60R14',185,60,14), ('185/65R14',185,65,14), ('185/70R14',185,70,14),
    -- 15"
    ('175/65R15',175,65,15), ('185/55R15',185,55,15), ('185/60R15',185,60,15),
    ('185/65R15',185,65,15), ('195/50R15',195,50,15), ('195/55R15',195,55,15),
    ('195/60R15',195,60,15), ('195/65R15',195,65,15), ('195/70R15',195,70,15),
    ('205/55R15',205,55,15), ('205/60R15',205,60,15), ('205/65R15',205,65,15),
    ('215/65R15',215,65,15), ('215/70R15',215,70,15),
    -- 16"
    ('195/45R16',195,45,16), ('195/50R16',195,50,16), ('195/55R16',195,55,16),
    ('205/45R16',205,45,16), ('205/50R16',205,50,16), ('205/55R16',205,55,16),
    ('205/60R16',205,60,16), ('205/65R16',205,65,16), ('215/55R16',215,55,16),
    ('215/60R16',215,60,16), ('215/65R16',215,65,16), ('225/50R16',225,50,16),
    ('225/55R16',225,55,16), ('235/60R16',235,60,16), ('235/65R16',235,65,16),
    ('255/70R16',255,70,16),
    -- 17"
    ('205/40R17',205,40,17), ('205/45R17',205,45,17), ('205/50R17',205,50,17),
    ('215/45R17',215,45,17), ('215/50R17',215,50,17), ('215/55R17',215,55,17),
    ('215/60R17',215,60,17), ('225/45R17',225,45,17), ('225/50R17',225,50,17),
    ('225/55R17',225,55,17), ('225/60R17',225,60,17), ('225/65R17',225,65,17),
    ('235/45R17',235,45,17), ('235/50R17',235,50,17), ('235/55R17',235,55,17),
    ('235/60R17',235,60,17), ('235/65R17',235,65,17), ('245/45R17',245,45,17),
    ('245/65R17',245,65,17), ('255/65R17',255,65,17), ('265/65R17',265,65,17),
    ('265/70R17',265,70,17),
    -- 18"
    ('205/40R18',205,40,18), ('215/45R18',215,45,18), ('215/50R18',215,50,18),
    ('225/40R18',225,40,18), ('225/45R18',225,45,18), ('225/50R18',225,50,18),
    ('225/55R18',225,55,18), ('225/60R18',225,60,18), ('235/40R18',235,40,18),
    ('235/45R18',235,45,18), ('235/50R18',235,50,18), ('235/55R18',235,55,18),
    ('235/60R18',235,60,18), ('235/65R18',235,65,18), ('245/40R18',245,40,18),
    ('245/45R18',245,45,18), ('255/35R18',255,35,18), ('255/40R18',255,40,18),
    ('255/45R18',255,45,18), ('255/55R18',255,55,18), ('255/60R18',255,60,18),
    ('255/65R18',255,65,18), ('265/35R18',265,35,18), ('265/60R18',265,60,18),
    ('265/65R18',265,65,18),
    -- 19"
    ('225/35R19',225,35,19), ('225/40R19',225,40,19), ('225/45R19',225,45,19),
    ('225/55R19',225,55,19), ('235/35R19',235,35,19), ('235/40R19',235,40,19),
    ('235/45R19',235,45,19), ('235/50R19',235,50,19), ('235/55R19',235,55,19),
    ('245/35R19',245,35,19), ('245/40R19',245,40,19), ('245/45R19',245,45,19),
    ('245/50R19',245,50,19), ('255/35R19',255,35,19), ('255/40R19',255,40,19),
    ('255/45R19',255,45,19), ('255/50R19',255,50,19), ('255/55R19',255,55,19),
    ('265/30R19',265,30,19), ('265/35R19',265,35,19), ('265/50R19',265,50,19),
    ('275/30R19',275,30,19), ('275/35R19',275,35,19), ('275/40R19',275,40,19),
    -- 20"
    ('225/35R20',225,35,20), ('235/30R20',235,30,20), ('235/35R20',235,35,20),
    ('245/30R20',245,30,20), ('245/35R20',245,35,20), ('245/40R20',245,40,20),
    ('245/45R20',245,45,20), ('245/50R20',245,50,20), ('255/30R20',255,30,20),
    ('255/35R20',255,35,20), ('255/40R20',255,40,20), ('255/45R20',255,45,20),
    ('255/50R20',255,50,20), ('265/30R20',265,30,20), ('265/35R20',265,35,20),
    ('265/40R20',265,40,20), ('265/45R20',265,45,20), ('265/50R20',265,50,20),
    ('275/30R20',275,30,20), ('275/35R20',275,35,20), ('275/40R20',275,40,20),
    ('275/45R20',275,45,20), ('285/30R20',285,30,20), ('285/35R20',285,35,20),
    ('285/40R20',285,40,20), ('285/45R20',285,45,20), ('285/50R20',285,50,20),
    ('295/30R20',295,30,20), ('295/35R20',295,35,20), ('295/40R20',295,40,20),
    -- 21" (premium SUV / performance)
    ('235/45R21',235,45,21), ('245/45R21',245,45,21), ('255/40R21',255,40,21),
    ('265/45R21',265,45,21), ('275/40R21',275,40,21), ('275/45R21',275,45,21),
    ('285/40R21',285,40,21), ('285/45R21',285,45,21), ('295/35R21',295,35,21),
    ('295/40R21',295,40,21),
    -- 22" (large SUV)
    ('265/40R22',265,40,22), ('275/40R22',275,40,22), ('285/35R22',285,35,22),
    ('285/40R22',285,40,22), ('295/35R22',295,35,22), ('315/30R22',315,30,22),
    -- Van / LCV "C" (reinforced) — common UK fitments
    ('195/70R15C',195,70,15), ('205/65R15C',205,65,15), ('215/70R15C',215,70,15),
    ('225/70R15C',225,70,15), ('185/75R16C',185,75,16), ('195/60R16C',195,60,16),
    ('195/65R16C',195,65,16), ('195/75R16C',195,75,16), ('205/65R16C',205,65,16),
    ('205/75R16C',205,75,16), ('215/60R16C',215,60,16), ('215/65R16C',215,65,16),
    ('215/75R16C',215,75,16), ('225/65R16C',225,65,16), ('225/70R16C',225,70,16),
    ('225/75R16C',225,75,16), ('235/65R16C',235,65,16), ('215/60R17C',215,60,17),
    ('215/65R17C',215,65,17), ('235/60R17C',235,60,17), ('235/65R17C',235,65,17)
  ) AS s(size, width, profile, rim)
  ON CONFLICT (organization_id, size) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- 3. One-off cleanup: a hand-entered production size has a stray slash.
--    Normalise it to the canonical form, or drop it if the canonical row exists.
UPDATE tyre_sizes t
   SET size = '255/65R18', width = 255, profile = 65, rim_size = 18
 WHERE t.size = '255/65/R18'
   AND NOT EXISTS (
     SELECT 1 FROM tyre_sizes t2
      WHERE t2.organization_id = t.organization_id AND t2.size = '255/65R18');

DELETE FROM tyre_sizes t
 WHERE t.size = '255/65/R18'
   AND EXISTS (
     SELECT 1 FROM tyre_sizes t2
      WHERE t2.organization_id = t.organization_id AND t2.size = '255/65R18');

-- 4. Backfill every existing org (idempotent; tops up the new makes/sizes).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM seed_tyre_reference_for_org(r.id);
  END LOOP;
END $$;
