import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { autoGenerateRepairItems, getStorageUrl } from './helpers.js'

const crud = new Hono()

// GET / - List health checks with filters
crud.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
      .is('deleted_at', null) // Exclude soft-deleted records
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
        vhc_reference: hc.vhc_reference,
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
        arrived_at: hc.arrived_at,
        customer_waiting: hc.customer_waiting,
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

// POST / - Create new health check
crud.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    // Check if organization has check-in enabled
    const { data: checkinSettings } = await supabaseAdmin
      .from('organization_checkin_settings')
      .select('checkin_enabled')
      .eq('organization_id', auth.orgId)
      .single()

    const checkinEnabled = checkinSettings?.checkin_enabled === true

    // Determine initial status:
    // - If technician assigned: 'assigned' (bypass check-in for direct assignment)
    // - If check-in enabled: 'awaiting_checkin'
    // - Otherwise: 'created'
    let initialStatus: string
    if (technicianId) {
      initialStatus = 'assigned'
    } else if (checkinEnabled) {
      initialStatus = 'awaiting_checkin'
    } else {
      initialStatus = 'created'
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
        status: initialStatus
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Create initial status history entry
    const statusNotes = initialStatus === 'awaiting_checkin'
      ? 'Health check created - awaiting check-in'
      : 'Health check created'

    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: healthCheck.id,
        from_status: null,
        to_status: healthCheck.status,
        changed_by: auth.user.id,
        change_source: 'user',
        notes: statusNotes
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

// GET /:id - Get full details
crud.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
        // VHC Reference Number
        vhc_reference: healthCheck.vhc_reference,
        // Technician inspection timestamps
        tech_started_at: healthCheck.tech_started_at,
        tech_completed_at: healthCheck.tech_completed_at,
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

      // Fetch repair items with linked check results via junction table (NEW schema)
      // Note: repair_options FK hint needed because repair_items has TWO relationships to repair_options
      // (repair_options.repair_item_id and repair_items.selected_option_id) - must disambiguate
      let { data: repairItems, error: repairItemsError } = await supabaseAdmin
        .from('repair_items')
        .select(`
          *,
          check_results:repair_item_check_results(
            check_result:check_results(id, rag_status, notes)
          ),
          options:repair_options!repair_options_repair_item_id_fkey(id, name, description, labour_total, parts_total, subtotal, vat_amount, total_inc_vat, is_recommended, sort_order)
        `)
        .eq('health_check_id', id)
        .order('created_at', { ascending: true })

      if (repairItemsError) {
        console.error('Failed to fetch repair items with options:', repairItemsError)
      }

      // Build a map of children by parent_repair_item_id for group rag_status derivation
      // Groups don't have direct check_results - their children do
      const childrenByParent = new Map<string, typeof repairItems>()
      if (repairItems) {
        for (const item of repairItems) {
          if (item.parent_repair_item_id) {
            const parentId = item.parent_repair_item_id
            if (!childrenByParent.has(parentId)) {
              childrenByParent.set(parentId, [])
            }
            childrenByParent.get(parentId)!.push(item)
          }
        }
      }

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
            check_results:repair_item_check_results(
              check_result:check_results(id, rag_status, notes)
            ),
            options:repair_options!repair_options_repair_item_id_fkey(id, name, description, labour_total, parts_total, subtotal, vat_amount, total_inc_vat, is_recommended, sort_order)
          `)
          .eq('health_check_id', id)
          .order('created_at', { ascending: true })
        repairItems = generatedItems

        // Rebuild childrenByParent map after re-fetching
        childrenByParent.clear()
        if (repairItems) {
          for (const item of repairItems) {
            if (item.parent_repair_item_id) {
              const parentId = item.parent_repair_item_id
              if (!childrenByParent.has(parentId)) {
                childrenByParent.set(parentId, [])
              }
              childrenByParent.get(parentId)!.push(item)
            }
          }
        }
      }

      // Fetch authorizations
      const { data: authorizations, error: authError } = await supabaseAdmin
        .from('authorizations')
        .select('*')
        .eq('health_check_id', id)

      console.log('[HealthCheck Detail] Authorizations query:', {
        healthCheckId: id,
        authCount: authorizations?.length || 0,
        authError: authError?.message || null,
        authData: authorizations
      })

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

      // Map repair items (NEW schema - derive rag_status from linked check_results)
      response.repair_items = repairItems?.map(item => {
        // Get linked check results and derive rag_status
        const linkedCheckResults = item.check_results || []
        const firstCheckResult = Array.isArray(linkedCheckResults) && linkedCheckResults.length > 0
          ? linkedCheckResults[0]?.check_result
          : null
        // Derive rag_status: red takes priority over amber
        let derivedRagStatus: 'red' | 'amber' | null = null

        // For groups, derive rag_status from children's check_results
        // Groups themselves don't have direct check_results - their children do
        if (item.is_group) {
          const children = childrenByParent.get(item.id) || []
          for (const child of children) {
            const childCheckResults = child.check_results || []
            for (const link of childCheckResults) {
              const cr = link?.check_result
              if (cr?.rag_status === 'red') {
                derivedRagStatus = 'red'
                break
              } else if (cr?.rag_status === 'amber') {
                derivedRagStatus = 'amber'
              }
            }
            if (derivedRagStatus === 'red') break // Red takes priority, stop searching
          }
        } else {
          // For individual items, use direct check_results
          for (const link of linkedCheckResults) {
            const cr = link?.check_result
            if (cr?.rag_status === 'red') {
              derivedRagStatus = 'red'
              break
            } else if (cr?.rag_status === 'amber') {
              derivedRagStatus = 'amber'
            }
          }
        }

        // Fallback to stored rag_status for MRI items (which don't have linked check_results)
        if (!derivedRagStatus && item.rag_status) {
          derivedRagStatus = item.rag_status as 'red' | 'amber' | null
        }

        // Get first check_result_id for backward compatibility
        const checkResultId = firstCheckResult?.id || null

        return {
          id: item.id,
          health_check_id: item.health_check_id,
          check_result_id: checkResultId,
          title: item.name, // NEW schema uses 'name', map to 'title' for backward compat
          description: item.description,
          rag_status: derivedRagStatus,
          parts_cost: parseFloat(item.selected_option_id && item.options?.length
            ? (item.options.find((o: any) => o.id === item.selected_option_id)?.parts_total ?? item.parts_total)
            : item.parts_total) || 0,
          labor_cost: parseFloat(item.selected_option_id && item.options?.length
            ? (item.options.find((o: any) => o.id === item.selected_option_id)?.labour_total ?? item.labour_total)
            : item.labour_total) || 0,
          total_price: parseFloat(item.selected_option_id && item.options?.length
            ? (item.options.find((o: any) => o.id === item.selected_option_id)?.total_inc_vat ?? item.total_inc_vat)
            : item.total_inc_vat) || 0,
          is_approved: item.customer_approved,
          is_visible: true, // NEW schema doesn't have is_visible, default to true
          is_mot_failure: false, // NEW schema doesn't have this on repair_items
          follow_up_date: item.follow_up_date || null,
          work_completed_at: item.work_completed_at,
          work_completed_by: item.work_completed_by,
          work_completed_by_user: null, // Would need separate query
          sort_order: 0, // NEW schema doesn't have sort_order
          created_at: item.created_at,
          // Group/parent-child fields for repair groups
          is_group: item.is_group || false,
          parent_repair_item_id: item.parent_repair_item_id || null,
          // Line Completion feature - outcome tracking fields
          labour_status: item.labour_status || 'pending',
          parts_status: item.parts_status || 'pending',
          no_labour_required: item.no_labour_required || false,
          no_parts_required: item.no_parts_required || false,
          outcome_status: item.outcome_status || null,
          outcome_set_at: item.outcome_set_at || null,
          outcome_set_by: item.outcome_set_by || null,
          outcome_source: item.outcome_source || null,
          deferred_until: item.deferred_until || null,
          deferred_notes: item.deferred_notes || null,
          declined_reason_id: item.declined_reason_id || null,
          deleted_at: item.deleted_at || null,
          deleted_reason_id: item.deleted_reason_id || null,
          // Source tracking for MRI items
          source: item.source || null,
          // Repair options
          options: item.options?.map((opt: any) => ({
            id: opt.id,
            name: opt.name,
            description: opt.description,
            labourTotal: parseFloat(opt.labour_total) || 0,
            partsTotal: parseFloat(opt.parts_total) || 0,
            subtotal: parseFloat(opt.subtotal) || 0,
            vatAmount: parseFloat(opt.vat_amount) || 0,
            totalIncVat: parseFloat(opt.total_inc_vat) || 0,
            isRecommended: opt.is_recommended,
            sortOrder: opt.sort_order
          })) || [],
          selected_option_id: item.selected_option_id || null
        }
      })

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

// PATCH /:id - Update health check
crud.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    // Support both camelCase and snake_case for mileage fields
    const mileageIn = body.mileageIn ?? body.mileage_in
    const mileageOut = body.mileageOut ?? body.mileage_out
    const technicianNotes = body.technicianNotes ?? body.technician_notes
    const technicianSignature = body.technicianSignature ?? body.technician_signature
    const advisorId = body.advisorId ?? body.advisor_id
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

    // Technicians cannot change the advisor
    if (advisorId !== undefined && auth.user.role === 'technician') {
      return c.json({ error: 'Not authorized to change advisor' }, 403)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (mileageIn !== undefined) updateData.mileage_in = mileageIn
    if (mileageOut !== undefined) updateData.mileage_out = mileageOut
    if (notes !== undefined) updateData.notes = notes
    if (customerNotes !== undefined) updateData.customer_notes = customerNotes
    if (technicianNotes !== undefined) updateData.technician_notes = technicianNotes
    if (technicianSignature !== undefined) updateData.technician_signature = technicianSignature
    if (advisorId !== undefined) updateData.advisor_id = advisorId || null

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

    // Fetch advisor details if advisor was updated
    let advisorData = null
    if (healthCheck.advisor_id) {
      const { data: advisor } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name')
        .eq('id', healthCheck.advisor_id)
        .single()
      advisorData = advisor
    }

    return c.json({
      id: healthCheck.id,
      status: healthCheck.status,
      mileageIn: healthCheck.mileage_in,
      mileageOut: healthCheck.mileage_out,
      notes: healthCheck.notes,
      customerNotes: healthCheck.customer_notes,
      advisorId: healthCheck.advisor_id,
      advisor: advisorData,
      updatedAt: healthCheck.updated_at
    })
  } catch (error) {
    console.error('Update health check error:', error)
    return c.json({ error: 'Failed to update health check' }, 500)
  }
})

export default crud
