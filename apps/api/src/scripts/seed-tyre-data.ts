/**
 * Tyre Reference Data Seed Script
 * Seeds tyre manufacturers, sizes, and extends load ratings for all organizations
 */

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

// UK Tyre Manufacturers (30+ brands)
const manufacturers = [
  // Premium brands
  'Michelin',
  'Continental',
  'Pirelli',
  'Bridgestone',
  'Dunlop',
  'Goodyear',
  // Mid-range brands
  'Hankook',
  'Yokohama',
  'Falken',
  'Kumho',
  'Toyo',
  'Nexen',
  'Avon',
  'Cooper',
  'BFGoodrich',
  'Firestone',
  'General',
  'GT Radial',
  'Maxxis',
  'Vredestein',
  'Uniroyal',
  // Budget/Economy brands
  'Nankang',
  'Federal',
  'Achilles',
  'Accelera',
  'Landsail',
  'Linglong',
  'Triangle',
  'Westlake',
  'Zeetex',
  'Davanti',
  'Churchill',
  'Roadstone',
  'Sailun',
  'Rotalla',
  'Aoteli',
  'Autogreen',
  'Event',
  'Minerva',
  'Sonar',
  'Other'
]

// Common UK Tyre Sizes (14" to 20" rims)
const tyreSizes = [
  // 14 inch
  { size: '155/65R14', width: 155, profile: 65, rim_size: 14 },
  { size: '165/60R14', width: 165, profile: 60, rim_size: 14 },
  { size: '165/65R14', width: 165, profile: 65, rim_size: 14 },
  { size: '165/70R14', width: 165, profile: 70, rim_size: 14 },
  { size: '175/65R14', width: 175, profile: 65, rim_size: 14 },
  { size: '175/70R14', width: 175, profile: 70, rim_size: 14 },
  { size: '185/60R14', width: 185, profile: 60, rim_size: 14 },
  { size: '185/65R14', width: 185, profile: 65, rim_size: 14 },
  { size: '185/70R14', width: 185, profile: 70, rim_size: 14 },
  // 15 inch
  { size: '175/65R15', width: 175, profile: 65, rim_size: 15 },
  { size: '185/55R15', width: 185, profile: 55, rim_size: 15 },
  { size: '185/60R15', width: 185, profile: 60, rim_size: 15 },
  { size: '185/65R15', width: 185, profile: 65, rim_size: 15 },
  { size: '195/50R15', width: 195, profile: 50, rim_size: 15 },
  { size: '195/55R15', width: 195, profile: 55, rim_size: 15 },
  { size: '195/60R15', width: 195, profile: 60, rim_size: 15 },
  { size: '195/65R15', width: 195, profile: 65, rim_size: 15 },
  { size: '205/55R15', width: 205, profile: 55, rim_size: 15 },
  { size: '205/60R15', width: 205, profile: 60, rim_size: 15 },
  { size: '205/65R15', width: 205, profile: 65, rim_size: 15 },
  // 16 inch
  { size: '195/45R16', width: 195, profile: 45, rim_size: 16 },
  { size: '195/55R16', width: 195, profile: 55, rim_size: 16 },
  { size: '205/45R16', width: 205, profile: 45, rim_size: 16 },
  { size: '205/50R16', width: 205, profile: 50, rim_size: 16 },
  { size: '205/55R16', width: 205, profile: 55, rim_size: 16 },
  { size: '205/60R16', width: 205, profile: 60, rim_size: 16 },
  { size: '215/55R16', width: 215, profile: 55, rim_size: 16 },
  { size: '215/60R16', width: 215, profile: 60, rim_size: 16 },
  { size: '215/65R16', width: 215, profile: 65, rim_size: 16 },
  { size: '225/50R16', width: 225, profile: 50, rim_size: 16 },
  { size: '225/55R16', width: 225, profile: 55, rim_size: 16 },
  // 17 inch
  { size: '205/45R17', width: 205, profile: 45, rim_size: 17 },
  { size: '205/50R17', width: 205, profile: 50, rim_size: 17 },
  { size: '215/45R17', width: 215, profile: 45, rim_size: 17 },
  { size: '215/50R17', width: 215, profile: 50, rim_size: 17 },
  { size: '215/55R17', width: 215, profile: 55, rim_size: 17 },
  { size: '225/45R17', width: 225, profile: 45, rim_size: 17 },
  { size: '225/50R17', width: 225, profile: 50, rim_size: 17 },
  { size: '225/55R17', width: 225, profile: 55, rim_size: 17 },
  { size: '235/45R17', width: 235, profile: 45, rim_size: 17 },
  { size: '235/55R17', width: 235, profile: 55, rim_size: 17 },
  { size: '245/45R17', width: 245, profile: 45, rim_size: 17 },
  // 18 inch
  { size: '215/45R18', width: 215, profile: 45, rim_size: 18 },
  { size: '225/40R18', width: 225, profile: 40, rim_size: 18 },
  { size: '225/45R18', width: 225, profile: 45, rim_size: 18 },
  { size: '225/50R18', width: 225, profile: 50, rim_size: 18 },
  { size: '235/40R18', width: 235, profile: 40, rim_size: 18 },
  { size: '235/45R18', width: 235, profile: 45, rim_size: 18 },
  { size: '235/50R18', width: 235, profile: 50, rim_size: 18 },
  { size: '235/55R18', width: 235, profile: 55, rim_size: 18 },
  { size: '245/40R18', width: 245, profile: 40, rim_size: 18 },
  { size: '245/45R18', width: 245, profile: 45, rim_size: 18 },
  { size: '255/35R18', width: 255, profile: 35, rim_size: 18 },
  { size: '255/40R18', width: 255, profile: 40, rim_size: 18 },
  { size: '255/45R18', width: 255, profile: 45, rim_size: 18 },
  { size: '265/35R18', width: 265, profile: 35, rim_size: 18 },
  // 19 inch
  { size: '225/35R19', width: 225, profile: 35, rim_size: 19 },
  { size: '225/40R19', width: 225, profile: 40, rim_size: 19 },
  { size: '225/45R19', width: 225, profile: 45, rim_size: 19 },
  { size: '235/35R19', width: 235, profile: 35, rim_size: 19 },
  { size: '235/40R19', width: 235, profile: 40, rim_size: 19 },
  { size: '245/35R19', width: 245, profile: 35, rim_size: 19 },
  { size: '245/40R19', width: 245, profile: 40, rim_size: 19 },
  { size: '245/45R19', width: 245, profile: 45, rim_size: 19 },
  { size: '255/35R19', width: 255, profile: 35, rim_size: 19 },
  { size: '255/40R19', width: 255, profile: 40, rim_size: 19 },
  { size: '265/30R19', width: 265, profile: 30, rim_size: 19 },
  { size: '265/35R19', width: 265, profile: 35, rim_size: 19 },
  { size: '275/30R19', width: 275, profile: 30, rim_size: 19 },
  { size: '275/35R19', width: 275, profile: 35, rim_size: 19 },
  // 20 inch
  { size: '225/35R20', width: 225, profile: 35, rim_size: 20 },
  { size: '235/30R20', width: 235, profile: 30, rim_size: 20 },
  { size: '235/35R20', width: 235, profile: 35, rim_size: 20 },
  { size: '245/30R20', width: 245, profile: 30, rim_size: 20 },
  { size: '245/35R20', width: 245, profile: 35, rim_size: 20 },
  { size: '245/40R20', width: 245, profile: 40, rim_size: 20 },
  { size: '255/30R20', width: 255, profile: 30, rim_size: 20 },
  { size: '255/35R20', width: 255, profile: 35, rim_size: 20 },
  { size: '255/40R20', width: 255, profile: 40, rim_size: 20 },
  { size: '265/30R20', width: 265, profile: 30, rim_size: 20 },
  { size: '265/35R20', width: 265, profile: 35, rim_size: 20 },
  { size: '275/30R20', width: 275, profile: 30, rim_size: 20 },
  { size: '275/35R20', width: 275, profile: 35, rim_size: 20 },
  { size: '285/30R20', width: 285, profile: 30, rim_size: 20 },
  { size: '285/35R20', width: 285, profile: 35, rim_size: 20 },
  { size: '295/30R20', width: 295, profile: 30, rim_size: 20 },
  { size: '295/35R20', width: 295, profile: 35, rim_size: 20 }
]

// Additional Load Ratings (111-120) to extend the migration seed
const additionalLoadRatings = [
  { code: '111', max_load_kg: 1090, sort_order: 42 },
  { code: '112', max_load_kg: 1120, sort_order: 43 },
  { code: '113', max_load_kg: 1150, sort_order: 44 },
  { code: '114', max_load_kg: 1180, sort_order: 45 },
  { code: '115', max_load_kg: 1215, sort_order: 46 },
  { code: '116', max_load_kg: 1250, sort_order: 47 },
  { code: '117', max_load_kg: 1285, sort_order: 48 },
  { code: '118', max_load_kg: 1320, sort_order: 49 },
  { code: '119', max_load_kg: 1360, sort_order: 50 },
  { code: '120', max_load_kg: 1400, sort_order: 51 }
]

async function seedTyreData() {
  console.log('='.repeat(60))
  console.log('Tyre Reference Data Seed')
  console.log('='.repeat(60))

  // Step 1: Extend Load Ratings (111-120)
  console.log('\n1. Extending load ratings (111-120)...')
  for (const rating of additionalLoadRatings) {
    const { error } = await supabase
      .from('load_ratings')
      .upsert(rating, { onConflict: 'code' })

    if (error) {
      console.error(`   [ERROR] Failed to insert load rating ${rating.code}:`, error.message)
    }
  }
  console.log(`   [OK] Extended load ratings with ${additionalLoadRatings.length} additional codes (111-120)`)

  // Step 2: Get all organizations
  console.log('\n2. Fetching organizations...')
  const { data: organizations, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')

  if (orgError) {
    console.error('   [ERROR] Failed to fetch organizations:', orgError.message)
    return
  }

  if (!organizations || organizations.length === 0) {
    console.log('   [WARN] No organizations found. Skipping manufacturer and size seeding.')
    return
  }

  console.log(`   [OK] Found ${organizations.length} organization(s)`)

  // Step 3: Seed manufacturers for each organization
  console.log('\n3. Seeding tyre manufacturers...')
  for (const org of organizations) {
    console.log(`\n   Organization: ${org.name}`)
    let successCount = 0
    let skipCount = 0

    for (let i = 0; i < manufacturers.length; i++) {
      const { error } = await supabase
        .from('tyre_manufacturers')
        .upsert({
          organization_id: org.id,
          name: manufacturers[i],
          sort_order: i + 1,
          is_active: true
        }, { onConflict: 'organization_id,name' })

      if (error) {
        if (error.code === '23505') { // Duplicate key
          skipCount++
        } else {
          console.error(`      [ERROR] ${manufacturers[i]}: ${error.message}`)
        }
      } else {
        successCount++
      }
    }
    console.log(`      [OK] ${successCount} inserted, ${skipCount} already existed`)
  }
  console.log(`\n   Total: ${manufacturers.length} manufacturers per organization`)

  // Step 4: Seed tyre sizes for each organization
  console.log('\n4. Seeding tyre sizes...')
  for (const org of organizations) {
    console.log(`\n   Organization: ${org.name}`)
    let successCount = 0
    let skipCount = 0

    for (let i = 0; i < tyreSizes.length; i++) {
      const { error } = await supabase
        .from('tyre_sizes')
        .upsert({
          organization_id: org.id,
          ...tyreSizes[i],
          sort_order: i + 1,
          is_active: true
        }, { onConflict: 'organization_id,size' })

      if (error) {
        if (error.code === '23505') { // Duplicate key
          skipCount++
        } else {
          console.error(`      [ERROR] ${tyreSizes[i].size}: ${error.message}`)
        }
      } else {
        successCount++
      }
    }
    console.log(`      [OK] ${successCount} inserted, ${skipCount} already existed`)
  }
  console.log(`\n   Total: ${tyreSizes.length} sizes per organization`)

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('Tyre Data Seed Complete!')
  console.log('='.repeat(60))
  console.log('\nSummary:')
  console.log(`  - ${manufacturers.length} tyre manufacturers (per org)`)
  console.log(`  - ${tyreSizes.length} tyre sizes (per org)`)
  console.log(`  - ${additionalLoadRatings.length} additional load ratings (111-120, global)`)
  console.log('\nSpeed Ratings: Seeded by migration (N, P, Q, R, S, T, U, H, V, W, Y, ZR)')
  console.log('Load Ratings: Seeded by migration (70-110) + extended (111-120)')
  console.log('')
}

seedTyreData().catch(console.error)
