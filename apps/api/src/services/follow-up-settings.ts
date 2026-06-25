/**
 * Follow-Up engine — per-org settings + send window.
 *
 * Reads the follow_up_* columns on organization_settings (gating the sweep,
 * simulation mode and the send window / quiet hours) and decides whether "now"
 * is inside the org's send window. Defaults are opt-in: an org with no settings
 * row (or follow_up_enabled = false) is treated as disabled. Extracted from
 * follow-up-engine.ts.
 */

import { supabaseAdmin } from '../lib/supabase.js'

export interface FollowUpSettings {
  enabled: boolean
  autoSweepEnabled: boolean
  simulationMode: boolean
  sendWindowEnabled: boolean
  sendWindowStart: string // 'HH:MM'
  sendWindowEnd: string // 'HH:MM'
  skipWeekends: boolean
  timezone: string
  lastCreatedOn: string | null // 'YYYY-MM-DD' (org-local)
}

export async function getFollowUpSettings(organizationId: string): Promise<FollowUpSettings> {
  const { data } = await supabaseAdmin
    .from('organization_settings')
    .select(
      'follow_up_enabled, follow_up_auto_sweep_enabled, follow_up_simulation_mode, follow_up_send_window_enabled, follow_up_send_window_start, follow_up_send_window_end, follow_up_skip_weekends, follow_up_last_created_on, timezone'
    )
    .eq('organization_id', organizationId)
    .maybeSingle()
  return {
    enabled: data?.follow_up_enabled === true,
    autoSweepEnabled: data?.follow_up_auto_sweep_enabled !== false,
    simulationMode: data?.follow_up_simulation_mode === true,
    sendWindowEnabled: data?.follow_up_send_window_enabled === true,
    sendWindowStart: data?.follow_up_send_window_start || '08:00',
    sendWindowEnd: data?.follow_up_send_window_end || '18:00',
    skipWeekends: data?.follow_up_skip_weekends === true,
    timezone: data?.timezone || 'Europe/London',
    lastCreatedOn: data?.follow_up_last_created_on || null,
  }
}

function hmToMinutes(hm: string): number {
  const [h, m] = (hm || '').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Current org-local date (YYYY-MM-DD), minutes-since-midnight, and weekday (0=Sun..6=Sat). */
export function nowInOrgTz(tz: string): { dateStr: string; minutes: number; weekday: number } {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz })
  const hm = now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
  const wd = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { dateStr, minutes: hmToMinutes(hm), weekday: wdMap[wd] ?? 0 }
}

/**
 * Is "now" inside the org's configured send window? Customer-facing SMS/email is
 * only dispatched when this is true; out-of-window cases are left due and picked
 * up on a later tick once the window opens. A misconfigured window (start >= end)
 * is treated as always-open so a typo can't silently halt all follow-ups.
 */
export function withinSendWindow(s: FollowUpSettings): boolean {
  if (!s.sendWindowEnabled) return true
  const { minutes, weekday } = nowInOrgTz(s.timezone)
  if (s.skipWeekends && (weekday === 0 || weekday === 6)) return false
  const start = hmToMinutes(s.sendWindowStart)
  const end = hmToMinutes(s.sendWindowEnd)
  if (start >= end) return true
  return minutes >= start && minutes < end
}
