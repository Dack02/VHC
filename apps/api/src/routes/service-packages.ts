import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const servicePackages = new Hono()

servicePackages.use('*', authMiddleware)

// GET / - List active service packages with labour + parts
servicePackages.get('/', async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: packages, error } = await supabaseAdmin
      .from('service_packages')
      .select(`
        *,
        labour:service_package_labour(
          id, labour_code_id, hours, discount_percent, is_vat_exempt, notes, sort_order, rate,
          labour_code:labour_codes(id, code, description, hourly_rate)
        ),
        parts:service_package_parts(
          id, part_number, description, quantity, supplier_id, supplier_name, cost_price, sell_price, notes, sort_order
        )
      `)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      console.error('Get service packages error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      servicePackages: (packages || []).map(pkg => ({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        isActive: pkg.is_active,
        sortOrder: pkg.sort_order,
        createdAt: pkg.created_at,
        updatedAt: pkg.updated_at,
        labour: (pkg.labour || []).map((l: Record<string, unknown>) => {
          const labourCode = l.labour_code as Record<string, unknown> | null
          return {
            id: l.id,
            labourCodeId: l.labour_code_id,
            hours: parseFloat(l.hours as string),
            discountPercent: parseFloat(l.discount_percent as string) || 0,
            isVatExempt: l.is_vat_exempt,
            notes: l.notes,
            sortOrder: l.sort_order,
            rate: l.rate != null ? parseFloat(l.rate as string) : null,
            labourCode: labourCode ? {
              id: labourCode.id,
              code: labourCode.code,
              description: labourCode.description,
              hourlyRate: parseFloat(labourCode.hourly_rate as string)
            } : null
          }
        }),
        parts: (pkg.parts || []).map((p: Record<string, unknown>) => ({
          id: p.id,
          partNumber: p.part_number,
          description: p.description,
          quantity: parseFloat(p.quantity as string),
          supplierId: p.supplier_id,
          supplierName: p.supplier_name,
          costPrice: parseFloat(p.cost_price as string),
          sellPrice: parseFloat(p.sell_price as string),
          notes: p.notes,
          sortOrder: p.sort_order
        }))
      }))
    })
  } catch (error) {
    console.error('Get service packages error:', error)
    return c.json({ error: 'Failed to get service packages' }, 500)
  }
})

// POST / - Create service package with nested labour + parts
servicePackages.post('/', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { name, description, labour, parts } = body

    if (!name?.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('service_packages')
      .select('sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const nextSortOrder = (maxSort?.sort_order || 0) + 1

    // Create package
    const { data: pkg, error } = await supabaseAdmin
      .from('service_packages')
      .insert({
        organization_id: orgId,
        name: name.trim(),
        description: description?.trim() || null,
        sort_order: nextSortOrder,
        created_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: 'A package with this name already exists' }, 409)
      }
      console.error('Create service package error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Insert labour entries
    if (labour && Array.isArray(labour) && labour.length > 0) {
      const labourRows = labour.map((l: Record<string, unknown>, i: number) => ({
        service_package_id: pkg.id,
        labour_code_id: l.labour_code_id,
        hours: isNaN(parseFloat(l.hours as string)) ? 1 : parseFloat(l.hours as string),
        discount_percent: parseFloat(l.discount_percent as string) || 0,
        is_vat_exempt: l.is_vat_exempt || false,
        notes: (l.notes as string)?.trim() || null,
        sort_order: i,
        rate: l.rate != null ? parseFloat(l.rate as string) : null
      }))

      const { error: labourError } = await supabaseAdmin
        .from('service_package_labour')
        .insert(labourRows)

      if (labourError) {
        console.error('Insert package labour error:', labourError)
      }
    }

    // Insert parts entries
    if (parts && Array.isArray(parts) && parts.length > 0) {
      const partsRows = parts.map((p: Record<string, unknown>, i: number) => ({
        service_package_id: pkg.id,
        part_number: (p.part_number as string)?.trim() || null,
        description: (p.description as string)?.trim(),
        quantity: parseFloat(p.quantity as string) || 1,
        supplier_id: p.supplier_id || null,
        supplier_name: (p.supplier_name as string) || null,
        cost_price: parseFloat(p.cost_price as string) || 0,
        sell_price: parseFloat(p.sell_price as string) || 0,
        notes: (p.notes as string)?.trim() || null,
        sort_order: i
      }))

      const { error: partsError } = await supabaseAdmin
        .from('service_package_parts')
        .insert(partsRows)

      if (partsError) {
        console.error('Insert package parts error:', partsError)
      }
    }

    return c.json({ id: pkg.id, name: pkg.name }, 201)
  } catch (error) {
    console.error('Create service package error:', error)
    return c.json({ error: 'Failed to create service package' }, 500)
  }
})

// PATCH /:id - Update service package (replace-all for labour/parts if provided)
servicePackages.patch('/:id', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const packageId = c.req.param('id')
    const body = await c.req.json()

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    // Verify package belongs to org
    const { data: existing, error: existError } = await supabaseAdmin
      .from('service_packages')
      .select('id')
      .eq('id', packageId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Service package not found' }, 404)
    }

    const { name, description, labour, parts } = body

    // Update package fields
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null

    const { error: updateError } = await supabaseAdmin
      .from('service_packages')
      .update(updateData)
      .eq('id', packageId)

    if (updateError) {
      if (updateError.code === '23505') {
        return c.json({ error: 'A package with this name already exists' }, 409)
      }
      console.error('Update service package error:', updateError)
      return c.json({ error: updateError.message }, 500)
    }

    // Replace-all strategy for labour
    if (labour !== undefined && Array.isArray(labour)) {
      await supabaseAdmin
        .from('service_package_labour')
        .delete()
        .eq('service_package_id', packageId)

      if (labour.length > 0) {
        const labourRows = labour.map((l: Record<string, unknown>, i: number) => ({
          service_package_id: packageId,
          labour_code_id: l.labour_code_id,
          hours: isNaN(parseFloat(l.hours as string)) ? 1 : parseFloat(l.hours as string),
          discount_percent: parseFloat(l.discount_percent as string) || 0,
          is_vat_exempt: l.is_vat_exempt || false,
          notes: (l.notes as string)?.trim() || null,
          sort_order: i,
          rate: l.rate != null ? parseFloat(l.rate as string) : null
        }))

        const { error: labourError } = await supabaseAdmin
          .from('service_package_labour')
          .insert(labourRows)

        if (labourError) {
          console.error('Replace package labour error:', labourError)
        }
      }
    }

    // Replace-all strategy for parts
    if (parts !== undefined && Array.isArray(parts)) {
      await supabaseAdmin
        .from('service_package_parts')
        .delete()
        .eq('service_package_id', packageId)

      if (parts.length > 0) {
        const partsRows = parts.map((p: Record<string, unknown>, i: number) => ({
          service_package_id: packageId,
          part_number: (p.part_number as string)?.trim() || null,
          description: (p.description as string)?.trim(),
          quantity: parseFloat(p.quantity as string) || 1,
          supplier_id: p.supplier_id || null,
          supplier_name: (p.supplier_name as string) || null,
          cost_price: parseFloat(p.cost_price as string) || 0,
          sell_price: parseFloat(p.sell_price as string) || 0,
          notes: (p.notes as string)?.trim() || null,
          sort_order: i
        }))

        const { error: partsError } = await supabaseAdmin
          .from('service_package_parts')
          .insert(partsRows)

        if (partsError) {
          console.error('Replace package parts error:', partsError)
        }
      }
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Update service package error:', error)
    return c.json({ error: 'Failed to update service package' }, 500)
  }
})

// DELETE /:id - Soft delete (is_active = false)
servicePackages.delete('/:id', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const orgId = c.req.param('orgId')
    const packageId = c.req.param('id')

    if (orgId !== auth.orgId) {
      return c.json({ error: 'Organisation not found' }, 404)
    }

    const { data: existing, error: existError } = await supabaseAdmin
      .from('service_packages')
      .select('id')
      .eq('id', packageId)
      .eq('organization_id', orgId)
      .single()

    if (existError || !existing) {
      return c.json({ error: 'Service package not found' }, 404)
    }

    const { error } = await supabaseAdmin
      .from('service_packages')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', packageId)

    if (error) {
      console.error('Delete service package error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete service package error:', error)
    return c.json({ error: 'Failed to delete service package' }, 500)
  }
})

export default servicePackages
