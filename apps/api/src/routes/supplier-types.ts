import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const supplierTypes = new Hono()

// Apply auth middleware to all routes
supplierTypes.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/supplier-types - List org's supplier types
supplierTypes.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    // Users can only access their own organization's supplier types
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { data: types, error } = await supabaseAdmin
      .from('supplier_types')
      .select('*')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      console.error('Get supplier types error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      supplierTypes: (types || []).map(type => ({
        id: type.id,
        name: type.name,
        description: type.description,
        isActive: type.is_active,
        isSystem: type.is_system,
        sortOrder: type.sort_order,
        createdAt: type.created_at,
        updatedAt: type.updated_at
      }))
    })
  } catch (error) {
    console.error('Get supplier types error:', error)
    return c.json({ error: 'Failed to get supplier types' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/supplier-types - Create supplier type
supplierTypes.post('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    // Users can only create in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { name, description } = body

    // Validate required fields
    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('supplier_types')
      .select('sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const nextSortOrder = (maxSort?.sort_order || 0) + 1

    const { data: newType, error } = await supabaseAdmin
      .from('supplier_types')
      .insert({
        organization_id: orgId,
        name: name.trim(),
        description: description?.trim() || null,
        sort_order: nextSortOrder,
        is_system: false
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A supplier type with this name already exists' }, 409)
      }
      console.error('Create supplier type error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: newType.id,
      name: newType.name,
      description: newType.description,
      isActive: newType.is_active,
      isSystem: newType.is_system,
      sortOrder: newType.sort_order,
      createdAt: newType.created_at
    }, 201)
  } catch (error) {
    console.error('Create supplier type error:', error)
    return c.json({ error: 'Failed to create supplier type' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/supplier-types/seed-defaults - Seed default types
supplierTypes.post('/seed-defaults', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    // Users can only seed in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Check if any types already exist
    const { data: existingTypes, error: checkError } = await supabaseAdmin
      .from('supplier_types')
      .select('name')
      .eq('organization_id', orgId)
      .eq('is_active', true)

    if (checkError) {
      console.error('Check existing types error:', checkError)
      return c.json({ error: checkError.message }, 500)
    }

    // If types already exist, return empty created array
    if (existingTypes && existingTypes.length > 0) {
      return c.json({ created: [] })
    }

    // Seed default supplier types
    const defaultTypes = [
      { name: 'Dealer', description: 'OEM dealership parts', sort_order: 1, is_system: false },
      { name: 'Factor', description: 'Parts factor / wholesaler', sort_order: 2, is_system: false },
      { name: 'Tyres', description: 'Tyre supplier', sort_order: 3, is_system: false },
      { name: 'Other', description: 'Other supplier type', sort_order: 99, is_system: true }
    ]

    const { data: insertedTypes, error: insertError } = await supabaseAdmin
      .from('supplier_types')
      .insert(defaultTypes.map(t => ({
        ...t,
        organization_id: orgId
      })))
      .select()

    if (insertError) {
      console.error('Seed supplier types error:', insertError)
      return c.json({ error: insertError.message }, 500)
    }

    return c.json({
      created: (insertedTypes || []).map(t => t.name)
    }, 201)
  } catch (error) {
    console.error('Seed supplier types error:', error)
    return c.json({ error: 'Failed to seed supplier types' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/supplier-types/:id - Update supplier type
supplierTypes.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const typeId = c.req.param('id')
    const body = await c.req.json()

    // Users can only update in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { name, description, sort_order } = body

    // Check if the type exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('supplier_types')
      .select('*')
      .eq('id', typeId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Supplier type not found' }, 404)
    }

    // Build update data
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updated, error } = await supabaseAdmin
      .from('supplier_types')
      .update(updateData)
      .eq('id', typeId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A supplier type with this name already exists' }, 409)
      }
      console.error('Update supplier type error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      isActive: updated.is_active,
      isSystem: updated.is_system,
      sortOrder: updated.sort_order,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update supplier type error:', error)
    return c.json({ error: 'Failed to update supplier type' }, 500)
  }
})

// DELETE /api/v1/organizations/:orgId/supplier-types/:id - Soft delete supplier type
supplierTypes.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const typeId = c.req.param('id')

    // Users can only delete in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Check if the type exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('supplier_types')
      .select('id, is_system')
      .eq('id', typeId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Supplier type not found' }, 404)
    }

    // System types cannot be deleted
    if (existing.is_system) {
      return c.json({ error: 'System types cannot be deleted' }, 403)
    }

    // Soft delete by setting is_active = false
    const { error } = await supabaseAdmin
      .from('supplier_types')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', typeId)

    if (error) {
      console.error('Delete supplier type error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete supplier type error:', error)
    return c.json({ error: 'Failed to delete supplier type' }, 500)
  }
})

export default supplierTypes
