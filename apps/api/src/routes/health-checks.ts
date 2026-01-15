import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const healthChecks = new Hono()

healthChecks.use('*', authMiddleware)

// Valid status transitions
const validTransitions: Record<string, string[]> = {
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

// GET /api/v1/health-checks/:id - Get full details
healthChecks.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .select(`
        *,
        vehicle:vehicles(*,customer:customers(*)),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name, email),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name, email),
        template:check_templates(id, name)
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Return in snake_case format for web dashboard compatibility
    return c.json({
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
        public_expires_at: healthCheck.public_expires_at,
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
            external_id: healthCheck.vehicle.customer.external_id
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
    })
  } catch (error) {
    console.error('Get health check error:', error)
    return c.json({ error: 'Failed to get health check' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id - Update health check
healthChecks.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { mileageIn, mileageOut, notes, customerNotes } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (mileageIn !== undefined) updateData.mileage_in = mileageIn
    if (mileageOut !== undefined) updateData.mileage_out = mileageOut
    if (notes !== undefined) updateData.notes = notes
    if (customerNotes !== undefined) updateData.customer_notes = customerNotes

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

    // Get current health check
    const { data: current } = await supabaseAdmin
      .from('health_checks')
      .select('status, technician_id')
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

// POST /api/v1/health-checks/:id/assign - Assign technician
healthChecks.post('/:id/assign', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { technicianId } = body

    if (!technicianId) {
      return c.json({ error: 'Technician ID is required' }, 400)
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

    // Get health check and verify ownership
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, technician_id')
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

    // Check for existing open time entry
    const { data: openEntry } = await supabaseAdmin
      .from('technician_time_entries')
      .select('id')
      .eq('health_check_id', id)
      .is('clock_out_at', null)
      .single()

    if (openEntry) {
      return c.json({ error: 'Already clocked in' }, 400)
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

    // Get health check
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, technician_id')
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
        id, status, customer_id, vehicle_id,
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
        public_expires_at: expiresAt.toISOString(),
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

    // Get organization settings for sending
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, settings')
      .eq('id', auth.orgId)
      .single()

    // TODO: Implement actual email/SMS sending via external service
    // For now, we'll just log the intent
    const publicUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5183'}/view/${publicToken}`

    console.log('Would send notification:', {
      to: healthCheck.customer,
      sendEmail: send_email,
      sendSms: send_sms,
      publicUrl,
      message,
      orgName: org?.name
    })

    return c.json({
      id: updated.id,
      status: updated.status,
      publicToken: updated.public_token,
      publicUrl,
      expiresAt: updated.public_expires_at,
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

    return c.json({
      results: results?.map(r => ({
        id: r.id,
        health_check_id: r.health_check_id,
        template_item_id: r.template_item_id,
        rag_status: r.rag_status,
        value: r.value,
        notes: r.notes,
        media: r.media?.map((m: Record<string, unknown>) => ({
          id: m.id,
          url: m.url,
          thumbnail_url: m.thumbnail_url,
          annotation_data: m.annotation_data
        }))
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
          id, rag_status, notes,
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

    // Calculate total cost if parts or labour changed
    if (body.parts_cost !== undefined || body.labor_cost !== undefined) {
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
      is_approved: updated.is_approved
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

export default healthChecks
