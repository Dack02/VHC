/**
 * Follow-Up Engine
 * --------------------------------------------------------------------------
 * Deferred-work recovery. A once-daily idempotent sweep that:
 *   1. Creates a follow-up case per vehicle visit (health check) that has
 *      deferred repair items and no case yet.
 *   2. Advances each active case through its timeline (due-date-aware), sending
 *      SMS / email or dropping into the manual-call stage.
 *   3. Pre-checks the Gemini DMS for an existing/future booking and pauses the
 *      case if the customer has already booked.
 *   4. Auto-resolves cases whose items are no longer deferred.
 *
 * Also exposes handleInboundSmsForFollowUps() — paused cadence on customer reply.
 *
 * Spec: docs/follow-up-module-spec.md
 */

import crypto from 'node:crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { sendSms } from './sms.js'
import { sendEmail, getOrganizationBranding } from './email.js'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CHUNK = 100
const MAX_DEFERRED_SCAN = 5000   // safety cap per org per sweep (logged if hit)
const MAX_DUE_CASES = 1000

function gbp(n: unknown): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0)
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function todayStart(): Date {
  return startOfDay(new Date())
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function render(tpl: string | null | undefined, vars: Record<string, string>): string {
  if (!tpl) return ''
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/**
 * Dry-run guard. When FOLLOW_UP_DRY_RUN is truthy, the engine renders and logs
 * every SMS/email step (so you can preview exactly what would go out and watch
 * the timeline advance) but never calls sendSms/sendEmail. Default OFF, so
 * production behaviour is unchanged. Intended for safe testing on dev.
 */
function followUpDryRun(): boolean {
  const v = (process.env.FOLLOW_UP_DRY_RUN || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
}

// ---------------------------------------------------------------------------
// Types (loose — these mirror the DB rows we touch)
// ---------------------------------------------------------------------------

interface TimelineStep {
  id: string
  step_order: number
  action: 'send_sms' | 'send_email' | 'send_both' | 'manual_call' | 'auto_close'
  offset_days: number
  sms_body: string | null
  email_subject: string | null
  email_body: string | null
  default_outcome_id: string | null
}

interface Timeline {
  anchor: 'due_date' | 'deferral_date'
  steps: TimelineStep[]
  minOffset: number
}

interface CaseRow {
  id: string
  organization_id: string
  health_check_id: string
  customer_id: string | null
  vehicle_id: string | null
  site_id: string | null
  timeline_id: string | null
  status: string
  current_step_order: number | null
  anchor_date: string | null
  next_action_at: string | null
  deferred_value_snapshot: number | null
  item_count: number | null
  last_contacted_at: string | null
  created_at: string
}

interface CaseItemSnapshot {
  name_snapshot: string | null
  value_snapshot: number | null
  due_date_snapshot: string | null
}

// ---------------------------------------------------------------------------
// Event + comms logging
// ---------------------------------------------------------------------------

async function logEvent(
  caseId: string,
  organizationId: string,
  eventType: string,
  opts: {
    channel?: string
    stepOrder?: number
    dispositionId?: string
    body?: string
    metadata?: Record<string, unknown>
    createdBy?: string | null
  } = {}
): Promise<void> {
  const { error } = await supabaseAdmin.from('follow_up_events').insert({
    case_id: caseId,
    organization_id: organizationId,
    event_type: eventType,
    channel: opts.channel ?? null,
    step_order: opts.stepOrder ?? null,
    disposition_id: opts.dispositionId ?? null,
    body: opts.body ?? null,
    metadata: opts.metadata ?? {},
    created_by: opts.createdBy ?? null,
  })
  if (error) logger.error('Failed to log follow-up event', { error: error.message, caseId, eventType })
}

async function logComm(
  healthCheckId: string,
  organizationId: string,
  channel: 'sms' | 'email',
  recipient: string,
  subject: string | null,
  body: string,
  result: { success: boolean; messageId?: string; error?: string }
): Promise<void> {
  await supabaseAdmin.from('communication_logs').insert({
    health_check_id: healthCheckId,
    organization_id: organizationId,
    channel,
    recipient,
    subject,
    message_body: body,
    template_id: 'follow_up',
    status: result.success ? 'sent' : 'failed',
    external_id: result.messageId ?? null,
    error_message: result.error ?? null,
    metadata: { source: 'follow_up' },
  })
}

// ---------------------------------------------------------------------------
// DMS booking pre-check (queries imported bookings in health_checks)
// ---------------------------------------------------------------------------

export interface FutureBooking {
  id: string
  due_date: string | null
  promise_time: string | null
  booked_repairs: unknown
}

export async function findFutureBooking(
  organizationId: string,
  customerId: string | null,
  vehicleId: string | null
): Promise<FutureBooking | null> {
  if (!customerId || !vehicleId) return null
  const todayStr = todayStart().toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, due_date, promise_time, booked_repairs')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'awaiting_arrival')
    .eq('external_source', 'gemini_osi')
    .gte('due_date', todayStr)
    .is('deleted_at', null)
    .order('due_date', { ascending: true })
    .limit(1)
  if (error) {
    logger.error('Booking pre-check failed', { error: error.message, organizationId })
    return null
  }
  return (data && data[0]) || null
}

// ---------------------------------------------------------------------------
// Step scheduling (due-date-aware, with deferral-date fallback)
// ---------------------------------------------------------------------------

function computeStepDate(
  anchor: 'due_date' | 'deferral_date',
  step: TimelineStep,
  anchorDate: Date | null,
  createdAt: Date,
  minOffset: number
): Date {
  if (anchor === 'due_date' && anchorDate) {
    return startOfDay(addDays(anchorDate, step.offset_days))
  }
  // No due date (or deferral-date timeline): normalise so the earliest step
  // starts at creation, preserving the spacing between steps.
  return startOfDay(addDays(startOfDay(createdAt), step.offset_days - minOffset))
}

// ---------------------------------------------------------------------------
// Timeline cache
// ---------------------------------------------------------------------------

async function loadTimeline(timelineId: string, cache: Map<string, Timeline | null>): Promise<Timeline | null> {
  if (cache.has(timelineId)) return cache.get(timelineId)!
  const { data: tl } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('anchor')
    .eq('id', timelineId)
    .maybeSingle()
  const { data: steps } = await supabaseAdmin
    .from('follow_up_timeline_steps')
    .select('id, step_order, action, offset_days, sms_body, email_subject, email_body, default_outcome_id')
    .eq('timeline_id', timelineId)
    .order('step_order', { ascending: true })
  if (!tl || !steps || steps.length === 0) {
    cache.set(timelineId, null)
    return null
  }
  const minOffset = Math.min(...steps.map((s) => s.offset_days))
  const timeline: Timeline = { anchor: tl.anchor, steps: steps as TimelineStep[], minOffset }
  cache.set(timelineId, timeline)
  return timeline
}

// ---------------------------------------------------------------------------
// Email rendering (branded, with deferred-items table)
// ---------------------------------------------------------------------------

const ITEMS_MARKER = ' ITEMS '

function buildItemsHtml(items: CaseItemSnapshot[], color: string): string {
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(it.name_snapshot || 'Repair')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${it.due_date_snapshot ? escapeHtml(fmtDate(it.due_date_snapshot)) : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${escapeHtml(gbp(it.value_snapshot))}</td>
      </tr>`
    )
    .join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px;">
    <thead><tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${color};">Work</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${color};">Due</th>
      <th style="text-align:right;padding:8px 12px;border-bottom:2px solid ${color};">Price</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

function buildItemsText(items: CaseItemSnapshot[]): string {
  return items
    .map((it) => `• ${it.name_snapshot || 'Repair'}${it.due_date_snapshot ? ` (due ${fmtDate(it.due_date_snapshot)})` : ''} — ${gbp(it.value_snapshot)}`)
    .join('\n')
}

function buildEmail(
  bodyTemplate: string,
  vars: Record<string, string>,
  items: CaseItemSnapshot[],
  branding: { logoUrl?: string | null; primaryColor?: string; organizationName?: string; phone?: string }
): { html: string; text: string } {
  const color = branding.primaryColor || '#3B82F6'

  // Text version
  const text = render(bodyTemplate, { ...vars, deferredItemsTable: buildItemsText(items) })

  // HTML version — substitute everything except the items marker, then lay out
  const withMarker = render(bodyTemplate, { ...vars, deferredItemsTable: ITEMS_MARKER })
  const itemsHtml = buildItemsHtml(items, color)
  const bodyHtml = withMarker
    .split('\n')
    .map((line) => {
      if (line.includes(ITEMS_MARKER)) return itemsHtml
      if (!line.trim()) return ''
      return `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(line)}</p>`
    })
    .join('')

  const header = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${escapeHtml(branding.organizationName)}" style="max-height:48px;" />`
    : `<span style="color:#fff;font-size:18px;font-weight:700;">${escapeHtml(branding.organizationName || 'Vehicle Health Check')}</span>`

  const cta = vars.followUpUrl
    ? `<div style="margin:20px 0;"><a href="${escapeHtml(vars.followUpUrl)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">View &amp; book</a></div>`
    : ''

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <div style="max-width:600px;margin:0 auto;padding:16px;">
      <div style="background:${color};padding:16px 20px;border-radius:12px 12px 0 0;">${header}</div>
      <div style="background:#fff;border-bottom:1px solid #eee;padding:12px 20px;font-size:13px;color:#374151;">
        <strong>${escapeHtml(vars.vehicleReg)}</strong> &middot; ${escapeHtml(vars.itemCount)} item(s) &middot; <strong>${escapeHtml(vars.deferredTotal)}</strong>${vars.dueDate ? ` &middot; due ${escapeHtml(vars.dueDate)}` : ''}
      </div>
      <div style="background:#fff;padding:24px 20px;border-radius:0 0 12px 12px;">
        ${bodyHtml}
        ${cta}
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">You're receiving this because you have outstanding recommended work with ${escapeHtml(branding.organizationName || 'us')}. Reply STOP to opt out.</p>
      </div>
    </div>
  </body></html>`

  return { html, text }
}

// ---------------------------------------------------------------------------
// Public-link helper (re-uses the existing /view portal page)
// ---------------------------------------------------------------------------

async function ensureFollowUpLink(hc: { id: string; public_token: string | null; token_expires_at: string | null }): Promise<string> {
  const base = process.env.PUBLIC_APP_URL || 'http://localhost:5183'
  const valid = hc.public_token && hc.token_expires_at && new Date(hc.token_expires_at) > new Date()
  if (valid) return `${base}/view/${hc.public_token}`
  const token = crypto.randomBytes(32).toString('hex')
  const expires = addDays(new Date(), 30).toISOString()
  await supabaseAdmin.from('health_checks').update({ public_token: token, token_expires_at: expires }).eq('id', hc.id)
  return `${base}/view/${token}`
}

// ---------------------------------------------------------------------------
// Case creation
// ---------------------------------------------------------------------------

interface DeferredItem {
  id: string
  health_check_id: string
  name: string | null
  total_inc_vat: number | null
  price_override: number | null
  deferred_until: string | null
  follow_up_date: string | null
  rag_status: string | null
}

function itemValue(it: DeferredItem): number {
  return Number(it.price_override ?? it.total_inc_vat ?? 0) || 0
}

function itemAnchor(it: DeferredItem): Date | null {
  const d = it.deferred_until || it.follow_up_date
  return d ? startOfDay(new Date(d)) : null
}

async function createCasesForOrg(organizationId: string): Promise<number> {
  // 1. Fetch deferred top-level repair items
  const { data: items, error } = await supabaseAdmin
    .from('repair_items')
    .select('id, health_check_id, name, total_inc_vat, price_override, deferred_until, follow_up_date, rag_status')
    .eq('organization_id', organizationId)
    .eq('outcome_status', 'deferred')
    .is('deleted_at', null)
    .is('parent_repair_item_id', null)
    .limit(MAX_DEFERRED_SCAN)
  if (error) {
    logger.error('Follow-up: failed to scan deferred items', { error: error.message, organizationId })
    return 0
  }
  if (!items || items.length === 0) return 0
  if (items.length >= MAX_DEFERRED_SCAN) {
    logger.warn('Follow-up: deferred-item scan hit cap', { organizationId, cap: MAX_DEFERRED_SCAN })
  }

  // Group by health check
  const byHc = new Map<string, DeferredItem[]>()
  for (const it of items as DeferredItem[]) {
    const list = byHc.get(it.health_check_id) || []
    list.push(it)
    byHc.set(it.health_check_id, list)
  }
  const hcIds = [...byHc.keys()]

  // 2. Which already have a case? (chunk the IN list)
  const withCase = new Set<string>()
  for (const ids of chunk(hcIds, CHUNK)) {
    const { data: existing } = await supabaseAdmin
      .from('follow_up_cases')
      .select('health_check_id')
      .eq('organization_id', organizationId)
      .in('health_check_id', ids)
    for (const r of existing || []) withCase.add(r.health_check_id)
  }
  const newHcIds = hcIds.filter((id) => !withCase.has(id))
  if (newHcIds.length === 0) return 0

  // 3. Default timeline (need its steps to schedule the first action)
  const { data: tlRow } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('id, anchor')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!tlRow) {
    logger.warn('Follow-up: no default timeline for org — skipping case creation', { organizationId })
    return 0
  }
  const tlCache = new Map<string, Timeline | null>()
  const timeline = await loadTimeline(tlRow.id, tlCache)
  if (!timeline) {
    logger.warn('Follow-up: default timeline has no steps', { organizationId })
    return 0
  }
  const firstStep = timeline.steps[0]

  // 4. Fetch HC details for new ones (chunked)
  const hcRows: Array<{
    id: string
    customer_id: string | null
    vehicle_id: string | null
    site_id: string | null
    advisor_id: string | null
    status: string
    deleted_at: string | null
  }> = []
  for (const ids of chunk(newHcIds, CHUNK)) {
    const { data } = await supabaseAdmin
      .from('health_checks')
      .select('id, customer_id, vehicle_id, site_id, advisor_id, status, deleted_at')
      .eq('organization_id', organizationId)
      .in('id', ids)
    for (const r of data || []) hcRows.push(r)
  }

  const skipStatuses = new Set(['cancelled', 'no_show'])
  const now = new Date()
  let created = 0

  for (const hc of hcRows) {
    if (hc.deleted_at) continue
    if (skipStatuses.has(hc.status)) continue
    const hcItems = byHc.get(hc.id) || []
    if (hcItems.length === 0) continue

    const value = hcItems.reduce((sum, it) => sum + itemValue(it), 0)
    const anchorDates = hcItems.map(itemAnchor).filter((d): d is Date => d !== null)
    const anchorDate = anchorDates.length ? new Date(Math.min(...anchorDates.map((d) => d.getTime()))) : null
    const nextActionAt = computeStepDate(timeline.anchor, firstStep, anchorDate, now, timeline.minOffset)

    const { data: caseRow, error: caseErr } = await supabaseAdmin
      .from('follow_up_cases')
      .insert({
        organization_id: organizationId,
        site_id: hc.site_id,
        health_check_id: hc.id,
        customer_id: hc.customer_id,
        vehicle_id: hc.vehicle_id,
        timeline_id: tlRow.id,
        status: 'active',
        current_step_order: 0,
        anchor_date: anchorDate ? anchorDate.toISOString().slice(0, 10) : null,
        next_action_at: nextActionAt.toISOString(),
        deferred_value_snapshot: value,
        item_count: hcItems.length,
        assigned_to: hc.advisor_id,
      })
      .select('id')
      .single()

    if (caseErr) {
      // 23505 = unique violation (case created concurrently) — safe to skip
      if (caseErr.code !== '23505') {
        logger.error('Follow-up: failed to create case', { error: caseErr.message, healthCheckId: hc.id })
      }
      continue
    }

    await supabaseAdmin.from('follow_up_case_items').insert(
      hcItems.map((it) => ({
        case_id: caseRow.id,
        organization_id: organizationId,
        repair_item_id: it.id,
        name_snapshot: it.name,
        value_snapshot: itemValue(it),
        due_date_snapshot: it.deferred_until || it.follow_up_date || null,
        rag_snapshot: it.rag_status,
      }))
    )

    await logEvent(caseRow.id, organizationId, 'system', {
      body: `Follow-up case created from ${hcItems.length} deferred item(s) — ${gbp(value)}`,
      metadata: { healthCheckId: hc.id, anchorDate: anchorDate ? anchorDate.toISOString().slice(0, 10) : null },
    })
    created++
  }

  if (created > 0) logger.info('Follow-up: created cases', { organizationId, created })
  return created
}

// ---------------------------------------------------------------------------
// Close a case
// ---------------------------------------------------------------------------

async function closeCase(
  c: CaseRow,
  opts: { outcomeId: string | null; note: string; createdBy?: string | null; stepOrder?: number }
): Promise<void> {
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('follow_up_cases')
    .update({
      status: 'closed',
      outcome_id: opts.outcomeId,
      outcome_notes: opts.note,
      closed_at: now,
      closed_by: opts.createdBy ?? null,
      next_action_at: null,
      ...(opts.stepOrder !== undefined ? { current_step_order: opts.stepOrder } : {}),
      updated_at: now,
    })
    .eq('id', c.id)
  await logEvent(c.id, c.organization_id, 'outcome_set', {
    body: opts.note,
    stepOrder: opts.stepOrder,
    metadata: { outcomeId: opts.outcomeId, system: !opts.createdBy },
    createdBy: opts.createdBy ?? null,
  })
}

// ---------------------------------------------------------------------------
// Build the placeholder + email context for a case
// ---------------------------------------------------------------------------

async function buildContext(c: CaseRow): Promise<{
  vars: Record<string, string>
  items: CaseItemSnapshot[]
  customer: { mobile: string | null; email: string | null; contact_opt_out: boolean }
  branding: { logoUrl?: string | null; primaryColor?: string; organizationName?: string; phone?: string }
} | null> {
  const [{ data: hc }, { data: customer }, { data: vehicle }, { data: caseItems }, branding] = await Promise.all([
    supabaseAdmin.from('health_checks').select('id, public_token, token_expires_at').eq('id', c.health_check_id).maybeSingle(),
    c.customer_id
      ? supabaseAdmin.from('customers').select('first_name, last_name, mobile, email, contact_opt_out').eq('id', c.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.vehicle_id
      ? supabaseAdmin.from('vehicles').select('registration, make, model').eq('id', c.vehicle_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('follow_up_case_items').select('name_snapshot, value_snapshot, due_date_snapshot').eq('case_id', c.id),
    getOrganizationBranding(c.organization_id),
  ])

  if (!hc) return null

  const followUpUrl = await ensureFollowUpLink(hc)
  const cust = customer || ({} as Record<string, unknown>)
  const veh = vehicle || ({} as Record<string, unknown>)

  const vars: Record<string, string> = {
    customerFirstName: String((cust as Record<string, unknown>).first_name || ''),
    customerName: `${(cust as Record<string, unknown>).first_name || ''} ${(cust as Record<string, unknown>).last_name || ''}`.trim(),
    vehicleReg: String((veh as Record<string, unknown>).registration || ''),
    vehicleMakeModel: [(veh as Record<string, unknown>).make, (veh as Record<string, unknown>).model].filter(Boolean).join(' '),
    dealershipName: branding.organizationName || '',
    dealershipPhone: branding.phone || '',
    followUpUrl,
    deferredTotal: gbp(c.deferred_value_snapshot),
    itemCount: String(c.item_count || 0),
    dueDate: c.anchor_date ? fmtDate(c.anchor_date) : '',
  }

  return {
    vars,
    items: (caseItems || []) as CaseItemSnapshot[],
    customer: {
      mobile: (cust as Record<string, unknown>).mobile as string | null,
      email: (cust as Record<string, unknown>).email as string | null,
      contact_opt_out: Boolean((cust as Record<string, unknown>).contact_opt_out),
    },
    branding,
  }
}

// ---------------------------------------------------------------------------
// Execute one timeline step for a case
// ---------------------------------------------------------------------------

async function executeStep(c: CaseRow, step: TimelineStep, allSteps: TimelineStep[], timeline: Timeline): Promise<void> {
  const org = c.organization_id
  const now = new Date().toISOString()
  const dryRun = followUpDryRun()

  // Manual call — park the case for a human
  if (step.action === 'manual_call') {
    await supabaseAdmin
      .from('follow_up_cases')
      .update({ current_step_order: step.step_order, status: 'manual', next_action_at: now, updated_at: now })
      .eq('id', c.id)
      .lt('current_step_order', step.step_order)
    await logEvent(c.id, org, 'status_change', {
      stepOrder: step.step_order,
      body: 'Reached manual call stage — awaiting human follow-up',
      metadata: { to: 'manual' },
    })
    return
  }

  // Auto close
  if (step.action === 'auto_close') {
    await closeCase(c, { outcomeId: step.default_outcome_id, note: 'Auto-closed by timeline', stepOrder: step.step_order })
    return
  }

  // Send step — build context once
  const ctx = await buildContext(c)
  if (!ctx) {
    logger.warn('Follow-up: could not build context, skipping step', { caseId: c.id })
    return
  }
  let contacted = false

  const wantSms = step.action === 'send_sms' || step.action === 'send_both'
  const wantEmail = step.action === 'send_email' || step.action === 'send_both'

  if (wantSms) {
    if (ctx.customer.contact_opt_out) {
      await logEvent(c.id, org, 'system', { stepOrder: step.step_order, body: 'SMS suppressed — customer opted out' })
    } else if (!ctx.customer.mobile) {
      await logEvent(c.id, org, 'system', { stepOrder: step.step_order, body: 'SMS skipped — no mobile on file' })
    } else {
      const body = render(step.sms_body, ctx.vars)
      if (dryRun) {
        await logEvent(c.id, org, 'step_sent', {
          channel: 'sms', stepOrder: step.step_order, body,
          metadata: { success: true, dryRun: true, wouldSendTo: ctx.customer.mobile },
        })
        contacted = true
      } else {
        const res = await sendSms(ctx.customer.mobile, body, org)
        await logComm(c.health_check_id, org, 'sms', ctx.customer.mobile, null, body, res)
        await logEvent(c.id, org, 'step_sent', { channel: 'sms', stepOrder: step.step_order, body, metadata: { success: res.success, error: res.error } })
        if (res.success) contacted = true
      }
    }
  }

  if (wantEmail) {
    if (ctx.customer.contact_opt_out) {
      await logEvent(c.id, org, 'system', { stepOrder: step.step_order, body: 'Email suppressed — customer opted out' })
    } else if (!ctx.customer.email) {
      await logEvent(c.id, org, 'system', { stepOrder: step.step_order, body: 'Email skipped — no email on file' })
    } else {
      const subject = render(step.email_subject || 'Your vehicle has work due', ctx.vars)
      const { html, text } = buildEmail(step.email_body || '', ctx.vars, ctx.items, ctx.branding)
      if (dryRun) {
        await logEvent(c.id, org, 'step_sent', {
          channel: 'email', stepOrder: step.step_order, body: subject,
          metadata: { success: true, dryRun: true, wouldSendTo: ctx.customer.email, preview: text, htmlBytes: html.length },
        })
        contacted = true
      } else {
        const res = await sendEmail({ to: ctx.customer.email, subject, html, text, organizationId: org })
        await logComm(c.health_check_id, org, 'email', ctx.customer.email, subject, text, res)
        await logEvent(c.id, org, 'step_sent', { channel: 'email', stepOrder: step.step_order, body: subject, metadata: { success: res.success, error: res.error } })
        if (res.success) contacted = true
      }
    }
  }

  // Advance to the next step
  const nextStep = allSteps.find((s) => s.step_order > step.step_order)
  const nextActionAt = nextStep
    ? computeStepDate(timeline.anchor, nextStep, c.anchor_date ? new Date(c.anchor_date) : null, new Date(c.created_at), timeline.minOffset).toISOString()
    : null

  await supabaseAdmin
    .from('follow_up_cases')
    .update({
      current_step_order: step.step_order,
      next_action_at: nextActionAt,
      last_contacted_at: contacted ? now : c.last_contacted_at,
      status: nextStep ? 'active' : 'manual', // no more steps → park for human
      updated_at: now,
    })
    .eq('id', c.id)
    .lt('current_step_order', step.step_order)
}

// ---------------------------------------------------------------------------
// Process one due case
// ---------------------------------------------------------------------------

async function processCase(c: CaseRow, tlCache: Map<string, Timeline | null>): Promise<void> {
  const org = c.organization_id

  // 1. Resolution check — are any snapshot items still deferred?
  const { data: caseItems } = await supabaseAdmin
    .from('follow_up_case_items')
    .select('repair_item_id')
    .eq('case_id', c.id)
  const itemIds = (caseItems || []).map((ci) => ci.repair_item_id)
  if (itemIds.length > 0) {
    const { data: stillDeferred } = await supabaseAdmin
      .from('repair_items')
      .select('id')
      .in('id', itemIds)
      .eq('outcome_status', 'deferred')
      .is('deleted_at', null)
    if (!stillDeferred || stillDeferred.length === 0) {
      await closeCase(c, { outcomeId: null, note: 'Auto-closed — deferred items resolved elsewhere' })
      return
    }
  }

  // 2. DMS booking pre-check
  const booking = await findFutureBooking(org, c.customer_id, c.vehicle_id)
  if (booking) {
    const nowIso = new Date().toISOString()
    await supabaseAdmin
      .from('follow_up_cases')
      .update({ status: 'booking_found', linked_booking_id: booking.id, next_action_at: nowIso, updated_at: nowIso })
      .eq('id', c.id)
    await logEvent(c.id, org, 'booking_found', {
      channel: 'system',
      body: `Existing booking found for ${fmtDate(booking.due_date)} — paused for confirmation`,
      metadata: { bookingId: booking.id, dueDate: booking.due_date, bookedRepairs: booking.booked_repairs },
    })
    return
  }

  // 3. Execute the next due step
  if (!c.timeline_id) {
    await supabaseAdmin.from('follow_up_cases').update({ status: 'manual', updated_at: new Date().toISOString() }).eq('id', c.id)
    return
  }
  const timeline = await loadTimeline(c.timeline_id, tlCache)
  if (!timeline) {
    await supabaseAdmin.from('follow_up_cases').update({ status: 'manual', updated_at: new Date().toISOString() }).eq('id', c.id)
    await logEvent(c.id, org, 'system', { body: 'Timeline missing/empty — parked for manual follow-up' })
    return
  }

  const next = timeline.steps.find((s) => s.step_order > (c.current_step_order || 0))
  if (!next) {
    // Exhausted — park for human
    await supabaseAdmin
      .from('follow_up_cases')
      .update({ status: 'manual', next_action_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', c.id)
    await logEvent(c.id, org, 'status_change', { body: 'Timeline complete — awaiting manual follow-up', metadata: { to: 'manual' } })
    return
  }

  const schedDate = computeStepDate(timeline.anchor, next, c.anchor_date ? new Date(c.anchor_date) : null, new Date(c.created_at), timeline.minOffset)
  if (schedDate > todayStart()) {
    // Not actually due yet — correct next_action_at and move on
    await supabaseAdmin.from('follow_up_cases').update({ next_action_at: schedDate.toISOString() }).eq('id', c.id)
    return
  }

  await executeStep(c, next, timeline.steps, timeline)
}

async function processDueCasesForOrg(organizationId: string): Promise<number> {
  const nowIso = new Date().toISOString()
  const { data: cases, error } = await supabaseAdmin
    .from('follow_up_cases')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .lte('next_action_at', nowIso)
    .order('next_action_at', { ascending: true })
    .limit(MAX_DUE_CASES)
  if (error) {
    logger.error('Follow-up: failed to load due cases', { error: error.message, organizationId })
    return 0
  }
  if (!cases || cases.length === 0) return 0
  if (cases.length >= MAX_DUE_CASES) {
    logger.warn('Follow-up: due-case batch hit cap', { organizationId, cap: MAX_DUE_CASES })
  }

  const tlCache = new Map<string, Timeline | null>()
  let processed = 0
  for (const c of cases as CaseRow[]) {
    try {
      await processCase(c, tlCache)
      processed++
    } catch (e) {
      logger.error('Follow-up: error processing case', { caseId: c.id, error: String(e) })
    }
  }
  return processed
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function runFollowUpSweep(organizationId?: string): Promise<{ orgsProcessed: number; casesCreated: number; casesProcessed: number; dryRun: boolean }> {
  const dryRun = followUpDryRun()
  if (dryRun) logger.warn('Follow-up sweep running in DRY-RUN mode — no SMS/email will be sent (FOLLOW_UP_DRY_RUN)')
  let orgIds: string[]
  if (organizationId) {
    orgIds = [organizationId]
  } else {
    const { data } = await supabaseAdmin.from('organizations').select('id')
    orgIds = (data || []).map((o) => o.id)
  }

  let casesCreated = 0
  let casesProcessed = 0
  for (const orgId of orgIds) {
    try {
      casesCreated += await createCasesForOrg(orgId)
      casesProcessed += await processDueCasesForOrg(orgId)
    } catch (e) {
      logger.error('Follow-up: sweep failed for org', { organizationId: orgId, error: String(e) })
    }
  }
  logger.info('Follow-up sweep complete', { orgs: orgIds.length, casesCreated, casesProcessed, dryRun })
  return { orgsProcessed: orgIds.length, casesCreated, casesProcessed, dryRun }
}

/**
 * Called from the inbound-SMS pipeline. Pauses active cadences when a customer
 * replies, and honours STOP opt-out keywords.
 */
export async function handleInboundSmsForFollowUps(params: {
  organizationId: string | null
  customerId: string | null
  healthCheckId: string | null
  body: string
  messageId: string
}): Promise<void> {
  const { organizationId, customerId, body, messageId } = params
  if (!organizationId) return

  // STOP / opt-out keywords
  const kw = body.trim().toUpperCase()
  const stopWords = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']
  if (customerId && stopWords.includes(kw)) {
    await supabaseAdmin
      .from('customers')
      .update({ contact_opt_out: true, opt_out_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('organization_id', organizationId)
    logger.info('Follow-up: customer opted out via SMS STOP', { customerId })
  }

  if (!customerId) return

  // Pause active cadences for this customer
  const { data: cases } = await supabaseAdmin
    .from('follow_up_cases')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .in('status', ['active', 'booking_found'])
  for (const c of cases || []) {
    const now = new Date().toISOString()
    await supabaseAdmin.from('follow_up_cases').update({ status: 'engaged', next_action_at: now, updated_at: now }).eq('id', c.id)
    await logEvent(c.id, organizationId, 'sms_in', { channel: 'sms', body, metadata: { messageId } })
  }
}
