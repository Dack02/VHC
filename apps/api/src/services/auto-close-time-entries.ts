/**
 * Auto-close stale technician time entries.
 *
 * A forgotten clock-off otherwise leaves a segment open forever, and the live
 * board timer keeps adding `now - clock_in_at` (the +407h incident). This runs
 * per-org at end of day: it closes every still-open segment, capping the
 * recorded duration at the org's `open_segment_stale_minutes`, and flags the
 * segment `auto_closed` for audit. See docs/technician-job-clocking-spec.md §5.3.
 */
import { supabaseAdmin } from '../lib/supabase.js'

export async function autoCloseStaleTimeEntries(
  organizationId: string
): Promise<{ closed: number }> {
  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('auto_close_at_eod, open_segment_stale_minutes')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (settings && settings.auto_close_at_eod === false) {
    return { closed: 0 }
  }
  const staleMinutes = (settings?.open_segment_stale_minutes as number) ?? 600

  const { data: openEntries, error } = await supabaseAdmin
    .from('technician_time_entries')
    .select('id, health_check_id, clock_in_at')
    .eq('organization_id', organizationId)
    .is('clock_out_at', null)

  if (error || !openEntries || openEntries.length === 0) {
    return { closed: 0 }
  }

  const nowMs = Date.now()
  const affectedHcIds = new Set<string>()

  for (const entry of openEntries) {
    const clockInMs = new Date(entry.clock_in_at as string).getTime()
    const elapsedMin = Math.max(0, Math.round((nowMs - clockInMs) / 60000))
    // Cap at site close: a same-day forgotten clock-off records up to now; an
    // entry left open across days is bounded so it can't record days of "work".
    const cappedMin = Math.min(elapsedMin, staleMinutes)
    const clockOutIso = new Date(clockInMs + cappedMin * 60000).toISOString()

    await supabaseAdmin
      .from('technician_time_entries')
      .update({
        clock_out_at: clockOutIso,
        duration_minutes: cappedMin,
        auto_closed: true,
        closed_reason: 'auto_eod'
      })
      .eq('id', entry.id)

    if (entry.health_check_id) affectedHcIds.add(entry.health_check_id as string)
  }

  // Recompute the denormalised job-time cache (productive segments only) for
  // each affected health check, and clear its active-entry pointer.
  for (const hcId of affectedHcIds) {
    const { data: entries } = await supabaseAdmin
      .from('technician_time_entries')
      .select('duration_minutes, category:time_entry_categories(counts_toward_job)')
      .eq('health_check_id', hcId)
      .not('clock_out_at', 'is', null)

    const total = (entries || []).reduce((sum, e) => {
      const cat = e.category as { counts_toward_job?: boolean } | null
      if (cat && cat.counts_toward_job === false) return sum
      return sum + ((e.duration_minutes as number) || 0)
    }, 0)

    await supabaseAdmin
      .from('health_checks')
      .update({ total_tech_time_minutes: total, active_time_entry_id: null })
      .eq('id', hcId)
  }

  return { closed: openEntries.length }
}
