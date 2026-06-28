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
import {
  loadCategoryQuotas, defaultQuota, getSkillCapacity,
  getDayCapacity, canBook,
  resolveBookingJobForParent, resolveBookingJobByType, getAvailabilityStrip, getCapacityStrip,
  type BookingJob, type ParentRef
} from '../services/resource-capacity.js'

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
  if (body.motDailyCap !== undefined) merged.motDailyCap = body.motDailyCap == null ? null : clamp(Math.round(Number(body.motDailyCap)), 0, 200)
  if (body.motCapacityHours !== undefined) merged.motCapacityHours = body.motCapacityHours == null ? null : clamp(Number(body.motCapacityHours), 0, 24)

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
      mot_daily_cap: merged.motDailyCap,
      mot_capacity_hours: merged.motCapacityHours,
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
  const onDate = (typeof body?.date === 'string' && body.date) ? body.date : new Date().toISOString().slice(0, 10)

  // Category can be given directly, or resolved from a job (its first priced
  // repair item's repair type). The downstream org-scoped repair_types lookup
  // re-validates the id, so a foreign id simply yields no suggestions.
  let repairTypeId: string | null = body?.repairTypeId ?? null
  const healthCheckId = body?.healthCheckId ?? null
  if (!repairTypeId && healthCheckId) {
    const { data: ri } = await supabaseAdmin
      .from('repair_items')
      .select('repair_type_id')
      .eq('health_check_id', healthCheckId)
      .not('repair_type_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    repairTypeId = ri?.repair_type_id ?? null
  }
  if (!repairTypeId) {
    if (healthCheckId) {
      return c.json({ siteId, suggestions: [], reason: 'No repair type set on this job yet' })
    }
    return c.json({ error: 'repairTypeId or healthCheckId is required' }, 400)
  }

  const { data: rt } = await supabaseAdmin
    .from('repair_types')
    .select('id, code, label, required_cert')
    .eq('id', repairTypeId)
    .eq('organization_id', auth.orgId)
    .maybeSingle()
  if (!rt) return c.json({ siteId, suggestions: [], reason: 'Repair type not found' })
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

// ---------------------------------------------------------------------------
// P2 — category quotas + capacity engine
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// GET /quotas?siteId=...  → one row per active repair type (defaults merged) +
// today's staffed snapshot for the grid's read-only "staffed" column.
resourceManager.get('/quotas', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: rts, error: rtErr }, quotas, staffed] = await Promise.all([
    supabaseAdmin.from('repair_types')
      .select('id, code, label, colour, sort_order, is_mot')
      .eq('organization_id', auth.orgId).eq('is_active', true)
      .order('sort_order', { ascending: true }).order('code', { ascending: true }),
    loadCategoryQuotas(auth.orgId, siteId),
    getSkillCapacity(auth.orgId, siteId, today)
  ])
  if (rtErr) {
    console.error('quotas load error:', rtErr)
    return c.json({ error: 'Failed to load quotas' }, 500)
  }

  const rows = (rts || []).map((r: any) => {
    const q = quotas.get(r.id) || defaultQuota(r.id)
    const cap = staffed.get(r.id)
    return {
      repairTypeId: r.id, code: r.code, label: r.label ?? r.code, colour: r.colour, sortOrder: r.sort_order, isMot: r.is_mot ?? false,
      valueRank: q.valueRank, protectPrimary: q.protectPrimary, releaseWindowDays: q.releaseWindowDays,
      minHours: q.minHours, hardCapJobs: q.hardCapJobs, hardCapHours: q.hardCapHours,
      enforcement: q.enforcement, allowOverride: q.allowOverride,
      staffed: cap
        ? { primaryHours: Math.round(cap.primaryHours * 10) / 10, eligibleHours: Math.round(cap.eligibleHours * 10) / 10, jobCeiling: cap.uncappedTechs === 0 ? cap.jobCapSum : null }
        : { primaryHours: 0, eligibleHours: 0, jobCeiling: null }
    }
  })
  return c.json({ siteId, quotas: rows })
})

// PUT /quotas/:repairTypeId?siteId=...  → upsert one category's quota (site_admin+)
resourceManager.put('/quotas/:repairTypeId', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)
  const repairTypeId = c.req.param('repairTypeId')

  const { data: rt } = await supabaseAdmin.from('repair_types')
    .select('id').eq('id', repairTypeId).eq('organization_id', auth.orgId).maybeSingle()
  if (!rt) return c.json({ error: 'Repair type not found' }, 404)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

  const current = (await loadCategoryQuotas(auth.orgId, siteId)).get(repairTypeId) || defaultQuota(repairTypeId)
  const num = (v: any, fallback: number | null) => v === '' || v == null ? fallback : Number(v)

  const { error } = await supabaseAdmin.from('resource_category_quotas').upsert({
    organization_id: auth.orgId,
    site_id: siteId,
    repair_type_id: repairTypeId,
    value_rank: body.valueRank != null ? clamp(Math.round(Number(body.valueRank)), 0, 999) : current.valueRank,
    protect_primary: body.protectPrimary != null ? Boolean(body.protectPrimary) : current.protectPrimary,
    release_window_days: body.releaseWindowDays != null ? clamp(Math.round(Number(body.releaseWindowDays)), 0, 60) : current.releaseWindowDays,
    min_hours: body.minHours !== undefined ? num(body.minHours, null) : current.minHours,
    hard_cap_jobs: body.hardCapJobs !== undefined ? num(body.hardCapJobs, null) : current.hardCapJobs,
    hard_cap_hours: body.hardCapHours !== undefined ? num(body.hardCapHours, null) : current.hardCapHours,
    enforcement: body.enforcement === 'hard' ? 'hard' : (body.enforcement === 'soft' ? 'soft' : current.enforcement),
    allow_override: body.allowOverride != null ? Boolean(body.allowOverride) : current.allowOverride,
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'organization_id,site_id,repair_type_id' })

  if (error) {
    console.error('category quota upsert error:', error)
    return c.json({ error: 'Failed to save quota' }, 500)
  }
  return c.json({ ok: true })
})

// GET /capacity/day?date=YYYY-MM-DD&siteId=...  → the full per-category day bundle
resourceManager.get('/capacity/day', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)
  const date = c.req.query('date')
  if (!date || !DATE_RE.test(date)) return c.json({ error: 'date (YYYY-MM-DD) is required' }, 400)

  const [capacity, { data: rts }] = await Promise.all([
    getDayCapacity(auth.orgId, siteId, date),
    supabaseAdmin.from('repair_types').select('id, code, label, colour').eq('organization_id', auth.orgId)
  ])
  const meta = new Map((rts || []).map((r: any) => [r.id, { code: r.code, label: r.label ?? r.code, colour: r.colour }]))
  const categories = capacity.categories.map(cat => {
    const m = meta.get(cat.repairTypeId)
    return { ...cat, code: m?.code ?? null, label: m?.label ?? 'Other', colour: m?.colour ?? '#9ca3af' }
  })
  return c.json({ siteId, capacity: { ...capacity, categories } })
})

// POST /can-book?siteId=...  body {repairTypeId, hours, date} → verdict
resourceManager.post('/can-book', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  if (!body?.repairTypeId || !body?.date || !DATE_RE.test(body.date)) {
    return c.json({ error: 'repairTypeId and date (YYYY-MM-DD) are required' }, 400)
  }
  const hours = Number(body.hours) || 0
  const result = await canBook(auth.orgId, siteId, body.date, body.repairTypeId, hours)
  return c.json(result)
})

// POST /availability?siteId=...  → the booking date picker's one-shot payload:
// resolved job (category/hours/mode) + a contiguous day strip with per-day
// verdict + load band + recommended/alternatives/softHints + the drop-off window.
// Job is resolved from a draft parent (jobsheetId/estimateId/healthCheckId) or an
// explicit repairTypeId (+ optional hours).
resourceManager.post('/availability', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const fromDate = (typeof body.fromDate === 'string' && DATE_RE.test(body.fromDate)) ? body.fromDate : undefined
  // Only treat ?siteId as an explicit override; without it, a parent (estimate/HC) keeps
  // its own site rather than defaulting to the caller's. The repair-type path uses the
  // caller's site.
  const explicitSite = c.req.query('siteId') ? await resolveSiteId(c) : null

  let job: BookingJob | null = null
  if (body.jobsheetId || body.estimateId || body.healthCheckId) {
    const parent: ParentRef = body.jobsheetId ? { kind: 'jobsheet', id: String(body.jobsheetId) }
      : body.estimateId ? { kind: 'estimate', id: String(body.estimateId) }
      : { kind: 'health_check', id: String(body.healthCheckId) }
    job = await resolveBookingJobForParent(auth.orgId, parent, explicitSite)
    // No priced repair-type work yet → fall through to the capacity-only strip below.
  } else if (body.repairTypeId) {
    const siteId = explicitSite ?? auth.user.siteId
    if (!siteId) return c.json({ error: 'No site selected' }, 400)
    job = await resolveBookingJobByType(auth.orgId, siteId, String(body.repairTypeId), Number(body.hours) || undefined)
    if (!job) return c.json({ error: 'Repair type not found' }, 404)
  }

  // Capacity-only mode: no job resolves yet, but we can still show the workshop's
  // day-by-day load + a "soonest day with room" recommendation off the site alone,
  // so the picker never has to fall back to a bare date field. Category quotas /
  // skill checks don't apply until there's a job. Needs a known site.
  if (!job) {
    const siteId = explicitSite ?? auth.user.siteId
    if (!siteId) return c.json({ resolved: false, capacityOnly: false, reason: 'Add priced work with a repair type to see availability' })
    const config = await loadSiteConfig(auth.orgId, siteId)
    const strip = await getCapacityStrip(auth.orgId, siteId, { fromDate })
    return c.json({
      resolved: false,
      capacityOnly: true,
      siteId,
      job: null,
      dropoffWindow: { start: config.dropoffWindowStart, end: config.dropoffWindowEnd, intervalMinutes: config.dropoffSlotIntervalMinutes },
      leadTimeDays: config.bookingLeadTimeDays,
      ...strip
    })
  }

  const config = await loadSiteConfig(auth.orgId, job.siteId)
  const strip = await getAvailabilityStrip(auth.orgId, job.siteId, job.repairTypeId, job.hours, { fromDate })
  return c.json({
    resolved: true,
    capacityOnly: false,
    siteId: job.siteId,
    job: {
      repairTypeId: job.repairTypeId, label: job.label, colour: job.colour,
      hours: Math.round(job.hours * 100) / 100, bookingMode: job.bookingMode, slotMinutes: job.slotMinutes
    },
    dropoffWindow: { start: config.dropoffWindowStart, end: config.dropoffWindowEnd, intervalMinutes: config.dropoffSlotIntervalMinutes },
    leadTimeDays: config.bookingLeadTimeDays,
    ...strip
  })
})

// ---------------------------------------------------------------------------
// P4 — physical resources (loan cars, waiter seats, MOT bay)
// ---------------------------------------------------------------------------

// MOT bays are no longer a generic asset — MOT capacity lives on the MOT card
// (mot_daily_cap, keyed on the is_mot repair type). Loan cars / waiter seats stay.
const KNOWN_ASSETS: Array<{ assetType: string; label: string }> = [
  { assetType: 'loan_car', label: 'Courtesy cars' },
  { assetType: 'waiter_seat', label: 'Waiter seats' }
]

// GET /assets?siteId=...  → the known resource types + saved quantity (null = untracked)
resourceManager.get('/assets', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const { data } = await supabaseAdmin
    .from('resource_assets')
    .select('asset_type, name, quantity')
    .eq('organization_id', auth.orgId).eq('site_id', siteId).eq('is_active', true)
  const saved = new Map((data || []).map((r: any) => [r.asset_type, r]))

  const assets = KNOWN_ASSETS.map(k => {
    const row = saved.get(k.assetType)
    return { assetType: k.assetType, label: k.label, quantity: row ? Number(row.quantity) : null }
  })
  return c.json({ siteId, assets })
})

// PUT /assets?siteId=...  body {assets:[{assetType, quantity}]} → upsert (null quantity = untrack/delete)
resourceManager.put('/assets', authorize([...ADMIN_ROLES]), async (c) => {
  const auth = c.get('auth')
  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }
  const incoming = Array.isArray(body?.assets) ? body.assets : []
  const known = new Set(KNOWN_ASSETS.map(k => k.assetType))

  for (const a of incoming) {
    if (!a || !known.has(a.assetType)) continue
    if (a.quantity == null || a.quantity === '') {
      // Untracked → remove the cap row so the resource is treated as unlimited.
      await supabaseAdmin.from('resource_assets').delete()
        .eq('organization_id', auth.orgId).eq('site_id', siteId).eq('asset_type', a.assetType)
    } else {
      await supabaseAdmin.from('resource_assets').upsert({
        organization_id: auth.orgId,
        site_id: siteId,
        asset_type: a.assetType,
        quantity: clamp(Math.round(Number(a.quantity)), 0, 200),
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id,site_id,asset_type' })
    }
  }
  return c.json({ ok: true })
})

export default resourceManager
