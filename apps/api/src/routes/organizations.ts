import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const organizations = new Hono()

// Apply auth middleware to all routes
organizations.use('*', authMiddleware)

// GET /api/v1/organizations/:id - Get organization
organizations.get('/:id', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Users can only access their own organization
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !org) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    return c.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      settings: org.settings,
      createdAt: org.created_at,
      updatedAt: org.updated_at
    })
  } catch (error) {
    console.error('Get organization error:', error)
    return c.json({ error: 'Failed to get organization' }, 500)
  }
})

// PATCH /api/v1/organizations/:id - Update organization
organizations.patch('/:id', authorize(['super_admin', 'org_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()
    const { name, settings } = body

    // Users can only update their own organization
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name
    if (settings !== undefined) updateData.settings = settings

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      settings: org.settings,
      updatedAt: org.updated_at
    })
  } catch (error) {
    console.error('Update organization error:', error)
    return c.json({ error: 'Failed to update organization' }, 500)
  }
})

// Default threshold values
// Note: Brake disc thresholds removed - they are vehicle-specific (manufacturer min spec)
const DEFAULT_THRESHOLDS = {
  tyre_red_below_mm: 1.6,
  tyre_amber_below_mm: 3.0,
  brake_pad_red_below_mm: 3.0,
  brake_pad_amber_below_mm: 5.0
}

// GET /api/v1/organizations/:id/thresholds - Get inspection thresholds
organizations.get('/:id/thresholds', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Users can only access their own organization's thresholds
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Try to get existing thresholds
    let { data: thresholds } = await supabaseAdmin
      .from('inspection_thresholds')
      .select('*')
      .eq('organization_id', id)
      .single()

    // If no thresholds exist, create defaults
    if (!thresholds) {
      const { data: newThresholds, error: createError } = await supabaseAdmin
        .from('inspection_thresholds')
        .insert({
          organization_id: id,
          ...DEFAULT_THRESHOLDS
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating default thresholds:', createError)
        // Return defaults even if insert failed
        return c.json({
          organizationId: id,
          ...DEFAULT_THRESHOLDS,
          isDefault: true
        })
      }

      thresholds = newThresholds
    }

    return c.json({
      id: thresholds.id,
      organizationId: thresholds.organization_id,
      tyreRedBelowMm: parseFloat(thresholds.tyre_red_below_mm),
      tyreAmberBelowMm: parseFloat(thresholds.tyre_amber_below_mm),
      brakePadRedBelowMm: parseFloat(thresholds.brake_pad_red_below_mm),
      brakePadAmberBelowMm: parseFloat(thresholds.brake_pad_amber_below_mm),
      updatedAt: thresholds.updated_at
    })
  } catch (error) {
    console.error('Get thresholds error:', error)
    return c.json({ error: 'Failed to get thresholds' }, 500)
  }
})

// PATCH /api/v1/organizations/:id/thresholds - Update inspection thresholds
organizations.patch('/:id/thresholds', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Users can only update their own organization's thresholds
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const {
      tyreRedBelowMm,
      tyreAmberBelowMm,
      brakePadRedBelowMm,
      brakePadAmberBelowMm,
      resetToDefaults
    } = body

    // Build update data
    const updateData: Record<string, unknown> = {}

    if (resetToDefaults) {
      // Reset all to defaults
      Object.assign(updateData, DEFAULT_THRESHOLDS)
    } else {
      // Update only provided values
      if (tyreRedBelowMm !== undefined) updateData.tyre_red_below_mm = tyreRedBelowMm
      if (tyreAmberBelowMm !== undefined) updateData.tyre_amber_below_mm = tyreAmberBelowMm
      if (brakePadRedBelowMm !== undefined) updateData.brake_pad_red_below_mm = brakePadRedBelowMm
      if (brakePadAmberBelowMm !== undefined) updateData.brake_pad_amber_below_mm = brakePadAmberBelowMm
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    // Upsert thresholds (create if not exists, update if exists)
    const { data: thresholds, error } = await supabaseAdmin
      .from('inspection_thresholds')
      .upsert({
        organization_id: id,
        ...DEFAULT_THRESHOLDS,
        ...updateData
      }, {
        onConflict: 'organization_id'
      })
      .select()
      .single()

    if (error) {
      console.error('Update thresholds error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: thresholds.id,
      organizationId: thresholds.organization_id,
      tyreRedBelowMm: parseFloat(thresholds.tyre_red_below_mm),
      tyreAmberBelowMm: parseFloat(thresholds.tyre_amber_below_mm),
      brakePadRedBelowMm: parseFloat(thresholds.brake_pad_red_below_mm),
      brakePadAmberBelowMm: parseFloat(thresholds.brake_pad_amber_below_mm),
      updatedAt: thresholds.updated_at
    })
  } catch (error) {
    console.error('Update thresholds error:', error)
    return c.json({ error: 'Failed to update thresholds' }, 500)
  }
})

// Default pricing values
const DEFAULT_PRICING = {
  default_margin_percent: 40.00,
  vat_rate: 20.00
}

// GET /api/v1/organizations/:id/pricing-settings - Get pricing settings
organizations.get('/:id/pricing-settings', async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Users can only access their own organization's settings
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    // Get settings from organization_settings table
    const { data: settings, error } = await supabaseAdmin
      .from('organization_settings')
      .select('default_margin_percent, vat_rate')
      .eq('organization_id', id)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Get pricing settings error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      settings: {
        defaultMarginPercent: settings?.default_margin_percent ?? DEFAULT_PRICING.default_margin_percent,
        vatRate: settings?.vat_rate ?? DEFAULT_PRICING.vat_rate
      }
    })
  } catch (error) {
    console.error('Get pricing settings error:', error)
    return c.json({ error: 'Failed to get pricing settings' }, 500)
  }
})

// PATCH /api/v1/organizations/:id/pricing-settings - Update pricing settings
organizations.patch('/:id/pricing-settings', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Users can only update their own organization's settings
    if (id !== auth.orgId) {
      return c.json({ error: 'Organization not found' }, 404)
    }

    const { default_margin_percent, vat_rate } = body

    // Validate values
    if (default_margin_percent !== undefined) {
      if (default_margin_percent < 0 || default_margin_percent > 100) {
        return c.json({ error: 'Margin must be between 0 and 100' }, 400)
      }
    }
    if (vat_rate !== undefined) {
      if (vat_rate < 0 || vat_rate > 100) {
        return c.json({ error: 'VAT rate must be between 0 and 100' }, 400)
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (default_margin_percent !== undefined) updateData.default_margin_percent = default_margin_percent
    if (vat_rate !== undefined) updateData.vat_rate = vat_rate

    // Upsert settings
    const { data: settings, error } = await supabaseAdmin
      .from('organization_settings')
      .upsert({
        organization_id: id,
        ...updateData
      }, {
        onConflict: 'organization_id'
      })
      .select('default_margin_percent, vat_rate')
      .single()

    if (error) {
      console.error('Update pricing settings error:', error)
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      settings: {
        defaultMarginPercent: settings.default_margin_percent ?? DEFAULT_PRICING.default_margin_percent,
        vatRate: settings.vat_rate ?? DEFAULT_PRICING.vat_rate
      }
    })
  } catch (error) {
    console.error('Update pricing settings error:', error)
    return c.json({ error: 'Failed to update pricing settings' }, 500)
  }
})

export default organizations
