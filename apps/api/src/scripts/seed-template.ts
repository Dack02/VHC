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

// Define the default VHC template structure
const defaultTemplate = {
  name: 'Full Vehicle Health Check',
  description: 'Comprehensive 47-point vehicle inspection covering all major systems',
  sections: [
    {
      name: 'Under Bonnet',
      description: 'Engine bay and fluid checks',
      items: [
        { name: 'Engine Oil Level', itemType: 'fluid_level', config: { levels: ['OK', 'Low', 'Very Low', 'Overfilled'] } },
        { name: 'Coolant Level', itemType: 'fluid_level', config: { levels: ['OK', 'Low', 'Very Low', 'Overfilled'] } },
        { name: 'Brake Fluid Level', itemType: 'fluid_level', config: { levels: ['OK', 'Low', 'Very Low', 'Overfilled'] } },
        { name: 'Power Steering Fluid', itemType: 'fluid_level', config: { levels: ['OK', 'Low', 'Very Low', 'N/A'] } },
        { name: 'Washer Fluid Level', itemType: 'fluid_level', config: { levels: ['OK', 'Low', 'Empty'] } },
        { name: 'Battery Condition', itemType: 'rag', config: {} },
        { name: 'Drive Belts', itemType: 'rag', config: {} },
        { name: 'Hoses & Pipes', itemType: 'rag', config: {} },
        { name: 'Air Filter', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Brakes',
      description: 'Brake system inspection',
      items: [
        { name: 'Front Brake Pads', itemType: 'brake_measurement', config: { unit: 'mm', minThickness: 3, warningThickness: 5 } },
        { name: 'Rear Brake Pads', itemType: 'brake_measurement', config: { unit: 'mm', minThickness: 3, warningThickness: 5 } },
        { name: 'Front Brake Discs', itemType: 'rag', config: {} },
        { name: 'Rear Brake Discs', itemType: 'rag', config: {} },
        { name: 'Brake Lines & Hoses', itemType: 'rag', config: {} },
        { name: 'Handbrake Operation', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Tyres & Wheels',
      description: 'Tyre condition and tread depth',
      items: [
        { name: 'Front Left Tyre', itemType: 'tyre_depth', config: { positions: ['outer', 'centre', 'inner'], unit: 'mm', minDepth: 1.6, warningDepth: 3 } },
        { name: 'Front Right Tyre', itemType: 'tyre_depth', config: { positions: ['outer', 'centre', 'inner'], unit: 'mm', minDepth: 1.6, warningDepth: 3 } },
        { name: 'Rear Left Tyre', itemType: 'tyre_depth', config: { positions: ['outer', 'centre', 'inner'], unit: 'mm', minDepth: 1.6, warningDepth: 3 } },
        { name: 'Rear Right Tyre', itemType: 'tyre_depth', config: { positions: ['outer', 'centre', 'inner'], unit: 'mm', minDepth: 1.6, warningDepth: 3 } },
        { name: 'Spare Tyre', itemType: 'rag', config: {} },
        { name: 'Wheel Condition', itemType: 'rag', config: {} },
        { name: 'Wheel Nuts/Bolts', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Steering & Suspension',
      description: 'Steering and suspension components',
      items: [
        { name: 'Steering Rack', itemType: 'rag', config: {} },
        { name: 'Track Rod Ends', itemType: 'rag', config: {} },
        { name: 'Ball Joints', itemType: 'rag', config: {} },
        { name: 'Front Shock Absorbers', itemType: 'rag', config: {} },
        { name: 'Rear Shock Absorbers', itemType: 'rag', config: {} },
        { name: 'Springs', itemType: 'rag', config: {} },
        { name: 'Anti-Roll Bar Links', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Lights & Electrics',
      description: 'All lights and electrical systems',
      items: [
        { name: 'Headlights (Dipped)', itemType: 'rag', config: {} },
        { name: 'Headlights (Main Beam)', itemType: 'rag', config: {} },
        { name: 'Front Indicators', itemType: 'rag', config: {} },
        { name: 'Rear Indicators', itemType: 'rag', config: {} },
        { name: 'Brake Lights', itemType: 'rag', config: {} },
        { name: 'Tail Lights', itemType: 'rag', config: {} },
        { name: 'Reverse Lights', itemType: 'rag', config: {} },
        { name: 'Number Plate Lights', itemType: 'rag', config: {} },
        { name: 'Horn', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Exhaust',
      description: 'Exhaust system inspection',
      items: [
        { name: 'Exhaust Manifold', itemType: 'rag', config: {} },
        { name: 'Catalytic Converter', itemType: 'rag', config: {} },
        { name: 'Exhaust Pipes', itemType: 'rag', config: {} },
        { name: 'Silencer/Muffler', itemType: 'rag', config: {} },
        { name: 'Exhaust Mountings', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Interior',
      description: 'Interior condition and safety',
      items: [
        { name: 'Seatbelts', itemType: 'rag', config: {} },
        { name: 'Warning Lights', itemType: 'rag', config: {} },
        { name: 'Wipers & Washers', itemType: 'rag', config: {} },
        { name: 'Mirrors', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Exterior',
      description: 'Body and exterior checks',
      items: [
        { name: 'Windscreen', itemType: 'rag', config: {} },
        { name: 'Wiper Blades', itemType: 'rag', config: {} },
        { name: 'Door Operation', itemType: 'rag', config: {} },
        { name: 'Boot/Tailgate', itemType: 'rag', config: {} },
        { name: 'Fuel Filler Cap', itemType: 'rag', config: {} }
      ]
    },
    {
      name: 'Road Test',
      description: 'Dynamic driving assessment',
      items: [
        { name: 'Engine Performance', itemType: 'rag', config: {} },
        { name: 'Gearbox Operation', itemType: 'rag', config: {} },
        { name: 'Clutch Operation', itemType: 'rag', config: {} },
        { name: 'Brake Performance', itemType: 'rag', config: {} },
        { name: 'Steering Feel', itemType: 'rag', config: {} },
        { name: 'Suspension Noise', itemType: 'rag', config: {} }
      ]
    }
  ]
}

async function seedTemplate() {
  console.log('Creating default VHC template...')

  // Check if template already exists
  const { data: existingTemplate } = await supabase
    .from('check_templates')
    .select('id')
    .eq('organization_id', ORG_ID)
    .eq('name', defaultTemplate.name)
    .single()

  if (existingTemplate) {
    console.log('Deleting existing template to re-seed...')

    // First delete health checks that reference this template
    const { error: healthChecksError } = await supabase
      .from('health_checks')
      .delete()
      .eq('template_id', existingTemplate.id)

    if (healthChecksError) {
      console.error('Failed to delete health checks:', healthChecksError)
      process.exit(1)
    }
    console.log('Deleted health checks referencing template.')

    // Now delete the template
    const { error: deleteError } = await supabase
      .from('check_templates')
      .delete()
      .eq('id', existingTemplate.id)

    if (deleteError) {
      console.error('Failed to delete existing template:', deleteError)
      process.exit(1)
    }
    console.log('Existing template deleted.')
  }

  // Create the template
  const { data: template, error: templateError } = await supabase
    .from('check_templates')
    .insert({
      organization_id: ORG_ID,
      name: defaultTemplate.name,
      description: defaultTemplate.description,
      is_default: true,
      is_active: true
    })
    .select()
    .single()

  if (templateError) {
    console.error('Failed to create template:', templateError)
    process.exit(1)
  }

  console.log(`Created template: ${template.name} (${template.id})`)

  let totalItems = 0

  // Create sections and items
  for (let sectionIndex = 0; sectionIndex < defaultTemplate.sections.length; sectionIndex++) {
    const sectionData = defaultTemplate.sections[sectionIndex]

    const { data: section, error: sectionError } = await supabase
      .from('template_sections')
      .insert({
        template_id: template.id,
        name: sectionData.name,
        description: sectionData.description,
        sort_order: sectionIndex + 1
      })
      .select()
      .single()

    if (sectionError) {
      console.error(`Failed to create section ${sectionData.name}:`, sectionError)
      continue
    }

    console.log(`  Created section: ${section.name}`)

    // Create items for this section
    for (let itemIndex = 0; itemIndex < sectionData.items.length; itemIndex++) {
      const itemData = sectionData.items[itemIndex]

      const { error: itemError } = await supabase
        .from('template_items')
        .insert({
          section_id: section.id,
          name: itemData.name,
          item_type: itemData.itemType,
          config: itemData.config,
          is_required: true,
          sort_order: itemIndex + 1
        })

      if (itemError) {
        console.error(`    Failed to create item ${itemData.name}:`, itemError)
        continue
      }

      totalItems++
    }

    console.log(`    Added ${sectionData.items.length} items`)
  }

  console.log('\nTemplate seed complete!')
  console.log(`  Template: ${defaultTemplate.name}`)
  console.log(`  Sections: ${defaultTemplate.sections.length}`)
  console.log(`  Total items: ${totalItems}`)
}

seedTemplate().catch(console.error)
