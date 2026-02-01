import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { generateCompactHealthCheckPDF, type HealthCheckPDFData } from '../../services/pdf-generator/index.js'

const pdf = new Hono()

// GET /:id/pdf - Generate PDF report
// NOTE: This route MUST be defined BEFORE /:id to avoid being caught by the general route
pdf.get('/:id/pdf', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const { id } = c.req.param()
    const auth = c.get('auth')

    console.log('PDF generation request:', { id, orgId: auth.orgId, userId: auth.user?.id })

    // Fetch health check with all related data
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select(`
        *,
        vehicle:vehicles(
          id, registration, make, model, year, vin,
          customer:customers(id, first_name, last_name, email, mobile)
        ),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name),
        site:sites(id, name, address, phone, email),
        template:check_templates(id, name)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      console.log('PDF: Health check not found', { hcError, healthCheckId: id, orgId: auth.orgId })
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Fetch check results with media
    const { data: checkResults } = await supabaseAdmin
      .from('check_results')
      .select(`
        id,
        rag_status,
        notes,
        value,
        template_item:template_items(
          id,
          name,
          item_type,
          section:template_sections(name)
        ),
        media:result_media(id, storage_path, thumbnail_path, media_type, include_in_report)
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: true })

    // Fetch repair items (NEW schema - transform to legacy format)
    // Only fetch TOP-LEVEL items (no parent) for the main table
    const { data: repairItemsRaw, error: repairItemsError } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        description,
        is_group,
        labour_total,
        parts_total,
        total_inc_vat,
        labour_completed_at,
        parts_completed_at,
        follow_up_date,
        work_completed_at,
        source,
        rag_status,
        outcome_status,
        outcome_set_at,
        declined_notes,
        declined_reason:declined_reasons(reason),
        check_results:repair_item_check_results(
          check_result:check_results(id, rag_status)
        )
      `)
      .eq('health_check_id', id)
      .is('parent_repair_item_id', null)  // Only top-level items
      .order('created_at', { ascending: true })

    // Fetch child items separately (for deriving group rag_status and rendering)
    const { data: childItemsRaw } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        description,
        parent_repair_item_id,
        check_results:repair_item_check_results(
          check_result:check_results(id, rag_status)
        )
      `)
      .eq('health_check_id', id)
      .not('parent_repair_item_id', 'is', null)
      .order('created_at', { ascending: true })

    // Build child items map for groups
    const childItemsByParentId = new Map<string, Array<{ id: string; name: string; description?: string | null; rag_status: 'red' | 'amber' | null; check_result_id?: string }>>()
    for (const child of childItemsRaw || []) {
      const parentId = child.parent_repair_item_id as string
      if (!childItemsByParentId.has(parentId)) {
        childItemsByParentId.set(parentId, [])
      }
      // Derive child's rag_status from its check results
      let childRagStatus: 'red' | 'amber' | null = null
      let firstCheckResultId: string | undefined = undefined
      for (const link of child.check_results || []) {
        const cr = (link as Record<string, unknown>)?.check_result as { id?: string; rag_status?: string } | null
        if (!firstCheckResultId && cr?.id) {
          firstCheckResultId = cr.id
        }
        if (cr?.rag_status === 'red') {
          childRagStatus = 'red'
          break
        }
        if (cr?.rag_status === 'amber' && !childRagStatus) {
          childRagStatus = 'amber'
        }
      }
      childItemsByParentId.get(parentId)!.push({
        id: child.id,
        name: child.name,
        description: child.description,
        rag_status: childRagStatus,
        check_result_id: firstCheckResultId
      })
    }

    // Transform NEW schema to legacy format for PDF
    const repairItems = (repairItemsRaw || []).map(item => {
      // For MRI items, use the direct rag_status from the repair_items table
      // For inspection items, derive from linked check_results
      let derivedRagStatus: 'red' | 'amber' | null = null
      let firstCheckResultId: string | null = null

      // MRI items have their rag_status stored directly
      if (item.source === 'mri_scan' && item.rag_status) {
        derivedRagStatus = item.rag_status as 'red' | 'amber'
      } else {
        // Derive rag_status from linked check results (for inspection items)
        const linkedResults = item.check_results || []
        for (const link of linkedResults) {
          // Supabase returns single relations as objects (not arrays)
          const cr = link?.check_result as { id?: string; rag_status?: string } | null
          if (!firstCheckResultId && cr?.id) {
            firstCheckResultId = cr.id
          }
          if (cr?.rag_status === 'red') {
            derivedRagStatus = 'red'
            break
          }
          if (cr?.rag_status === 'amber' && !derivedRagStatus) {
            derivedRagStatus = 'amber'
          }
        }
      }

      // For groups, derive rag_status from children's statuses
      const children = childItemsByParentId.get(item.id) || []
      if (item.is_group && children.length > 0) {
        // Get highest severity from children
        for (const child of children) {
          if (child.rag_status === 'red') {
            derivedRagStatus = 'red'
            break
          }
          if (child.rag_status === 'amber' && derivedRagStatus !== 'red') {
            derivedRagStatus = 'amber'
          }
        }
      }

      // Resolve declined reason text from join or notes
      const declinedReasonObj = item.declined_reason as unknown as { reason: string } | null
      const resolvedDeclinedReason = declinedReasonObj?.reason || (item as Record<string, unknown>).declined_notes as string | null || null

      return {
        id: item.id,
        check_result_id: firstCheckResultId || '',
        title: item.name,
        description: item.description,
        // Default to 'amber' if no rag_status derived (repair items are created from amber/red results)
        rag_status: derivedRagStatus || 'amber' as const,
        parts_cost: parseFloat(String(item.parts_total)) || 0,
        labor_cost: parseFloat(String(item.labour_total)) || 0,
        total_price: parseFloat(String(item.total_inc_vat)) || 0,
        is_mot_failure: false, // is_mot_failure is on check_results, not repair_items
        follow_up_date: item.follow_up_date || null,
        work_completed_at: item.work_completed_at,
        outcome_status: (item as Record<string, unknown>).outcome_status as string | null || null,
        outcome_set_at: (item as Record<string, unknown>).outcome_set_at as string | null || null,
        declined_reason: resolvedDeclinedReason,
        // Group info for rendering
        is_group: item.is_group,
        children: children.length > 0 ? children.map(c => ({
          name: c.name,
          rag_status: c.rag_status || 'amber',
          description: c.description,
          check_result_id: c.check_result_id
        })) : undefined
      }
    })

    console.log('PDF Debug - Old repairItems query (mapped to legacy):', {
      healthCheckId: id,
      count: repairItems?.length || 0,
      error: repairItemsError?.message
    })

    // Fetch authorizations from legacy table (for backward compatibility)
    const { data: legacyAuthorizations } = await supabaseAdmin
      .from('authorizations')
      .select('repair_item_id, decision, signature_data, signed_at')
      .eq('health_check_id', id)

    // Fetch new repair items with options, labour, parts, and linked check results for PDF
    // Also includes customer signature fields from new system
    const { data: newRepairItemsData, error: newRepairItemsError } = await supabaseAdmin
      .from('repair_items')
      .select(`
        id,
        name,
        description,
        is_group,
        parent_repair_item_id,
        source,
        rag_status,
        labour_total,
        parts_total,
        subtotal,
        vat_amount,
        total_inc_vat,
        customer_approved,
        customer_approved_at,
        customer_declined_reason,
        customer_signature_data,
        customer_notes,
        selected_option_id,
        outcome_status,
        outcome_set_at,
        declined_notes,
        follow_up_date,
        work_completed_at,
        declined_reason:declined_reasons(reason),
        options:repair_options!repair_options_repair_item_id_fkey(
          id,
          name,
          description,
          labour_total,
          parts_total,
          subtotal,
          vat_amount,
          total_inc_vat,
          is_recommended,
          sort_order
        ),
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
        linked_check_results:repair_item_check_results(
          check_result:check_results(
            id,
            rag_status,
            template_item:template_items(name)
          )
        )
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: true })

    console.log('PDF Debug - New repairItems query:', {
      healthCheckId: id,
      count: newRepairItemsData?.length || 0,
      error: newRepairItemsError?.message || null,
      items: newRepairItemsData?.map(i => ({ id: i.id, name: i.name }))
    })

    // Type for transformed repair items (used for hierarchy building)
    type TransformedRepairItem = {
      id: string
      name: string
      description: string | null
      isGroup: boolean
      parentRepairItemId: string | null
      labourTotal: number
      partsTotal: number
      subtotal: number
      vatAmount: number
      totalIncVat: number
      customerApproved: boolean | null
      customerApprovedAt: string | null
      customerDeclinedReason: string | null
      customerSignatureData: string | null
      customerNotes: string | null
      selectedOptionId: string | null
      outcomeStatus: string | null
      outcomeSetAt: string | null
      declinedReason: string | null
      options: Array<{
        id: string
        name: string
        description: string | null
        labourTotal: number
        partsTotal: number
        subtotal: number
        vatAmount: number
        totalIncVat: number
        isRecommended: boolean
      }>
      linkedCheckResults: string[]
      children: TransformedRepairItem[]
      labourEntries: Array<{
        code: string
        description: string
        hours: number
        rate: number
        total: number
        isVatExempt: boolean
      }>
      partsEntries: Array<{
        partNumber: string | undefined
        description: string
        quantity: number
        sellPrice: number
        lineTotal: number
      }>
    }

    // Helper to transform a single repair item
    const transformRepairItem = (item: typeof newRepairItemsData extends (infer T)[] | null ? T : never): TransformedRepairItem => {
      const linkedCheckResults = (item.linked_check_results || [])
        .map((lcr: Record<string, unknown>) => {
          const cr = lcr.check_result as Record<string, unknown> | null
          const ti = cr?.template_item as { name: string } | null
          return ti?.name
        })
        .filter(Boolean) as string[]

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        isGroup: item.is_group,
        parentRepairItemId: item.parent_repair_item_id,
        labourTotal: parseFloat(item.labour_total as string) || 0,
        partsTotal: parseFloat(item.parts_total as string) || 0,
        subtotal: parseFloat(item.subtotal as string) || 0,
        vatAmount: parseFloat(item.vat_amount as string) || 0,
        totalIncVat: parseFloat(item.total_inc_vat as string) || 0,
        customerApproved: item.customer_approved,
        customerApprovedAt: item.customer_approved_at,
        customerDeclinedReason: item.customer_declined_reason,
        customerSignatureData: item.customer_signature_data,
        customerNotes: item.customer_notes,
        selectedOptionId: item.selected_option_id,
        outcomeStatus: (item as Record<string, unknown>).outcome_status as string | null || null,
        outcomeSetAt: (item as Record<string, unknown>).outcome_set_at as string | null || null,
        declinedReason: (() => {
          const dr = (item as Record<string, unknown>).declined_reason as { reason: string } | null
          return dr?.reason || (item as Record<string, unknown>).declined_notes as string | null || null
        })(),
        options: (item.options || []).map((opt: Record<string, unknown>) => ({
          id: opt.id as string,
          name: opt.name as string,
          description: opt.description as string | null,
          labourTotal: parseFloat(opt.labour_total as string) || 0,
          partsTotal: parseFloat(opt.parts_total as string) || 0,
          subtotal: parseFloat(opt.subtotal as string) || 0,
          vatAmount: parseFloat(opt.vat_amount as string) || 0,
          totalIncVat: parseFloat(opt.total_inc_vat as string) || 0,
          isRecommended: opt.is_recommended as boolean
        })),
        linkedCheckResults,
        children: [],
        labourEntries: (item.labour || []).map((lab: Record<string, unknown>) => {
          const lc = lab.labour_code as { code: string; description: string } | null
          return {
            code: lc?.code || '',
            description: lc?.description || '',
            hours: parseFloat(lab.hours as string) || 0,
            rate: parseFloat(lab.rate as string) || 0,
            total: parseFloat(lab.total as string) || 0,
            isVatExempt: lab.is_vat_exempt as boolean
          }
        }),
        partsEntries: (item.parts || []).map((part: Record<string, unknown>) => ({
          partNumber: part.part_number as string | undefined,
          description: part.description as string,
          quantity: parseFloat(part.quantity as string) || 0,
          sellPrice: parseFloat(part.sell_price as string) || 0,
          lineTotal: parseFloat(part.line_total as string) || 0
        }))
      }
    }

    // Transform all items first
    const allTransformedItems = (newRepairItemsData || []).map(transformRepairItem)

    // Build parent-child hierarchy
    const itemById = new Map(allTransformedItems.map(item => [item.id, item]))

    // Attach children to their parent groups
    for (const item of allTransformedItems) {
      if (item.parentRepairItemId) {
        const parent = itemById.get(item.parentRepairItemId)
        if (parent) {
          parent.children.push(item)
        }
      }
    }

    // Filter to only top-level items (those without a parent)
    const newRepairItems = allTransformedItems.filter(item => !item.parentRepairItemId)

    const hasNewRepairItems = newRepairItems.length > 0

    // Fix legacy repairItems total_price when pricing lives on options
    const newItemsById = new Map(allTransformedItems.map(item => [item.id, item]))
    for (const legacyItem of repairItems) {
      const newItem = newItemsById.get(legacyItem.id)
      if (newItem && newItem.options.length > 0) {
        const opt = newItem.selectedOptionId
          ? newItem.options.find(o => o.id === newItem.selectedOptionId)
          : null
        const fallback = !opt
          ? (newItem.options.find(o => o.isRecommended) || newItem.options[0])
          : null
        const priceSource = opt || fallback
        if (priceSource) {
          legacyItem.total_price = priceSource.totalIncVat
          legacyItem.parts_cost = priceSource.partsTotal
          legacyItem.labor_cost = priceSource.labourTotal
        }
      }
    }

    // When legacy repairItems is empty but newRepairItems exist, populate legacy
    // format from new data. This happens when parent_repair_item_id is not SQL NULL
    // (e.g. empty string), causing the .is(null) filter to miss them.
    if (repairItems.length === 0 && newRepairItems.length > 0) {
      console.log('[PDF] Legacy repairItems empty — populating from newRepairItems')
      for (const item of newRepairItems) {
        // Derive RAG status from linked check results or direct rag_status
        let derivedRag: 'red' | 'amber' | null = null
        const rawItem = (newRepairItemsData || []).find(r => r.id === item.id)
        const source = (rawItem as Record<string, unknown>)?.source as string | null
        const directRag = (rawItem as Record<string, unknown>)?.rag_status as string | null

        if (source === 'mri_scan' && directRag) {
          derivedRag = directRag as 'red' | 'amber'
        } else {
          // Derive from linked check results
          for (const lcr of (rawItem?.linked_check_results || []) as Array<Record<string, unknown>>) {
            const cr = lcr.check_result as { id?: string; rag_status?: string } | null
            if (cr?.rag_status === 'red') { derivedRag = 'red'; break }
            if (cr?.rag_status === 'amber' && !derivedRag) { derivedRag = 'amber' }
          }
        }

        // For groups, derive from children
        if (item.isGroup && item.children.length > 0) {
          for (const child of item.children) {
            const childRaw = (newRepairItemsData || []).find(r => r.id === child.id)
            for (const lcr of (childRaw?.linked_check_results || []) as Array<Record<string, unknown>>) {
              const cr = lcr.check_result as { id?: string; rag_status?: string } | null
              if (cr?.rag_status === 'red') { derivedRag = 'red'; break }
              if (cr?.rag_status === 'amber' && derivedRag !== 'red') { derivedRag = 'amber' }
            }
            if (derivedRag === 'red') break
          }
        }

        // Use pricing from selected/recommended option if available
        let totalPrice = item.totalIncVat
        let partsCost = item.partsTotal
        let laborCost = item.labourTotal
        if (item.options.length > 0) {
          const opt = item.selectedOptionId
            ? item.options.find(o => o.id === item.selectedOptionId)
            : null
          const fallback = !opt
            ? (item.options.find(o => o.isRecommended) || item.options[0])
            : null
          const priceSource = opt || fallback
          if (priceSource) {
            totalPrice = priceSource.totalIncVat
            partsCost = priceSource.partsTotal
            laborCost = priceSource.labourTotal
          }
        }

        const declinedReasonObj = (rawItem as Record<string, unknown>)?.declined_reason as { reason: string } | null
        const resolvedDeclinedReason = declinedReasonObj?.reason || item.declinedReason || null

        repairItems.push({
          id: item.id,
          check_result_id: '',
          title: item.name,
          description: item.description,
          rag_status: derivedRag || 'amber' as const,
          parts_cost: partsCost,
          labor_cost: laborCost,
          total_price: totalPrice,
          is_mot_failure: false,
          follow_up_date: (rawItem as Record<string, unknown>)?.follow_up_date as string | null || null,
          work_completed_at: (rawItem as Record<string, unknown>)?.work_completed_at as string | null || undefined,
          outcome_status: item.outcomeStatus,
          outcome_set_at: item.outcomeSetAt,
          declined_reason: resolvedDeclinedReason,
          is_group: item.isGroup,
          children: item.children.length > 0 ? item.children.map(c => ({
            name: c.name,
            rag_status: 'amber' as const,
            description: c.description,
            check_result_id: undefined
          })) : undefined
        })
      }
    }

    // Fetch selected reasons for all check results
    const checkResultIds = (checkResults || []).map(r => r.id)
    const reasonsByCheckResult: Record<string, Array<{ id: string; reasonText: string; customerDescription?: string | null; followUpDays?: number | null; followUpText?: string | null }>> = {}

    if (checkResultIds.length > 0) {
      const { data: allReasons } = await supabaseAdmin
        .from('check_result_reasons')
        .select(`
          id,
          check_result_id,
          follow_up_days,
          follow_up_text,
          customer_description_override,
          reason:item_reasons(
            reason_text,
            customer_description
          )
        `)
        .in('check_result_id', checkResultIds)

      // Group reasons by check result ID
      for (const reasonData of allReasons || []) {
        const checkResultId = reasonData.check_result_id
        if (!reasonsByCheckResult[checkResultId]) {
          reasonsByCheckResult[checkResultId] = []
        }
        const reasonItem = reasonData.reason as unknown as { reason_text: string; customer_description?: string | null } | null
        reasonsByCheckResult[checkResultId].push({
          id: reasonData.id,
          reasonText: reasonItem?.reason_text || '',
          customerDescription: reasonData.customer_description_override || reasonItem?.customer_description,
          followUpDays: reasonData.follow_up_days,
          followUpText: reasonData.follow_up_text
        })
      }
    }

    // Calculate summary
    const redItems = repairItems?.filter(i => i.rag_status === 'red') || []
    const amberItems = repairItems?.filter(i => i.rag_status === 'amber') || []
    const greenResults = checkResults?.filter(r => r.rag_status === 'green') || []

    // Debug logging for PDF repair items
    console.log('PDF Debug - Repair Items:', {
      repairItemsCount: repairItems?.length || 0,
      repairItemsRagStatuses: repairItems?.map(i => ({ id: i.id, title: i.title, rag_status: i.rag_status })),
      newRepairItemsCount: newRepairItems.length,
      newRepairItemsSample: newRepairItems.slice(0, 3).map(i => ({ id: i.id, name: i.name, customerApproved: i.customerApproved })),
      redItemsCount: redItems.length,
      amberItemsCount: amberItems.length,
      hasNewRepairItems
    })

    const authByItemId = new Map((legacyAuthorizations || []).map(a => [a.repair_item_id, a]))
    const authorisedItems = repairItems?.filter(i => authByItemId.get(i.id)?.decision === 'approved') || []
    const completedItems = authorisedItems.filter(i => i.work_completed_at)

    // Build PDF data
    const pdfData: HealthCheckPDFData = {
      id: healthCheck.id,
      status: healthCheck.status,
      created_at: healthCheck.created_at,
      completed_at: healthCheck.completed_at,
      closed_at: healthCheck.closed_at,
      mileage: healthCheck.mileage,
      vhc_reference: healthCheck.vhc_reference,

      vehicle: {
        registration: healthCheck.vehicle?.registration || 'Unknown',
        make: healthCheck.vehicle?.make,
        model: healthCheck.vehicle?.model,
        year: healthCheck.vehicle?.year,
        vin: healthCheck.vehicle?.vin
      },

      customer: {
        first_name: healthCheck.vehicle?.customer?.first_name || 'Unknown',
        last_name: healthCheck.vehicle?.customer?.last_name || '',
        email: healthCheck.vehicle?.customer?.email,
        phone: healthCheck.vehicle?.customer?.mobile
      },

      technician: healthCheck.technician ? {
        first_name: healthCheck.technician.first_name,
        last_name: healthCheck.technician.last_name
      } : undefined,

      technician_signature: healthCheck.technician_signature,

      site: healthCheck.site ? {
        name: healthCheck.site.name,
        address: healthCheck.site.address,
        phone: healthCheck.site.phone,
        email: healthCheck.site.email
      } : undefined,

      results: (checkResults || []).map(r => {
        // Type assertion for Supabase single relations (cast through unknown)
        const templateItem = r.template_item as unknown as { id: string; name: string; item_type: string; section: { name: string } | null } | null
        return {
          id: r.id,
          rag_status: r.rag_status as 'red' | 'amber' | 'green',
          notes: r.notes,
          value: r.value as Record<string, unknown> | null,
          template_item: templateItem ? {
            id: templateItem.id,
            name: templateItem.name,
            item_type: templateItem.item_type,
            section: templateItem.section ? { name: templateItem.section.name } : undefined
          } : undefined,
          media: r.media
            ?.filter((m: Record<string, unknown>) => m.include_in_report !== false)
            .map((m: Record<string, unknown>) => {
              const supabaseUrl = process.env.SUPABASE_URL
              const url = m.storage_path ? `${supabaseUrl}/storage/v1/object/public/vhc-photos/${m.storage_path}` : null
              return {
                id: m.id as string,
                url: url || '',
                thumbnail_url: url ? `${url}?width=200&height=200` : null,
                type: (m.media_type as string) || 'photo'
              }
            })
        }
      }),

      repairItems: (repairItems || []).map(i => ({
        id: i.id,
        check_result_id: i.check_result_id,
        title: i.title,
        description: i.description,
        rag_status: i.rag_status as 'red' | 'amber' | 'green',
        parts_cost: i.parts_cost,
        labor_cost: i.labor_cost,
        total_price: i.total_price,
        is_mot_failure: i.is_mot_failure,
        follow_up_date: i.follow_up_date,
        work_completed_at: i.work_completed_at,
        outcome_status: i.outcome_status,
        outcome_set_at: i.outcome_set_at,
        declined_reason: i.declined_reason,
        is_group: i.is_group,
        children: i.children
      })),

      authorizations: (legacyAuthorizations || []).map(a => ({
        repair_item_id: a.repair_item_id,
        decision: a.decision as 'approved' | 'declined',
        signature_data: a.signature_data,
        signed_at: a.signed_at
      })),

      reasonsByCheckResult,

      // New Repair Items (Phase 6+)
      newRepairItems,
      hasNewRepairItems,
      vatRate: 20, // Default VAT rate
      showDetailedBreakdown: false, // Can be enabled for detailed PDF

      summary: {
        red_count: redItems.length,
        amber_count: amberItems.length,
        green_count: greenResults.length,
        total_identified: repairItems?.reduce((sum, i) => sum + (i.total_price || 0), 0) || 0,
        total_authorised: authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0),
        work_completed_value: completedItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
      }
    }

    // Generate PDF using compact layout
    const pdfBuffer = await generateCompactHealthCheckPDF(pdfData)

    // Return PDF with appropriate headers
    const filename = `health-check-${healthCheck.vehicle?.registration || id}-${new Date().toISOString().split('T')[0]}.pdf`

    c.header('Content-Type', 'application/pdf')
    c.header('Content-Disposition', `attachment; filename="${filename}"`)
    c.header('Content-Length', pdfBuffer.length.toString())

    // Convert Buffer to Uint8Array for Hono compatibility
    return c.body(new Uint8Array(pdfBuffer))
  } catch (error) {
    console.error('PDF generation error:', error)
    return c.json({
      error: 'Failed to generate PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

export default pdf
