/**
 * Follow-Up engine — shared pure helpers.
 *
 * Currency/date formatting, calendar-date math, HTML escaping, template
 * rendering and the dry-run guard. Extracted from follow-up-engine.ts to keep
 * the engine focused on the cadence state machine. No DB or domain logic here.
 */

import { suppressAutomatedComms } from '../lib/comms-guard.js'

export function gbp(n: unknown): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0)
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function todayStart(): Date {
  return startOfDay(new Date())
}

// Treat a date-only "due"/"deferral" value as a plain calendar date pinned to UTC
// midnight. Date-only strings ('2026-06-25') parse as UTC midnight, but snapping
// them to *local* midnight and re-serialising via toISOString() rolled the date
// back a day whenever the process ran ahead of UTC (e.g. UK summer time) — the
// anchor_date drift bug. Working in UTC keeps a calendar date stable regardless
// of the server timezone.
export function calendarDate(d: string | Date): Date {
  const dt = new Date(d)
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}

// Serialise a Date to a plain 'YYYY-MM-DD' calendar string (UTC).
export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function render(tpl: string | null | undefined, vars: Record<string, string>): string {
  if (!tpl) return ''
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/**
 * Dry-run guard. When FOLLOW_UP_DRY_RUN is truthy, the engine renders and logs
 * every SMS/email step (so you can preview exactly what would go out and watch
 * the timeline advance) but never calls sendSms/sendEmail. Default OFF, so
 * production behaviour is unchanged. Intended for safe testing on dev.
 */
export function followUpDryRun(): boolean {
  // The master automated-comms suppression switch also forces follow-up dry-run.
  if (suppressAutomatedComms()) return true
  const v = (process.env.FOLLOW_UP_DRY_RUN || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
}
