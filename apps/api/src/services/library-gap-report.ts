/**
 * Library Gap Report Service
 *
 * Builds and sends the daily "Library Gap" digest: red/amber inspection findings
 * where a technician typed free text instead of picking a Reason Library entry,
 * plus any custom reasons submitted for manager review. Grouped by technician so
 * a workshop manager can spot new library entries and coach the team.
 *
 * Covers the previous calendar day in the organisation's timezone. Sent in-process
 * by the scheduler (see scheduler.ts) so it works without the BullMQ worker, which
 * does not run in production.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { sendEmail, getOrganizationBranding, type OrganizationBranding } from './email.js'

const WEB_URL = process.env.WEB_URL || 'https://vhc.ollosoft.co.uk'
const PAGE_SIZE = 1000

type Rag = 'red' | 'amber'

export interface LibraryGapEntry {
  kind: 'free_text' | 'submission'
  itemName: string
  rag: Rag | null
  registration: string | null
  jobNumber: string | null
  reasonText: string | null
  notes: string | null
}

export interface LibraryGapTechnicianGroup {
  technicianId: string
  technicianName: string
  entries: LibraryGapEntry[]
}

export interface LibraryGapReportData {
  dateLabel: string
  groups: LibraryGapTechnicianGroup[]
  freeTextCount: number
  submissionCount: number
  technicianCount: number
}

export interface LibraryGapSendResult {
  sent: number
  recipientCount: number
  skipped: boolean
  reason?: 'no_entries' | 'no_recipients'
  freeTextCount: number
  submissionCount: number
}

// --- timezone helpers (mirror the BST/GMT handling in daily-sms-overview.ts) ---

function tzOffsetMs(date: Date, tz: string): number {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const local = new Date(date.toLocaleString('en-US', { timeZone: tz })).getTime()
  return local - utc
}

/** UTC instant of local midnight for the given YYYY-MM-DD date in tz. */
function localMidnightUtc(dateStr: string, tz: string): Date {
  const midnightUtc = new Date(`${dateStr}T00:00:00.000Z`)
  return new Date(midnightUtc.getTime() - tzOffsetMs(midnightUtc, tz))
}

/** Yesterday + today as YYYY-MM-DD strings in tz. */
function localDates(now: Date, tz: string): { todayStr: string; yesterdayStr: string } {
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz })
  const [y, m, d] = todayStr.split('-').map(Number)
  const yd = new Date(Date.UTC(y, m - 1, d))
  yd.setUTCDate(yd.getUTCDate() - 1)
  const yesterdayStr = `${yd.getUTCFullYear()}-${String(yd.getUTCMonth() + 1).padStart(2, '0')}-${String(yd.getUTCDate()).padStart(2, '0')}`
  return { todayStr, yesterdayStr }
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function relationOne<T = Record<string, unknown>>(rel: unknown): T | null {
  if (Array.isArray(rel)) return (rel[0] as T) ?? null
  return (rel as T) ?? null
}

async function getOrgTimezone(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select('timezone')
    .eq('organization_id', orgId)
    .maybeSingle()
  return (data?.timezone as string) || 'Europe/London'
}

/**
 * Build the report data for an organisation, covering the previous calendar day.
 */
export async function buildLibraryGapReportData(
  orgId: string,
  now: Date = new Date()
): Promise<LibraryGapReportData> {
  const tz = await getOrgTimezone(orgId)
  const { todayStr, yesterdayStr } = localDates(now, tz)
  const startIso = localMidnightUtc(yesterdayStr, tz).toISOString()
  const endIso = localMidnightUtc(todayStr, tz).toISOString()

  const groupsMap = new Map<string, LibraryGapEntry[]>()
  const userIds = new Set<string>()
  let freeTextCount = 0
  let submissionCount = 0

  // --- Section A: free text on red/amber items with NO library reason attached.
  // Matches the "free-text only" condition used by the leaderboard's Library %
  // (reports.ts): a check_result with notes/custom_reason_text but no linked
  // check_result_reasons row.
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const { data: rows, error } = await supabaseAdmin
      .from('check_results')
      .select(
        'id, notes, custom_reason_text, rag_status, checked_by, template_item:template_items(name), check_result_reasons(id), health_check:health_checks!inner(id, job_number, technician_id, organization_id, vehicle:vehicles(registration))'
      )
      .eq('health_check.organization_id', orgId)
      .in('rag_status', ['red', 'amber'])
      .gte('checked_at', startIso)
      .lt('checked_at', endIso)
      .order('checked_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('[Library Gap Report] check_results query error:', error)
      break
    }

    const list = rows || []
    for (const cr of list) {
      const reasons = cr.check_result_reasons as unknown[] | null
      const hasLibrary = Array.isArray(reasons) && reasons.length > 0
      if (hasLibrary) continue

      const custom = ((cr.custom_reason_text as string | null) || '').trim() || null
      const note = ((cr.notes as string | null) || '').trim() || null
      if (!custom && !note) continue

      const hc = relationOne(cr.health_check)
      const techId =
        (cr.checked_by as string | null) ||
        (hc?.technician_id as string | null) ||
        'unknown'
      if (techId !== 'unknown') userIds.add(techId)

      const item = relationOne(cr.template_item)
      const vehicle = hc ? relationOne(hc.vehicle) : null

      const entry: LibraryGapEntry = {
        kind: 'free_text',
        itemName: (item?.name as string) || 'Unknown item',
        rag: (cr.rag_status as Rag) || null,
        registration: (vehicle?.registration as string) || null,
        jobNumber: (hc?.job_number as string) || null,
        reasonText: custom,
        notes: note
      }
      if (!groupsMap.has(techId)) groupsMap.set(techId, [])
      groupsMap.get(techId)!.push(entry)
      freeTextCount++
    }

    hasMore = list.length === PAGE_SIZE
    offset += PAGE_SIZE
  }

  // --- Section B: custom reasons submitted for review yesterday (still pending).
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('reason_submissions')
    .select(
      'id, submitted_reason_text, submitted_notes, submitted_by, reason_type, template_item:template_items(name), health_check:health_checks(job_number, vehicle:vehicles(registration))'
    )
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .gte('submitted_at', startIso)
    .lt('submitted_at', endIso)

  if (subErr) {
    console.error('[Library Gap Report] reason_submissions query error:', subErr)
  } else {
    for (const s of subs || []) {
      const techId = (s.submitted_by as string | null) || 'unknown'
      if (techId !== 'unknown') userIds.add(techId)

      const item = relationOne(s.template_item)
      const hc = relationOne(s.health_check)
      const vehicle = hc ? relationOne(hc.vehicle) : null

      const entry: LibraryGapEntry = {
        kind: 'submission',
        itemName: (item?.name as string) || (s.reason_type as string) || 'General',
        rag: null,
        registration: (vehicle?.registration as string) || null,
        jobNumber: (hc?.job_number as string) || null,
        reasonText: ((s.submitted_reason_text as string | null) || '').trim() || null,
        notes: ((s.submitted_notes as string | null) || '').trim() || null
      }
      if (!groupsMap.has(techId)) groupsMap.set(techId, [])
      groupsMap.get(techId)!.push(entry)
      submissionCount++
    }
  }

  // --- resolve technician names ---
  const nameMap = new Map<string, string>()
  if (userIds.size > 0) {
    const { data: us } = await supabaseAdmin
      .from('users')
      .select('id, first_name, last_name')
      .in('id', Array.from(userIds))
    for (const u of us || []) {
      nameMap.set(
        u.id,
        `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown technician'
      )
    }
  }

  // red first, then amber, then submissions
  const rank = (e: LibraryGapEntry) => (e.kind === 'submission' ? 2 : e.rag === 'red' ? 0 : 1)
  const groups: LibraryGapTechnicianGroup[] = Array.from(groupsMap.entries())
    .map(([technicianId, entries]) => ({
      technicianId,
      technicianName: nameMap.get(technicianId) || 'Unknown technician',
      entries: entries.sort((a, b) => rank(a) - rank(b))
    }))
    .sort(
      (a, b) =>
        b.entries.length - a.entries.length || a.technicianName.localeCompare(b.technicianName)
    )

  return {
    dateLabel: formatDateLabel(yesterdayStr),
    groups,
    freeTextCount,
    submissionCount,
    technicianCount: groups.length
  }
}

// --- email rendering ---

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function ragPill(rag: Rag | null): string {
  if (rag === 'red')
    return '<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;">RED</span>'
  if (rag === 'amber')
    return '<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#d97706;color:#fff;font-size:11px;font-weight:700;">AMBER</span>'
  return ''
}

function entryHtml(e: LibraryGapEntry): string {
  const meta = [e.registration, e.jobNumber ? `Job ${e.jobNumber}` : null]
    .filter(Boolean)
    .map(v => esc(v as string))
    .join(' &middot; ')
  const badge =
    e.kind === 'submission'
      ? '<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:#ede9fe;color:#6d28d9;font-size:11px;font-weight:700;">SUBMITTED FOR REVIEW</span>'
      : ragPill(e.rag)
  const text: string[] = []
  if (e.reasonText)
    text.push(
      `<div style="margin-top:4px;color:#111827;font-size:13px;white-space:pre-wrap;">&ldquo;${esc(e.reasonText)}&rdquo;</div>`
    )
  if (e.notes)
    text.push(
      `<div style="margin-top:4px;color:#6b7280;font-size:12px;white-space:pre-wrap;">Notes: ${esc(e.notes)}</div>`
    )
  return `
    <div style="padding:12px 0;border-bottom:1px solid #f0f0f0;">
      <div>${badge}<span style="margin-left:8px;font-weight:600;color:#111827;font-size:13px;vertical-align:middle;">${esc(e.itemName)}</span></div>
      ${meta ? `<div style="margin-top:2px;color:#9ca3af;font-size:12px;">${meta}</div>` : ''}
      ${text.join('')}
    </div>`
}

export function buildLibraryGapEmailHtml(
  data: LibraryGapReportData,
  branding: OrganizationBranding
): string {
  const primary = branding.primaryColor || '#3B82F6'
  const orgName = branding.organizationName || 'Vehicle Health Check'
  const header = branding.logoUrl
    ? `<img src="${esc(branding.logoUrl)}" alt="${esc(orgName)}" style="max-height:40px;max-width:160px;">`
    : '<h1 style="color:#fff;margin:0;font-size:20px;">Library Gap Report</h1>'

  const submissionsUrl = `${WEB_URL}/settings/reason-submissions`
  const libraryUrl = `${WEB_URL}/settings/reasons`
  const empty = data.groups.length === 0

  const summary = empty
    ? '<p style="margin:0 0 8px;color:#16a34a;font-size:14px;">&#127881; Every red/amber finding yesterday used the Reason Library &mdash; nothing was typed manually.</p>'
    : `<p style="margin:0 0 8px;color:#374151;font-size:14px;"><strong>${data.freeTextCount}</strong> manual note${data.freeTextCount === 1 ? '' : 's'} from <strong>${data.technicianCount}</strong> technician${data.technicianCount === 1 ? '' : 's'}${data.submissionCount > 0 ? `, plus <strong>${data.submissionCount}</strong> submitted for review` : ''}.</p>`

  const groupsHtml = data.groups
    .map(
      g => `
    <div style="margin:0 0 20px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid #e5e7eb;">
        <span style="font-weight:700;color:#111827;font-size:14px;">${esc(g.technicianName)}</span><span style="color:#9ca3af;font-size:12px;"> &middot; ${g.entries.length} item${g.entries.length === 1 ? '' : 's'}</span>
      </div>
      <div style="padding:0 14px 4px;">
        ${g.entries.map(entryHtml).join('')}
      </div>
    </div>`
    )
    .join('')

  const cta = empty
    ? ''
    : `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 4px;">
      <tr><td style="text-align:center;">
        <a href="${submissionsUrl}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;padding:10px 18px;font-size:13px;font-weight:700;border-radius:6px;margin:4px;">Review submissions</a>
        <a href="${libraryUrl}" style="display:inline-block;background:#fff;color:${primary};border:1px solid ${primary};text-decoration:none;padding:10px 18px;font-size:13px;font-weight:700;border-radius:6px;margin:4px;">Open Reason Library</a>
      </td></tr>
    </table>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;">
  <table cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#fff;">
    <tr><td style="background:${primary};padding:20px;text-align:center;">${header}</td></tr>
    <tr><td style="padding:24px;">
      <p style="margin:0 0 4px;color:#111827;font-size:16px;font-weight:700;">Library Gap Report</p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">Manual notes &amp; submissions from ${esc(data.dateLabel)}</p>
      ${summary}
      ${empty ? '' : '<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">These red/amber findings were described in free text instead of using the Reason Library. Review them to add new library entries and coach the team.</p>'}
      ${groupsHtml}
      ${cta}
    </td></tr>
    <tr><td style="background:#f4f4f4;padding:16px;text-align:center;"><p style="margin:0;color:#666;font-size:12px;">${esc(orgName)} &middot; VHC</p></td></tr>
  </table>
</body></html>`
}

function buildLibraryGapText(data: LibraryGapReportData): string {
  if (data.groups.length === 0) {
    return `Library Gap Report - ${data.dateLabel}\n\nEvery red/amber finding used the Reason Library. Nothing was typed manually.`
  }
  const lines: string[] = [
    `Library Gap Report - ${data.dateLabel}`,
    '',
    `${data.freeTextCount} manual note(s) from ${data.technicianCount} technician(s)${data.submissionCount > 0 ? `, ${data.submissionCount} submitted for review` : ''}.`,
    ''
  ]
  for (const g of data.groups) {
    lines.push(`${g.technicianName} (${g.entries.length}):`)
    for (const e of g.entries) {
      const tag = e.kind === 'submission' ? '[SUBMITTED]' : `[${(e.rag || '').toUpperCase()}]`
      const meta = [e.registration, e.jobNumber ? `Job ${e.jobNumber}` : null].filter(Boolean).join(' / ')
      lines.push(`  ${tag} ${e.itemName}${meta ? ` (${meta})` : ''}`)
      if (e.reasonText) lines.push(`    "${e.reasonText}"`)
      if (e.notes) lines.push(`    Notes: ${e.notes}`)
    }
    lines.push('')
  }
  lines.push(`Review submissions: ${WEB_URL}/settings/reason-submissions`)
  lines.push(`Reason Library: ${WEB_URL}/settings/reasons`)
  return lines.join('\n')
}

/**
 * Build and send the Library Gap digest for an organisation.
 * Pass { force: true } to send even when there is nothing to report (used by the
 * "Send test" button); the scheduled path respects the skip-empty setting.
 */
export async function sendLibraryGapReport(
  orgId: string,
  opts: { force?: boolean } = {}
): Promise<LibraryGapSendResult> {
  console.log(`[Library Gap Report] Starting for org ${orgId}`)

  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('library_gap_report_skip_empty')
    .eq('organization_id', orgId)
    .maybeSingle()
  const skipEmpty = settings?.library_gap_report_skip_empty !== false

  const data = await buildLibraryGapReportData(orgId)
  const isEmpty = data.groups.length === 0

  if (isEmpty && skipEmpty && !opts.force) {
    console.log(`[Library Gap Report] Nothing to report for org ${orgId}, skipping`)
    return { sent: 0, recipientCount: 0, skipped: true, reason: 'no_entries', freeTextCount: 0, submissionCount: 0 }
  }

  // Resolve recipients (staff users use their current email so the list stays
  // in sync; free-form rows use the stored email).
  const { data: recipientRows } = await supabaseAdmin
    .from('library_gap_report_recipients')
    .select('id, name, email, user_id, is_active')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const recips = recipientRows || []
  const staffIds = recips.filter(r => r.user_id).map(r => r.user_id as string)
  const staffMap = new Map<string, { email: string; name: string; active: boolean }>()
  if (staffIds.length > 0) {
    const { data: us } = await supabaseAdmin
      .from('users')
      .select('id, email, first_name, last_name, is_active')
      .in('id', staffIds)
    for (const u of us || []) {
      staffMap.set(u.id, {
        email: u.email,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        active: u.is_active !== false
      })
    }
  }

  const finalRecipients: { email: string; name: string }[] = []
  const seen = new Set<string>()
  for (const r of recips) {
    let email = r.email as string
    let name = r.name as string
    if (r.user_id) {
      const u = staffMap.get(r.user_id as string)
      if (!u || !u.active) continue // staff member removed or deactivated
      email = u.email
      if (u.name) name = u.name
    }
    if (!email) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    finalRecipients.push({ email, name })
  }

  if (finalRecipients.length === 0) {
    console.log(`[Library Gap Report] No active recipients for org ${orgId}, skipping`)
    return {
      sent: 0,
      recipientCount: 0,
      skipped: true,
      reason: 'no_recipients',
      freeTextCount: data.freeTextCount,
      submissionCount: data.submissionCount
    }
  }

  const branding = await getOrganizationBranding(orgId)
  const html = buildLibraryGapEmailHtml(data, branding)
  const text = buildLibraryGapText(data)
  const subject = isEmpty
    ? `Library Gap Report - ${data.dateLabel} (nothing to report)`
    : `Library Gap Report - ${data.dateLabel} - ${data.freeTextCount} manual note${data.freeTextCount === 1 ? '' : 's'}`

  let sent = 0
  for (const r of finalRecipients) {
    try {
      const res = await sendEmail({ to: r.email, subject, html, text, organizationId: orgId })
      if (res.success) {
        sent++
        console.log(`[Library Gap Report] Sent to ${r.email}`)
      } else {
        console.error(`[Library Gap Report] Failed to send to ${r.email}: ${res.error}`)
      }
    } catch (err) {
      console.error(`[Library Gap Report] Error sending to ${r.email}:`, err)
    }
  }

  console.log(`[Library Gap Report] Completed for org ${orgId}: ${sent}/${finalRecipients.length} sent`)
  return {
    sent,
    recipientCount: finalRecipients.length,
    skipped: false,
    freeTextCount: data.freeTextCount,
    submissionCount: data.submissionCount
  }
}
