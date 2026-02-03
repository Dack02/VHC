/**
 * Check-In Settings & MRI Items API Routes
 * Manages per-organization check-in feature settings and MRI item configuration
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import { generateMriSalesDescription } from '../services/ai-mri.js'

const checkinSettings = new Hono()

// All routes require authentication
checkinSettings.use('*', authMiddleware)

// Default MRI items to seed when check-in is enabled
const DEFAULT_MRI_ITEMS = [
  // Service Items (date_mileage type)
  { name: 'Timing Belt', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'red', sort_order: 1 },
  { name: 'Brake Fluid', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'red', sort_order: 2 },
  { name: 'Coolant', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'amber', sort_order: 3 },
  { name: 'Gearbox Oil', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'amber', sort_order: 4 },
  { name: 'Air Filter', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'amber', sort_order: 5 },
  { name: 'Pollen Filter', category: 'Service Items', item_type: 'date_mileage', severity_when_due: 'green', sort_order: 6 },

  // Safety & Compliance (yes_no type)
  { name: 'Outstanding Recalls', category: 'Safety & Compliance', item_type: 'yes_no', severity_when_yes: 'red', severity_when_no: 'green', sort_order: 1 },
  { name: 'Warranty Status', category: 'Safety & Compliance', item_type: 'yes_no', is_informational: true, sort_order: 2 },
  { name: 'Service Book Present', category: 'Safety & Compliance', item_type: 'yes_no', is_informational: true, sort_order: 3 },

  // Other
  { name: 'Key Fob Battery', category: 'Other', item_type: 'date_mileage', severity_when_due: 'amber', sort_order: 1 },
]

/**
 * Seed default MRI items for an organization
 */
async function seedDefaultMriItems(organizationId: string): Promise<void> {
  // Check if already seeded
  const { count } = await supabaseAdmin
    .from('mri_items')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)

  if ((count || 0) > 0) {
    return // Already has items
  }

  // Insert default items
  const items = DEFAULT_MRI_ITEMS.map(item => ({
    ...item,
    organization_id: organizationId,
    is_default: true,
    enabled: true
  }))

  await supabaseAdmin.from('mri_items').insert(items)
}

// ============================================================================
// Check-In Settings Endpoints
// ============================================================================

/**
 * GET /:orgId/checkin-settings
 * Get organization check-in settings
 */
checkinSettings.get('/:orgId/checkin-settings', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Get or create settings
  let { data: settings, error } = await supabaseAdmin
    .from('organization_checkin_settings')
    .select('*')
    .eq('organization_id', orgId)
    .single()

  if (error && error.code === 'PGRST116') {
    // Not found - return defaults (don't create until explicitly enabled)
    return c.json({
      checkinEnabled: false,
      showMileageIn: true,
      showTimeRequired: true,
      showKeyLocation: true,
      checkinTimeoutMinutes: 20
    })
  } else if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    checkinEnabled: settings.checkin_enabled,
    showMileageIn: settings.show_mileage_in,
    showTimeRequired: settings.show_time_required,
    showKeyLocation: settings.show_key_location,
    checkinTimeoutMinutes: settings.checkin_timeout_minutes
  })
})

/**
 * PATCH /:orgId/checkin-settings
 * Update organization check-in settings (Org Admin only)
 */
checkinSettings.patch('/:orgId/checkin-settings', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Check if enabling check-in for the first time
  const isEnabling = body.checkinEnabled === true

  // Get existing settings
  let { data: existing } = await supabaseAdmin
    .from('organization_checkin_settings')
    .select('id, checkin_enabled')
    .eq('organization_id', orgId)
    .single()

  const wasEnabled = existing?.checkin_enabled === true

  // Build update data
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (body.checkinEnabled !== undefined) updateData.checkin_enabled = body.checkinEnabled
  if (body.showMileageIn !== undefined) updateData.show_mileage_in = body.showMileageIn
  if (body.showTimeRequired !== undefined) updateData.show_time_required = body.showTimeRequired
  if (body.showKeyLocation !== undefined) updateData.show_key_location = body.showKeyLocation
  if (body.checkinTimeoutMinutes !== undefined) updateData.checkin_timeout_minutes = body.checkinTimeoutMinutes

  let result
  if (existing) {
    result = await supabaseAdmin
      .from('organization_checkin_settings')
      .update(updateData)
      .eq('organization_id', orgId)
      .select()
      .single()
  } else {
    result = await supabaseAdmin
      .from('organization_checkin_settings')
      .insert({
        organization_id: orgId,
        ...updateData
      })
      .select()
      .single()
  }

  if (result.error) {
    return c.json({ error: result.error.message }, 500)
  }

  // Seed default MRI items if check-in is being enabled for the first time
  if (isEnabling && !wasEnabled) {
    await seedDefaultMriItems(orgId)
  }

  const settings = result.data

  return c.json({
    checkinEnabled: settings.checkin_enabled,
    showMileageIn: settings.show_mileage_in,
    showTimeRequired: settings.show_time_required,
    showKeyLocation: settings.show_key_location,
    checkinTimeoutMinutes: settings.checkin_timeout_minutes
  })
})

// ============================================================================
// MRI Items Endpoints
// ============================================================================

/**
 * GET /:orgId/mri-items
 * Get all MRI items for an organization
 */
checkinSettings.get('/:orgId/mri-items', async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const { data: items, error } = await supabaseAdmin
    .from('mri_items')
    .select('*')
    .eq('organization_id', orgId)
    .order('category')
    .order('sort_order')

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Group by category and convert to camelCase
  const grouped: Record<string, Array<{
    id: string
    name: string
    description: string | null
    itemType: string
    severityWhenDue: string | null
    severityWhenYes: string | null
    severityWhenNo: string | null
    isInformational: boolean
    enabled: boolean
    sortOrder: number
    isDefault: boolean
    salesDescription: string | null
    aiGenerated: boolean
    aiReviewed: boolean
    servicePackageId: string | null
  }>> = {}

  for (const item of items || []) {
    const category = item.category || 'Other'
    if (!grouped[category]) {
      grouped[category] = []
    }
    grouped[category].push({
      id: item.id,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      severityWhenDue: item.severity_when_due,
      severityWhenYes: item.severity_when_yes,
      severityWhenNo: item.severity_when_no,
      isInformational: item.is_informational,
      enabled: item.enabled,
      sortOrder: item.sort_order,
      isDefault: item.is_default,
      salesDescription: item.sales_description,
      aiGenerated: item.ai_generated || false,
      aiReviewed: item.ai_reviewed || false,
      servicePackageId: item.service_package_id || null
    })
  }

  return c.json({
    items: items?.map(item => ({
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      itemType: item.item_type,
      severityWhenDue: item.severity_when_due,
      severityWhenYes: item.severity_when_yes,
      severityWhenNo: item.severity_when_no,
      isInformational: item.is_informational,
      enabled: item.enabled,
      sortOrder: item.sort_order,
      isDefault: item.is_default,
      salesDescription: item.sales_description,
      aiGenerated: item.ai_generated || false,
      aiReviewed: item.ai_reviewed || false,
      servicePackageId: item.service_package_id || null
    })) || [],
    grouped
  })
})

/**
 * POST /:orgId/mri-items
 * Create a new custom MRI item (Org Admin only)
 */
checkinSettings.post('/:orgId/mri-items', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Validate required fields
  if (!body.name || !body.itemType) {
    return c.json({ error: 'Name and itemType are required' }, 400)
  }

  if (!['date_mileage', 'yes_no'].includes(body.itemType)) {
    return c.json({ error: 'itemType must be date_mileage or yes_no' }, 400)
  }

  // Get max sort order for category
  const { data: maxSort } = await supabaseAdmin
    .from('mri_items')
    .select('sort_order')
    .eq('organization_id', orgId)
    .eq('category', body.category || 'Other')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const nextSortOrder = ((maxSort?.sort_order || 0) + 1)

  const { data: item, error } = await supabaseAdmin
    .from('mri_items')
    .insert({
      organization_id: orgId,
      name: body.name,
      description: body.description || null,
      category: body.category || 'Other',
      item_type: body.itemType,
      severity_when_due: body.severityWhenDue || null,
      severity_when_yes: body.severityWhenYes || null,
      severity_when_no: body.severityWhenNo || null,
      is_informational: body.isInformational || false,
      enabled: body.enabled !== false,
      sort_order: nextSortOrder,
      is_default: false,
      service_package_id: body.servicePackageId || null
    })
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    itemType: item.item_type,
    severityWhenDue: item.severity_when_due,
    severityWhenYes: item.severity_when_yes,
    severityWhenNo: item.severity_when_no,
    isInformational: item.is_informational,
    enabled: item.enabled,
    sortOrder: item.sort_order,
    isDefault: item.is_default,
    servicePackageId: item.service_package_id || null
  }, 201)
})

/**
 * PATCH /:orgId/mri-items/:itemId
 * Update an MRI item (Org Admin only)
 */
checkinSettings.patch('/:orgId/mri-items/:itemId', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const itemId = c.req.param('itemId')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Verify item belongs to org
  const { data: existing } = await supabaseAdmin
    .from('mri_items')
    .select('id')
    .eq('id', itemId)
    .eq('organization_id', orgId)
    .single()

  if (!existing) {
    return c.json({ error: 'MRI item not found' }, 404)
  }

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (body.name !== undefined) updateData.name = body.name
  if (body.description !== undefined) updateData.description = body.description
  if (body.category !== undefined) updateData.category = body.category
  if (body.severityWhenDue !== undefined) updateData.severity_when_due = body.severityWhenDue
  if (body.severityWhenYes !== undefined) updateData.severity_when_yes = body.severityWhenYes
  if (body.severityWhenNo !== undefined) updateData.severity_when_no = body.severityWhenNo
  if (body.isInformational !== undefined) updateData.is_informational = body.isInformational
  if (body.enabled !== undefined) updateData.enabled = body.enabled
  if (body.sortOrder !== undefined) updateData.sort_order = body.sortOrder
  if (body.salesDescription !== undefined) updateData.sales_description = body.salesDescription
  if (body.aiReviewed !== undefined) updateData.ai_reviewed = body.aiReviewed
  if (body.servicePackageId !== undefined) updateData.service_package_id = body.servicePackageId || null

  const { data: item, error } = await supabaseAdmin
    .from('mri_items')
    .update(updateData)
    .eq('id', itemId)
    .select()
    .single()

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    itemType: item.item_type,
    severityWhenDue: item.severity_when_due,
    severityWhenYes: item.severity_when_yes,
    severityWhenNo: item.severity_when_no,
    isInformational: item.is_informational,
    enabled: item.enabled,
    sortOrder: item.sort_order,
    isDefault: item.is_default,
    salesDescription: item.sales_description,
    aiGenerated: item.ai_generated || false,
    aiReviewed: item.ai_reviewed || false,
    servicePackageId: item.service_package_id || null
  })
})

/**
 * POST /:orgId/mri-items/:itemId/generate-sales-description
 * Generate AI sales description for an MRI item (Org Admin only)
 */
checkinSettings.post('/:orgId/mri-items/:itemId/generate-sales-description', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const itemId = c.req.param('itemId')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  try {
    const salesDescription = await generateMriSalesDescription(itemId, orgId, auth.user.id)
    return c.json({ salesDescription })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate description'
    return c.json({ error: message }, 500)
  }
})

/**
 * DELETE /:orgId/mri-items/:itemId
 * Delete a custom MRI item (Org Admin only)
 * Note: Default items cannot be deleted, only disabled
 */
checkinSettings.delete('/:orgId/mri-items/:itemId', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const itemId = c.req.param('itemId')

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Verify item belongs to org and is not a default item
  const { data: existing } = await supabaseAdmin
    .from('mri_items')
    .select('id, is_default')
    .eq('id', itemId)
    .eq('organization_id', orgId)
    .single()

  if (!existing) {
    return c.json({ error: 'MRI item not found' }, 404)
  }

  if (existing.is_default) {
    return c.json({ error: 'Default MRI items cannot be deleted. Disable them instead.' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('mri_items')
    .delete()
    .eq('id', itemId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  return c.json({ success: true })
})

/**
 * POST /:orgId/mri-items/reorder
 * Reorder MRI items within a category (Org Admin only)
 */
checkinSettings.post('/:orgId/mri-items/reorder', requireOrgAdmin(), async (c) => {
  const auth = c.get('auth')
  const orgId = c.req.param('orgId')
  const body = await c.req.json()

  // Verify user belongs to this organization
  if (auth.orgId !== orgId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // body should be { items: [{ id: string, sortOrder: number }] }
  if (!Array.isArray(body.items)) {
    return c.json({ error: 'items array is required' }, 400)
  }

  // Update each item's sort order
  for (const item of body.items) {
    await supabaseAdmin
      .from('mri_items')
      .update({ sort_order: item.sortOrder, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('organization_id', orgId)
  }

  return c.json({ success: true })
})

export default checkinSettings
