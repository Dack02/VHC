/**
 * Estimate → Jobsheet conversion (Garage-Hive "Make Jobsheet").
 *
 * Shared by the advisor-initiated `POST /estimates/:id/make-jobsheet` and the
 * customer online-booking path (`POST /public/estimate/:token/book`). Copies the
 * approved (or all) quote lines onto a new VHC-less jobsheet as pre-authorised
 * booked work — the work is already priced + agreed — then links + marks the
 * estimate converted.
 *
 * Why the online path converts too: an estimate with only a `requested_date`
 * stamped on it does NOT appear in `vw_diary_bookings` (which unions jobsheets +
 * health_checks), so it wouldn't consume workshop capacity. Converting makes the
 * online acceptance a real new booking that counts toward — and is therefore
 * bounded by — the site's target loading, the same as every other channel.
 */

import { supabaseAdmin } from '../lib/supabase.js'

// Copy one estimate line (+ its labour + parts) onto a jobsheet as pre-authorised
// booked work. Returns the new repair_item id, or null on failure.
async function copyLineToJobsheet(srcLineId: string, jobsheetId: string, orgId: string, userId: string | null): Promise<string | null> {
  const { data: src } = await supabaseAdmin
    .from('repair_items')
    .select('name, description, repair_type_id')
    .eq('id', srcLineId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!src) return null

  const now = new Date().toISOString()
  const { data: item, error } = await supabaseAdmin
    .from('repair_items')
    .insert({
      jobsheet_id: jobsheetId,
      organization_id: orgId,
      name: src.name,
      description: src.description,
      // Carry the Repair Type so the won job keeps its classification for reporting (copy-time:
      // do NOT re-derive — the snapshotted labour rate below preserves the approved price).
      repair_type_id: src.repair_type_id ?? null,
      source: 'booking',
      // Booked off an estimate the customer already priced/approved → pre-authorised.
      outcome_status: 'authorised',
      outcome_source: 'manual',
      outcome_set_by: userId,
      outcome_set_at: now,
      customer_approved: true,
      customer_approved_at: now,
      created_by: userId
    })
    .select('id')
    .single()
  if (error || !item) return null

  const { data: labour } = await supabaseAdmin
    .from('repair_labour')
    .select('labour_code_id, hours, rate, discount_percent, is_vat_exempt, notes')
    .eq('repair_item_id', srcLineId)
  if (labour && labour.length) {
    await supabaseAdmin.from('repair_labour').insert(labour.map((l) => ({ ...l, repair_item_id: item.id })))
  }

  const { data: parts } = await supabaseAdmin
    .from('repair_parts')
    .select('part_number, description, quantity, supplier_id, supplier_name, cost_price, sell_price, notes')
    .eq('repair_item_id', srcLineId)
  if (parts && parts.length) {
    await supabaseAdmin.from('repair_parts').insert(parts.map((p) => ({ ...p, repair_item_id: item.id })))
  }

  return item.id
}

export interface ConvertEstimateOptions {
  orgId: string
  estimateId: string
  /** Acting user, or null for a system/online conversion. */
  userId?: string | null
  dueInDate: string
  dueInTime?: string | null
  serviceTypeId?: string | null
  advisorId?: string | null
  bookingNotes?: string | null
  /** Copy only customer-approved lines (default true) vs all top-level lines. */
  approvedOnly?: boolean
  /** Stamp the booking's dominant category for capacity/quota counting. */
  primaryRepairTypeId?: string | null
  /** Persisted provenance marker on the jobsheet (e.g. 'online_estimate'). NULL = manual/advisor. */
  bookingSource?: string | null
  /** Provenance, for logging (e.g. 'advisor' | 'online'). */
  source?: string
}

export type ConvertEstimateResult =
  | { ok: true; jobsheetId: string; reference: string | null; linesCopied: number }
  | { ok: false; status: number; error: string; jobsheetId?: string }

export async function convertEstimateToJobsheet(opts: ConvertEstimateOptions): Promise<ConvertEstimateResult> {
  const { orgId, estimateId, userId = null, approvedOnly = true } = opts
  if (!opts.dueInDate) return { ok: false, status: 400, error: 'Due-in date is required' }

  const { data: est } = await supabaseAdmin
    .from('estimates')
    .select('id, site_id, customer_id, vehicle_id, advisor_id, status, is_draft, customer_notes, converted_to_jobsheet_id')
    .eq('id', estimateId)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .single()
  if (!est) return { ok: false, status: 404, error: 'Estimate not found' }
  if (est.is_draft) return { ok: false, status: 400, error: 'Finish creating the estimate before converting it' }
  if (est.converted_to_jobsheet_id) return { ok: false, status: 400, error: 'This estimate has already been converted', jobsheetId: est.converted_to_jobsheet_id }
  if (est.status === 'cancelled') return { ok: false, status: 400, error: 'Cannot convert a cancelled estimate' }
  if (!est.customer_id || !est.vehicle_id) return { ok: false, status: 400, error: 'Estimate needs a customer and vehicle to convert' }

  // Which lines? Approved-only (default) or all top-level quote lines.
  let q = supabaseAdmin
    .from('repair_items')
    .select('id')
    .eq('estimate_id', estimateId)
    .eq('organization_id', orgId)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (approvedOnly) q = q.eq('customer_approved', true)
  const { data: lines } = await q
  if (!lines || lines.length === 0) {
    return { ok: false, status: 400, error: approvedOnly ? 'No approved lines to copy. Approve lines first, or choose "all lines".' : 'This estimate has no lines to copy.' }
  }

  // 1. Create the jobsheet (no VHC — the work is already quoted/agreed; reference auto-assigned).
  const { data: js, error: jsErr } = await supabaseAdmin
    .from('jobsheets')
    .insert({
      organization_id: orgId,
      site_id: est.site_id,
      customer_id: est.customer_id,
      vehicle_id: est.vehicle_id,
      service_type_id: opts.serviceTypeId || null,
      advisor_id: opts.advisorId || est.advisor_id || userId || null,
      due_in_date: opts.dueInDate,
      due_in_time: (typeof opts.dueInTime === 'string' && opts.dueInTime.trim()) ? opts.dueInTime.trim() : null,
      vhc_required: false,
      primary_repair_type_id: opts.primaryRepairTypeId || null,
      booking_source: opts.bookingSource || null,
      booking_notes: (typeof opts.bookingNotes === 'string' && opts.bookingNotes.trim()) ? opts.bookingNotes.trim() : (est.customer_notes || null),
      is_draft: false,
      created_by: userId
    })
    .select('id, reference')
    .single()
  if (jsErr || !js) return { ok: false, status: 500, error: jsErr?.message || 'Failed to create jobsheet' }

  // 2. Copy the selected lines onto the jobsheet as pre-authorised booked work.
  let copied = 0
  for (const l of lines) {
    const newId = await copyLineToJobsheet(l.id, js.id, orgId, userId)
    if (newId) copied++
  }

  // 3. Link + mark the estimate converted.
  await supabaseAdmin
    .from('estimates')
    .update({ status: 'converted', converted_to_jobsheet_id: js.id, converted_at: new Date().toISOString() })
    .eq('id', estimateId)
    .eq('organization_id', orgId)

  return { ok: true, jobsheetId: js.id, reference: js.reference, linesCopied: copied }
}
