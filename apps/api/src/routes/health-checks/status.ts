import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { notifyHealthCheckStatusChanged, notifyTechnicianClockedIn, notifyTechnicianClockedOut } from '../../services/websocket.js'
import { isValidTransition, autoGenerateRepairItems, autoCreateMriRepairItems } from './helpers.js'
import { createNotification } from '../notifications.js'

const status = new Hono()

// POST /:id/status - Change status
status.post('/:id/status', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { status: newStatus, notes } = body

    if (!newStatus) {
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
    if (!isValidTransition(current.status, newStatus)) {
      return c.json({ error: `Invalid status transition from ${current.status} to ${newStatus}` }, 400)
    }

    // Technicians can only change status of their own checks
    if (auth.user.role === 'technician' && current.technician_id !== auth.user.id) {
      return c.json({ error: 'Not authorized to change this health check status' }, 403)
    }

    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
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
        to_status: newStatus,
        changed_by: auth.user.id,
        change_source: 'user',
        notes
      })

    // Send WebSocket notification for status change
    if (current.site_id) {
      const vehicleReg = (current.vehicle as unknown as { registration: string })?.registration || 'Unknown'
      notifyHealthCheckStatusChanged(current.site_id, id, {
        status: newStatus,
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

// POST /:id/mark-arrived - Mark vehicle as arrived (DMS workflow)
status.post('/:id/mark-arrived', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    // Check if organization has check-in enabled
    const { data: checkinSettings } = await supabaseAdmin
      .from('organization_checkin_settings')
      .select('checkin_enabled')
      .eq('organization_id', auth.orgId)
      .single()

    const checkinEnabled = checkinSettings?.checkin_enabled === true

    // Determine target status based on check-in setting
    const newStatus = checkinEnabled ? 'awaiting_checkin' : 'created'
    const statusNote = checkinEnabled ? 'Vehicle arrived - awaiting check-in' : 'Vehicle marked as arrived'

    const now = new Date().toISOString()

    // Update status and record arrival time
    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: newStatus,
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
        to_status: newStatus,
        changed_by: auth.user.id,
        notes: statusNote
      })

    // Notify via WebSocket (need site_id for WebSocket notification)
    const { data: updatedHC } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', id)
      .single()

    if (updatedHC?.site_id) {
      notifyHealthCheckStatusChanged(updatedHC.site_id, id, {
        status: newStatus,
        previousStatus: 'awaiting_arrival',
        vehicleReg: 'Unknown',
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status,
        arrivedAt: healthCheck.arrived_at,
        requiresCheckin: checkinEnabled
      }
    })
  } catch (error) {
    console.error('Mark arrived error:', error)
    return c.json({ error: 'Failed to mark vehicle as arrived' }, 500)
  }
})

// POST /:id/complete-checkin - Complete check-in process (transitions awaiting_checkin → created)
status.post('/:id/complete-checkin', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get current health check
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, site_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Validate transition - must be in awaiting_checkin status
    // Also allow completing from 'created' status if check-in was skipped but user wants to record it
    if (current.status !== 'awaiting_checkin' && current.status !== 'created') {
      return c.json({ error: `Can only complete check-in from awaiting_checkin or created status, current status is ${current.status}` }, 400)
    }

    const now = new Date().toISOString()

    // Calculate MRI completion stats for bypass tracking
    // Get total enabled MRI items for the org
    const { count: mriItemsTotal } = await supabaseAdmin
      .from('mri_items')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('enabled', true)
      .is('deleted_at', null)

    // Get completed MRI results for this health check
    // An item is "completed" if it has any meaningful data
    const { data: mriResults } = await supabaseAdmin
      .from('mri_scan_results')
      .select('id, next_due_date, next_due_mileage, date_na, mileage_na, due_if_not_replaced, recommended_this_visit, not_due_yet, yes_no_value')
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)

    const mriItemsCompleted = (mriResults || []).filter(r =>
      r.next_due_date ||
      r.next_due_mileage ||
      r.date_na ||
      r.mileage_na ||
      r.due_if_not_replaced ||
      r.recommended_this_visit ||
      r.not_due_yet ||
      r.yes_no_value !== null
    ).length

    const mriBypassed = (mriItemsTotal || 0) > 0 && mriItemsCompleted < (mriItemsTotal || 0)

    // Update status, record check-in completion with MRI stats
    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'created',
        checked_in_at: now,
        checked_in_by: auth.user.id,
        mri_items_total: mriItemsTotal || 0,
        mri_items_completed: mriItemsCompleted,
        mri_bypassed: mriBypassed,
        updated_at: now
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Mark MRI scan as complete (set completed_at on all MRI results)
    // This ensures the mobile app shows MRI results instead of "Awaiting MRI Scan"
    await supabaseAdmin
      .from('mri_scan_results')
      .update({
        completed_at: now,
        completed_by: auth.user.id
      })
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)

    // Auto-create repair items from flagged MRI results
    const mriResult = await autoCreateMriRepairItems(id, auth.orgId)

    // Build status history notes
    let historyNotes = 'Check-in completed'
    if (mriBypassed) {
      historyNotes = `Check-in completed (MRI bypassed: ${mriItemsCompleted}/${mriItemsTotal || 0} items)`
    }
    if (mriResult.created > 0) {
      historyNotes += `. ${mriResult.created} repair items created from MRI scan.`
    }

    // Record status change in history
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'awaiting_checkin',
        to_status: 'created',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: historyNotes
      })

    // Notify via WebSocket
    if (current.site_id) {
      notifyHealthCheckStatusChanged(current.site_id, id, {
        status: 'created',
        previousStatus: 'awaiting_checkin',
        vehicleReg: 'Unknown',
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status,
        checkedInAt: healthCheck.checked_in_at,
        checkedInBy: healthCheck.checked_in_by,
        mriItemsTotal: mriItemsTotal || 0,
        mriItemsCompleted,
        mriBypassed
      },
      mriRepairItems: {
        created: mriResult.created
      }
    })
  } catch (error) {
    console.error('Complete check-in error:', error)
    return c.json({ error: 'Failed to complete check-in' }, 500)
  }
})

// POST /:id/skip-checkin - Skip check-in when feature is disabled mid-workflow (Admin only)
// Allows vehicles stuck in awaiting_checkin to proceed without completing the full check-in process
status.post('/:id/skip-checkin', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const reason = body.reason || 'Check-in skipped by admin'

    // Get current health check
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, site_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Only allow skipping from awaiting_checkin status
    if (current.status !== 'awaiting_checkin') {
      return c.json({ error: `Can only skip check-in from awaiting_checkin status, current status is ${current.status}` }, 400)
    }

    const now = new Date().toISOString()

    // Update status to created, skipping the check-in process
    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update({
        status: 'created',
        updated_at: now
        // Note: We don't set checked_in_at or checked_in_by since check-in was skipped
      })
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    // Record status change in history with skip reason
    await supabaseAdmin
      .from('health_check_status_history')
      .insert({
        health_check_id: id,
        from_status: 'awaiting_checkin',
        to_status: 'created',
        changed_by: auth.user.id,
        change_source: 'user',
        notes: reason
      })

    // Notify via WebSocket
    if (current.site_id) {
      notifyHealthCheckStatusChanged(current.site_id, id, {
        status: 'created',
        previousStatus: 'awaiting_checkin',
        vehicleReg: 'Unknown',
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status
      },
      skippedAt: now,
      reason
    })
  } catch (error) {
    console.error('Skip check-in error:', error)
    return c.json({ error: 'Failed to skip check-in' }, 500)
  }
})

// PATCH /:id/checkin-data - Update check-in data fields (auto-save during check-in)
status.patch('/:id/checkin-data', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Get current health check
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, checked_in_at')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (fetchError || !current) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Allow updates during awaiting_checkin or if not yet checked-in
    // After check-in is complete, only allow updates by org_admin
    if (current.checked_in_at && !['super_admin', 'org_admin'].includes(auth.user.role)) {
      return c.json({ error: 'Check-in data cannot be modified after completion' }, 403)
    }

    // Build update object with only allowed fields
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    // Check-in specific fields
    if (body.mileageIn !== undefined || body.mileage_in !== undefined) {
      updateData.mileage_in = body.mileageIn ?? body.mileage_in
    }
    if (body.timeRequired !== undefined || body.time_required !== undefined) {
      updateData.time_required = body.timeRequired ?? body.time_required
    }
    if (body.keyLocation !== undefined || body.key_location !== undefined) {
      updateData.key_location = body.keyLocation ?? body.key_location
    }
    if (body.checkinNotes !== undefined || body.checkin_notes !== undefined) {
      updateData.checkin_notes = body.checkinNotes ?? body.checkin_notes
    }
    if (body.checkinNotesVisibleToTech !== undefined || body.checkin_notes_visible_to_tech !== undefined) {
      updateData.checkin_notes_visible_to_tech = body.checkinNotesVisibleToTech ?? body.checkin_notes_visible_to_tech
    }
    // Customer waiting flag
    if (body.customerWaiting !== undefined || body.customer_waiting !== undefined) {
      updateData.customer_waiting = body.customerWaiting ?? body.customer_waiting
    }

    const { data: healthCheck, error: updateError } = await supabaseAdmin
      .from('health_checks')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      success: true,
      healthCheck: {
        id: healthCheck.id,
        mileageIn: healthCheck.mileage_in,
        timeRequired: healthCheck.time_required,
        keyLocation: healthCheck.key_location,
        checkinNotes: healthCheck.checkin_notes,
        checkinNotesVisibleToTech: healthCheck.checkin_notes_visible_to_tech,
        customerWaiting: healthCheck.customer_waiting
      }
    })
  } catch (error) {
    console.error('Update check-in data error:', error)
    return c.json({ error: 'Failed to update check-in data' }, 500)
  }
})

// GET /:id/checkin-data - Get check-in data for a health check
status.get('/:id/checkin-data', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check with check-in fields
    const { data: healthCheck, error } = await supabaseAdmin
      .from('health_checks')
      .select(`
        id, status,
        mileage_in, time_required, key_location,
        checkin_notes, checkin_notes_visible_to_tech,
        customer_waiting, booked_repairs, loan_car_required,
        checked_in_at, checked_in_by,
        arrived_at,
        vehicle:vehicles(id, registration, make, model, vin, customer:customers(id, first_name, last_name, email, mobile))
      `)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (error || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Fetch checked_in_by user separately if exists
    let checkedInByUser = null
    if (healthCheck.checked_in_by) {
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('id, first_name, last_name')
        .eq('id', healthCheck.checked_in_by)
        .single()
      if (userData) {
        checkedInByUser = {
          id: userData.id,
          firstName: userData.first_name,
          lastName: userData.last_name
        }
      }
    }

    // For technicians, hide notes if not visible
    const isTechnician = auth.user.role === 'technician'
    const showNotes = !isTechnician || healthCheck.checkin_notes_visible_to_tech

    // Type assertion for vehicle relation (Supabase returns nested relations as arrays)
    const vehicleRaw = healthCheck.vehicle as unknown
    const vehicle = vehicleRaw as {
      id: string
      registration: string
      make: string | null
      model: string | null
      vin: string | null
      customer: {
        id: string
        first_name: string
        last_name: string
        email: string | null
        mobile: string | null
      } | null
    } | null

    return c.json({
      id: healthCheck.id,
      status: healthCheck.status,
      mileageIn: healthCheck.mileage_in,
      timeRequired: healthCheck.time_required,
      keyLocation: healthCheck.key_location,
      checkinNotes: showNotes ? healthCheck.checkin_notes : null,
      checkinNotesVisibleToTech: healthCheck.checkin_notes_visible_to_tech,
      customerWaiting: healthCheck.customer_waiting,
      bookedRepairs: healthCheck.booked_repairs,
      loanCarRequired: healthCheck.loan_car_required,
      checkedInAt: healthCheck.checked_in_at,
      checkedInBy: healthCheck.checked_in_by,
      checkedInByUser,
      arrivedAt: healthCheck.arrived_at,
      vehicle: vehicle ? {
        id: vehicle.id,
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin,
        customer: vehicle.customer ? {
          id: vehicle.customer.id,
          firstName: vehicle.customer.first_name,
          lastName: vehicle.customer.last_name,
          email: vehicle.customer.email,
          mobile: vehicle.customer.mobile
        } : null
      } : null
    })
  } catch (error) {
    console.error('Get check-in data error:', error)
    return c.json({ error: 'Failed to get check-in data' }, 500)
  }
})

// POST /:id/mark-no-show - Mark vehicle as no-show (DMS workflow)
status.post('/:id/mark-no-show', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    // Notify via WebSocket (need site_id for WebSocket notification)
    const { data: updatedHC } = await supabaseAdmin
      .from('health_checks')
      .select('site_id')
      .eq('id', id)
      .single()

    if (updatedHC?.site_id) {
      notifyHealthCheckStatusChanged(updatedHC.site_id, id, {
        status: 'no_show',
        previousStatus: 'awaiting_arrival',
        vehicleReg: 'Unknown',
        updatedBy: `${auth.user.firstName} ${auth.user.lastName}`
      })
    }

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

// POST /:id/assign - Assign technician
status.post('/:id/assign', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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

    // Block assignment if vehicle is awaiting check-in
    if (current.status === 'awaiting_checkin') {
      return c.json({
        error: 'Cannot assign technician: vehicle must complete check-in first',
        code: 'CHECKIN_REQUIRED'
      }, 400)
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

    // Notify the assigned technician (if assigned by someone else)
    if (technicianId !== auth.user.id) {
      // Get vehicle registration for the notification message
      const { data: vehicleData } = await supabaseAdmin
        .from('health_checks')
        .select('vehicle:vehicles(registration)')
        .eq('id', id)
        .single()

      const vehicleReg = (vehicleData?.vehicle as { registration?: string } | null)?.registration || 'Unknown'

      await createNotification(
        technicianId,
        'health_check_assigned',
        'New Job Assigned',
        `You have been assigned to inspect ${vehicleReg}`,
        {
          healthCheckId: id,
          priority: 'normal',
          actionUrl: `/health-checks/${id}`
        }
      )
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

// POST /:id/clock-in - Technician clock in
status.post('/:id/clock-in', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
    // Also set tech_started_at if this is the first time starting the inspection
    if (healthCheck.status === 'assigned' || healthCheck.status === 'paused') {
      const now = new Date().toISOString()

      // Check if tech_started_at is already set (resuming from pause)
      const { data: hcData } = await supabaseAdmin
        .from('health_checks')
        .select('tech_started_at')
        .eq('id', id)
        .single()

      const updateData: Record<string, string> = {
        status: 'in_progress',
        updated_at: now
      }

      // Only set tech_started_at on first start (not on resume from pause)
      if (!hcData?.tech_started_at) {
        updateData.tech_started_at = now
      }

      await supabaseAdmin
        .from('health_checks')
        .update(updateData)
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

// POST /:id/clock-out - Technician clock out
status.post('/:id/clock-out', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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
      const now = new Date().toISOString()
      const updateData: Record<string, string> = {
        status: newStatus,
        updated_at: now
      }

      // Set tech_completed_at when completing the inspection
      if (complete) {
        updateData.tech_completed_at = now
      }

      await supabaseAdmin
        .from('health_checks')
        .update(updateData)
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

// GET /:id/time-entries - Get time entries
status.get('/:id/time-entries', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
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

// POST /:id/close - Close health check (advisor action)
status.post('/:id/close', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
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

    // Get all non-deleted repair items (top-level only, not children)
    const { data: repairItems } = await supabaseAdmin
      .from('repair_items')
      .select('id, name, is_approved, work_completed_at, outcome_status, labour_status, parts_status, no_labour_required, no_parts_required, deleted_at, parent_repair_item_id')
      .eq('health_check_id', id)
      .is('deleted_at', null)
      .is('parent_repair_item_id', null)  // Only top-level items

    // ===========================================================================
    // OUTCOME ENFORCEMENT: Check items that still need an outcome decision
    // ===========================================================================
    const pendingOutcomeItems = (repairItems || []).filter(item => {
      // Calculate effective outcome status
      const outcomeStatus = item.outcome_status

      // If already has an outcome (authorised, deferred, declined), it's done
      if (['authorised', 'deferred', 'declined', 'deleted'].includes(outcomeStatus)) {
        return false
      }

      // Otherwise, check if it's 'incomplete' or 'ready' - both need attention
      // If outcome_status is explicitly set, use it
      if (outcomeStatus === 'incomplete' || outcomeStatus === 'ready') {
        return true
      }

      // If outcome_status is null/undefined, calculate based on L&P completion
      // If L&P both complete but no outcome yet = ready = pending
      // If L&P not complete = incomplete = pending
      return true
    })

    if (pendingOutcomeItems.length > 0) {
      return c.json({
        error: `Cannot close: ${pendingOutcomeItems.length} repair item${pendingOutcomeItems.length !== 1 ? 's' : ''} need an outcome`,
        code: 'PENDING_OUTCOMES',
        pending_outcome_items: pendingOutcomeItems.map(item => ({
          id: item.id,
          name: item.name
        })),
        pending_count: pendingOutcomeItems.length
      }, 400)
    }

    // ===========================================================================
    // WORK COMPLETION: Check if all authorised items have work marked complete
    // ===========================================================================
    const authorisedItems = (repairItems || []).filter(item =>
      item.outcome_status === 'authorised' || item.is_approved === true
    )

    // Check if all authorised items have been marked as complete
    const incompleteWorkItems = authorisedItems.filter(item => !item.work_completed_at)

    if (incompleteWorkItems.length > 0) {
      return c.json({
        error: 'Cannot close health check: some authorised work is not complete',
        code: 'INCOMPLETE_WORK',
        incomplete_items: incompleteWorkItems.map(item => ({
          id: item.id,
          name: item.name
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

export default status
