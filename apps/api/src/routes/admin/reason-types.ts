/**
 * Admin Reason Types Routes
 * Super admin management of reason types (including system types)
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { superAdminMiddleware, logSuperAdminActivity } from '../../middleware/auth.js'

const adminReasonTypes = new Hono()

adminReasonTypes.use('*', superAdminMiddleware)

// GET /api/v1/admin/reason-types - List all reason types (system only for super admin view)
adminReasonTypes.get('/', async (c) => {
  try {
    const { data: reasonTypes, error } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .order('is_system', { ascending: false })
      .order('name', { ascending: true })

    if (error) {
      console.error('Failed to fetch reason types:', error)
      return c.json({ error: error.message }, 500)
    }

    // Get item counts and reason counts for each type
    const typesWithCounts = await Promise.all(
      (reasonTypes || []).map(async (rt) => {
        // Count items using this type (across all orgs)
        const { count: itemCount } = await supabaseAdmin
          .from('template_items')
          .select('*', { count: 'exact', head: true })
          .eq('reason_type', rt.id)

        // Count reasons for this type (across all orgs)
        const { count: reasonCount } = await supabaseAdmin
          .from('item_reasons')
          .select('*', { count: 'exact', head: true })
          .eq('reason_type', rt.id)
          .eq('is_active', true)

        return {
          id: rt.id,
          name: rt.name,
          description: rt.description,
          organizationId: rt.organization_id,
          isSystem: rt.is_system,
          isCustom: rt.organization_id !== null,
          itemCount: itemCount || 0,
          reasonCount: reasonCount || 0,
          createdAt: rt.created_at,
          updatedAt: rt.updated_at
        }
      })
    )

    return c.json({ reasonTypes: typesWithCounts })
  } catch (error) {
    console.error('Get reason types error:', error)
    return c.json({ error: 'Failed to get reason types' }, 500)
  }
})

// DELETE /api/v1/admin/reason-types/:id - Delete any reason type (super admin only)
adminReasonTypes.delete('/:id', async (c) => {
  try {
    const superAdmin = c.get('superAdmin')
    const { id } = c.req.param()

    // Get the reason type
    const { data: existing } = await supabaseAdmin
      .from('reason_types')
      .select('*')
      .eq('id', id)
      .single()

    if (!existing) {
      return c.json({ error: 'Reason type not found' }, 404)
    }

    // Check if any items are using this type
    const { count: itemCount } = await supabaseAdmin
      .from('template_items')
      .select('*', { count: 'exact', head: true })
      .eq('reason_type', id)

    if (itemCount && itemCount > 0) {
      return c.json({
        error: `Cannot delete: ${itemCount} item(s) are using this reason type. Remove the type from all items first.`
      }, 409)
    }

    // Check if any reasons exist for this type
    const { count: reasonCount } = await supabaseAdmin
      .from('item_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('reason_type', id)
      .eq('is_active', true)

    if (reasonCount && reasonCount > 0) {
      return c.json({
        error: `Cannot delete: ${reasonCount} reason(s) exist for this type. Delete the reasons first.`
      }, 409)
    }

    // Delete the reason type
    const { error } = await supabaseAdmin
      .from('reason_types')
      .delete()
      .eq('id', id)

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    // Log the activity
    await logSuperAdminActivity(
      superAdmin.id,
      'delete_reason_type',
      `Deleted reason type: ${existing.name} (${id})`,
      undefined,
      { reasonTypeId: id, wasSystem: existing.is_system }
    )

    return c.json({ success: true, deletedId: id, wasSystem: existing.is_system })
  } catch (error) {
    console.error('Delete reason type error:', error)
    return c.json({ error: 'Failed to delete reason type' }, 500)
  }
})

export default adminReasonTypes
