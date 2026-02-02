/**
 * Work Authority Sheet Service
 *
 * Generates Work Authority Sheet PDFs - consolidated documents showing all
 * authorized VHC repairs and pre-booked DMS work for technicians and service advisors.
 */

import { supabaseAdmin } from '../../lib/supabase.js'
import type {
  WorkAuthoritySheetData,
  WorkAuthorityVariant,
  WorkSection,
  LabourLine,
  PartsLine,
  PricingSummary,
  OrganizationBranding
} from './types.js'

// ============================================
// Types
// ============================================

interface GenerateOptions {
  healthCheckId: string
  variant: WorkAuthorityVariant
  generatedByUserId: string
  organizationId: string
  includePreBooked?: boolean
  includeVhcWork?: boolean
  assignedTechnicianId?: string | null
}

interface BookedRepair {
  code?: string
  description?: string
  notes?: string
}

// ============================================
// Document Number Generation
// ============================================

/**
 * Generate a sequential document number for today: WA-YYYYMMDD-SEQ
 */
async function generateDocumentNumber(organizationId: string): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `WA-${dateStr}-`

  // Count existing documents for today to get sequence number
  const { count } = await supabaseAdmin
    .from('work_authority_sheets')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .like('document_number', `${prefix}%`)

  const seq = (count || 0) + 1
  return `${prefix}${seq.toString().padStart(3, '0')}`
}

// ============================================
// Data Fetching
// ============================================

/**
 * Fetch all data needed for the Work Authority Sheet
 */
async function fetchWorkAuthorityData(options: GenerateOptions): Promise<WorkAuthoritySheetData> {
  const {
    healthCheckId,
    variant,
    generatedByUserId,
    organizationId,
    includePreBooked = true,
    includeVhcWork = true,
    assignedTechnicianId
  } = options

  // 1. Fetch health check with related data
  // Note: customer is nested inside vehicle (vehicles have customer_id)
  const { data: healthCheck, error: hcError } = await supabaseAdmin
    .from('health_checks')
    .select(`
      id,
      vhc_reference,
      mileage_in,
      jobsheet_number,
      booked_repairs,
      vehicle:vehicles(
        id,
        registration,
        make,
        model,
        year,
        vin,
        customer:customers(
          id,
          first_name,
          last_name,
          email,
          mobile,
          address_line1,
          address_line2,
          town,
          county,
          postcode
        )
      ),
      technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
      advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name),
      site:sites(id, name, address, phone)
    `)
    .eq('id', healthCheckId)
    .eq('organization_id', organizationId)
    .single()

  if (hcError || !healthCheck) {
    console.error('Work Authority Sheet: Health check not found', { hcError, healthCheckId, organizationId })
    throw new Error(`Health check not found: ${healthCheckId}`)
  }

  // 2. Fetch organization branding
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name, logo_url, primary_color')
    .eq('id', organizationId)
    .single()

  // 3. Fetch user who generated
  const { data: generatedByUser } = await supabaseAdmin
    .from('users')
    .select('first_name, last_name')
    .eq('id', generatedByUserId)
    .single()

  // 4. Fetch authorized repair items with labour and parts
  let authorizedVhcWork: WorkSection[] = []
  if (includeVhcWork) {
    authorizedVhcWork = await fetchAuthorizedRepairItems(healthCheckId, variant)
  }

  // 5. Transform pre-booked DMS work
  let preBookedWork: WorkSection[] = []
  if (includePreBooked && healthCheck.booked_repairs) {
    const bookedRepairs = healthCheck.booked_repairs as BookedRepair[]
    preBookedWork = transformPreBookedWork(bookedRepairs, variant)
  }

  // 6. Generate document number
  const documentNumber = await generateDocumentNumber(organizationId)

  // 7. Calculate totals for service advisor variant
  let totals: PricingSummary | undefined
  if (variant === 'service_advisor') {
    totals = calculateTotals(preBookedWork, authorizedVhcWork)
  }

  // 8. Get assigned technician name
  let assignedTechnician: string | null = null
  if (assignedTechnicianId) {
    const { data: tech } = await supabaseAdmin
      .from('users')
      .select('first_name, last_name')
      .eq('id', assignedTechnicianId)
      .single()
    if (tech) {
      assignedTechnician = `${tech.first_name} ${tech.last_name}`
    }
  } else if (healthCheck.technician) {
    // Supabase single relations are objects when using .single()
    const tech = healthCheck.technician as unknown as { first_name: string; last_name: string }
    assignedTechnician = `${tech.first_name} ${tech.last_name}`
  }

  // Build the data structure - cast through unknown for Supabase single relation types
  // Customer is nested inside vehicle (vehicles have customer_id)
  const vehicle = healthCheck.vehicle as unknown as {
    registration: string
    make?: string
    model?: string
    year?: number
    vin?: string
    customer?: {
      first_name: string
      last_name: string
      email?: string
      mobile?: string
      address_line1?: string
      address_line2?: string
      town?: string
      county?: string
      postcode?: string
    }
  }

  const customer = vehicle?.customer

  const advisor = healthCheck.advisor as unknown as { first_name: string; last_name: string } | null
  const site = healthCheck.site as unknown as { name: string; address?: string; phone?: string } | null

  const branding: OrganizationBranding | undefined = org ? {
    organizationName: org.name,
    logoUrl: org.logo_url,
    primaryColor: org.primary_color
  } : undefined

  return {
    documentNumber,
    generatedAt: new Date().toISOString(),
    generatedBy: generatedByUser ? `${generatedByUser.first_name} ${generatedByUser.last_name}` : 'Unknown',
    variant,
    vehicle: {
      vrm: vehicle.registration,
      vin: vehicle.vin || null,
      make: vehicle.make || null,
      model: vehicle.model || null,
      year: vehicle.year || null,
      mileageIn: healthCheck.mileage_in || null,
      fuelLevel: null // Not currently tracked
    },
    customer: {
      name: customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer',
      phone: customer?.mobile || null,
      email: customer?.email || null,
      address: customer?.address_line1 ? {
        line1: customer.address_line1,
        line2: [customer.address_line2, customer.town, customer.county].filter(Boolean).join(', ') || null,
        postcode: customer.postcode || null
      } : null
    },
    serviceAdvisor: advisor ? `${advisor.first_name} ${advisor.last_name}` : 'Not assigned',
    assignedTechnician,
    vhcReference: healthCheck.vhc_reference || healthCheck.id.slice(0, 8).toUpperCase(),
    dmsJobNumber: healthCheck.jobsheet_number || null,
    site: site ? {
      name: site.name,
      address: site.address || null,
      phone: site.phone || null
    } : null,
    branding,
    preBookedWork,
    authorizedVhcWork,
    totals
  }
}

// ============================================
// Repair Items Fetching
// ============================================

/**
 * Fetch authorized repair items with labour and parts
 */
async function fetchAuthorizedRepairItems(
  healthCheckId: string,
  variant: WorkAuthorityVariant
): Promise<WorkSection[]> {
  console.log('Work Authority Sheet: fetchAuthorizedRepairItems starting', { healthCheckId, variant })

  // Fetch authorized repair items (customer_approved = true)
  // Note: Authorization is tracked via customer_approved field, not outcome_status
  const { data: repairItemsRaw, error: repairItemsError } = await supabaseAdmin
    .from('repair_items')
    .select(`
      id,
      name,
      description,
      is_group,
      parent_repair_item_id,
      outcome_status,
      customer_approved,
      labour_total,
      parts_total,
      subtotal,
      vat_amount,
      total_inc_vat,
      selected_option_id,
      labour:repair_labour(
        id,
        hours,
        rate,
        total,
        is_vat_exempt,
        labour_code:labour_codes(code, description)
      ),
      parts:repair_parts(
        id,
        part_number,
        description,
        quantity,
        sell_price,
        line_total
      ),
      options:repair_options!repair_options_repair_item_id_fkey(
        id,
        name,
        labour:repair_labour(
          id,
          hours,
          rate,
          total,
          is_vat_exempt,
          labour_code:labour_codes(code, description)
        ),
        parts:repair_parts(
          id,
          part_number,
          description,
          quantity,
          sell_price,
          line_total
        )
      ),
      check_results:repair_item_check_results(
        check_result:check_results(id, rag_status, notes)
      )
    `)
    .eq('health_check_id', healthCheckId)
    .eq('customer_approved', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  console.log('Work Authority Sheet: fetchAuthorizedRepairItems result', {
    healthCheckId,
    error: repairItemsError,
    itemCount: repairItemsRaw?.length || 0,
    items: repairItemsRaw?.map(i => ({ id: i.id, name: i.name, customer_approved: i.customer_approved }))
  })

  if (repairItemsError) {
    console.error('Work Authority Sheet: Error fetching repair items', repairItemsError)
  }

  if (!repairItemsRaw || repairItemsRaw.length === 0) {
    return []
  }

  // Build parent-child map
  const itemById = new Map<string, typeof repairItemsRaw[0]>()
  const childrenByParent = new Map<string, typeof repairItemsRaw>()

  for (const item of repairItemsRaw) {
    itemById.set(item.id, item)

    if (item.parent_repair_item_id) {
      if (!childrenByParent.has(item.parent_repair_item_id)) {
        childrenByParent.set(item.parent_repair_item_id, [])
      }
      childrenByParent.get(item.parent_repair_item_id)!.push(item)
    }
  }

  // Transform to WorkSection format - only top-level items
  const topLevelItems = repairItemsRaw.filter(item => !item.parent_repair_item_id)

  return topLevelItems.map(item => transformRepairItemToWorkSection(
    item,
    childrenByParent.get(item.id) || [],
    variant
  ))
}

/**
 * Transform a repair item to WorkSection format
 */
function transformRepairItemToWorkSection(
  item: Record<string, unknown>,
  children: Record<string, unknown>[],
  variant: WorkAuthorityVariant
): WorkSection {
  // Get labour and parts from the selected option if applicable, otherwise from item directly
  let labourData = item.labour as Record<string, unknown>[] || []
  let partsData = item.parts as Record<string, unknown>[] || []

  const selectedOptionId = item.selected_option_id as string | null
  if (selectedOptionId && item.options) {
    const options = item.options as Array<Record<string, unknown>>
    const selectedOption = options.find(opt => opt.id === selectedOptionId)
    if (selectedOption) {
      labourData = selectedOption.labour as Record<string, unknown>[] || []
      partsData = selectedOption.parts as Record<string, unknown>[] || []
    }
  }

  // Transform labour lines
  const labourLines: LabourLine[] = labourData.map(lab => {
    const labourCode = lab.labour_code as { code: string; description: string } | null
    const line: LabourLine = {
      description: labourCode?.description || 'Labour',
      labourCode: labourCode?.code || null,
      hours: parseFloat(lab.hours as string) || 0,
      isVatExempt: lab.is_vat_exempt as boolean || false
    }

    if (variant === 'service_advisor') {
      line.rate = parseFloat(lab.rate as string) || 0
      line.total = parseFloat(lab.total as string) || 0
    }

    return line
  })

  // Transform parts lines
  const partsLines: PartsLine[] = partsData.map(part => {
    const line: PartsLine = {
      description: part.description as string || 'Part',
      partNumber: part.part_number as string | null,
      quantity: parseFloat(part.quantity as string) || 1,
      unit: 'each'
    }

    if (variant === 'service_advisor') {
      line.unitPrice = parseFloat(part.sell_price as string) || 0
      line.total = parseFloat(part.line_total as string) || 0
    }

    return line
  })

  // Derive severity from check results
  const checkResultLinks = item.check_results as Array<{ check_result: { rag_status: string; notes?: string } }> || []
  let severity: 'red' | 'amber' | 'green' | undefined
  let defectDescription: string | null = item.description as string | null

  for (const link of checkResultLinks) {
    const cr = link.check_result
    if (cr?.rag_status === 'red') {
      severity = 'red'
      if (cr.notes && !defectDescription) {
        defectDescription = cr.notes
      }
      break
    }
    if (cr?.rag_status === 'amber' && severity !== 'red') {
      severity = 'amber'
      if (cr.notes && !defectDescription) {
        defectDescription = cr.notes
      }
    }
  }

  // Calculate subtotals for service advisor
  let subtotals: { labourTotal: number; partsTotal: number; sectionTotal: number } | undefined
  if (variant === 'service_advisor') {
    let labourTotal = labourLines.reduce((sum, l) => sum + (l.total || 0), 0)
    let partsTotal = partsLines.reduce((sum, p) => sum + (p.total || 0), 0)

    // Fall back to item-level totals when no detailed labour/parts lines exist
    // This handles the case where a user manually enters a total price without
    // adding individual labour/parts line items
    if (labourTotal === 0 && partsTotal === 0) {
      const itemLabourTotal = parseFloat(item.labour_total as string) || 0
      const itemPartsTotal = parseFloat(item.parts_total as string) || 0
      const itemTotalIncVat = parseFloat(item.total_inc_vat as string) || 0

      if (itemLabourTotal > 0 || itemPartsTotal > 0) {
        labourTotal = itemLabourTotal
        partsTotal = itemPartsTotal
      } else if (itemTotalIncVat > 0) {
        // Manual total entered with no parts/labour breakdown - treat as a lump sum
        // Use the total_inc_vat as the section total directly
        subtotals = {
          labourTotal: 0,
          partsTotal: 0,
          sectionTotal: itemTotalIncVat
        }
      }
    }

    if (!subtotals) {
      subtotals = {
        labourTotal,
        partsTotal,
        sectionTotal: labourTotal + partsTotal
      }
    }
  }

  // Transform children recursively
  const childSections = children.map(child =>
    transformRepairItemToWorkSection(child, [], variant)
  )

  return {
    id: item.id as string,
    title: item.name as string,
    description: defectDescription,
    severity,
    labourLines,
    partsLines,
    subtotals,
    isGroup: item.is_group as boolean || false,
    children: childSections.length > 0 ? childSections : undefined
  }
}

// ============================================
// Pre-Booked Work Transformation
// ============================================

/**
 * Transform DMS pre-booked repairs to WorkSection format
 */
function transformPreBookedWork(
  bookedRepairs: BookedRepair[],
  _variant: WorkAuthorityVariant // Will be used for pricing in Phase 5
): WorkSection[] {
  if (!bookedRepairs || bookedRepairs.length === 0) {
    return []
  }

  return bookedRepairs.map((repair, index) => {
    // DMS pre-booked items don't have detailed pricing - just descriptions
    // Labour and parts details would need DMS integration for full data
    const section: WorkSection = {
      id: `prebooked-${index}`,
      title: repair.description || repair.code || 'Pre-booked Work',
      description: repair.notes || null,
      labourLines: [],
      partsLines: []
    }

    // If we have a code, create a placeholder labour line
    if (repair.code) {
      section.labourLines.push({
        description: repair.description || 'Service/Repair',
        labourCode: repair.code,
        hours: 0 // Hours not available from DMS
      })
    }

    return section
  })
}

// ============================================
// Totals Calculation
// ============================================

/**
 * Calculate pricing summary for service advisor variant
 */
function calculateTotals(
  preBookedWork: WorkSection[],
  authorizedVhcWork: WorkSection[]
): PricingSummary {
  // Calculate pre-booked totals
  const preBookedLabour = preBookedWork.reduce((sum, section) => {
    return sum + (section.subtotals?.labourTotal || 0)
  }, 0)
  const preBookedParts = preBookedWork.reduce((sum, section) => {
    return sum + (section.subtotals?.partsTotal || 0)
  }, 0)
  // Use sectionTotal to capture lump-sum manual prices that don't break down into labour/parts
  const preBookedSubtotal = preBookedWork.reduce((sum, section) => {
    return sum + (section.subtotals?.sectionTotal || 0)
  }, 0)

  // Calculate VHC work totals
  const vhcLabour = authorizedVhcWork.reduce((sum, section) => {
    return sum + (section.subtotals?.labourTotal || 0)
  }, 0)
  const vhcParts = authorizedVhcWork.reduce((sum, section) => {
    return sum + (section.subtotals?.partsTotal || 0)
  }, 0)
  const vhcSubtotal = authorizedVhcWork.reduce((sum, section) => {
    return sum + (section.subtotals?.sectionTotal || 0)
  }, 0)

  // Calculate total labour hours
  const totalLabourHours = [...preBookedWork, ...authorizedVhcWork].reduce((sum, section) => {
    return sum + section.labourLines.reduce((lSum, l) => lSum + l.hours, 0)
  }, 0)

  // Count total parts lines
  const totalPartsLines = [...preBookedWork, ...authorizedVhcWork].reduce((sum, section) => {
    return sum + section.partsLines.length
  }, 0)

  const totalLabourValue = preBookedLabour + vhcLabour
  const totalPartsValue = preBookedParts + vhcParts
  const subtotalExVat = preBookedSubtotal + vhcSubtotal
  const vatRate = 0.20
  const vatAmount = subtotalExVat * vatRate

  return {
    preBooked: {
      labour: preBookedLabour,
      parts: preBookedParts,
      subtotal: preBookedSubtotal
    },
    vhcWork: {
      labour: vhcLabour,
      parts: vhcParts,
      subtotal: vhcSubtotal
    },
    totalLabourHours,
    totalLabourValue,
    totalPartsLines,
    totalPartsValue,
    subtotalExVat,
    vatAmount,
    vatRate,
    grandTotal: subtotalExVat + vatAmount
  }
}

// ============================================
// Exports
// ============================================

export {
  fetchWorkAuthorityData,
  generateDocumentNumber,
  type GenerateOptions,
  type BookedRepair
}
