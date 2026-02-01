import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const labourCodes = new Hono()

// Apply auth middleware to all routes
labourCodes.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/labour-codes - List org's labour codes
labourCodes.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    // Users can only access their own organization's labour codes
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: codes, error } = await supabaseAdmin
      .from('labour_codes')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })

    if (error) {
      console.error('Get labour codes error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      labourCodes: (codes || []).map(code => ({
        id: code.id,
        code: code.code,
        description: code.description,
        hourlyRate: parseFloat(code.hourly_rate),
        isVatExempt: code.is_vat_exempt,
        isDefault: code.is_default,
        isActive: code.is_active,
        sortOrder: code.sort_order,
        createdAt: code.created_at,
        updatedAt: code.updated_at
      }))
    })
  } catch (error) {
    console.error('Get labour codes error:', error)
    return c.json({ error: 'Failed to get labour codes' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/labour-codes - Create labour code
labourCodes.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    // Users can only create in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { code, description, hourly_rate, is_vat_exempt, is_default } = body

    // Validate required fields
    if (!code || !description || hourly_rate === undefined) {
      return c.json({ error: 'Code, description, and hourly_rate are required' }, 400)
    }

    // If this is being set as default, unset other defaults
    if (is_default) {
      await supabaseAdmin
        .from('labour_codes')
        .update({ is_default: false })
        .eq('organization_id', orgId)
        .eq('is_default', true)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('labour_codes')
      .select('sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const nextSortOrder = (maxSort?.sort_order || 0) + 1

    const { data: newCode, error } = await supabaseAdmin
      .from('labour_codes')
      .insert({
        organization_id: orgId,
        code: code.toUpperCase().trim(),
        description: description.trim(),
        hourly_rate,
        is_vat_exempt: is_vat_exempt || false,
        is_default: is_default || false,
        sort_order: nextSortOrder
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A labour code with this code already exists' }, 409)
      }
      console.error('Create labour code error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: newCode.id,
      code: newCode.code,
      description: newCode.description,
      hourlyRate: parseFloat(newCode.hourly_rate),
      isVatExempt: newCode.is_vat_exempt,
      isDefault: newCode.is_default,
      isActive: newCode.is_active,
      sortOrder: newCode.sort_order,
      createdAt: newCode.created_at
    }, 201)
  } catch (error) {
    console.error('Create labour code error:', error)
    return c.json({ error: 'Failed to create labour code' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/labour-codes/seed-defaults - Seed default labour codes
labourCodes.post('/seed-defaults', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    // Users can only seed in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Check if any labour codes already exist
    const { data: existingCodes, error: checkError } = await supabaseAdmin
      .from('labour_codes')
      .select('code')
      .eq('organization_id', orgId)
      .eq('is_active', true)

    if (checkError) {
      console.error('Check existing codes error:', checkError)
      return c.json({ error: checkError.message }, 500)
    }

    // If codes already exist, return empty created array
    if (existingCodes && existingCodes.length > 0) {
      return c.json({ created: [] })
    }

    // Seed default labour codes
    const defaultCodes = [
      { code: 'LAB', description: 'Standard Labour', hourly_rate: 85.00, is_vat_exempt: false, is_default: true, sort_order: 1 },
      { code: 'DIAG', description: 'Diagnostic', hourly_rate: 95.00, is_vat_exempt: false, is_default: false, sort_order: 2 },
      { code: 'MOT', description: 'MOT Labour', hourly_rate: 45.00, is_vat_exempt: true, is_default: false, sort_order: 3 }
    ]

    const { data: insertedCodes, error: insertError } = await supabaseAdmin
      .from('labour_codes')
      .insert(defaultCodes.map(code => ({
        ...code,
        organization_id: orgId
      })))
      .select()

    if (insertError) {
      console.error('Seed labour codes error:', insertError)
      return c.json({ error: insertError.message }, 500)
    }

    return c.json({
      created: (insertedCodes || []).map(code => code.code)
    }, 201)
  } catch (error) {
    console.error('Seed labour codes error:', error)
    return c.json({ error: 'Failed to seed labour codes' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/labour-codes/:id - Update labour code
labourCodes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const codeId = c.req.param('id')
    const body = await c.req.json()

    // Users can only update in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { code, description, hourly_rate, is_vat_exempt, is_default, sort_order } = body

    // Check if the labour code exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('labour_codes')
      .select('*')
      .eq('id', codeId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Labour code not found' }, 404)
    }

    // If this is being set as default, unset other defaults
    if (is_default === true && !existing.is_default) {
      await supabaseAdmin
        .from('labour_codes')
        .update({ is_default: false })
        .eq('organization_id', orgId)
        .eq('is_default', true)
    }

    // Build update data
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (code !== undefined) updateData.code = code.toUpperCase().trim()
    if (description !== undefined) updateData.description = description.trim()
    if (hourly_rate !== undefined) updateData.hourly_rate = hourly_rate
    if (is_vat_exempt !== undefined) updateData.is_vat_exempt = is_vat_exempt
    if (is_default !== undefined) updateData.is_default = is_default
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updated, error } = await supabaseAdmin
      .from('labour_codes')
      .update(updateData)
      .eq('id', codeId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A labour code with this code already exists' }, 409)
      }
      console.error('Update labour code error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      code: updated.code,
      description: updated.description,
      hourlyRate: parseFloat(updated.hourly_rate),
      isVatExempt: updated.is_vat_exempt,
      isDefault: updated.is_default,
      isActive: updated.is_active,
      sortOrder: updated.sort_order,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update labour code error:', error)
    return c.json({ error: 'Failed to update labour code' }, 500)
  }
})

// DELETE /api/v1/organizations/:orgId/labour-codes/:id - Soft delete labour code
labourCodes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const codeId = c.req.param('id')

    // Users can only delete in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Check if the labour code exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('labour_codes')
      .select('id')
      .eq('id', codeId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Labour code not found' }, 404)
    }

    // Soft delete by setting is_active = false
    const { error } = await supabaseAdmin
      .from('labour_codes')
      .update({
        is_active: false,
        is_default: false, // Remove default status if deleted
        updated_at: new Date().toISOString()
      })
      .eq('id', codeId)

    if (error) {
      console.error('Delete labour code error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete labour code error:', error)
    return c.json({ error: 'Failed to delete labour code' }, 500)
  }
})

export default labourCodes
