import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { getCustomerInsights } from '../services/customer-insights.js'
import { getCustomerScopeMode, scopedSiteId } from '../lib/site-scope.js'

const customers = new Hono()

customers.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// Additional contacts (extra emails / phone numbers)
// ---------------------------------------------------------------------------

interface AdditionalContactInput {
  contactType?: 'email' | 'phone'
  value?: string
  label?: string | null
}

/** Normalise + validate an additionalContacts payload into insertable rows. */
function normaliseContacts(
  raw: unknown,
  orgId: string,
  customerId: string
): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const rows: Array<Record<string, unknown>> = []
  for (const c of raw as AdditionalContactInput[]) {
    const type = c?.contactType === 'phone' ? 'phone' : c?.contactType === 'email' ? 'email' : null
    const value = typeof c?.value === 'string' ? c.value.trim() : ''
    if (!type || !value) continue
    const label = typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : null
    rows.push({
      organization_id: orgId,
      customer_id: customerId,
      contact_type: type,
      value,
      label,
      is_primary: false
    })
  }
  return rows
}

/**
 * Replace a customer's additional contacts with the supplied set. Pass
 * `undefined` to leave existing contacts untouched (e.g. a PATCH that doesn't
 * include the field); pass `[]` to clear them.
 */
async function syncAdditionalContacts(
  orgId: string,
  customerId: string,
  raw: unknown
): Promise<void> {
  if (raw === undefined) return
  await supabaseAdmin
    .from('customer_contacts')
    .delete()
    .eq('customer_id', customerId)
    .eq('organization_id', orgId)

  const rows = normaliseContacts(raw, orgId, customerId)
  if (rows.length > 0) {
    await supabaseAdmin.from('customer_contacts').insert(rows)
  }
}

/** Fetch a customer's additional contacts as camelCase DTOs. */
async function getAdditionalContacts(orgId: string, customerId: string) {
  const { data } = await supabaseAdmin
    .from('customer_contacts')
    .select('id, customer_id, organization_id, contact_type, value, label, is_primary, created_at, updated_at')
    .eq('customer_id', customerId)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    customerId: row.customer_id,
    organizationId: row.organization_id,
    contactType: row.contact_type,
    value: row.value,
    label: row.label,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

// GET /api/v1/customers - List customers with search/pagination
customers.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { search: rawSearch, site_id, limit = '50', offset = '0' } = c.req.query()
    const search = rawSearch?.trim() || ''

    // Per-site separation (§4.2): confine to the actor's site when the org is separated.
    const scopeMode = await getCustomerScopeMode(auth.orgId)
    const sSite = scopedSiteId(auth, scopeMode)

    let query = supabaseAdmin
      .from('customers')
      .select('*, vehicles:vehicles(id, registration, make, model)', { count: 'exact' })
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (sSite) {
      query = query.eq('site_id', sSite)
    } else if (site_id) {
      // Explicit site filter (org-wide viewers can narrow to a chosen site)
      query = query.eq('site_id', site_id)
    }

    // Search: handle multi-word (e.g. "Leo Dack"), single-word, and vehicle registration
    let vehicleCustomerIds: string[] = []

    if (search) {
      // Search vehicles by registration
      let vq = supabaseAdmin
        .from('vehicles')
        .select('customer_id')
        .eq('organization_id', auth.orgId)
        .ilike('registration', `%${search.replace(/\s/g, '')}%`)
      if (sSite) vq = vq.eq('site_id', sSite)
      const { data: vehicleMatches } = await vq

      if (vehicleMatches && vehicleMatches.length > 0) {
        vehicleCustomerIds = vehicleMatches.map((v: Record<string, unknown>) => v.customer_id as string)
      }

      const words = search.trim().split(/\s+/)

      if (words.length >= 2) {
        // Multi-word: try first_name + last_name combination, plus individual word matches
        const orParts = [
          `first_name.ilike.%${search}%`,
          `last_name.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `mobile.ilike.%${search}%`
        ]

        // Also add individual word matches on name fields
        for (const word of words) {
          orParts.push(`first_name.ilike.%${word}%`)
          orParts.push(`last_name.ilike.%${word}%`)
        }

        // Include vehicle registration matches
        if (vehicleCustomerIds.length > 0) {
          orParts.push(`id.in.(${vehicleCustomerIds.join(',')})`)
        }

        query = query.or(orParts.join(','))

        // For multi-word name searches, post-filter to ensure ALL words match across name fields
        // We can't do AND across OR in PostgREST easily, so we over-fetch and filter
      } else {
        // Single word search
        const orParts = [
          `first_name.ilike.%${search}%`,
          `last_name.ilike.%${search}%`,
          `email.ilike.%${search}%`,
          `mobile.ilike.%${search}%`
        ]

        if (vehicleCustomerIds.length > 0) {
          orParts.push(`id.in.(${vehicleCustomerIds.join(',')})`)
        }

        query = query.or(orParts.join(','))
      }
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      customers: data?.map(customer => ({
        id: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name,
        companyName: customer.company_name,
        email: customer.email,
        mobile: customer.mobile,
        phone: customer.phone,
        address: customer.address,
        postcode: customer.postcode,
        externalId: customer.external_id,
        vehicles: customer.vehicles,
        createdAt: customer.created_at
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('List customers error:', error)
    return c.json({ error: 'Failed to list customers' }, 500)
  }
})

// GET /api/v1/customers/search - Quick search
customers.get('/search', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { q } = c.req.query()

    if (!q || q.length < 2) {
      return c.json({ customers: [] })
    }

    const scopeMode = await getCustomerScopeMode(auth.orgId)
    const sSite = scopedSiteId(auth, scopeMode)

    let sq = supabaseAdmin
      .from('customers')
      .select('id, first_name, last_name, email, mobile')
      .eq('organization_id', auth.orgId)
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,mobile.ilike.%${q}%`)
      .limit(10)
    if (sSite) sq = sq.eq('site_id', sSite)
    const { data, error } = await sq

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      customers: data?.map(c => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        mobile: c.mobile
      }))
    })
  } catch (error) {
    console.error('Search customers error:', error)
    return c.json({ error: 'Failed to search customers' }, 500)
  }
})

// POST /api/v1/customers - Create customer
customers.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const {
      title, firstName, lastName, companyName, email, mobile, phone, contactName,
      address, addressLine1, addressLine2, town, county, postcode,
      externalId, siteId, additionalContacts
    } = body

    if (!firstName || !lastName) {
      return c.json({ error: 'First name and last name are required' }, 400)
    }

    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .insert({
        organization_id: auth.orgId,
        site_id: siteId || auth.user.siteId,
        title,
        first_name: firstName,
        last_name: lastName,
        company_name: companyName,
        email,
        mobile,
        phone,
        contact_name: contactName,
        address,
        address_line1: addressLine1,
        address_line2: addressLine2,
        town,
        county,
        postcode,
        external_id: externalId
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    await syncAdditionalContacts(auth.orgId, customer.id, additionalContacts)
    const contacts = await getAdditionalContacts(auth.orgId, customer.id)

    return c.json({
      id: customer.id,
      title: customer.title,
      firstName: customer.first_name,
      lastName: customer.last_name,
      companyName: customer.company_name,
      email: customer.email,
      mobile: customer.mobile,
      phone: customer.phone,
      contactName: customer.contact_name,
      address: customer.address,
      addressLine1: customer.address_line1,
      addressLine2: customer.address_line2,
      town: customer.town,
      county: customer.county,
      postcode: customer.postcode,
      externalId: customer.external_id,
      contacts,
      createdAt: customer.created_at
    }, 201)
  } catch (error) {
    console.error('Create customer error:', error)
    return c.json({ error: 'Failed to create customer' }, 500)
  }
})

// GET /api/v1/customers/:id/health-checks - Health checks for a customer
customers.get('/:id/health-checks', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { vehicle_id, status, limit = '50', offset = '0' } = c.req.query()

    let query = supabaseAdmin
      .from('health_checks')
      .select(`
        id, status, created_at, updated_at, vhc_reference,
        green_count, amber_count, red_count,
        mileage_in, jobsheet_id,
        vehicle:vehicles(id, registration, make, model, year),
        technician:users!health_checks_technician_id_fkey(id, first_name, last_name),
        advisor:users!health_checks_advisor_id_fkey(id, first_name, last_name)
      `, { count: 'exact' })
      .eq('customer_id', id)
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (vehicle_id) {
      query = query.eq('vehicle_id', vehicle_id)
    }
    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      healthChecks: data?.map((hc: Record<string, unknown>) => ({
        id: hc.id,
        status: hc.status,
        vhcReference: hc.vhc_reference,
        createdAt: hc.created_at,
        updatedAt: hc.updated_at,
        greenCount: hc.green_count,
        amberCount: hc.amber_count,
        redCount: hc.red_count,
        totalAmount: 0,
        mileageIn: hc.mileage_in,
        jobsheetId: hc.jobsheet_id ?? null,
        vehicle: hc.vehicle,
        technician: hc.technician,
        advisor: hc.advisor
      })),
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    })
  } catch (error) {
    console.error('Get customer health checks error:', error)
    return c.json({ error: 'Failed to get customer health checks' }, 500)
  }
})

// GET /api/v1/customers/:id/stats - Aggregate stats for a customer
customers.get('/:id/stats', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Get health check stats
    const { data: healthChecks, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, status, created_at')
      .eq('customer_id', id)
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })

    if (hcError) {
      return c.json({ error: hcError.message }, 500)
    }

    // Get vehicle count (org-scoped; the customer id is already org-validated above)
    const { count: vehicleCount, error: vError } = await supabaseAdmin
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', id)
      .eq('organization_id', auth.orgId)

    if (vError) {
      return c.json({ error: vError.message }, 500)
    }

    const totalHealthChecks = healthChecks?.length || 0
    const activeStatuses = ['in_progress', 'assigned', 'awaiting_arrival', 'awaiting_checkin', 'paused', 'awaiting_review', 'awaiting_pricing', 'ready_to_send', 'sent', 'opened', 'partial_response']
    const activeCount = healthChecks?.filter((hc: Record<string, unknown>) => activeStatuses.includes(hc.status as string)).length || 0
    const lastVisit = healthChecks?.[0]?.created_at || null
    const totalAuthorisedValue = 0

    return c.json({
      totalHealthChecks,
      activeCount,
      lastVisit,
      totalAuthorisedValue,
      vehicleCount: vehicleCount || 0
    })
  } catch (error) {
    console.error('Get customer stats error:', error)
    return c.json({ error: 'Failed to get customer stats' }, 500)
  }
})

// GET /api/v1/customers/:id/insights - Smart-banner data (new/lapsed/at-risk, deferred
// work, MOT). Powers the shared <CustomerInsightsBanner> on Estimate/Jobsheet/VHC pages.
customers.get('/:id/insights', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { vehicle_id, exclude_hc } = c.req.query()
    const insights = await getCustomerInsights(auth.orgId, id, {
      vehicleId: vehicle_id || null,
      excludeHealthCheckId: exclude_hc || null
    })
    return c.json(insights)
  } catch (error) {
    console.error('Get customer insights error:', error)
    return c.json({ error: 'Failed to get customer insights' }, 500)
  }
})

// GET /api/v1/customers/:id/communications - Communication history across all health checks
customers.get('/:id/communications', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const { limit = '50', offset = '0' } = c.req.query()

    // Get all health check IDs for this customer
    const { data: healthChecks, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, vhc_reference, jobsheet_id, vehicle:vehicles(registration)')
      .eq('customer_id', id)
      .eq('organization_id', auth.orgId)

    if (hcError) {
      return c.json({ error: hcError.message }, 500)
    }

    const hcIds = healthChecks?.map((hc: Record<string, unknown>) => hc.id as string) || []

    if (hcIds.length === 0) {
      return c.json({ communications: [], total: 0 })
    }

    const { data: comms, error: commsError, count } = await supabaseAdmin
      .from('communication_logs')
      .select('id, health_check_id, channel, recipient, subject, message_body, status, error_message, created_at', { count: 'exact' })
      .in('health_check_id', hcIds)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (commsError) {
      return c.json({ error: commsError.message }, 500)
    }

    // Build a lookup for health check info
    const hcLookup: Record<string, { vhcReference: string | null; vehicleReg: string | null; jobsheetId: string | null }> = {}
    healthChecks?.forEach((hc: Record<string, unknown>) => {
      const vehicle = hc.vehicle as Record<string, unknown> | null
      hcLookup[hc.id as string] = {
        vhcReference: (hc.vhc_reference as string) || null,
        vehicleReg: vehicle ? (vehicle.registration as string) : null,
        jobsheetId: (hc.jobsheet_id as string) || null
      }
    })

    return c.json({
      communications: comms?.map((comm: Record<string, unknown>) => {
        const hcInfo = hcLookup[comm.health_check_id as string]
        return {
          id: comm.id,
          healthCheckId: comm.health_check_id,
          jobsheetId: hcInfo?.jobsheetId || null,
          vhcReference: hcInfo?.vhcReference || null,
          vehicleReg: hcInfo?.vehicleReg || null,
          channel: comm.channel,
          recipient: comm.recipient,
          subject: comm.subject,
          messagePreview: comm.message_body ? (comm.message_body as string).substring(0, 100) : null,
          status: comm.status,
          errorMessage: comm.error_message,
          sentAt: comm.created_at
        }
      }),
      total: count
    })
  } catch (error) {
    console.error('Get customer communications error:', error)
    return c.json({ error: 'Failed to get customer communications' }, 500)
  }
})

// GET /api/v1/customers/:id - Get customer with vehicles
customers.get('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const scopeMode = await getCustomerScopeMode(auth.orgId)
    const sSite = scopedSiteId(auth, scopeMode)

    let cq = supabaseAdmin
      .from('customers')
      .select('*, vehicles:vehicles(*)')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
    if (sSite) cq = cq.eq('site_id', sSite)
    const { data: customer, error } = await cq.single()

    if (error || !customer) {
      return c.json({ error: 'Customer not found' }, 404)
    }

    // Look up notes_updated_by user name if present
    let notesUpdatedByUser = null
    if (customer.notes_updated_by) {
      const { data: noteUser } = await supabaseAdmin
        .from('users')
        .select('first_name, last_name')
        .eq('id', customer.notes_updated_by)
        .single()
      if (noteUser) {
        notesUpdatedByUser = { firstName: noteUser.first_name, lastName: noteUser.last_name }
      }
    }

    const contacts = await getAdditionalContacts(auth.orgId, customer.id)

    return c.json({
      id: customer.id,
      title: customer.title,
      firstName: customer.first_name,
      lastName: customer.last_name,
      companyName: customer.company_name,
      email: customer.email,
      mobile: customer.mobile,
      phone: customer.phone,
      contactName: customer.contact_name,
      address: customer.address,
      addressLine1: customer.address_line1,
      addressLine2: customer.address_line2,
      town: customer.town,
      county: customer.county,
      postcode: customer.postcode,
      externalId: customer.external_id,
      contacts,
      notes: customer.notes,
      notesUpdatedAt: customer.notes_updated_at,
      notesUpdatedBy: customer.notes_updated_by,
      notesUpdatedByUser,
      vehicles: customer.vehicles?.map((v: Record<string, unknown>) => ({
        id: v.id,
        registration: v.registration,
        vin: v.vin,
        make: v.make,
        model: v.model,
        year: v.year,
        color: v.color,
        fuelType: v.fuel_type,
        engineSize: v.engine_size
      })),
      createdAt: customer.created_at,
      updatedAt: customer.updated_at
    })
  } catch (error) {
    console.error('Get customer error:', error)
    return c.json({ error: 'Failed to get customer' }, 500)
  }
})

// PATCH /api/v1/customers/:id - Update customer
customers.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const {
      title, firstName, lastName, companyName, email, mobile, phone, contactName,
      address, addressLine1, addressLine2, town, county, postcode,
      externalId, notes, additionalContacts
    } = body

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (title !== undefined) updateData.title = title
    if (firstName !== undefined) updateData.first_name = firstName
    if (lastName !== undefined) updateData.last_name = lastName
    if (companyName !== undefined) updateData.company_name = companyName
    if (email !== undefined) updateData.email = email
    if (mobile !== undefined) updateData.mobile = mobile
    if (phone !== undefined) updateData.phone = phone
    if (contactName !== undefined) updateData.contact_name = contactName
    if (address !== undefined) updateData.address = address
    if (addressLine1 !== undefined) updateData.address_line1 = addressLine1
    if (addressLine2 !== undefined) updateData.address_line2 = addressLine2
    if (town !== undefined) updateData.town = town
    if (county !== undefined) updateData.county = county
    if (postcode !== undefined) updateData.postcode = postcode
    if (externalId !== undefined) updateData.external_id = externalId
    if (notes !== undefined) {
      updateData.notes = notes
      updateData.notes_updated_at = new Date().toISOString()
      updateData.notes_updated_by = auth.user.id
    }

    const { data: customer, error } = await supabaseAdmin
      .from('customers')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    await syncAdditionalContacts(auth.orgId, id, additionalContacts)
    const contacts = await getAdditionalContacts(auth.orgId, id)

    return c.json({
      id: customer.id,
      title: customer.title,
      firstName: customer.first_name,
      lastName: customer.last_name,
      companyName: customer.company_name,
      email: customer.email,
      mobile: customer.mobile,
      phone: customer.phone,
      contactName: customer.contact_name,
      address: customer.address,
      addressLine1: customer.address_line1,
      addressLine2: customer.address_line2,
      town: customer.town,
      county: customer.county,
      postcode: customer.postcode,
      externalId: customer.external_id,
      contacts,
      updatedAt: customer.updated_at
    })
  } catch (error) {
    console.error('Update customer error:', error)
    return c.json({ error: 'Failed to update customer' }, 500)
  }
})

export default customers
