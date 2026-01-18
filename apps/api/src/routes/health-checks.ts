import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { generateHealthCheckPDF, type HealthCheckPDFData } from '../services/pdf-generator.js'
import { queueNotification } from '../services/queue.js'
import { scheduleHealthCheckReminders } from '../services/scheduler.js'
import { notifyHealthCheckStatusChanged, notifyTechnicianClockedIn, notifyTechnicianClockedOut } from '../services/websocket.js'

const healthChecks = new Hono()

healthChecks.use('*', authMiddleware)

// Valid status transitions
const validTransitions: Record<string, string[]> = {
  // DMS Import arrival workflow (Phase D)
  awaiting_arrival: ['created', 'no_show', 'cancelled'],  // Mark arrived → created, No show, or Cancel
  no_show: ['awaiting_arrival', 'cancelled'],  // Can be rescheduled or cancelled
  // Standard workflow
  created: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'tech_completed', 'cancelled'],
  paused: ['in_progress', 'cancelled'],
  tech_completed: ['awaiting_review', 'awaiting_pricing'],
  awaiting_review: ['awaiting_pricing', 'ready_to_send'],
  awaiting_pricing: ['awaiting_parts', 'ready_to_send'],
  awaiting_parts: ['ready_to_send'],
  ready_to_send: ['sent'],
  sent: ['delivered', 'expired'],
  delivered: ['opened', 'expired'],
  opened: ['partial_response', 'authorized', 'declined', 'expired'],
  partial_response: ['authorized', 'declined', 'expired'],
  authorized: ['completed'],
  declined: ['completed'],
  expired: ['completed'],
  completed: [],
  cancelled: []
}

function isValidTransition(from: string, to: string): boolean {
  return validTransitions[from]?.includes(to) ?? false
}

// GET /api/v1/health-checks - List with filters
healthChecks.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { status, technician_id, advisor_id, site_id, date_from, date_to, unassigned, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        *,
        vehicle:vehicles(id, registration, make, model, customer:customers(id, first_name, last_name)),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name),
        template:check_templates(id, name)
      `, { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    // Apply filters
    if (status) {
      // Support comma-separated status values
      const statuses = status.split(',').map(s => s.trim())
      if (statuses.length === 1) {
        query = query.eq('status', statuses[0])
      } else {
        query = query.in('status', statuses)
      }
    }
    if (unassigned === 'true') {
      // Show only unassigned health checks (no technician)
      query = query.is('technician_id', null)
    } else if (technician_id) {
      query = query.eq('technician_id', technician_id)
    }
    if (advisor_id) {
      query = query.eq('advisor_id', advisor_id)
    }
    if (site_id) {
      query = query.eq('site_id', site_id)
    }
    if (date_from) {
      query = query.gte('created_at', date_from)
    }
    if (date_to) {
      query = query.lte('created_at', date_to)
    }

    // For technicians, filter by site if they have one (so they only see jobs at their location)
    if (auth.user.role === 'technician' && auth.user.siteId && !site_id) {
      query = query.eq('site_id', auth.user.siteId)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      healthChecks: data?.map(hc => ({
        id: hc.id,
        status: hc.status,
        vehicle: hc.vehicle ? {
          id: hc.vehicle.id,
          registration: hc.vehicle.registration,
          make: hc.vehicle.make,
          model: hc.vehicle.model,
          customer: hc.vehicle.customer ? {
            id: hc.vehicle.customer.id,
            first_name: hc.vehicle.customer.first_name,
            last_name: hc.vehicle.customer.last_name
          } : null
        } : null,
        technician: hc.technician ? {
          id: hc.technician.id,
          first_name: hc.technician.first_name,
          last_name: hc.technician.last_name
        } : null,
        advisor: hc.advisor ? {
          id: hc.advisor.id,
          first_name: hc.advisor.first_name,
          last_name: hc.advisor.last_name
        } : null,
        template: hc.template ? {
          id: hc.template.id,
          name: hc.template.name
        } : null,
        mileage_in: hc.mileage_in,
        green_count: hc.green_count,
        amber_count: hc.amber_count,
        red_count: hc.red_count,
        total_labour: hc.total_labour,
        total_parts: hc.total_parts,
        total_amount: hc.total_amount,
        created_at: hc.created_at,
        updated_at: hc.updated_at
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List health checks error:', error)
    return c.json({ error: 'Failed to list health checks' }, 500)
  }
})

// POST /api/v1/health-checks - Create new health check
healthChecks.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { vehicleId, templateId, technicianId, advisorId, mileageIn, siteId } = body

    if (!vehicleId || !templateId) {
      return c.json({ error: 'Vehicle ID and Template ID are required' }, 400)
    }

    // Verify vehicle belongs to org
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('id, customer_id')
      .eq('id', vehicleId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!vehicle) {
      return c.json({ error: 'Vehicle not found' }, 404)
    }

    // Verify template belongs to org
    const { data: template } = await supabaseAdmin
      .from('check_templates')
      .select('id')
      .eq('id', templateId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!template) {
      return c.json({ error: 'Template not found' }, 404)
    }

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId,
        vehicle_id: vehicleId,
        customer_id: vehicle.customer_id,
        template_id: templateId,
        technician_id: technicianId,
        advisor_id: advisorId || auth.user.id,
        mileage_in: mileageIn,
        status: technicianId ? 'assigned' : 'created'
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Create initial status history entry
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: healthCheck.id,
        from_status: null,
        to_status: healthCheck.status,
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check created'
      })

    return c.json({
      id: healthCheck.id,
      status: healthCheck.status,
      vehicleId: healthCheck.vehicle_id,
      templateId: healthCheck.template_id,
      technicianId: healthCheck.technician_id,
      advisorId: healthCheck.advisor_id,
      mileageIn: healthCheck.mileage_in,
      createdAt: healthCheck.created_at
    }, 201)
  } catch (error) {
    console.error('Create health check error:', error)
    return c.json({ error: 'Failed to create health check' }, 500)
  }
})

// GET /api/v1/health-checks/:id/pdf - Generate PDF report
// NOTE: This route MUST be defined BEFORE /:id to avoid being caught by the general route
healthChecks.get('/:id/pdf', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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
          input_type,
          section:template_sections(name)
        ),
        media:result_media(id, storage_path, thumbnail_path, media_type, include_in_report)
      `)
      .eq('health_check_id', id)
      .order('created_at', { ascending: true })

    // Fetch repair items
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select('*')
      .eq('health_check_id', id)
      .eq('is_visible', true)
      .order('sort_order', { ascending: true })

    // Fetch authorizations
    const { data: authorizations } = await supabaseAdmin
      .from('authorizations')
      .select('repair_item_id, decision, signature_data, signed_at')
      .eq('health_check_id', id)

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

    const authByItemId = new Map((authorizations || []).map(a => [a.repair_item_id, a]))
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
        const templateItem = r.template_item as unknown as { id: string; name: string; input_type: string; section: { name: string } | null } | null
        return {
          id: r.id,
          rag_status: r.rag_status as 'red' | 'amber' | 'green',
          notes: r.notes,
          value: r.value as Record<string, unknown> | null,
          template_item: templateItem ? {
            id: templateItem.id,
            name: templateItem.name,
            input_type: templateItem.input_type,
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
        work_completed_at: i.work_completed_at
      })),

      authorizations: (authorizations || []).map(a => ({
        repair_item_id: a.repair_item_id,
        decision: a.decision as 'approved' | 'declined',
        signature_data: a.signature_data,
        signed_at: a.signed_at
      })),

      reasonsByCheckResult,

      summary: {
        red_count: redItems.length,
        amber_count: amberItems.length,
        green_count: greenResults.length,
        total_identified: repairItems?.reduce((sum, i) => sum + (i.total_price || 0), 0) || 0,
        total_authorised: authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0),
        work_completed_value: completedItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
      }
    }

    // Generate PDF
    const pdfBuffer = await generateHealthCheckPDF(pdfData)

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

// GET /api/v1/health-checks/:id - Get full details
healthChecks.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { include } = c.req.query()

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .select(`
        *,
        vehicle:vehicles(*,customer:customers(*)),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name, email),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name, email),
        closed_by_user:users!health_checks_closed_by_fkey(id, first_name, last_name),
        template:check_templates(id, name)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Helper to build storage URL from path
    const getStorageUrl = (storagePath: string) => {
      const supabaseUrl = process.env.SUPABASE_URL
      return `${supabaseUrl}/storage/v1/object/public/vhc-photos/${storagePath}`
    }

    // Build response object
    const response: Record<string, unknown> = {
      healthCheck: {
        id: healthCheck.id,
        organization_id: healthCheck.organization_id,
        site_id: healthCheck.site_id,
        vehicle_id: healthCheck.vehicle_id,
        customer_id: healthCheck.customer_id,
        template_id: healthCheck.template_id,
        technician_id: healthCheck.technician_id,
        advisor_id: healthCheck.advisor_id,
        status: healthCheck.status,
        created_at: healthCheck.created_at,
        updated_at: healthCheck.updated_at,
        mileage_in: healthCheck.mileage_in,
        mileage_out: healthCheck.mileage_out,
        promise_time: healthCheck.promise_time,
        notes: healthCheck.notes,
        technician_notes: healthCheck.technician_notes,
        advisor_notes: healthCheck.advisor_notes,
        green_count: healthCheck.green_count,
        amber_count: healthCheck.amber_count,
        red_count: healthCheck.red_count,
        total_labour: healthCheck.total_labour,
        total_parts: healthCheck.total_parts,
        total_amount: healthCheck.total_amount,
        public_token: healthCheck.public_token,
        token_expires_at: healthCheck.token_expires_at,
        sent_at: healthCheck.sent_at,
        first_opened_at: healthCheck.first_opened_at,
        closed_at: healthCheck.closed_at,
        closed_by: healthCheck.closed_by,
        arrived_at: healthCheck.arrived_at,
        external_id: healthCheck.external_id,
        external_source: healthCheck.external_source,
        // Phase 1 Quick Wins fields
        due_date: healthCheck.due_date,
        booked_date: healthCheck.booked_date,
        customer_waiting: healthCheck.customer_waiting || false,
        loan_car_required: healthCheck.loan_car_required || false,
        is_internal: healthCheck.is_internal || false,
        booked_repairs: healthCheck.booked_repairs || [],
        jobsheet_number: healthCheck.jobsheet_number,
        jobsheet_status: healthCheck.jobsheet_status,
        closed_by_user: healthCheck.closed_by_user ? {
          id: healthCheck.closed_by_user.id,
          first_name: healthCheck.closed_by_user.first_name,
          last_name: healthCheck.closed_by_user.last_name
        } : null,
        vehicle: healthCheck.vehicle ? {
          id: healthCheck.vehicle.id,
          registration: healthCheck.vehicle.registration,
          vin: healthCheck.vehicle.vin,
          make: healthCheck.vehicle.make,
          model: healthCheck.vehicle.model,
          year: healthCheck.vehicle.year,
          color: healthCheck.vehicle.color,
          fuel_type: healthCheck.vehicle.fuel_type,
          mileage: healthCheck.vehicle.mileage,
          customer_id: healthCheck.vehicle.customer_id,
          customer: healthCheck.vehicle.customer ? {
            id: healthCheck.vehicle.customer.id,
            first_name: healthCheck.vehicle.customer.first_name,
            last_name: healthCheck.vehicle.customer.last_name,
            email: healthCheck.vehicle.customer.email,
            mobile: healthCheck.vehicle.customer.mobile,
            external_id: healthCheck.vehicle.customer.external_id,
            // Phase 1 Quick Wins - Address fields
            title: healthCheck.vehicle.customer.title,
            address_line1: healthCheck.vehicle.customer.address_line1,
            address_line2: healthCheck.vehicle.customer.address_line2,
            town: healthCheck.vehicle.customer.town,
            county: healthCheck.vehicle.customer.county,
            postcode: healthCheck.vehicle.customer.postcode
          } : null
        } : null,
        technician: healthCheck.technician ? {
          id: healthCheck.technician.id,
          first_name: healthCheck.technician.first_name,
          last_name: healthCheck.technician.last_name
        } : null,
        advisor: healthCheck.advisor ? {
          id: healthCheck.advisor.id,
          first_name: healthCheck.advisor.first_name,
          last_name: healthCheck.advisor.last_name
        } : null,
        template: healthCheck.template ? {
          id: healthCheck.template.id,
          name: healthCheck.template.name
        } : null
      }
    }

    // If include=full or include=advisor, fetch all related data for advisor view
    if (include === 'full' || include === 'advisor') {
      // Fetch check results with template items and media
      const { data: checkResults } = await supabaseAdmin
        .from('check_results')
        .select(`
          *,
          template_item:template_items(
            id, name, description, item_type, config,
            section:template_sections(id, name, sort_order)
          ),
          media:result_media(*)
        `)
        .eq('health_check_id', id)

      // Fetch repair items with work completion info
      let { data: repairItems } = await supabaseAdmin
        .from('repair_items')
        .select(`
          *,
          work_completed_by_user:users!repair_items_work_completed_by_fkey(id, first_name, last_name)
        `)
        .eq('health_check_id', id)
        .order('sort_order', { ascending: true })

      // Auto-generate repair items for existing health checks that don't have them
      // This handles health checks completed before the auto-generation feature
      const hasRedAmberResults = checkResults?.some(r => r.rag_status === 'red' || r.rag_status === 'amber')
      if ((!repairItems || repairItems.length === 0) && hasRedAmberResults) {
        await autoGenerateRepairItems(id)
        // Re-fetch repair items after generation
        const { data: generatedItems } = await supabaseAdmin
          .from('repair_items')
          .select(`
            *,
            work_completed_by_user:users!repair_items_work_completed_by_fkey(id, first_name, last_name)
          `)
          .eq('health_check_id', id)
          .order('sort_order', { ascending: true })
        repairItems = generatedItems
      }

      // Fetch authorizations
      const { data: authorizations } = await supabaseAdmin
        .from('authorizations')
        .select('*')
        .eq('health_check_id', id)

      // Map check results with media URLs
      response.check_results = checkResults?.map(r => ({
        id: r.id,
        health_check_id: r.health_check_id,
        template_item_id: r.template_item_id,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        is_mot_failure: r.is_mot_failure,
        checked_at: r.checked_at,
        checked_by: r.checked_by,
        template_item: r.template_item ? {
          id: r.template_item.id,
          name: r.template_item.name,
          description: r.template_item.description,
          item_type: r.template_item.item_type,
          config: r.template_item.config,
          section: r.template_item.section ? {
            id: r.template_item.section.id,
            name: r.template_item.section.name,
            sort_order: r.template_item.section.sort_order
          } : null
        } : null,
        media: r.media?.map((m: Record<string, unknown>) => {
          const url = m.storage_path ? getStorageUrl(m.storage_path as string) : null
          return {
            id: m.id,
            url,
            thumbnail_url: url ? `${url}?width=200&height=200` : null,
            annotation_data: m.annotation_data,
            caption: m.caption,
            sort_order: m.sort_order,
            include_in_report: m.include_in_report !== false
          }
        })
      }))

      // Map repair items
      response.repair_items = repairItems?.map(item => ({
        id: item.id,
        health_check_id: item.health_check_id,
        check_result_id: item.check_result_id,
        title: item.title,
        description: item.description,
        rag_status: item.rag_status,
        parts_cost: item.parts_cost,
        labor_cost: item.labor_cost,
        total_price: item.total_price,
        is_approved: item.is_approved,
        is_visible: item.is_visible,
        is_mot_failure: item.is_mot_failure,
        follow_up_date: item.follow_up_date,
        work_completed_at: item.work_completed_at,
        work_completed_by: item.work_completed_by,
        work_completed_by_user: item.work_completed_by_user ? {
          id: item.work_completed_by_user.id,
          first_name: item.work_completed_by_user.first_name,
          last_name: item.work_completed_by_user.last_name
        } : null,
        sort_order: item.sort_order,
        created_at: item.created_at
      }))

      // Map authorizations (customer decisions)
      response.authorizations = authorizations?.map(a => ({
        id: a.id,
        repair_item_id: a.repair_item_id,
        decision: a.decision,
        decided_at: a.decided_at,
        customer_notes: a.customer_notes,
        signature_data: a.signature_data ? true : false // Just indicate if signed, don't expose signature
      }))

      // Calculate summary stats for advisor view
      const authorisedItems = repairItems?.filter(i => i.is_approved) || []
      const declinedItems = authorizations?.filter(a => a.decision === 'declined') || []
      const completedItems = authorisedItems.filter(i => i.work_completed_at)

      response.summary = {
        total_items: checkResults?.length || 0,
        red_count: checkResults?.filter(r => r.rag_status === 'red').length || 0,
        amber_count: checkResults?.filter(r => r.rag_status === 'amber').length || 0,
        green_count: checkResults?.filter(r => r.rag_status === 'green').length || 0,
        total_identified: repairItems?.reduce((sum, i) => sum + (i.total_price || 0), 0) || 0,
        total_authorised: authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0),
        total_declined: declinedItems.length,
        work_completed_count: completedItems.length,
        work_outstanding_count: authorisedItems.length - completedItems.length,
        work_completed_value: completedItems.reduce((sum, i) => sum + (i.total_price || 0), 0),
        work_outstanding_value: authorisedItems.filter(i => !i.work_completed_at).reduce((sum, i) => sum + (i.total_price || 0), 0),
        media_count: checkResults?.reduce((sum, r) => sum + (r.media?.length || 0), 0) || 0
      }
    }

    return c.json(response)
  } catch (error) {
    console.error('Get health check error:', error)
    return c.json({ error: 'Failed to get health check' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id - Update health check
healthChecks.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    // Support both camelCase and snake_case for mileage fields
    const mileageIn = body.mileageIn ?? body.mileage_in
    const mileageOut = body.mileageOut ?? body.mileage_out
    const technicianNotes = body.technicianNotes ?? body.technician_notes
    const technicianSignature = body.technicianSignature ?? body.technician_signature
    const { notes, customerNotes } = body

    // Technicians can only update health checks assigned to them
    if (auth.user.role === 'technician') {
      const { data: hc } = await supabaseAdmin
        .from('health_checks')
        .select('technician_id')
        .eq('id', id)
        .eq('organization_id', auth.orgId)
        .single()

      if (!hc || hc.technician_id !== auth.user.id) {
        return c.json({ error: 'Not authorized to update this health check' }, 403)
      }
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (mileageIn !== undefined) updateData.mileage_in = mileageIn
    if (mileageOut !== undefined) updateData.mileage_out = mileageOut
    if (notes !== undefined) updateData.notes = notes
    if (customerNotes !== undefined) updateData.customer_notes = customerNotes
    if (technicianNotes !== undefined) updateData.technician_notes = technicianNotes
    if (technicianSignature !== undefined) updateData.technician_signature = technicianSignature

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: healthCheck.id,
      status: healthCheck.status,
      mileageIn: healthCheck.mileage_in,
      mileageOut: healthCheck.mileage_out,
      notes: healthCheck.notes,
      customerNotes: healthCheck.customer_notes,
      updatedAt: healthCheck.updated_at
    })
  } catch (error) {
    console.error('Update health check error:', error)
    return c.json({ error: 'Failed to update health check' }, 500)
  }
})

// DELETE /api/v1/health-checks/:id - Cancel health check
healthChecks.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get current status
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select('status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!isValidTransition(current.status, 'cancelled')) {
      return c.json({ error: `Cannot cancel health check in ${current.status} status` }, 400)
    }

    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: current.status,
        to_status: 'cancelled',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check cancelled'
      })

    return c.json({ message: 'Health check cancelled' })
  } catch (error) {
    console.error('Cancel health check error:', error)
    return c.json({ error: 'Failed to cancel health check' }, 500)
  }
})

// POST /api/v1/health-checks/:id/status - Change status
healthChecks.post('/:id/status', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { status, notes } = body

    if (!status) {
      return c.json({ error: 'Status is required' }, 400)
    }

    // Get current health check with vehicle info for notifications
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select(`
        status, technician_id, site_id,
        vehicle:vehicles(registration)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate transition
    if (!isValidTransition(current.status, status)) {
      return c.json({ error: `Invalid status transition from ${current.status} to ${status}` }, 400)
    }

    // Technicians can only change status of their own checks
    if (auth.user.role === 'technician' && current.technician_id !== auth.user.id) {
      return c.json({ error: 'Not authorized to change this health check status' }, 403)
    }

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: current.status,
        to_status: status,
        changed_by: auth.user.id,
        change_source: 'user',
        notes
      })

    // Send WebSocket notification for status change
    if (current.site_id) {
      const vehicleReg = (current.vehicle as unknown as { registration: string })?.registration || 'Unknown'
      notifyHealthCheckStatusChanged(current.site_id, id, {
        status,
        previousStatus: current.status,
        vehicleReg,
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

    return c.json({
      id: healthCheck.id,
      status: healthCheck.status,
      previousStatus: current.status,
      updatedAt: healthCheck.updated_at
    })
  } catch (error) {
    console.error('Change status error:', error)
    return c.json({ error: 'Failed to change status' }, 500)
  }
})

// GET /api/v1/health-checks/:id/history - Get status history
healthChecks.get('/:id/history', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: history, error } = await supabaseAdmin
      .from('health_check_status_history')
      .select(`
        *,
        user:users(id, first_name, last_name)
      `)
      .eq('health_check_id', id)
      .order('changed_at', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      history: history?.map(h => ({
        id: h.id,
        fromStatus: h.from_status,
        toStatus: h.to_status,
        changedBy: h.user ? {
          id: h.user.id,
          firstName: h.user.first_name,
          lastName: h.user.last_name
        } : null,
        notes: h.notes,
        createdAt: h.changed_at
      }))
    })
  } catch (error) {
    console.error('Get history error:', error)
    return c.json({ error: 'Failed to get status history' }, 500)
  }
})

// POST /api/v1/health-checks/:id/mark-arrived - Mark vehicle as arrived (DMS workflow)
healthChecks.post('/:id/mark-arrived', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get current health check
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate transition
    if (current.status !== 'awaiting_arrival') {
      return c.json({ error: `Can only mark arrived from awaiting_arrival status, current status is ${current.status}` }, 400)
    }

    const now = new Date().toISOString()

    // Update status and record arrival time
    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'created',
        arrived_at: now,
        updated_at: now
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record status change in history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'awaiting_arrival',
        to_status: 'created',
        changed_by: auth.user.id,
        notes: 'Vehicle marked as arrived'
      })

    // Notify via WebSocket
    await notifyHealthCheckStatusChanged(id, 'awaiting_arrival', 'created', auth.user.id, auth.orgId)

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status,
        arrivedAt: healthCheck.arrived_at
      }
    })
  } catch (error) {
    console.error('Mark arrived error:', error)
    return c.json({ error: 'Failed to mark vehicle as arrived' }, 500)
  }
})

// POST /api/v1/health-checks/:id/mark-no-show - Mark vehicle as no-show (DMS workflow)
healthChecks.post('/:id/mark-no-show', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const notes = body.notes || 'Vehicle did not arrive'

    // Get current health check
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate transition
    if (current.status !== 'awaiting_arrival') {
      return c.json({ error: `Can only mark no-show from awaiting_arrival status, current status is ${current.status}` }, 400)
    }

    const now = new Date().toISOString()

    // Update status to no_show
    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'no_show',
        updated_at: now
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record status change in history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'awaiting_arrival',
        to_status: 'no_show',
        changed_by: auth.user.id,
        notes
      })

    // Notify via WebSocket
    await notifyHealthCheckStatusChanged(id, 'awaiting_arrival', 'no_show', auth.user.id, auth.orgId)

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status
      }
    })
  } catch (error) {
    console.error('Mark no-show error:', error)
    return c.json({ error: 'Failed to mark vehicle as no-show' }, 500)
  }
})

// POST /api/v1/health-checks/:id/assign - Assign technician
healthChecks.post('/:id/assign', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { technicianId } = body

    if (!technicianId) {
      return c.json({ error: 'Technician ID is required' }, 400)
    }

    // Technicians can only assign themselves
    if (auth.user.role === 'technician' && technicianId !== auth.user.id) {
      return c.json({ error: 'Technicians can only assign themselves to jobs' }, 403)
    }

    // Verify technician exists and belongs to org
    const { data: technician } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', technicianId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!technician) {
      return c.json({ error: 'Technician not found' }, 404)
    }

    // Get current health check
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select('status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Update health check with technician and status
    const newStatus = current.status === 'created' ? 'assigned' : current.status
    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .update({
        technician_id: technicianId,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record status change if changed
    if (current.status !== newStatus) {
      await supabaseAdmin
        .from('health_check_status_history')
        .insert({
          health_check_id: id,
          from_status: current.status,
          to_status: newStatus,
          changed_by: auth.user.id,
          change_source: 'user',
          notes: 'Technician assigned'
        })
    }

    return c.json({
      id: healthCheck.id,
      technicianId: healthCheck.technician_id,
      status: healthCheck.status,
      updatedAt: healthCheck.updated_at
    })
  } catch (error) {
    console.error('Assign technician error:', error)
    return c.json({ error: 'Failed to assign technician' }, 500)
  }
})

// POST /api/v1/health-checks/:id/clock-in - Technician clock in
healthChecks.post('/:id/clock-in', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check with vehicle info for notifications
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, technician_id, site_id,
        vehicle:vehicles(registration)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Only assigned technician can clock in (or admins)
    if (auth.user.role === 'technician' && healthCheck.technician_id !== auth.user.id) {
      return c.json({ error: 'Not authorized to clock in to this health check' }, 403)
    }

    // Get vehicle registration for notifications
    const vehicleReg = (healthCheck.vehicle as unknown as { registration: string })?.registration || 'Unknown'

    // Check for existing open time entry for this technician
    const { data: openEntry } = await supabaseAdmin
      .from('technician_time_entries')
      .select('id, clock_in_at')
      .eq('health_check_id', id)
      .eq('technician_id', auth.user.id)
      .is('clock_out_at', null)
      .single()

    if (openEntry) {
      // Auto-close the stale entry (e.g., from a crashed session) and continue
      const clockOut = new Date()
      const clockIn = new Date(openEntry.clock_in_at)
      const durationMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)

      await supabaseAdmin
        .from('technician_time_entries')
        .update({
          clock_out_at: clockOut.toISOString(),
          duration_minutes: durationMinutes
        })
        .eq('id', openEntry.id)
    }

    // Create time entry
    const { data: timeEntry, error: entryError } = await supabaseAdmin
      .from('technician_time_entries')
      .insert({
        health_check_id: id,
        technician_id: auth.user.id,
        clock_in_at: new Date().toISOString()
      })
      .select()
      .single()

    if (entryError) {
      return c.json({ error: entryError.message }, 500)
    }

    // Update status to in_progress if currently assigned
    if (healthCheck.status === 'assigned' || healthCheck.status === 'paused') {
      await supabaseAdmin
        .from('health_checks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', id)

      await supabaseAdmin
        .from('health_check_status_history')
        .insert({
          health_check_id: id,
          from_status: healthCheck.status,
          to_status: 'in_progress',
          changed_by: auth.user.id,
          change_source: 'user',
          notes: 'Technician clocked in'
        })

      // Send WebSocket notification for status change
      if (healthCheck.site_id) {
        notifyHealthCheckStatusChanged(healthCheck.site_id, id, {
          status: 'in_progress',
          previousStatus: healthCheck.status,
          vehicleReg,
          updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
        })
      }
    }

    // Send WebSocket notification for clock in
    if (healthCheck.site_id) {
      notifyTechnicianClockedIn(healthCheck.site_id, id, {
        technicianId: auth.user.id,
        technicianName: `${auth.user.firstName} ${auth.user.lastName}`,
        vehicleReg
      })
    }

    return c.json({
      id: timeEntry.id,
      clockIn: timeEntry.clock_in_at,
      healthCheckStatus: 'in_progress'
    })
  } catch (error) {
    console.error('Clock in error:', error)
    return c.json({ error: 'Failed to clock in' }, 500)
  }
})

// POST /api/v1/health-checks/:id/clock-out - Technician clock out
healthChecks.post('/:id/clock-out', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Parse body safely (may be empty)
    let complete = true // Default to completing the inspection
    try {
      const body = await c.req.json()
      complete = body.complete !== false
    } catch {
      // Body is empty or not JSON, use default
    }

    // Get health check with vehicle info for notifications
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, technician_id, site_id,
        vehicle:vehicles(registration)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Only assigned technician can clock out (or admins)
    if (auth.user.role === 'technician' && healthCheck.technician_id !== auth.user.id) {
      return c.json({ error: 'Not authorized to clock out of this health check' }, 403)
    }

    // Get vehicle registration for notifications
    const vehicleReg = (healthCheck.vehicle as unknown as { registration: string })?.registration || 'Unknown'

    // Find open time entry
    const { data: openEntry } = await supabaseAdmin
      .from('technician_time_entries')
      .select('id, clock_in_at')
      .eq('health_check_id', id)
      .eq('technician_id', auth.user.id)
      .is('clock_out_at', null)
      .single()

    if (!openEntry) {
      return c.json({ error: 'Not clocked in' }, 400)
    }

    // Calculate duration
    const clockOut = new Date()
    const clockIn = new Date(openEntry.clock_in_at)
    const durationMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)

    // Update time entry
    const { data: timeEntry, error: entryError } = await supabaseAdmin
      .from('technician_time_entries')
      .update({
        clock_out_at: clockOut.toISOString(),
        duration_minutes: durationMinutes
      })
      .eq('id', openEntry.id)
      .select()
      .single()

    if (entryError) {
      return c.json({ error: entryError.message }, 500)
    }

    // Update status based on complete flag
    const newStatus = complete ? 'tech_completed' : 'paused'
    const canUpdateStatus = ['in_progress', 'paused', 'assigned'].includes(healthCheck.status)

    if (canUpdateStatus && healthCheck.status !== newStatus) {
      await supabaseAdmin
        .from('health_checks')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id)

      await supabaseAdmin
        .from('health_check_status_history')
        .insert({
          health_check_id: id,
          from_status: healthCheck.status,
          to_status: newStatus,
          changed_by: auth.user.id,
          change_source: 'user',
          notes: complete ? 'Technician completed check' : 'Technician clocked out (paused)'
        })

      // Auto-generate repair items when tech completes the check
      if (newStatus === 'tech_completed') {
        await autoGenerateRepairItems(id)
      }

      // Send WebSocket notification for status change
      if (healthCheck.site_id) {
        notifyHealthCheckStatusChanged(healthCheck.site_id, id, {
          status: newStatus,
          previousStatus: healthCheck.status,
          vehicleReg,
          updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
        })
      }
    }

    // Send WebSocket notification for clock out
    if (healthCheck.site_id) {
      notifyTechnicianClockedOut(healthCheck.site_id, id, {
        technicianId: auth.user.id,
        technicianName: `${auth.user.firstName} ${auth.user.lastName}`,
        vehicleReg,
        completed: complete,
        duration: durationMinutes
      })
    }

    return c.json({
      id: timeEntry.id,
      clockIn: timeEntry.clock_in_at,
      clockOut: timeEntry.clock_out_at,
      durationMinutes: timeEntry.duration_minutes,
      healthCheckStatus: newStatus
    })
  } catch (error) {
    console.error('Clock out error:', error)
    return c.json({ error: 'Failed to clock out' }, 500)
  }
})

// GET /api/v1/health-checks/:id/time-entries - Get time entries
healthChecks.get('/:id/time-entries', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: entries, error } = await supabaseAdmin
      .from('technician_time_entries')
      .select(`
        *,
        technician:users(id, first_name, last_name)
      `)
      .eq('health_check_id', id)
      .order('clock_in', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    const totalMinutes = entries?.reduce((sum, e) => sum + (e.duration_minutes || 0), 0) || 0

    return c.json({
      entries: entries?.map(e => ({
        id: e.id,
        technician: e.technician ? {
          id: e.technician.id,
          firstName: e.technician.first_name,
          lastName: e.technician.last_name
        } : null,
        clockIn: e.clock_in_at,
        clockOut: e.clock_out_at,
        durationMinutes: e.duration_minutes
      })),
      totalMinutes
    })
  } catch (error) {
    console.error('Get time entries error:', error)
    return c.json({ error: 'Failed to get time entries' }, 500)
  }
})

// POST /api/v1/health-checks/:id/publish - Publish and send to customer
healthChecks.post('/:id/publish', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { send_email = true, send_sms = false, expires_in_days = 7, message } = body

    // Get health check and verify it's ready to send
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, customer_id, vehicle_id, site_id,
        vehicle:vehicles(registration),
        customer:customers(id, first_name, last_name, email, mobile)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate status allows sending
    const sendableStatuses = ['ready_to_send', 'sent', 'expired']
    if (!sendableStatuses.includes(healthCheck.status)) {
      return c.json({ error: `Cannot send health check in ${healthCheck.status} status` }, 400)
    }

    // Generate public token (random hex string)
    const publicToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Calculate expiry date
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expires_in_days)

    // Update health check with public token and status
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        public_token: publicToken,
        token_expires_at: expiresAt.toISOString(),
        status: 'sent',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: healthCheck.status,
        to_status: 'sent',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: `Sent to customer via ${[send_email && 'email', send_sms && 'SMS'].filter(Boolean).join(' and ')}`
      })

    // Get organization and site settings for sending
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, settings')
      .eq('id', auth.orgId)
      .single()

    // Build public URL
    const publicUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5183'}/view/${publicToken}`

    // Cast nested relations for TypeScript
    const vehicle = healthCheck.vehicle as unknown as { registration: string }
    const customer = healthCheck.customer as unknown as { id: string; first_name: string; last_name: string; email: string; mobile: string }

    // Queue customer notification (email/SMS)
    await queueNotification({
      type: 'customer_health_check_ready',
      healthCheckId: id,
      customerId: healthCheck.customer_id,
      organizationId: auth.orgId,
      publicToken,
      publicUrl,
      sendEmail: send_email,
      sendSms: send_sms,
      customerEmail: customer?.email,
      customerMobile: customer?.mobile,
      customMessage: message
    })

    // Schedule automatic reminders
    await scheduleHealthCheckReminders(
      id,
      new Date(),
      expiresAt,
      org?.settings
    )

    // Send real-time notification to staff
    if (healthCheck.site_id) {
      notifyHealthCheckStatusChanged(healthCheck.site_id, id, {
        status: 'sent',
        previousStatus: healthCheck.status,
        vehicleReg: vehicle.registration,
        customerName: `${customer.first_name} ${customer.last_name}`,
        updatedBy: auth.user.email
      })
    }

    console.log('Health check published:', {
      id,
      publicUrl,
      sendEmail: send_email,
      sendSms: send_sms
    })

    return c.json({
      id: updated.id,
      status: updated.status,
      publicToken: updated.public_token,
      publicUrl,
      expiresAt: updated.token_expires_at,
      sentVia: {
        email: send_email,
        sms: send_sms
      }
    })
  } catch (error) {
    console.error('Publish health check error:', error)
    return c.json({ error: 'Failed to publish health check' }, 500)
  }
})

// GET /api/v1/health-checks/:id/results - Get all results for a health check
healthChecks.get('/:id/results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: results, error } = await supabaseAdmin
      .from('check_results')
      .select(`
        *,
        media:result_media(*)
      `)
      .eq('health_check_id', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Helper to build storage URL from path
    const getStorageUrl = (storagePath: string) => {
      const supabaseUrl = process.env.SUPABASE_URL
      return `${supabaseUrl}/storage/v1/object/public/vhc-photos/${storagePath}`
    }

    return c.json({
      results: results?.map(r => ({
        id: r.id,
        health_check_id: r.health_check_id,
        template_item_id: r.template_item_id,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        media: r.media?.map((m: Record<string, unknown>) => {
          const url = m.storage_path ? getStorageUrl(m.storage_path as string) : null
          return {
            id: m.id,
            url,
            thumbnail_url: url ? `${url}?width=200&height=200` : null,
            annotation_data: m.annotation_data,
            include_in_report: m.include_in_report !== false
          }
        })
      }))
    })
  } catch (error) {
    console.error('Get results error:', error)
    return c.json({ error: 'Failed to get results' }, 500)
  }
})

// GET /api/v1/health-checks/:id/repair-items - Get all repair items for a health check
healthChecks.get('/:id/repair-items', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { data: items, error } = await supabaseAdmin
      .from('repair_items')
      .select('*')
      .eq('health_check_id', id)
      .order('sort_order', { ascending: true })

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      repairItems: items?.map(item => ({
        id: item.id,
        health_check_id: item.health_check_id,
        check_result_id: item.check_result_id,
        title: item.title,
        description: item.description,
        rag_status: item.rag_status,
        parts_cost: item.parts_cost,
        labor_cost: item.labor_cost,
        total_price: item.total_price,
        is_approved: item.is_approved,
        is_visible: item.is_visible,
        sort_order: item.sort_order,
        created_at: item.created_at
      }))
    })
  } catch (error) {
    console.error('Get repair items error:', error)
    return c.json({ error: 'Failed to get repair items' }, 500)
  }
})

// POST /api/v1/health-checks/:id/repair-items/generate - Auto-generate repair items from results
healthChecks.post('/:id/repair-items/generate', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check with results
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id,
        results:check_results(
          id, rag_status, notes, is_mot_failure,
          template_item:template_items(name, description)
        )
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get existing repair items to avoid duplicates
    const { data: existingItems } = await supabaseAdmin
      .from('repair_items')
      .select('check_result_id')
      .eq('health_check_id', id)

    const existingResultIds = new Set(existingItems?.map(i => i.check_result_id) || [])

    // Filter to red/amber results that don't already have repair items
    const resultsToCreate = (healthCheck.results || []).filter(
      (r: { rag_status: string; id: string }) =>
        (r.rag_status === 'red' || r.rag_status === 'amber') &&
        !existingResultIds.has(r.id)
    )

    if (resultsToCreate.length === 0) {
      return c.json({ message: 'No new repair items to generate', created: 0 })
    }

    // Get current max sort order
    const { data: maxOrder } = await supabaseAdmin
      .from('repair_items')
      .select('sort_order')
      .eq('health_check_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    let sortOrder = (maxOrder?.sort_order || 0) + 1

    // Create repair items
    const newItems = resultsToCreate.map((result: Record<string, unknown>) => {
      // Handle template_item which may be object or array from Supabase
      const templateItem = Array.isArray(result.template_item)
        ? result.template_item[0]
        : result.template_item
      return {
        health_check_id: id,
        check_result_id: result.id as string,
        title: (templateItem?.name as string) || 'Repair Item',
        description: (result.notes as string) || (templateItem?.description as string) || null,
        rag_status: result.rag_status as string,
        parts_cost: 0,
        labor_cost: 0,
        total_price: 0,
        is_visible: true,
        is_mot_failure: result.is_mot_failure as boolean || false,
        sort_order: sortOrder++
      }
    })

    const { data: created, error } = await supabaseAdmin
      .from('repair_items')
      .insert(newItems)
      .select()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      message: `Generated ${created?.length || 0} repair items`,
      created: created?.length || 0,
      repairItems: created
    })
  } catch (error) {
    console.error('Generate repair items error:', error)
    return c.json({ error: 'Failed to generate repair items' }, 500)
  }
})

// PATCH /api/v1/health-checks/:healthCheckId/repair-items/:itemId - Update repair item
healthChecks.patch('/:healthCheckId/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()
    const body = await c.req.json()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.parts_cost !== undefined) updateData.parts_cost = body.parts_cost
    if (body.labor_cost !== undefined) updateData.labor_cost = body.labor_cost
    if (body.is_visible !== undefined) updateData.is_visible = body.is_visible
    if (body.is_approved !== undefined) updateData.is_approved = body.is_approved
    // Advisor view fields
    if (body.is_mot_failure !== undefined) updateData.is_mot_failure = body.is_mot_failure
    if (body.follow_up_date !== undefined) updateData.follow_up_date = body.follow_up_date

    // Handle total_price - if provided directly, use it; otherwise calculate from parts+labour
    if (body.total_price !== undefined) {
      // Direct total price update (clears parts/labour breakdown)
      updateData.total_price = body.total_price
    } else if (body.parts_cost !== undefined || body.labor_cost !== undefined) {
      // Calculate total from parts + labour
      const { data: current } = await supabaseAdmin
        .from('repair_items')
        .select('parts_cost, labor_cost')
        .eq('id', itemId)
        .single()

      const parts = body.parts_cost !== undefined ? body.parts_cost : current?.parts_cost || 0
      const labour = body.labor_cost !== undefined ? body.labor_cost : current?.labor_cost || 0
      updateData.total_price = parts + labour
    }

    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Update health check totals
    await updateHealthCheckTotals(healthCheckId)

    return c.json({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      parts_cost: updated.parts_cost,
      labor_cost: updated.labor_cost,
      total_price: updated.total_price,
      is_visible: updated.is_visible,
      is_approved: updated.is_approved,
      is_mot_failure: updated.is_mot_failure,
      follow_up_date: updated.follow_up_date,
      work_completed_at: updated.work_completed_at,
      work_completed_by: updated.work_completed_by
    })
  } catch (error) {
    console.error('Update repair item error:', error)
    return c.json({ error: 'Failed to update repair item' }, 500)
  }
})

// DELETE /api/v1/health-checks/:healthCheckId/repair-items/:itemId - Delete repair item
healthChecks.delete('/:healthCheckId/repair-items/:itemId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('repair_items')
      .delete()
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Update health check totals
    await updateHealthCheckTotals(healthCheckId)

    return c.json({ message: 'Repair item deleted' })
  } catch (error) {
    console.error('Delete repair item error:', error)
    return c.json({ error: 'Failed to delete repair item' }, 500)
  }
})

// POST /api/v1/health-checks/:healthCheckId/repair-items/:itemId/complete - Mark work as complete
healthChecks.post('/:healthCheckId/repair-items/:itemId/complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Verify repair item exists and belongs to this health check
    const { data: repairItem } = await supabaseAdmin
      .from('repair_items')
      .select('id, work_completed_at')
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .single()

    if (!repairItem) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Update repair item with work completion details
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        work_completed_at: new Date().toISOString(),
        work_completed_by: auth.user.id
      })
      .eq('id', itemId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      work_completed_at: updated.work_completed_at,
      work_completed_by: updated.work_completed_by
    })
  } catch (error) {
    console.error('Mark work complete error:', error)
    return c.json({ error: 'Failed to mark work as complete' }, 500)
  }
})

// DELETE /api/v1/health-checks/:healthCheckId/repair-items/:itemId/complete - Unmark work as complete
healthChecks.delete('/:healthCheckId/repair-items/:itemId/complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { healthCheckId, itemId } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Clear work completion details
    const { data: updated, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        work_completed_at: null,
        work_completed_by: null
      })
      .eq('id', itemId)
      .eq('health_check_id', healthCheckId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      work_completed_at: null,
      work_completed_by: null
    })
  } catch (error) {
    console.error('Unmark work complete error:', error)
    return c.json({ error: 'Failed to unmark work as complete' }, 500)
  }
})

// POST /api/v1/health-checks/:id/close - Close health check (advisor action)
healthChecks.post('/:id/close', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all authorised repair items (items with is_approved = true)
    const { data: authorisedItems } = await supabaseAdmin
      .from('repair_items')
      .select('id, title, work_completed_at')
      .eq('health_check_id', id)
      .eq('is_approved', true)

    // Check if all authorised items have been marked as complete
    const incompleteItems = authorisedItems?.filter(item => !item.work_completed_at) || []

    if (incompleteItems.length > 0) {
      return c.json({
        error: 'Cannot close health check: some authorised work is not complete',
        incomplete_items: incompleteItems.map(item => ({
          id: item.id,
          title: item.title
        }))
      }, 400)
    }

    // Close the health check
    const { data: updated, error } = await supabaseAdmin
      .from('health_checks')
      .update({
        closed_at: new Date().toISOString(),
        closed_by: auth.user.id,
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record status change
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: healthCheck.status,
        to_status: 'completed',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check closed by advisor'
      })

    return c.json({
      id: updated.id,
      status: updated.status,
      closed_at: updated.closed_at,
      closed_by: updated.closed_by
    })
  } catch (error) {
    console.error('Close health check error:', error)
    return c.json({ error: 'Failed to close health check' }, 500)
  }
})

// Helper function to auto-generate repair items from check results
async function autoGenerateRepairItems(healthCheckId: string) {
  try {
    // Get check results with red/amber status
    const { data: results } = await supabaseAdmin
      .from('check_results')
      .select(`
        id, rag_status, notes, is_mot_failure,
        template_item:template_items(name, description)
      `)
      .eq('health_check_id', healthCheckId)
      .in('rag_status', ['red', 'amber'])

    if (!results || results.length === 0) {
      return { created: 0 }
    }

    // Get existing repair items to avoid duplicates
    const { data: existingItems } = await supabaseAdmin
      .from('repair_items')
      .select('check_result_id')
      .eq('health_check_id', healthCheckId)

    const existingResultIds = new Set(existingItems?.map(i => i.check_result_id) || [])

    // Filter to results that don't already have repair items
    const resultsToCreate = results.filter(r => !existingResultIds.has(r.id))

    if (resultsToCreate.length === 0) {
      return { created: 0 }
    }

    // Get current max sort order
    const { data: maxOrder } = await supabaseAdmin
      .from('repair_items')
      .select('sort_order')
      .eq('health_check_id', healthCheckId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    let sortOrder = (maxOrder?.sort_order || 0) + 1

    // Create repair items
    const newItems = resultsToCreate.map(result => {
      // Handle template_item which may be object or array from Supabase
      const templateItem = Array.isArray(result.template_item)
        ? result.template_item[0]
        : result.template_item
      return {
        health_check_id: healthCheckId,
        check_result_id: result.id,
        title: templateItem?.name || 'Repair Item',
        description: result.notes || templateItem?.description || null,
        rag_status: result.rag_status,
        parts_cost: 0,
        labor_cost: 0,
        total_price: 0,
        is_visible: true,
        is_mot_failure: result.is_mot_failure || false,
        sort_order: sortOrder++
      }
    })

    const { data: created, error } = await supabaseAdmin
      .from('repair_items')
      .insert(newItems)
      .select()

    if (error) {
      console.error('Auto-generate repair items error:', error)
      return { created: 0, error: error.message }
    }

    console.log(`Auto-generated ${created?.length || 0} repair items for health check ${healthCheckId}`)
    return { created: created?.length || 0 }
  } catch (error) {
    console.error('Auto-generate repair items error:', error)
    return { created: 0, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Helper function to update health check totals
async function updateHealthCheckTotals(healthCheckId: string) {
  const { data: items } = await supabaseAdmin
    .from('repair_items')
    .select('parts_cost, labor_cost, is_visible')
    .eq('health_check_id', healthCheckId)
    .eq('is_visible', true)

  const totalParts = items?.reduce((sum, i) => sum + (i.parts_cost || 0), 0) || 0
  const totalLabour = items?.reduce((sum, i) => sum + (i.labor_cost || 0), 0) || 0

  await supabaseAdmin
    .from('health_checks')
    .update({
      total_parts: totalParts,
      total_labour: totalLabour,
      total_amount: totalParts + totalLabour,
      updated_at: new Date().toISOString()
    })
    .eq('id', healthCheckId)
}

// Valid deletion reasons
const DELETION_REASONS = [
  'no_show',           // Customer did not arrive
  'no_time',           // Not enough time to perform inspection
  'not_required',      // Customer declined inspection
  'customer_declined', // Customer declined after initial contact
  'vehicle_issue',     // Vehicle has issues preventing inspection
  'duplicate',         // Duplicate booking
  'other'              // Other reason (requires notes)
] as const

type DeletionReason = typeof DELETION_REASONS[number]

// POST /api/v1/health-checks/:id/delete - Soft delete with reason
healthChecks.post('/:id/delete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { reason, notes } = body as { reason: DeletionReason; notes?: string }

    // Validate reason
    if (!reason || !DELETION_REASONS.includes(reason)) {
      return c.json({
        error: 'Invalid deletion reason',
        valid_reasons: DELETION_REASONS
      }, 400)
    }

    // Require notes for 'other' reason
    if (reason === 'other' && (!notes || notes.trim().length === 0)) {
      return c.json({ error: 'Notes are required when reason is "other"' }, 400)
    }

    // Get health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, deleted_at')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (healthCheck.deleted_at) {
      return c.json({ error: 'Health check is already deleted' }, 400)
    }

    // Only allow deletion of certain statuses
    const deletableStatuses = ['created', 'assigned', 'cancelled']
    if (!deletableStatuses.includes(healthCheck.status)) {
      return c.json({
        error: `Cannot delete health check in "${healthCheck.status}" status. Only "${deletableStatuses.join('", "')}" can be deleted.`
      }, 400)
    }

    // Soft delete
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.user.id,
        deletion_reason: reason,
        deletion_notes: notes?.trim() || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: healthCheck.status,
        to_status: 'deleted',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: `Deleted: ${reason}${notes ? ` - ${notes}` : ''}`
      })

    return c.json({
      success: true,
      message: 'Health check deleted',
      reason
    })
  } catch (error) {
    console.error('Delete health check error:', error)
    return c.json({ error: 'Failed to delete health check' }, 500)
  }
})

// POST /api/v1/health-checks/bulk-delete - Bulk soft delete with reason
healthChecks.post('/bulk-delete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { ids, reason, notes } = body as {
      ids: string[]
      reason: DeletionReason
      notes?: string
    }

    // Validate inputs
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'ids array is required' }, 400)
    }

    if (ids.length > 100) {
      return c.json({ error: 'Maximum 100 health checks per bulk delete' }, 400)
    }

    if (!reason || !DELETION_REASONS.includes(reason)) {
      return c.json({
        error: 'Invalid deletion reason',
        valid_reasons: DELETION_REASONS
      }, 400)
    }

    if (reason === 'other' && (!notes || notes.trim().length === 0)) {
      return c.json({ error: 'Notes are required when reason is "other"' }, 400)
    }

    // Get health checks
    const { data: healthChecks } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, deleted_at')
      .in('id', ids)
      .eq('organization_id', auth.orgId)

    if (!healthChecks || healthChecks.length === 0) {
      return c.json({ error: 'No health checks found' }, 404)
    }

    // Filter to only deletable ones
    const deletableStatuses = ['created', 'assigned', 'cancelled']
    const deletable = healthChecks.filter(hc =>
      !hc.deleted_at && deletableStatuses.includes(hc.status)
    )
    const skipped = healthChecks.filter(hc =>
      hc.deleted_at || !deletableStatuses.includes(hc.status)
    )

    if (deletable.length === 0) {
      return c.json({
        error: 'No health checks can be deleted',
        skipped: skipped.length
      }, 400)
    }

    const deletableIds = deletable.map(hc => hc.id)

    // Bulk soft delete
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: auth.user.id,
        deletion_reason: reason,
        deletion_notes: notes?.trim() || null,
        updated_at: new Date().toISOString()
      })
      .in('id', deletableIds)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history for each
    const historyRecords = deletable.map(hc => ({
      health_check_id: hc.id,
      from_status: hc.status,
      to_status: 'deleted',
      changed_by: auth.user.id,
      change_source: 'user',
      notes: `Bulk deleted: ${reason}${notes ? ` - ${notes}` : ''}`
    }))

    await supabaseAdmin
      .from('health_check_status_history')
      .insert(historyRecords)

    return c.json({
      success: true,
      message: `${deletable.length} health check(s) deleted`,
      deleted: deletable.length,
      skipped: skipped.length,
      reason
    })
  } catch (error) {
    console.error('Bulk delete health checks error:', error)
    return c.json({ error: 'Failed to bulk delete health checks' }, 500)
  }
})

// POST /api/v1/health-checks/:id/restore - Restore a soft-deleted health check
healthChecks.post('/:id/restore', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, deleted_at, deletion_reason')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    if (!healthCheck.deleted_at) {
      return c.json({ error: 'Health check is not deleted' }, 400)
    }

    // Restore
    const { error } = await supabaseAdmin
      .from('health_checks')
      .update({
        deleted_at: null,
        deleted_by: null,
        deletion_reason: null,
        deletion_notes: null,
        status: 'created',  // Reset to created status
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Record in status history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'deleted',
        to_status: 'created',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: 'Health check restored'
      })

    return c.json({
      success: true,
      message: 'Health check restored'
    })
  } catch (error) {
    console.error('Restore health check error:', error)
    return c.json({ error: 'Failed to restore health check' }, 500)
  }
})

export default healthChecks
