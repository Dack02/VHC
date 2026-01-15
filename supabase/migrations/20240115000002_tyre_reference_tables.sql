-- Tyre Reference Tables Migration
-- Creates tables for tyre manufacturers, sizes, speed ratings, and load ratings

-- Speed Ratings (global, pre-seeded)
CREATE TABLE IF NOT EXISTS speed_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(5) NOT NULL UNIQUE,
  max_speed_kmh INTEGER,
  max_speed_mph INTEGER,
  description VARCHAR(50),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Load Ratings (global, pre-seeded)
CREATE TABLE IF NOT EXISTS load_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(5) NOT NULL UNIQUE,
  max_load_kg INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tyre Manufacturers (per organization)
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

-- Tyre Sizes (per organization)
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

-- Seed Speed Ratings
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

-- Seed Load Ratings (common ones 70-110)
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
('110', 1060, 41)
ON CONFLICT (code) DO NOTHING;

-- RLS Policies for tyre_manufacturers
ALTER TABLE tyre_manufacturers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tyre manufacturers in their org"
  ON tyre_manufacturers FOR SELECT
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY "Admins can manage tyre manufacturers"
  ON tyre_manufacturers FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- RLS Policies for tyre_sizes
ALTER TABLE tyre_sizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tyre sizes in their org"
  ON tyre_sizes FOR SELECT
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY "Admins can manage tyre sizes"
  ON tyre_sizes FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Speed and load ratings are global, no RLS needed (read-only for all)
