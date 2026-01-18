import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const suppliers = new Hono()

// Apply auth middleware to all routes
suppliers.use('*', authMiddleware)

// GET /api/v1/organizations/:orgId/suppliers - List org's suppliers
suppliers.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    // Users can only access their own organization's suppliers
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Check for ?include_inactive=true query param
    const includeInactive = c.req.query('include_inactive') === 'true'

    let query = supabaseAdmin
      .from('suppliers')
      .select('*')
      .eq('organization_id', orgId)

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data: supplierList, error } = await query
      .order('name', { ascending: true })

    if (error) {
      console.error('Get suppliers error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      suppliers: (supplierList || []).map(supplier => ({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
        accountNumber: supplier.account_number,
        contactName: supplier.contact_name,
        contactEmail: supplier.contact_email,
        contactPhone: supplier.contact_phone,
        address: supplier.address,
        notes: supplier.notes,
        isActive: supplier.is_active,
        isQuickAdd: supplier.is_quick_add,
        sortOrder: supplier.sort_order,
        createdAt: supplier.created_at,
        updatedAt: supplier.updated_at
      }))
    })
  } catch (error) {
    console.error('Get suppliers error:', error)
    return c.json({ error: 'Failed to get suppliers' }, 500)
  }
})

// POST /api/v1/organizations/:orgId/suppliers - Create supplier
suppliers.post('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    // Users can only create in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const {
      name,
      code,
      account_number,
      contact_name,
      contact_email,
      contact_phone,
      address,
      notes,
      is_quick_add
    } = body

    // Validate required fields
    if (!name || !name.trim()) {
      return c.json({ error: 'Supplier name is required' }, 400)
    }

    // Determine if this is a quick-add (only name provided)
    const isQuickAdd = is_quick_add || (
      !code && !account_number && !contact_name && !contact_email && !contact_phone && !address
    )

    const { data: newSupplier, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        organization_id: orgId,
        name: name.trim(),
        code: code?.toUpperCase()?.trim() || null,
        account_number: account_number?.trim() || null,
        contact_name: contact_name?.trim() || null,
        contact_email: contact_email?.trim() || null,
        contact_phone: contact_phone?.trim() || null,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
        is_quick_add: isQuickAdd
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A supplier with this name already exists' }, 409)
      }
      console.error('Create supplier error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: newSupplier.id,
      name: newSupplier.name,
      code: newSupplier.code,
      accountNumber: newSupplier.account_number,
      contactName: newSupplier.contact_name,
      contactEmail: newSupplier.contact_email,
      contactPhone: newSupplier.contact_phone,
      address: newSupplier.address,
      notes: newSupplier.notes,
      isActive: newSupplier.is_active,
      isQuickAdd: newSupplier.is_quick_add,
      createdAt: newSupplier.created_at
    }, 201)
  } catch (error) {
    console.error('Create supplier error:', error)
    return c.json({ error: 'Failed to create supplier' }, 500)
  }
})

// PATCH /api/v1/organizations/:orgId/suppliers/:id - Update supplier
suppliers.patch('/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const supplierId = c.req.param('id')
    const body = await c.req.json()

    // Users can only update in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const {
      name,
      code,
      account_number,
      contact_name,
      contact_email,
      contact_phone,
      address,
      notes,
      sort_order
    } = body

    // Check if the supplier exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('suppliers')
      .select('*')
      .eq('id', supplierId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Supplier not found' }, 404)
    }

    // Build update data
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (code !== undefined) updateData.code = code?.toUpperCase()?.trim() || null
    if (account_number !== undefined) updateData.account_number = account_number?.trim() || null
    if (contact_name !== undefined) updateData.contact_name = contact_name?.trim() || null
    if (contact_email !== undefined) updateData.contact_email = contact_email?.trim() || null
    if (contact_phone !== undefined) updateData.contact_phone = contact_phone?.trim() || null
    if (address !== undefined) updateData.address = address?.trim() || null
    if (notes !== undefined) updateData.notes = notes?.trim() || null
    if (sort_order !== undefined) updateData.sort_order = sort_order

    // If additional details were added, mark as no longer quick-add
    const hasDetails = !!(
      (code !== undefined && code) ||
      (account_number !== undefined && account_number) ||
      (contact_name !== undefined && contact_name) ||
      (contact_email !== undefined && contact_email) ||
      (contact_phone !== undefined && contact_phone) ||
      (address !== undefined && address)
    )

    if (existing.is_quick_add && hasDetails) {
      updateData.is_quick_add = false
    }

    const { data: updated, error } = await supabaseAdmin
      .from('suppliers')
      .update(updateData)
      .eq('id', supplierId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A supplier with this name already exists' }, 409)
      }
      console.error('Update supplier error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: updated.id,
      name: updated.name,
      code: updated.code,
      accountNumber: updated.account_number,
      contactName: updated.contact_name,
      contactEmail: updated.contact_email,
      contactPhone: updated.contact_phone,
      address: updated.address,
      notes: updated.notes,
      isActive: updated.is_active,
      isQuickAdd: updated.is_quick_add,
      sortOrder: updated.sort_order,
      updatedAt: updated.updated_at
    })
  } catch (error) {
    console.error('Update supplier error:', error)
    return c.json({ error: 'Failed to update supplier' }, 500)
  }
})

// DELETE /api/v1/organizations/:orgId/suppliers/:id - Soft delete supplier
suppliers.delete('/:id', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const supplierId = c.req.param('id')

    // Users can only delete in their own organization
    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Check if the supplier exists and belongs to this org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Supplier not found' }, 404)
    }

    // Soft delete by setting is_active = false
    const { error } = await supabaseAdmin
      .from('suppliers')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', supplierId)

    if (error) {
      console.error('Delete supplier error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete supplier error:', error)
    return c.json({ error: 'Failed to delete supplier' }, 500)
  }
})

export default suppliers
