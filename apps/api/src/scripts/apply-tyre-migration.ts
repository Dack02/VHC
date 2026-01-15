import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function applyMigration() {
  console.log('Applying tyre reference tables migration...')

  // Create speed_ratings table
  const { error: speedError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS speed_ratings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(5) NOT NULL,
        max_speed_kmh INTEGER,
        max_speed_mph INTEGER,
        description VARCHAR(50),
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS speed_ratings_code_idx ON speed_ratings(code);
    `
  })

  if (speedError) {
    // Table might already exist, try inserting data directly
    console.log('speed_ratings table may already exist, continuing...')
  }

  // Create load_ratings table
  const { error: loadError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS load_ratings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        code VARCHAR(5) NOT NULL,
        max_load_kg INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS load_ratings_code_idx ON load_ratings(code);
    `
  })

  if (loadError) {
    console.log('load_ratings table may already exist, continuing...')
  }

  // Create tyre_manufacturers table
  const { error: mfgError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS tyre_manufacturers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tyre_manufacturers_org ON tyre_manufacturers(organization_id);
    `
  })

  if (mfgError) {
    console.log('tyre_manufacturers table may already exist, continuing...')
  }

  // Create tyre_sizes table
  const { error: sizesError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS tyre_sizes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        size VARCHAR(20) NOT NULL,
        width INTEGER,
        profile INTEGER,
        rim_size INTEGER,
        is_active BOOLEAN DEFAULT true,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tyre_sizes_org ON tyre_sizes(organization_id);
    `
  })

  if (sizesError) {
    console.log('tyre_sizes table may already exist, continuing...')
  }

  console.log('Tables created (or already exist).')

  // Seed speed ratings
  const speedRatings = [
    { code: 'N', max_speed_kmh: 140, max_speed_mph: 87, description: 'Up to 87 mph', sort_order: 1 },
    { code: 'P', max_speed_kmh: 150, max_speed_mph: 93, description: 'Up to 93 mph', sort_order: 2 },
    { code: 'Q', max_speed_kmh: 160, max_speed_mph: 99, description: 'Up to 99 mph', sort_order: 3 },
    { code: 'R', max_speed_kmh: 170, max_speed_mph: 106, description: 'Up to 106 mph', sort_order: 4 },
    { code: 'S', max_speed_kmh: 180, max_speed_mph: 112, description: 'Up to 112 mph', sort_order: 5 },
    { code: 'T', max_speed_kmh: 190, max_speed_mph: 118, description: 'Up to 118 mph', sort_order: 6 },
    { code: 'U', max_speed_kmh: 200, max_speed_mph: 124, description: 'Up to 124 mph', sort_order: 7 },
    { code: 'H', max_speed_kmh: 210, max_speed_mph: 130, description: 'Up to 130 mph', sort_order: 8 },
    { code: 'V', max_speed_kmh: 240, max_speed_mph: 149, description: 'Up to 149 mph', sort_order: 9 },
    { code: 'W', max_speed_kmh: 270, max_speed_mph: 168, description: 'Up to 168 mph', sort_order: 10 },
    { code: 'Y', max_speed_kmh: 300, max_speed_mph: 186, description: 'Up to 186 mph', sort_order: 11 },
    { code: 'ZR', max_speed_kmh: 240, max_speed_mph: 149, description: 'Over 149 mph', sort_order: 12 }
  ]

  console.log('Seeding speed ratings...')
  for (const rating of speedRatings) {
    const { error } = await supabase
      .from('speed_ratings')
      .upsert(rating, { onConflict: 'code' })
    if (error && !error.message.includes('duplicate')) {
      console.error(`Failed to insert speed rating ${rating.code}:`, error.message)
    }
  }

  // Seed load ratings (70-110)
  const loadRatings = [
    { code: '70', max_load_kg: 335, sort_order: 1 },
    { code: '71', max_load_kg: 345, sort_order: 2 },
    { code: '72', max_load_kg: 355, sort_order: 3 },
    { code: '73', max_load_kg: 365, sort_order: 4 },
    { code: '74', max_load_kg: 375, sort_order: 5 },
    { code: '75', max_load_kg: 387, sort_order: 6 },
    { code: '76', max_load_kg: 400, sort_order: 7 },
    { code: '77', max_load_kg: 412, sort_order: 8 },
    { code: '78', max_load_kg: 425, sort_order: 9 },
    { code: '79', max_load_kg: 437, sort_order: 10 },
    { code: '80', max_load_kg: 450, sort_order: 11 },
    { code: '81', max_load_kg: 462, sort_order: 12 },
    { code: '82', max_load_kg: 475, sort_order: 13 },
    { code: '83', max_load_kg: 487, sort_order: 14 },
    { code: '84', max_load_kg: 500, sort_order: 15 },
    { code: '85', max_load_kg: 515, sort_order: 16 },
    { code: '86', max_load_kg: 530, sort_order: 17 },
    { code: '87', max_load_kg: 545, sort_order: 18 },
    { code: '88', max_load_kg: 560, sort_order: 19 },
    { code: '89', max_load_kg: 580, sort_order: 20 },
    { code: '90', max_load_kg: 600, sort_order: 21 },
    { code: '91', max_load_kg: 615, sort_order: 22 },
    { code: '92', max_load_kg: 630, sort_order: 23 },
    { code: '93', max_load_kg: 650, sort_order: 24 },
    { code: '94', max_load_kg: 670, sort_order: 25 },
    { code: '95', max_load_kg: 690, sort_order: 26 },
    { code: '96', max_load_kg: 710, sort_order: 27 },
    { code: '97', max_load_kg: 730, sort_order: 28 },
    { code: '98', max_load_kg: 750, sort_order: 29 },
    { code: '99', max_load_kg: 775, sort_order: 30 },
    { code: '100', max_load_kg: 800, sort_order: 31 },
    { code: '101', max_load_kg: 825, sort_order: 32 },
    { code: '102', max_load_kg: 850, sort_order: 33 },
    { code: '103', max_load_kg: 875, sort_order: 34 },
    { code: '104', max_load_kg: 900, sort_order: 35 },
    { code: '105', max_load_kg: 925, sort_order: 36 },
    { code: '106', max_load_kg: 950, sort_order: 37 },
    { code: '107', max_load_kg: 975, sort_order: 38 },
    { code: '108', max_load_kg: 1000, sort_order: 39 },
    { code: '109', max_load_kg: 1030, sort_order: 40 },
    { code: '110', max_load_kg: 1060, sort_order: 41 }
  ]

  console.log('Seeding load ratings...')
  for (const rating of loadRatings) {
    const { error } = await supabase
      .from('load_ratings')
      .upsert(rating, { onConflict: 'code' })
    if (error && !error.message.includes('duplicate')) {
      console.error(`Failed to insert load rating ${rating.code}:`, error.message)
    }
  }

  console.log('Speed and load ratings seeded.')
}

applyMigration().catch(console.error)
