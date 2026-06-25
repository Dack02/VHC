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
import { sendSms, formatPhoneNumber } from './sms.js'
import { sendEmail, getOrganizationBranding } from './email.js'
import { getSmsCredentials } from './credentials.js'
import { emitToOrganization, emitToHealthCheck, WS_EVENTS } from './websocket.js'
import { gbp, fmtDate, startOfDay, addDays, todayStart, calendarDate, dateStr, chunk, render, followUpDryRun } from './follow-up-utils.js'
import { buildEmail, type CaseItemSnapshot } from './follow-up-email.js'
import { getFollowUpSettings, withinSendWindow, nowInOrgTz, type FollowUpSettings } from './follow-up-settings.js'
import { persistBookingVerdict, isConfidentlyRelated, type BookingMatchVerdict } from './booking-match.js'

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const CHUNK = 100
const MAX_DEFERRED_SCAN = 5000   // safety cap per org per sweep (logged if hit)
const MAX_DUE_CASES = 1000

// Staleness guard: a customer-facing send step that ends up this many days past
// its own scheduled date is never sent (e.g. the org ran with automation off for
// weeks) — the case is parked for a manual call instead of firing a stale
// reminder. Overridable per-deployment; default 40 days. manual_call / auto_close
// steps are exempt (they don't send).
const STALE_SEND_DAYS = Math.max(1, parseInt(process.env.FOLLOW_UP_STALE_SEND_DAYS || '40', 10))

// Pure helpers (gbp/date math/render/dry-run) → ./follow-up-utils.ts

// Per-org settings + send-window / quiet-hours logic → ./follow-up-settings.ts
// (FollowUpSettings, getFollowUpSettings, withinSendWindow, nowInOrgTz).

// Fallback sample templates for the "test send" preview, used when the org has no
// default timeline yet. Mirror the seeded "Standard recovery" cadence.
const SAMPLE_SMS =
  'Hi {{customerFirstName}}, a reminder from {{dealershipName}}: your {{vehicleReg}} has work due soon (approx {{deferredTotal}}). View details & book: {{followUpUrl}}'
const SAMPLE_EMAIL_SUBJECT = 'Work due soon on your {{vehicleReg}} — {{dealershipName}}'
const SAMPLE_EMAIL_BODY =
  'Hi {{customerFirstName}},\n\n' +
  'During your recent visit we identified work on your {{vehicleMakeModel}} ({{vehicleReg}}) that was deferred. It is now coming due.\n\n' +
  '{{deferredItemsTable}}\n\n' +
  'Estimated total: {{deferredTotal}}\n\n' +
  'To book or ask a question, view the full details here: {{followUpUrl}}\n\n' +
  'Kind regards,\n{{dealershipName}}\n{{dealershipPhone}}'

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
  dismissed_booking_ids?: string[] | null
}

// CaseItemSnapshot (the email item shape) is defined in ./follow-up-email.ts.

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
  // Richer content used by the relatedness matcher (booking-match.ts).
  booked_service_type?: string | null
  is_mot_booking?: boolean | null
  notes?: string | null
  estimated_hours?: number | null
  jobsheet_number?: string | null
}

export async function findFutureBooking(
  organizationId: string,
  customerId: string | null,
  vehicleId: string | null,
  excludeBookingIds: string[] = []
): Promise<FutureBooking | null> {
  if (!customerId || !vehicleId) return null
  const todayStr = todayStart().toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('health_checks')
    .select('id, due_date, promise_time, booked_repairs, booked_service_type, is_mot_booking, notes, estimated_hours, jobsheet_number')
    .eq('organization_id', organizationId)
    .eq('customer_id', customerId)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'awaiting_arrival')
    .eq('external_source', 'gemini_osi')
    .gte('due_date', todayStr)
    .is('deleted_at', null)
    .order('due_date', { ascending: true })
    .limit(10)
  if (error) {
    logger.error('Booking pre-check failed', { error: error.message, organizationId })
    return null
  }
  const rows = (data || []) as FutureBooking[]
  // Skip bookings an advisor already flagged as NOT related to this case, so the
  // sweep doesn't re-pause on the same unrelated booking.
  const usable = excludeBookingIds.length ? rows.filter((r) => !excludeBookingIds.includes(r.id)) : rows
  return usable[0] || null
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
    // Calendar-date math in UTC so the scheduled day matches the anchor exactly,
    // independent of the server's timezone.
    return new Date(Date.UTC(
      anchorDate.getUTCFullYear(),
      anchorDate.getUTCMonth(),
      anchorDate.getUTCDate() + step.offset_days
    ))
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

// Branded customer email rendering → ./follow-up-email.ts
// (exports buildEmail; owns the items table + the ITEMS_MARKER sentinel).

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
  return d ? calendarDate(d) : null
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
        anchor_date: anchorDate ? dateStr(anchorDate) : null,
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
      metadata: { healthCheckId: hc.id, anchorDate: anchorDate ? dateStr(anchorDate) : null },
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

/**
 * Mirror a successfully-sent follow-up SMS into the two-way conversation store
 * (sms_messages) and emit the same socket event the rest of the app uses, so the
 * automated reminder shows up in the customer conversation (Follow-Up modal +
 * Messages page) — not just the activity log. Best-effort: failures are logged,
 * never thrown, so they can't break the sweep.
 */
async function recordOutboundSms(
  c: CaseRow,
  toMobile: string,
  body: string,
  res: { success: boolean; messageId?: string; from?: string }
): Promise<void> {
  try {
    const toNumber = formatPhoneNumber(toMobile)
    let fromNumber = res.from || ''
    if (!fromNumber) {
      const creds = await getSmsCredentials(c.organization_id)
      if (creds.credentials) fromNumber = creds.credentials.phoneNumber
    }
    const { data: stored } = await supabaseAdmin
      .from('sms_messages')
      .insert({
        organization_id: c.organization_id,
        health_check_id: c.health_check_id,
        customer_id: c.customer_id,
        direction: 'outbound',
        from_number: fromNumber,
        to_number: toNumber,
        body,
        twilio_sid: res.messageId || null,
        twilio_status: 'sent',
        is_read: true,
        sent_by: null,
        metadata: { source: 'follow_up' },
      })
      .select()
      .single()

    const payload = {
      message: {
        id: stored?.id,
        direction: 'outbound',
        from_number: fromNumber,
        to_number: toNumber,
        body,
        twilio_sid: res.messageId || null,
        twilio_status: 'sent',
        is_read: true,
        sent_by: null,
        sender: null,
        created_at: stored?.created_at || new Date().toISOString(),
      },
    }
    emitToOrganization(c.organization_id, WS_EVENTS.SMS_SENT, payload)
    if (c.health_check_id) emitToHealthCheck(c.health_check_id, WS_EVENTS.SMS_SENT, payload)
  } catch (err) {
    logger.error('Failed to record follow-up SMS to conversation thread', {
      error: err instanceof Error ? err.message : String(err),
      caseId: c.id,
    })
  }
}

async function executeStep(c: CaseRow, step: TimelineStep, allSteps: TimelineStep[], timeline: Timeline, simulate = false): Promise<void> {
  const org = c.organization_id
  const now = new Date().toISOString()
  const dryRun = followUpDryRun() || simulate

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
        if (res.success) {
          contacted = true
          // Mirror the reminder into the two-way conversation thread.
          await recordOutboundSms(c, ctx.customer.mobile, body, res)
        }
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

/**
 * Stamp the durable outreach-attribution marker on a booking (health_check) so the
 * Booking Diary flags it and the outreach report credits recovered £ — even after
 * the case closes. First-attribution-wins: the `.is(null)` guard means a booking
 * already credited to another case is never reassigned. Only called when we KNOW the
 * booking is related — the matcher is confident (sweep) or an advisor confirmed it.
 */
export async function attributeBookingToFollowUp(
  bookingId: string,
  caseId: string,
  organizationId: string,
  attributedValue: number,
  nowIso: string = new Date().toISOString()
): Promise<void> {
  await supabaseAdmin
    .from('health_checks')
    .update({
      origin_source: 'follow_up',
      follow_up_case_id: caseId,
      follow_up_attributed_at: nowIso,
      follow_up_attributed_value: attributedValue,
      updated_at: nowIso,
    })
    .eq('id', bookingId)
    .eq('organization_id', organizationId)
    .is('follow_up_case_id', null)
}

// ---------------------------------------------------------------------------
// Process one due case
// ---------------------------------------------------------------------------

async function processCase(c: CaseRow, tlCache: Map<string, Timeline | null>, settings: FollowUpSettings): Promise<void> {
  const org = c.organization_id

  // 1. Resolution check — are any snapshot items still deferred?
  const { data: caseItems } = await supabaseAdmin
    .from('follow_up_case_items')
    .select('repair_item_id, name_snapshot, value_snapshot, rag_snapshot')
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

  // 2. DMS booking pre-check (skipping any booking the advisor flagged unrelated)
  const booking = await findFutureBooking(org, c.customer_id, c.vehicle_id, c.dismissed_booking_ids || [])
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
    // Score whether the booking actually includes the deferred work (deterministic
    // + Claude for the ambiguous middle) and cache the verdict on the case. Best-
    // effort: never let a matcher/AI failure break the sweep.
    let verdict: BookingMatchVerdict | null = null
    try {
      const deferredItems = (caseItems || []).map((ci) => ({
        name: ci.name_snapshot, value: ci.value_snapshot, rag: ci.rag_snapshot,
      }))
      verdict = await persistBookingVerdict(c.id, org, deferredItems, booking, { allowAI: true })
    } catch (e) {
      logger.warn('Follow-up: booking verdict failed', { caseId: c.id, error: String(e) })
    }
    // Outreach attribution is GATED on confidence: only auto-credit the booking to
    // the follow-up when the matcher is sure it includes the deferred work. Anything
    // ambiguous stays unattributed until an advisor manually confirms via "Confirm as
    // booked" (handled in the /close route). linked_booking_id (set above) is just the
    // case→booking pointer for the modal — it does NOT credit recovered £; this does.
    if (isConfidentlyRelated(verdict)) {
      await attributeBookingToFollowUp(booking.id, c.id, org, c.deferred_value_snapshot ?? 0, nowIso)
    }
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

  const isSendStep = next.action === 'send_sms' || next.action === 'send_email' || next.action === 'send_both'

  // Staleness guard — never fire a customer send that has run badly late (e.g.
  // the org had automation off for weeks). Park the case for a manual call
  // instead of blasting a stale reminder. Checked before the send-window gate
  // because parking is not a send. manual_call / auto_close are exempt above.
  if (isSendStep) {
    const daysLate = Math.floor((todayStart().getTime() - schedDate.getTime()) / 86_400_000)
    if (daysLate >= STALE_SEND_DAYS) {
      const nowIso = new Date().toISOString()
      await supabaseAdmin
        .from('follow_up_cases')
        .update({ status: 'manual', next_action_at: nowIso, updated_at: nowIso })
        .eq('id', c.id)
      await logEvent(c.id, org, 'status_change', {
        channel: 'system',
        stepOrder: next.step_order,
        body: `Reminder was ${daysLate} days overdue — parked for a manual call instead of sending a stale message`,
        metadata: { to: 'manual', reason: 'stale_send', daysLate, action: next.action, threshold: STALE_SEND_DAYS },
      })
      return
    }
  }

  // Quiet hours — only gate customer-facing send steps. Leave the case due (no
  // state change, no log) so a later tick inside the window dispatches it.
  // manual_call / auto_close steps advance any time.
  if (isSendStep && !withinSendWindow(settings)) return

  await executeStep(c, next, timeline.steps, timeline, settings.simulationMode)
}

async function processDueCasesForOrg(organizationId: string, settings: FollowUpSettings): Promise<number> {
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
      await processCase(c, tlCache, settings)
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

export interface SweepResult {
  orgsProcessed: number
  orgsSwept: number
  casesCreated: number
  casesProcessed: number
  dryRun: boolean
  disabled: boolean
}

/**
 * Run the follow-up sweep.
 *
 * trigger 'scheduled' (default) is the recurring tick: it skips any org that is
 * disabled or has the automatic sweep turned off, and only runs the heavier
 * deferred-item scan once per org per local day. trigger 'manual' is the admin
 * "Run sweep now" action: it still requires the org to be enabled, but forces a
 * fresh case scan and ignores the automatic-sweep toggle.
 *
 * The send window / quiet hours and per-org simulation mode are applied inside
 * processCase regardless of trigger.
 */
export async function runFollowUpSweep(
  organizationId?: string,
  opts: { trigger?: 'scheduled' | 'manual' } = {}
): Promise<SweepResult> {
  const trigger = opts.trigger ?? 'scheduled'
  const globalDryRun = followUpDryRun()
  if (globalDryRun) logger.warn('Follow-up sweep running in DRY-RUN mode — no SMS/email will be sent (FOLLOW_UP_DRY_RUN)')

  let orgIds: string[]
  if (organizationId) {
    orgIds = [organizationId]
  } else {
    const { data } = await supabaseAdmin.from('organizations').select('id')
    orgIds = (data || []).map((o) => o.id)
  }

  let orgsSwept = 0
  let casesCreated = 0
  let casesProcessed = 0
  let anySimulation = false

  for (const orgId of orgIds) {
    try {
      const settings = await getFollowUpSettings(orgId)
      if (!settings.enabled) continue // opt-in: skip disabled orgs entirely
      if (trigger === 'scheduled' && !settings.autoSweepEnabled) continue // manual-only org
      if (settings.simulationMode) anySimulation = true
      orgsSwept++

      // Heavy deferred-item scan: once per org per local day on the schedule;
      // always on a manual run so a just-deferred item shows up immediately.
      const { dateStr } = nowInOrgTz(settings.timezone)
      const shouldCreate = trigger === 'manual' || settings.lastCreatedOn !== dateStr
      if (shouldCreate) casesCreated += await createCasesForOrg(orgId)

      casesProcessed += await processDueCasesForOrg(orgId, settings)

      const upd: Record<string, unknown> = { follow_up_last_swept_at: new Date().toISOString() }
      if (shouldCreate) upd.follow_up_last_created_on = dateStr
      await supabaseAdmin.from('organization_settings').update(upd).eq('organization_id', orgId)
    } catch (e) {
      logger.error('Follow-up: sweep failed for org', { organizationId: orgId, error: String(e) })
    }
  }

  const dryRun = globalDryRun || anySimulation
  if (orgsSwept > 0) logger.info('Follow-up sweep complete', { trigger, orgs: orgIds.length, orgsSwept, casesCreated, casesProcessed, dryRun })
  return {
    orgsProcessed: orgIds.length,
    orgsSwept,
    casesCreated,
    casesProcessed,
    dryRun,
    disabled: trigger === 'manual' && orgIds.length === 1 && orgsSwept === 0,
  }
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

/**
 * Render a representative follow-up message for the "test send" feature. Uses the
 * org's default-timeline templates (so what you preview is what customers get),
 * falling back to the seeded sample copy if no default timeline exists yet. The
 * content is filled with obvious sample data and a placeholder link.
 */
export async function renderFollowUpSample(
  organizationId: string,
  channel: 'sms' | 'email'
): Promise<{ sms?: string; subject?: string; html?: string; text?: string }> {
  // Pull the first SMS- and email-bearing steps from the active default timeline.
  let smsTpl: string | null = null
  let emailSubjectTpl: string | null = null
  let emailBodyTpl: string | null = null

  const { data: tlRow } = await supabaseAdmin
    .from('follow_up_timelines')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_default', true)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (tlRow) {
    const { data: steps } = await supabaseAdmin
      .from('follow_up_timeline_steps')
      .select('action, sms_body, email_subject, email_body, step_order')
      .eq('timeline_id', tlRow.id)
      .order('step_order', { ascending: true })
    for (const st of (steps || []) as TimelineStep[]) {
      if (!smsTpl && (st.action === 'send_sms' || st.action === 'send_both') && st.sms_body) smsTpl = st.sms_body
      if (!emailBodyTpl && (st.action === 'send_email' || st.action === 'send_both') && st.email_body) {
        emailBodyTpl = st.email_body
        emailSubjectTpl = st.email_subject
      }
    }
  }

  return renderFollowUpSampleFromTemplates(organizationId, channel, {
    smsBody: smsTpl,
    emailSubject: emailSubjectTpl,
    emailBody: emailBodyTpl,
  })
}

/**
 * Render a sample of an explicit set of templates with the org's branding and
 * sample data. Used by the timeline editor's live email preview + per-timeline
 * test send, so the preview reflects the step the admin is editing (including
 * unsaved edits). Falls back to the seeded sample copy when a template is blank.
 */
export async function renderFollowUpSampleFromTemplates(
  organizationId: string,
  channel: 'sms' | 'email',
  templates: { smsBody?: string | null; emailSubject?: string | null; emailBody?: string | null }
): Promise<{ sms?: string; subject?: string; html?: string; text?: string }> {
  const branding = await getOrganizationBranding(organizationId)
  const base = process.env.PUBLIC_APP_URL || 'http://localhost:5183'
  const sampleDue = fmtDate(addDays(new Date(), 21))
  const vars: Record<string, string> = {
    customerFirstName: 'Alex',
    customerName: 'Alex Sample',
    vehicleReg: 'AB12 CDE',
    vehicleMakeModel: 'Ford Focus',
    dealershipName: branding.organizationName || 'Your dealership',
    dealershipPhone: branding.phone || '',
    followUpUrl: `${base}/view/sample`,
    deferredTotal: gbp(480),
    itemCount: '3',
    dueDate: sampleDue,
  }

  if (channel === 'sms') {
    return { sms: render(templates.smsBody || SAMPLE_SMS, vars) }
  }

  const sampleItems: CaseItemSnapshot[] = [
    { name_snapshot: 'Front brake pads & discs', value_snapshot: 320, due_date_snapshot: addDays(new Date(), 21).toISOString().slice(0, 10) },
    { name_snapshot: 'Air filter', value_snapshot: 45, due_date_snapshot: null },
    { name_snapshot: 'Wiper blades (pair)', value_snapshot: 115, due_date_snapshot: null },
  ]
  const subject = render(templates.emailSubject || SAMPLE_EMAIL_SUBJECT, vars)
  const { html, text } = buildEmail(templates.emailBody || SAMPLE_EMAIL_BODY, vars, sampleItems, branding)
  return { subject, html, text }
}
