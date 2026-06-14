/**
 * Shop-level (job-less) indirect time clocking.
 *
 * For non-job time like cleaning, training or meetings — only when the org has
 * indirect-time tracking enabled. Job-linked indirect time uses the health-check
 * clock-indirect endpoint instead. See docs/technician-job-clocking-spec.md §8.
 */
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'

const timeEntries = new Hono()
timeEntries.use('*', authMiddleware)

async function indirectEnabled(orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('indirect_time_enabled')
    .eq('organization_id', orgId)
    .maybeSingle()
  return data?.indirect_time_enabled === true
}

// GET /indirect/active — the technician's current open shop-level indirect segment
timeEntries.get('/indirect/active', async (c) => {
  const auth = c.get('auth')
  const { data } = await supabaseAdmin
    .from('technician_time_entries')
    .select('id, clock_in_at, category:time_entry_categories(key, label, colour)')
    .eq('technician_id', auth.user.id)
    .eq('organization_id', auth.orgId)
    .is('health_check_id', null)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return c.json({ active: null })
  const cat = (data as any).category as { key?: string; label?: string; colour?: string } | null
  return c.json({
    active: { id: data.id, clockInAt: data.clock_in_at, category: cat ? { key: cat.key, label: cat.label, colour: cat.colour } : null }
  })
})

// POST /indirect — start a shop-level indirect segment (no job)
timeEntries.post('/indirect', async (c) => {
  const auth = c.get('auth')
  if (!(await indirectEnabled(auth.orgId))) {
    return c.json({ error: 'Indirect time tracking is not enabled for this organization' }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const categoryKey = typeof body?.categoryKey === 'string' ? body.categoryKey : null
  if (!categoryKey) return c.json({ error: 'categoryKey is required' }, 400)

  const { data: category } = await supabaseAdmin
    .from('time_entry_categories')
    .select('id, kind, is_active')
    .eq('organization_id', auth.orgId)
    .eq('key', categoryKey)
    .maybeSingle()
  if (!category || category.is_active === false) return c.json({ error: 'Unknown or inactive category' }, 400)
  if (category.kind !== 'indirect') return c.json({ error: 'Category is not an indirect category' }, 400)

  // Only one open shop-level indirect segment per tech — close any existing first.
  await supabaseAdmin
    .from('technician_time_entries')
    .update({ clock_out_at: new Date().toISOString(), closed_reason: 'reclock' })
    .eq('technician_id', auth.user.id)
    .eq('organization_id', auth.orgId)
    .is('health_check_id', null)
    .is('clock_out_at', null)

  const { data: entry, error } = await supabaseAdmin
    .from('technician_time_entries')
    .insert({
      health_check_id: null,
      technician_id: auth.user.id,
      organization_id: auth.orgId,
      site_id: auth.user.siteId ?? null,
      category_id: category.id,
      clock_in_at: new Date().toISOString()
    })
    .select('id, clock_in_at')
    .single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ id: entry.id, clockInAt: entry.clock_in_at }, 201)
})

// POST /indirect/stop — close the technician's open shop-level indirect segment
timeEntries.post('/indirect/stop', async (c) => {
  const auth = c.get('auth')
  const { data: open } = await supabaseAdmin
    .from('technician_time_entries')
    .select('id, clock_in_at')
    .eq('technician_id', auth.user.id)
    .eq('organization_id', auth.orgId)
    .is('health_check_id', null)
    .is('clock_out_at', null)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!open) return c.json({ error: 'No open indirect time' }, 400)

  const clockOut = new Date()
  const durationMinutes = Math.round((clockOut.getTime() - new Date(open.clock_in_at).getTime()) / 60000)
  const { error } = await supabaseAdmin
    .from('technician_time_entries')
    .update({ clock_out_at: clockOut.toISOString(), duration_minutes: durationMinutes, closed_reason: 'manual' })
    .eq('id', open.id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true, durationMinutes })
})

export default timeEntries
