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

const ORG_ID = '11111111-1111-1111-1111-111111111111'

async function seedTyreData() {
  console.log('Seeding tyre data for organization...')

  // Seed tyre manufacturers
  const manufacturers = [
    'Michelin',
    'Continental',
    'Pirelli',
    'Bridgestone',
    'Dunlop',
    'Goodyear',
    'Hankook',
    'Yokohama',
    'Kumho',
    'Falken',
    'Toyo',
    'BFGoodrich',
    'Uniroyal',
    'Vredestein',
    'Nexen',
    'Avon',
    'Cooper',
    'Firestone',
    'GT Radial',
    'Maxxis',
    'Nankang',
    'Accelera',
    'Achilles',
    'Other'
  ]

  console.log('Seeding tyre manufacturers...')
  for (let i = 0; i < manufacturers.length; i++) {
    const { error } = await supabase
      .from('tyre_manufacturers')
      .upsert({
        organization_id: ORG_ID,
        name: manufacturers[i],
        sort_order: i + 1,
        is_active: true
      }, { onConflict: 'organization_id,name' })

    if (error) {
      console.error(`Failed to insert manufacturer ${manufacturers[i]}:`, error.message)
    }
  }
  console.log(`Seeded ${manufacturers.length} manufacturers.`)

  // Seed common tyre sizes
  const tyreSizes = [
    { size: '155/65R14', width: 155, profile: 65, rim_size: 14 },
    { size: '165/65R14', width: 165, profile: 65, rim_size: 14 },
    { size: '175/65R14', width: 175, profile: 65, rim_size: 14 },
    { size: '185/65R14', width: 185, profile: 65, rim_size: 14 },
    { size: '185/65R15', width: 185, profile: 65, rim_size: 15 },
    { size: '195/65R15', width: 195, profile: 65, rim_size: 15 },
    { size: '195/55R16', width: 195, profile: 55, rim_size: 16 },
    { size: '205/55R16', width: 205, profile: 55, rim_size: 16 },
    { size: '205/60R16', width: 205, profile: 60, rim_size: 16 },
    { size: '215/55R16', width: 215, profile: 55, rim_size: 16 },
    { size: '215/55R17', width: 215, profile: 55, rim_size: 17 },
    { size: '215/45R17', width: 215, profile: 45, rim_size: 17 },
    { size: '225/45R17', width: 225, profile: 45, rim_size: 17 },
    { size: '225/50R17', width: 225, profile: 50, rim_size: 17 },
    { size: '225/55R17', width: 225, profile: 55, rim_size: 17 },
    { size: '225/40R18', width: 225, profile: 40, rim_size: 18 },
    { size: '225/45R18', width: 225, profile: 45, rim_size: 18 },
    { size: '235/45R18', width: 235, profile: 45, rim_size: 18 },
    { size: '235/55R18', width: 235, profile: 55, rim_size: 18 },
    { size: '245/45R18', width: 245, profile: 45, rim_size: 18 },
    { size: '245/40R18', width: 245, profile: 40, rim_size: 18 },
    { size: '255/35R18', width: 255, profile: 35, rim_size: 18 },
    { size: '255/35R19', width: 255, profile: 35, rim_size: 19 },
    { size: '255/40R19', width: 255, profile: 40, rim_size: 19 },
    { size: '265/35R19', width: 265, profile: 35, rim_size: 19 },
    { size: '275/35R19', width: 275, profile: 35, rim_size: 19 },
    { size: '275/35R20', width: 275, profile: 35, rim_size: 20 },
    { size: '285/35R20', width: 285, profile: 35, rim_size: 20 },
    { size: '295/35R20', width: 295, profile: 35, rim_size: 20 }
  ]

  console.log('Seeding tyre sizes...')
  for (let i = 0; i < tyreSizes.length; i++) {
    const { error } = await supabase
      .from('tyre_sizes')
      .upsert({
        organization_id: ORG_ID,
        ...tyreSizes[i],
        sort_order: i + 1,
        is_active: true
      }, { onConflict: 'organization_id,size' })

    if (error) {
      console.error(`Failed to insert size ${tyreSizes[i].size}:`, error.message)
    }
  }
  console.log(`Seeded ${tyreSizes.length} sizes.`)

  console.log('\nTyre data seeding complete!')
}

seedTyreData().catch(console.error)
