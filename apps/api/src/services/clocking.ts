import { supabaseAdmin } from '../lib/supabase.js'

/**
 * Shared technician-clocking helpers (TECH_JOB_MODEL.md §8). The jobsheet is the unit of
 * work, so a tech clocks the JOB; these helpers are used by both the legacy HC clock
 * endpoints and the new /jobsheets/:id/clock-* endpoints.
 */

/**
 * Close EVERY open time segment for a technician across the org — the §8.3 "one active
 * productive segment per technician" guard. Called at clock-in / clock-indirect so a tech
 * can never hold two concurrent timers across different jobs/VHCs/jobsheets (which would
 * double-count). Subsumes the older same-job stale-close and job-less break-close.
 */
export async function closeOpenSegmentsForTech(technicianId: string, orgId: string, reason = 'reclock'): Promise<void> {
  const { data: open } = await supabaseAdmin
    .from('technician_time_entries')
    .select('id, clock_in_at')
    .eq('technician_id', technicianId)
    .eq('organization_id', orgId)
    .is('clock_out_at', null)
  for (const seg of open || []) {
    const closeAt = new Date()
    await supabaseAdmin
      .from('technician_time_entries')
      .update({
        clock_out_at: closeAt.toISOString(),
        duration_minutes: Math.round((closeAt.getTime() - new Date(seg.clock_in_at as string).getTime()) / 60000),
        closed_reason: reason,
      })
      .eq('id', seg.id)
  }
}

/** Resolve an active time-entry category id by key for an org (null if missing/inactive). */
export async function resolveCategoryId(orgId: string, key: string | null): Promise<string | null> {
  if (!key) return null
  const { data } = await supabaseAdmin
    .from('time_entry_categories')
    .select('id')
    .eq('organization_id', orgId)
    .eq('key', key)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
}

export interface TimeSegmentRow {
  clock_in_at: string
  clock_out_at: string | null
  duration_minutes: number | null
  category?: { key?: string; label?: string; counts_toward_job?: boolean; is_health_check?: boolean } | null
}

/**
 * Per-segment job-time breakdown computed from the segments (the source of truth).
 * jobMinutes = all productive closed time; healthCheckMinutes is a labelled SUBSET of it
 * (the inspection slice); indirectMinutes = non-job-counting; plus the live open timer.
 */
export function computeTimeBreakdown(entries: TimeSegmentRow[]) {
  let jobMinutes = 0
  let healthCheckMinutes = 0
  let indirectMinutes = 0
  let activeClockInAt: string | null = null
  let activeCategory: { key: string; label: string } | null = null
  for (const e of entries) {
    const cat = e.category || null
    const productive = !cat || cat.counts_toward_job !== false
    const dur = e.duration_minutes || 0
    if (e.clock_out_at == null) {
      if (productive && !activeClockInAt) {
        activeClockInAt = e.clock_in_at
        activeCategory = cat ? { key: cat.key || '', label: cat.label || '' } : null
      }
    } else if (productive) {
      jobMinutes += dur
      if (cat?.is_health_check) healthCheckMinutes += dur
    } else {
      indirectMinutes += dur
    }
  }
  return { jobMinutes, healthCheckMinutes, indirectMinutes, activeClockInAt, activeCategory }
}
