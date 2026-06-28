import { supabaseAdmin } from '../lib/supabase.js'

export interface DropOffArrival {
  jobsheetId: string
  reference: string | null
  registration: string | null
  customerName: string | null
  /** Agreed drop-off time as 'HH:mm', or null when flexible. */
  dropOffTime: string | null
  /** The workshop schedule date (due_in_date) — when the work is actually planned. */
  scheduledDate: string
  serviceTypeLabel: string | null
}

// Cars physically dropped in on `date` whose work is scheduled for a LATER day —
// jobsheets.drop_off_date is only ever stored when it's earlier than the schedule
// date (due_in_date). Drives the "Arriving today" surfaces (Today + Booking Diary)
// for ALL bookings, VHC or not. Purely additive: never reads the capacity/diary view.
export async function getDropOffArrivals(orgId: string, siteId: string | null, date: string): Promise<DropOffArrival[]> {
  let q = supabaseAdmin
    .from('jobsheets')
    .select('id, reference, due_in_date, due_in_time, vehicle:vehicles(registration), customer:customers(first_name, last_name), service_type:service_types(label)')
    .eq('organization_id', orgId)
    .eq('drop_off_date', date)
    .eq('is_draft', false)
    .is('deleted_at', null)
    .order('due_in_time', { ascending: true, nullsFirst: false })
  if (siteId) q = q.eq('site_id', siteId)

  const { data, error } = await q
  if (error) { console.error('getDropOffArrivals error:', error); return [] }
  return (data || []).map((r: any) => ({
    jobsheetId: r.id,
    reference: r.reference ?? null,
    registration: r.vehicle?.registration ?? null,
    customerName: [r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(' ').trim() || null,
    dropOffTime: r.due_in_time ? String(r.due_in_time).slice(0, 5) : null,
    scheduledDate: r.due_in_date,
    serviceTypeLabel: r.service_type?.label ?? null
  }))
}
