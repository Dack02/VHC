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
    .select('id, clock_in_at')
    .eq('organization_id', organizationId)
    .is('clock_out_at', null)

  if (error || !openEntries || openEntries.length === 0) {
    return { closed: 0 }
  }

  const nowMs = Date.now()

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
  }

  // P5 (TECH_JOB_MODEL.md §8.5): the segment ledger is the sole source of job time
  // now — board/efficiency/mobile all sum the (jobsheet-keyed) segments directly, so
  // the old denormalised health_checks.total_tech_time_minutes / active_time_entry_id
  // cache is no longer recomputed here. Columns are left in place (additive-safe).

  return { closed: openEntries.length }
}
