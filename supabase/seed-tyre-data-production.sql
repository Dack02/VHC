-- ============================================================
-- Tyre Reference Data Seed Script (Production)
-- Safe to run multiple times - uses ON CONFLICT DO NOTHING
-- ============================================================

-- 1. Create tables if they don't exist
-- ============================================================

CREATE TABLE IF NOT EXISTS speed_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(5) NOT NULL UNIQUE,
  max_speed_kmh INTEGER,
  max_speed_mph INTEGER,
  description VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS load_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(5) NOT NULL UNIQUE,
  max_load_kg INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tyre_manufacturers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tyre_manufacturers_org ON tyre_manufacturers(organization_id);

CREATE TABLE IF NOT EXISTS tyre_sizes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  size VARCHAR(20) NOT NULL,
  width INTEGER,
  profile INTEGER,
  rim_size INTEGER,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, size)
);

CREATE INDEX IF NOT EXISTS idx_tyre_sizes_org ON tyre_sizes(organization_id);

-- RLS Policies (IF NOT EXISTS not supported for policies, so use DO blocks)
ALTER TABLE tyre_manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyre_sizes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tyre_manufacturers' AND policyname = 'Users can view tyre manufacturers in their org') THEN
    CREATE POLICY "Users can view tyre manufacturers in their org"
      ON tyre_manufacturers FOR SELECT
      USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tyre_manufacturers' AND policyname = 'Admins can manage tyre manufacturers') THEN
    CREATE POLICY "Admins can manage tyre manufacturers"
      ON tyre_manufacturers FOR ALL
      USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tyre_sizes' AND policyname = 'Users can view tyre sizes in their org') THEN
    CREATE POLICY "Users can view tyre sizes in their org"
      ON tyre_sizes FOR SELECT
      USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tyre_sizes' AND policyname = 'Admins can manage tyre sizes') THEN
    CREATE POLICY "Admins can manage tyre sizes"
      ON tyre_sizes FOR ALL
      USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;


-- 2. Seed Speed Ratings (global)
-- ============================================================

INSERT INTO speed_ratings (code, max_speed_kmh, max_speed_mph, description, sort_order) VALUES
('N', 140, 87, 'Up to 87 mph', 1),
('P', 150, 93, 'Up to 93 mph', 2),
('Q', 160, 99, 'Up to 99 mph', 3),
('R', 170, 106, 'Up to 106 mph', 4),
('S', 180, 112, 'Up to 112 mph', 5),
('T', 190, 118, 'Up to 118 mph', 6),
('U', 200, 124, 'Up to 124 mph', 7),
('H', 210, 130, 'Up to 130 mph', 8),
('V', 240, 149, 'Up to 149 mph', 9),
('W', 270, 168, 'Up to 168 mph', 10),
('Y', 300, 186, 'Up to 186 mph', 11),
('ZR', 240, 149, 'Over 149 mph', 12)
ON CONFLICT (code) DO NOTHING;


-- 3. Seed Load Ratings (global, 70-120)
-- ============================================================

INSERT INTO load_ratings (code, max_load_kg, sort_order) VALUES
('70', 335, 1),
('71', 345, 2),
('72', 355, 3),
('73', 365, 4),
('74', 375, 5),
('75', 387, 6),
('76', 400, 7),
('77', 412, 8),
('78', 425, 9),
('79', 437, 10),
('80', 450, 11),
('81', 462, 12),
('82', 475, 13),
('83', 487, 14),
('84', 500, 15),
('85', 515, 16),
('86', 530, 17),
('87', 545, 18),
('88', 560, 19),
('89', 580, 20),
('90', 600, 21),
('91', 615, 22),
('92', 630, 23),
('93', 650, 24),
('94', 670, 25),
('95', 690, 26),
('96', 710, 27),
('97', 730, 28),
('98', 750, 29),
('99', 775, 30),
('100', 800, 31),
('101', 825, 32),
('102', 850, 33),
('103', 875, 34),
('104', 900, 35),
('105', 925, 36),
('106', 950, 37),
('107', 975, 38),
('108', 1000, 39),
('109', 1030, 40),
('110', 1060, 41),
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


-- 4. Seed Tyre Manufacturers (for ALL organizations)
-- ============================================================

INSERT INTO tyre_manufacturers (organization_id, name, is_active, sort_order)
SELECT o.id, m.name, true, m.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Michelin', 1),
  ('Continental', 2),
  ('Pirelli', 3),
  ('Bridgestone', 4),
  ('Dunlop', 5),
  ('Goodyear', 6),
  ('Hankook', 7),
  ('Yokohama', 8),
  ('Falken', 9),
  ('Kumho', 10),
  ('Toyo', 11),
  ('Nexen', 12),
  ('Avon', 13),
  ('Cooper', 14),
  ('BFGoodrich', 15),
  ('Firestone', 16),
  ('General', 17),
  ('GT Radial', 18),
  ('Maxxis', 19),
  ('Vredestein', 20),
  ('Uniroyal', 21),
  ('Nankang', 22),
  ('Federal', 23),
  ('Achilles', 24),
  ('Accelera', 25),
  ('Landsail', 26),
  ('Linglong', 27),
  ('Triangle', 28),
  ('Westlake', 29),
  ('Zeetex', 30),
  ('Davanti', 31),
  ('Churchill', 32),
  ('Roadstone', 33),
  ('Sailun', 34),
  ('Rotalla', 35),
  ('Aoteli', 36),
  ('Autogreen', 37),
  ('Event', 38),
  ('Minerva', 39),
  ('Sonar', 40),
  ('Other', 41)
) AS m(name, sort_order)
ON CONFLICT (organization_id, name) DO NOTHING;


-- 5. Seed Tyre Sizes (for ALL organizations)
-- ============================================================

INSERT INTO tyre_sizes (organization_id, size, width, profile, rim_size, is_active, sort_order)
SELECT o.id, s.size, s.width, s.profile, s.rim_size, true, s.sort_order
FROM organizations o
CROSS JOIN (VALUES
  -- 14 inch
  ('155/65R14', 155, 65, 14, 1),
  ('165/60R14', 165, 60, 14, 2),
  ('165/65R14', 165, 65, 14, 3),
  ('165/70R14', 165, 70, 14, 4),
  ('175/65R14', 175, 65, 14, 5),
  ('175/70R14', 175, 70, 14, 6),
  ('185/60R14', 185, 60, 14, 7),
  ('185/65R14', 185, 65, 14, 8),
  ('185/70R14', 185, 70, 14, 9),
  -- 15 inch
  ('175/65R15', 175, 65, 15, 10),
  ('185/55R15', 185, 55, 15, 11),
  ('185/60R15', 185, 60, 15, 12),
  ('185/65R15', 185, 65, 15, 13),
  ('195/50R15', 195, 50, 15, 14),
  ('195/55R15', 195, 55, 15, 15),
  ('195/60R15', 195, 60, 15, 16),
  ('195/65R15', 195, 65, 15, 17),
  ('205/55R15', 205, 55, 15, 18),
  ('205/60R15', 205, 60, 15, 19),
  ('205/65R15', 205, 65, 15, 20),
  -- 16 inch
  ('195/45R16', 195, 45, 16, 21),
  ('195/55R16', 195, 55, 16, 22),
  ('205/45R16', 205, 45, 16, 23),
  ('205/50R16', 205, 50, 16, 24),
  ('205/55R16', 205, 55, 16, 25),
  ('205/60R16', 205, 60, 16, 26),
  ('215/55R16', 215, 55, 16, 27),
  ('215/60R16', 215, 60, 16, 28),
  ('215/65R16', 215, 65, 16, 29),
  ('225/50R16', 225, 50, 16, 30),
  ('225/55R16', 225, 55, 16, 31),
  -- 17 inch
  ('205/45R17', 205, 45, 17, 32),
  ('205/50R17', 205, 50, 17, 33),
  ('215/45R17', 215, 45, 17, 34),
  ('215/50R17', 215, 50, 17, 35),
  ('215/55R17', 215, 55, 17, 36),
  ('225/45R17', 225, 45, 17, 37),
  ('225/50R17', 225, 50, 17, 38),
  ('225/55R17', 225, 55, 17, 39),
  ('235/45R17', 235, 45, 17, 40),
  ('235/55R17', 235, 55, 17, 41),
  ('245/45R17', 245, 45, 17, 42),
  -- 18 inch
  ('215/45R18', 215, 45, 18, 43),
  ('225/40R18', 225, 40, 18, 44),
  ('225/45R18', 225, 45, 18, 45),
  ('225/50R18', 225, 50, 18, 46),
  ('235/40R18', 235, 40, 18, 47),
  ('235/45R18', 235, 45, 18, 48),
  ('235/50R18', 235, 50, 18, 49),
  ('235/55R18', 235, 55, 18, 50),
  ('245/40R18', 245, 40, 18, 51),
  ('245/45R18', 245, 45, 18, 52),
  ('255/35R18', 255, 35, 18, 53),
  ('255/40R18', 255, 40, 18, 54),
  ('255/45R18', 255, 45, 18, 55),
  ('265/35R18', 265, 35, 18, 56),
  -- 19 inch
  ('225/35R19', 225, 35, 19, 57),
  ('225/40R19', 225, 40, 19, 58),
  ('225/45R19', 225, 45, 19, 59),
  ('235/35R19', 235, 35, 19, 60),
  ('235/40R19', 235, 40, 19, 61),
  ('245/35R19', 245, 35, 19, 62),
  ('245/40R19', 245, 40, 19, 63),
  ('245/45R19', 245, 45, 19, 64),
  ('255/35R19', 255, 35, 19, 65),
  ('255/40R19', 255, 40, 19, 66),
  ('265/30R19', 265, 30, 19, 67),
  ('265/35R19', 265, 35, 19, 68),
  ('275/30R19', 275, 30, 19, 69),
  ('275/35R19', 275, 35, 19, 70),
  -- 20 inch
  ('225/35R20', 225, 35, 20, 71),
  ('235/30R20', 235, 30, 20, 72),
  ('235/35R20', 235, 35, 20, 73),
  ('245/30R20', 245, 30, 20, 74),
  ('245/35R20', 245, 35, 20, 75),
  ('245/40R20', 245, 40, 20, 76),
  ('255/30R20', 255, 30, 20, 77),
  ('255/35R20', 255, 35, 20, 78),
  ('255/40R20', 255, 40, 20, 79),
  ('265/30R20', 265, 30, 20, 80),
  ('265/35R20', 265, 35, 20, 81),
  ('275/30R20', 275, 30, 20, 82),
  ('275/35R20', 275, 35, 20, 83),
  ('285/30R20', 285, 30, 20, 84),
  ('285/35R20', 285, 35, 20, 85),
  ('295/30R20', 295, 30, 20, 86),
  ('295/35R20', 295, 35, 20, 87)
) AS s(size, width, profile, rim_size, sort_order)
ON CONFLICT (organization_id, size) DO NOTHING;


-- 6. Summary
-- ============================================================

SELECT 'Speed Ratings' AS table_name, COUNT(*) AS row_count FROM speed_ratings
UNION ALL
SELECT 'Load Ratings', COUNT(*) FROM load_ratings
UNION ALL
SELECT 'Tyre Manufacturers', COUNT(*) FROM tyre_manufacturers
UNION ALL
SELECT 'Tyre Sizes', COUNT(*) FROM tyre_sizes;
