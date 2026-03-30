import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const config = new Hono()

/**
 * GET /config?siteId= — Get board configuration
 */
config.get('/', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const siteId = c.req.query('siteId')

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('tcard_board_config')
      .select('*')
      .eq('organization_id', auth.orgId)
      .eq('site_id', siteId)
      .maybeSingle()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    if (!data) {
      return c.json({
        config: {
          defaultTechHours: 8.0,
          showCompletedColumn: true,
          autoCompleteStatuses: ['completed'],
        }
      })
    }

    return c.json({
      config: {
        id: data.id,
        siteId: data.site_id,
        defaultTechHours: data.default_tech_hours,
        showCompletedColumn: data.show_completed_column,
        autoCompleteStatuses: data.auto_complete_statuses,
      }
    })
  } catch (error) {
    console.error('Get config error:', error)
    return c.json({ error: 'Failed to get config' }, 500)
  }
})

/**
 * PATCH /config — Update board configuration
 */
config.patch('/', authorize(['super_admin', 'org_admin', 'site_admin']), async (c) => {
  try {
    const auth = c.get('auth')
    const body = await c.req.json()
    const { siteId, defaultTechHours, showCompletedColumn, autoCompleteStatuses } = body

    if (!siteId) {
      return c.json({ error: 'siteId is required' }, 400)
    }

    const { data, error } = await supabaseAdmin
      .from('tcard_board_config')
      .upsert({
        organization_id: auth.orgId,
        site_id: siteId,
        default_tech_hours: defaultTechHours ?? 8.0,
        show_completed_column: showCompletedColumn ?? true,
        auto_complete_statuses: autoCompleteStatuses ?? ['completed'],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,site_id' })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      config: {
        id: data.id,
        siteId: data.site_id,
        defaultTechHours: data.default_tech_hours,
        showCompletedColumn: data.show_completed_column,
        autoCompleteStatuses: data.auto_complete_statuses,
      }
    })
  } catch (error) {
    console.error('Update config error:', error)
    return c.json({ error: 'Failed to update config' }, 500)
  }
})

export default config
