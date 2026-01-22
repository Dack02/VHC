import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, verifyRepairOptionAccess } from './helpers.js'

const optionsRouter = new Hono()

// GET /repair-items/:id/options - List options
optionsRouter.get('/repair-items/:id/options', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    const { data: options, error } = await supabaseAdmin
      .from('repair_options')
      .select(`
        *,
        labour:repair_labour!repair_labour_repair_option_id_fkey(
          *,
          labour_code:labour_codes(id, code, description)
        ),
        parts:repair_parts!repair_parts_repair_option_id_fkey(*)
      `)
      .eq('repair_item_id', id)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Get repair options error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      options: (options || []).map(opt => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        labourTotal: parseFloat(opt.labour_total) || 0,
        partsTotal: parseFloat(opt.parts_total) || 0,
        subtotal: parseFloat(opt.subtotal) || 0,
        vatAmount: parseFloat(opt.vat_amount) || 0,
        totalIncVat: parseFloat(opt.total_inc_vat) || 0,
        isRecommended: opt.is_recommended,
        sortOrder: opt.sort_order,
        labour: opt.labour?.map((lab: Record<string, unknown>) => ({
          id: lab.id,
          labourCodeId: lab.labour_code_id,
          labourCode: lab.labour_code,
          hours: parseFloat(lab.hours as string),
          rate: parseFloat(lab.rate as string),
          discountPercent: parseFloat(lab.discount_percent as string) || 0,
          total: parseFloat(lab.total as string),
          isVatExempt: lab.is_vat_exempt,
          notes: lab.notes
        })) || [],
        parts: opt.parts?.map((part: Record<string, unknown>) => ({
          id: part.id,
          partNumber: part.part_number,
          description: part.description,
          quantity: parseFloat(part.quantity as string),
          supplierId: part.supplier_id,
          supplierName: part.supplier_name,
          costPrice: parseFloat(part.cost_price as string),
          sellPrice: parseFloat(part.sell_price as string),
          lineTotal: parseFloat(part.line_total as string),
          marginPercent: part.margin_percent ? parseFloat(part.margin_percent as string) : null,
          markupPercent: part.markup_percent ? parseFloat(part.markup_percent as string) : null,
          notes: part.notes
        })) || []
      }))
    })
  } catch (error) {
    console.error('Get repair options error:', error)
    return c.json({ error: 'Failed to get repair options' }, 500)
  }
})

// POST /repair-items/:id/options - Create option
optionsRouter.post('/repair-items/:id/options', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, is_recommended } = body

    if (!name || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400)
    }

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Get next sort order
    const { data: maxSort } = await supabaseAdmin
      .from('repair_options')
      .select('sort_order')
      .eq('repair_item_id', id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const { data: option, error } = await supabaseAdmin
      .from('repair_options')
      .insert({
        repair_item_id: id,
        name: name.trim(),
        description: description?.trim() || null,
        is_recommended: is_recommended || false,
        sort_order: (maxSort?.sort_order || 0) + 1
      })
      .select()
      .single()

    if (error) {
      console.error('Create repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: option.id,
      name: option.name,
      description: option.description,
      labourTotal: 0,
      partsTotal: 0,
      subtotal: 0,
      vatAmount: 0,
      totalIncVat: 0,
      isRecommended: option.is_recommended,
      sortOrder: option.sort_order
    }, 201)
  } catch (error) {
    console.error('Create repair option error:', error)
    return c.json({ error: 'Failed to create repair option' }, 500)
  }
})

// PATCH /repair-options/:id - Update option
optionsRouter.patch('/repair-options/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, description, is_recommended, sort_order } = body

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (is_recommended !== undefined) updateData.is_recommended = is_recommended
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: option, error } = await supabaseAdmin
      .from('repair_options')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: option.id,
      name: option.name,
      description: option.description,
      labourTotal: parseFloat(option.labour_total) || 0,
      partsTotal: parseFloat(option.parts_total) || 0,
      subtotal: parseFloat(option.subtotal) || 0,
      vatAmount: parseFloat(option.vat_amount) || 0,
      totalIncVat: parseFloat(option.total_inc_vat) || 0,
      isRecommended: option.is_recommended,
      sortOrder: option.sort_order
    })
  } catch (error) {
    console.error('Update repair option error:', error)
    return c.json({ error: 'Failed to update repair option' }, 500)
  }
})

// DELETE /repair-options/:id - Delete option
optionsRouter.delete('/repair-options/:id', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const existing = await verifyRepairOptionAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair option not found' }, 404)
    }

    // Delete cascades to labour and parts
    const { error } = await supabaseAdmin
      .from('repair_options')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete repair option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ success: true })
  } catch (error) {
    console.error('Delete repair option error:', error)
    return c.json({ error: 'Failed to delete repair option' }, 500)
  }
})

// POST /repair-items/:id/select-option - Set selected option
optionsRouter.post('/repair-items/:id/select-option', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { option_id } = body

    const existing = await verifyRepairItemAccess(id, auth.orgId)
    if (!existing) {
      return c.json({ error: 'Repair item not found' }, 404)
    }

    // Verify option belongs to this repair item (if option_id provided)
    if (option_id) {
      const { data: option } = await supabaseAdmin
        .from('repair_options')
        .select('id')
        .eq('id', option_id)
        .eq('repair_item_id', id)
        .single()

      if (!option) {
        return c.json({ error: 'Option not found for this repair item' }, 404)
      }
    }

    const { data: item, error } = await supabaseAdmin
      .from('repair_items')
      .update({
        selected_option_id: option_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Select option error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({ selectedOptionId: item.selected_option_id })
  } catch (error) {
    console.error('Select option error:', error)
    return c.json({ error: 'Failed to select option' }, 500)
  }
})

export default optionsRouter
