import { supabaseAdmin } from '../lib/supabase.js'
import { getEffectiveModules } from './modules.js'

interface SpawnShellParams {
  orgId: string
  siteId: string | null
  customerId: string | null
  vehicleId: string | null
  advisorId?: string | null
  /** The VHC's due date (date or ISO timestamp). Falls back to today for the shell's NOT-NULL due_in_date. */
  dueDate?: string | null
  healthCheckId: string
}

/**
 * Spawn a hidden shell jobsheet for a standalone VHC and link the VHC to it
 * (TECH_JOB_MODEL.md §5), so "every VHC has a jobsheet" holds going forward.
 *
 * Best-effort: any failure leaves the VHC standalone (jobsheet_id NULL) and is
 * logged, never thrown — a shell failure must never abort VHC creation. Returns
 * the shell id, or null on failure.
 *
 * Runs both in an HTTP route (health-checks/crud.ts) and a BullMQ worker
 * (jobs/dms-import.ts), so it takes explicit orgId/userId — it never reads request
 * auth context.
 */
export async function spawnShellJobsheetForVhc(params: SpawnShellParams): Promise<string | null> {
  const { orgId, siteId, customerId, vehicleId, advisorId, dueDate, healthCheckId } = params
  try {
    // Only GMS orgs get shells. For a VHC-only org (jobsheets module off) the shell would
    // be unreachable — the jobsheet UI + clock/work-done endpoints are all module-gated — and
    // worse, stamping health_checks.jobsheet_id would make the web jobPath() route the VHC to
    // the module-gated /jobsheets/:id page, leaving the VHC unopenable. VHC-only orgs stay
    // VHC-anchored (jobsheet_id NULL), which every consumer already tolerates.
    const mods = await getEffectiveModules(orgId)
    if (!mods.jobsheets) return null

    // jobsheets.due_in_date is NOT NULL with no default — derive from the VHC's due
    // date (date-only slice), else today. Both org_id and due_in_date are required.
    const dueInDate = (typeof dueDate === 'string' && dueDate)
      ? dueDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const { data: shell, error } = await supabaseAdmin
      .from('jobsheets')
      .insert({
        organization_id: orgId,
        site_id: siteId ?? null,
        customer_id: customerId ?? null,
        vehicle_id: vehicleId ?? null,
        advisor_id: advisorId ?? null,
        due_in_date: dueInDate,
        is_shell: true,
      })
      .select('id')
      .single()

    if (error || !shell) {
      console.error('spawnShellJobsheetForVhc: shell insert failed', error)
      return null
    }

    const { error: linkErr } = await supabaseAdmin
      .from('health_checks')
      .update({ jobsheet_id: shell.id })
      .eq('id', healthCheckId)
      .eq('organization_id', orgId)

    if (linkErr) {
      // The orphan shell is harmless (excluded from every surface); the VHC simply
      // stays standalone. Don't attempt a racy cleanup.
      console.error('spawnShellJobsheetForVhc: link to VHC failed', linkErr)
      return null
    }

    return shell.id
  } catch (err) {
    console.error('spawnShellJobsheetForVhc: unexpected error', err)
    return null
  }
}
