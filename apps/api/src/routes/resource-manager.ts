/**
 * Resource Manager API
 *
 * P0 surface: per-site capacity config. GET returns the saved config (or
 * all-defaults when none exists); PUT upserts it (site_admin+). The Booking
 * Diary reads the same config (via services/resource-config) to band days
 * against `target_loading_pct`.
 *
 * Site-scoped like the Booking Diary: an explicit ?siteId (validated against the
 * org) or the caller's own site.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { loadSiteConfig, type ResourceSiteConfig } from '../services/resource-config.js'

const resourceManager = new Hono()

resourceManager.use('*', authMiddleware)

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const
const ADVISOR_ROLES = [...ADMIN_ROLES, 'service_advisor'] as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

async function resolveSiteId(c: any): Promise<string | null> {
  const auth = c.get('auth')
  const requested = c.req.query('siteId')
  if (requested) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', requested)
      .eq('organization_id', auth.orgId)
      .single()
    return site ? site.id : null
  }
  return auth.user.siteId
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// GET /config?siteId=...  → saved config or all-defaults
resourceManager.get('/config', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const config = await loadSiteConfig(auth.orgId, siteId)
  return c.json({ siteId, config })
})

// PUT /config?siteId=...  → upsert (site_admin+)
resourceManager.put('/config', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  let body: Partial<ResourceSiteConfig>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Start from the current (or default) config, then apply provided fields so a
  // partial PUT only changes what it sends.
  const current = await loadSiteConfig(auth.orgId, siteId)
  const merged: ResourceSiteConfig = { ...current }

  if (body.targetLoadingPct != null) merged.targetLoadingPct = clamp(Number(body.targetLoadingPct), 0.1, 2.0)
  if (body.overbookFactor != null) merged.overbookFactor = clamp(Number(body.overbookFactor), 1.0, 2.0)
  if (body.bookingLeadTimeDays != null) merged.bookingLeadTimeDays = clamp(Math.round(Number(body.bookingLeadTimeDays)), 0, 365)
  if (body.onlineLeadTimeHours != null) merged.onlineLeadTimeHours = clamp(Math.round(Number(body.onlineLeadTimeHours)), 0, 720)
  if (body.bookingMaxDays != null) merged.bookingMaxDays = clamp(Math.round(Number(body.bookingMaxDays)), 1, 365)
  if (body.releaseWindowDays != null) merged.releaseWindowDays = clamp(Math.round(Number(body.releaseWindowDays)), 0, 60)
  if (body.dropoffWindowStart != null) {
    if (!TIME_RE.test(body.dropoffWindowStart)) return c.json({ error: 'dropoffWindowStart must be HH:MM' }, 400)
    merged.dropoffWindowStart = body.dropoffWindowStart
  }
  if (body.dropoffWindowEnd != null) {
    if (!TIME_RE.test(body.dropoffWindowEnd)) return c.json({ error: 'dropoffWindowEnd must be HH:MM' }, 400)
    merged.dropoffWindowEnd = body.dropoffWindowEnd
  }
  if (body.dropoffSlotIntervalMinutes != null) merged.dropoffSlotIntervalMinutes = clamp(Math.round(Number(body.dropoffSlotIntervalMinutes)), 5, 120)
  if (body.dropoffSlotCapacity !== undefined) {
    merged.dropoffSlotCapacity = body.dropoffSlotCapacity == null ? null : clamp(Math.round(Number(body.dropoffSlotCapacity)), 1, 100)
  }
  if (body.enableSkillRouting != null) merged.enableSkillRouting = Boolean(body.enableSkillRouting)
  if (body.enableCategoryQuotas != null) merged.enableCategoryQuotas = Boolean(body.enableCategoryQuotas)

  if (merged.dropoffWindowEnd <= merged.dropoffWindowStart) {
    return c.json({ error: 'Drop-off window end must be after start' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('resource_site_config')
    .upsert({
      organization_id: auth.orgId,
      site_id: siteId,
      target_loading_pct: merged.targetLoadingPct,
      overbook_factor: merged.overbookFactor,
      booking_lead_time_days: merged.bookingLeadTimeDays,
      online_lead_time_hours: merged.onlineLeadTimeHours,
      booking_max_days: merged.bookingMaxDays,
      release_window_days: merged.releaseWindowDays,
      dropoff_window_start: merged.dropoffWindowStart,
      dropoff_window_end: merged.dropoffWindowEnd,
      dropoff_slot_interval_minutes: merged.dropoffSlotIntervalMinutes,
      dropoff_slot_capacity: merged.dropoffSlotCapacity,
      enable_skill_routing: merged.enableSkillRouting,
      enable_category_quotas: merged.enableCategoryQuotas,
      updated_at: new Date().toISOString()
    }, { onConflict: 'organization_id,site_id' })

  if (error) {
    console.error('resource_site_config upsert error:', error)
    return c.json({ error: 'Failed to save config' }, 500)
  }

  return c.json({ siteId, config: merged })
})

// ---------------------------------------------------------------------------
// P1 — technician skills & certifications (advisory; nothing gates a booking)
// ---------------------------------------------------------------------------

const techName = (u: any) =>
  (`${u.first_name ?? ''} ${u.last_name ?? ''}`).trim() || u.email || 'Unnamed'

async function verifyTechnician(orgId: string, techId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', techId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return !!data
}

// GET /skills?siteId=...  → the whole matrix in one round-trip:
// technicians + repair types + their skill rows + certifications.
resourceManager.get('/skills', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)

  let techQ = supabaseAdmin
    .from('users')
    .select('id, first_name, last_name, email, site_id')
    .eq('organization_id', auth.orgId)
    .eq('role', 'technician')
    .eq('is_active', true)
    .order('first_name', { ascending: true })
  if (siteId) techQ = techQ.eq('site_id', siteId)

  const [{ data: techs, error: techErr }, { data: rts, error: rtErr }] = await Promise.all([
    techQ,
    supabaseAdmin
      .from('repair_types')
      .select('id, code, label, colour, sort_order, required_cert')
      .eq('organization_id', auth.orgId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })
  ])
  if (techErr || rtErr) {
    console.error('skills load error:', techErr || rtErr)
    return c.json({ error: 'Failed to load skills' }, 500)
  }

  const techIds = (techs || []).map((t: any) => t.id)
  const [skillsRes, certsRes] = techIds.length
    ? await Promise.all([
        supabaseAdmin.from('technician_skills').select('*').eq('organization_id', auth.orgId).in('technician_id', techIds),
        supabaseAdmin.from('technician_certifications').select('*').eq('organization_id', auth.orgId).in('technician_id', techIds).eq('is_active', true)
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }]

  return c.json({
    siteId,
    technicians: (techs || []).map((t: any) => ({ id: t.id, name: techName(t) })),
    repairTypes: (rts || []).map((r: any) => ({
      id: r.id, code: r.code, label: r.label ?? r.code, colour: r.colour,
      sortOrder: r.sort_order, requiredCert: r.required_cert ?? null
    })),
    skills: (skillsRes.data || []).map((s: any) => ({
      technicianId: s.technician_id,
      repairTypeId: s.repair_type_id,
      proficiency: s.proficiency,
      isPrimary: s.is_primary,
      dailyJobCap: s.daily_job_cap,
      dailyJobTarget: s.daily_job_target,
      isActive: s.is_active
    })),
    certifications: (certsRes.data || []).map((c2: any) => ({
      id: c2.id,
      technicianId: c2.technician_id,
      certType: c2.cert_type,
      reference: c2.reference,
      issuedDate: c2.issued_date,
      expiresDate: c2.expires_date
    }))
  })
})

// PUT /technicians/:id/skills  → replace a tech's skill rows (the matrix editor)
resourceManager.put('/technicians/:id/skills', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const techId = c.req.param('id')
  if (!(await verifyTechnician(auth.orgId, techId))) return c.json({ error: 'Technician not found' }, 404)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const incoming = Array.isArray(body?.skills) ? body.skills : []

  const rows = incoming
    .filter((s: any) => s && s.repairTypeId)
    .map((s: any) => ({
      organization_id: auth.orgId,
      technician_id: techId,
      repair_type_id: s.repairTypeId,
      proficiency: clamp(Math.round(Number(s.proficiency) || 3), 1, 5),
      is_primary: Boolean(s.isPrimary),
      daily_job_cap: s.dailyJobCap == null || s.dailyJobCap === '' ? null : clamp(Math.round(Number(s.dailyJobCap)), 1, 100),
      daily_job_target: s.dailyJobTarget == null || s.dailyJobTarget === '' ? null : clamp(Math.round(Number(s.dailyJobTarget)), 0, 100),
      is_active: true,
      updated_at: new Date().toISOString()
    }))

  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('technician_skills')
      .upsert(rows, { onConflict: 'technician_id,repair_type_id' })
    if (error) {
      console.error('technician_skills upsert error:', error)
      return c.json({ error: 'Failed to save skills' }, 500)
    }
  }

  // Drop any rows the editor removed (repair types no longer in the set).
  const keep = rows.map((r: any) => r.repair_type_id)
  let delQ = supabaseAdmin.from('technician_skills').delete()
    .eq('organization_id', auth.orgId).eq('technician_id', techId)
  if (keep.length) delQ = delQ.not('repair_type_id', 'in', `(${keep.join(',')})`)
  const { error: delErr } = await delQ
  if (delErr) {
    console.error('technician_skills delete error:', delErr)
    return c.json({ error: 'Failed to save skills' }, 500)
  }

  return c.json({ ok: true, count: rows.length })
})

// POST /technicians/:id/certifications  → add/update one cert
resourceManager.post('/technicians/:id/certifications', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const techId = c.req.param('id')
  if (!(await verifyTechnician(auth.orgId, techId))) return c.json({ error: 'Technician not found' }, 404)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const certType = String(body?.certType || '').trim()
  if (!certType) return c.json({ error: 'certType is required' }, 400)

  const { data, error } = await supabaseAdmin
    .from('technician_certifications')
    .upsert({
      organization_id: auth.orgId,
      technician_id: techId,
      cert_type: certType.slice(0, 40),
      reference: body?.reference ? String(body.reference).slice(0, 80) : null,
      issued_date: body?.issuedDate || null,
      expires_date: body?.expiresDate || null,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'technician_id,cert_type' })
    .select()
    .maybeSingle()

  if (error) {
    console.error('certification upsert error:', error)
    return c.json({ error: 'Failed to save certification' }, 500)
  }
  return c.json({
    id: data?.id,
    technicianId: techId,
    certType,
    reference: data?.reference ?? null,
    issuedDate: data?.issued_date ?? null,
    expiresDate: data?.expires_date ?? null
  })
})

// DELETE /certifications/:id
resourceManager.delete('/certifications/:id', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('technician_certifications')
    .delete()
    .eq('id', id)
    .eq('organization_id', auth.orgId)
  if (error) {
    console.error('certification delete error:', error)
    return c.json({ error: 'Failed to remove certification' }, 500)
  }
  return c.json({ ok: true })
})

// POST /suggest-technician  → ranked, advisory tech suggestions for a job.
// DISPATCH advisory only (does NOT gate a booking). P1 ranks by qualified + primary
// + proficiency; live load-balancing arrives with the P2 capacity RPCs.
resourceManager.post('/suggest-technician', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const repairTypeId = body?.repairTypeId
  if (!repairTypeId) return c.json({ error: 'repairTypeId is required' }, 400)
  const onDate = (typeof body?.date === 'string' && body.date) ? body.date : new Date().toISOString().slice(0, 10)

  const { data: rt } = await supabaseAdmin
    .from('repair_types')
    .select('id, code, label, required_cert')
    .eq('id', repairTypeId)
    .eq('organization_id', auth.orgId)
    .maybeSingle()
  if (!rt) return c.json({ error: 'Repair type not found' }, 404)
  const requiredCert: string | null = rt.required_cert ?? null

  // Skilled techs for this type + the active technician roster (for names / site).
  let techQ = supabaseAdmin
    .from('users')
    .select('id, first_name, last_name, email, site_id')
    .eq('organization_id', auth.orgId)
    .eq('role', 'technician')
    .eq('is_active', true)
  if (siteId) techQ = techQ.eq('site_id', siteId)

  const [{ data: skills }, { data: techs }] = await Promise.all([
    supabaseAdmin.from('technician_skills').select('*')
      .eq('organization_id', auth.orgId).eq('repair_type_id', repairTypeId).eq('is_active', true),
    techQ
  ])

  const techById = new Map((techs || []).map((t: any) => [t.id, t]))
  const candidateSkills = (skills || []).filter((s: any) => techById.has(s.technician_id))

  // Cert gate (only when the type requires one): keep techs holding a valid cert.
  let certedTechIds: Set<string> | null = null
  if (requiredCert && candidateSkills.length) {
    const ids = candidateSkills.map((s: any) => s.technician_id)
    const { data: certs } = await supabaseAdmin
      .from('technician_certifications')
      .select('technician_id, expires_date, is_active')
      .eq('organization_id', auth.orgId)
      .eq('cert_type', requiredCert)
      .eq('is_active', true)
      .in('technician_id', ids)
    certedTechIds = new Set(
      (certs || [])
        .filter((ct: any) => !ct.expires_date || ct.expires_date >= onDate)
        .map((ct: any) => ct.technician_id)
    )
  }

  const W_PRIMARY = 0.6
  const W_SKILL = 0.4
  const suggestions = candidateSkills
    .filter((s: any) => !requiredCert || (certedTechIds?.has(s.technician_id)))
    .map((s: any) => {
      const t = techById.get(s.technician_id)
      const reasons: string[] = []
      if (s.is_primary) reasons.push('primary lane')
      reasons.push(`proficiency ${s.proficiency}/5`)
      if (requiredCert) reasons.push(`${requiredCert} certified`)
      return {
        technicianId: s.technician_id,
        name: techName(t),
        isPrimary: s.is_primary,
        proficiency: s.proficiency,
        dailyJobCap: s.daily_job_cap,
        score: Math.round((W_PRIMARY * (s.is_primary ? 1 : 0) + W_SKILL * (s.proficiency / 5)) * 1000) / 1000,
        reasons
      }
    })
    .sort((a, b) => b.score - a.score)

  return c.json({ siteId, repairType: { id: rt.id, code: rt.code, label: rt.label ?? rt.code }, date: onDate, requiredCert, suggestions })
})

export default resourceManager
