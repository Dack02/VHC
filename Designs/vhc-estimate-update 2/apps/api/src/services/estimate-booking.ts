/**
 * Estimate online booking — availability + slot creation.
 *
 * Bookable slots are derived from the SAME workshop capacity the advisor Booking Diary uses
 * (diary_day_summary RPC + workshop_board_config.operating_days). We do NOT invent slots and
 * never exceed real capacity: a day is bookable only when its free hours (available − booked)
 * are at least the assumed job duration (the configured slot length). The customer's choice is
 * recorded as an estimate_bookings row (status 'requested') for the garage to confirm/convert.
 */
import { supabaseAdmin } from '../lib/supabase.js'
import type { EstimateSettings } from './estimate-settings.js'

export interface BookingSlot { time: string; label: string; available: boolean }
export interface BookingDay {
  date: string          // YYYY-MM-DD
  weekday: string       // 'Mon'
  dayNum: string        // '15'
  monthShort: string    // 'Jul'
  full: boolean         // no free workshop capacity that day
  slots: BookingSlot[]
}
export interface Availability {
  enabled: boolean
  courtesyCar: boolean
  slotMinutes: number
  days: BookingDay[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
// JS getDay() is 0=Sun..6=Sat; the diary stores ISO dow 1=Mon..7=Sun.
const isoDow = (d: Date) => ((d.getDay() + 6) % 7) + 1
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

// Weekdays the site operates (ISO dow 1=Mon..7=Sun); all seven when unset. Mirrors the
// Booking Diary's resolveOperatingDays so the customer picker matches the workshop board.
async function resolveOperatingDays(orgId: string, siteId: string): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from('workshop_board_config')
    .select('operating_days')
    .eq('organization_id', orgId)
    .eq('site_id', siteId)
    .maybeSingle()
  const od = data?.operating_days as number[] | null | undefined
  return od && od.length ? od : [1, 2, 3, 4, 5, 6, 7]
}

function generateSlots(dayStart: string, dayEnd: string, slotMinutes: number, available: boolean, dayDate: string, now: Date): BookingSlot[] {
  const start = toMins(dayStart)
  const end = toMins(dayEnd)
  const slots: BookingSlot[] = []
  const isToday = iso(now) === dayDate
  const nowMins = now.getHours() * 60 + now.getMinutes()
  for (let m = start; m + slotMinutes <= end + 1; m += slotMinutes) {
    const future = !isToday || m > nowMins
    slots.push({ time: hhmm(m), label: hhmm(m), available: available && future })
  }
  return slots
}

/**
 * Compute bookable days/slots for an estimate's org+site from diary capacity.
 * Returns `enabled:false` when booking is off or the estimate has no site.
 */
export async function getAvailability(
  orgId: string,
  siteId: string | null,
  settings: EstimateSettings,
  now: Date = new Date()
): Promise<Availability> {
  const base: Availability = {
    enabled: false,
    courtesyCar: settings.bookingCourtesyCar,
    slotMinutes: settings.bookingSlotMinutes,
    days: []
  }
  if (!settings.onlineBookingEnabled || !siteId) return base

  const operatingDays = await resolveOperatingDays(orgId, siteId)
  const slotHours = settings.bookingSlotMinutes / 60
  const from = addDays(now, settings.bookingLeadDays)
  const to = addDays(from, settings.bookingWindowDays)

  // One capacity query for the whole window (same RPC the diary uses).
  const { data: summaryRows } = await supabaseAdmin.rpc('diary_day_summary', {
    p_org_id: orgId,
    p_site_id: siteId,
    p_from: iso(from),
    p_to: iso(to)
  })
  const freeByDay = new Map<string, number>()
  for (const r of (summaryRows || []) as any[]) {
    const free = (Number(r.available_hours) || 0) - (Number(r.booked_hours) || 0)
    freeByDay.set(String(r.day), free)
  }

  const days: BookingDay[] = []
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    if (!operatingDays.includes(isoDow(d))) continue
    const key = iso(d)
    // No summary row → no shift config for that day; treat as no online capacity (closed)
    // rather than over-promising. Orgs running online booking are expected to have shifts set.
    const free = freeByDay.has(key) ? (freeByDay.get(key) as number) : 0
    const hasCapacity = free >= slotHours
    days.push({
      date: key,
      weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      dayNum: d.toLocaleDateString('en-GB', { day: '2-digit' }),
      monthShort: d.toLocaleDateString('en-GB', { month: 'short' }),
      full: !hasCapacity,
      slots: generateSlots(settings.bookingDayStart, settings.bookingDayEnd, settings.bookingSlotMinutes, hasCapacity, key, now)
    })
  }
  return { ...base, enabled: true, days }
}

export interface CreateBookingInput {
  date: string
  time: string
  courtesyCar: boolean
  customerName?: string | null
  ip?: string | null
  userAgent?: string | null
}

/**
 * Record a customer's chosen slot (status 'requested'). Re-validates capacity server-side
 * (it can change between page load and confirm). Throws Error with a customer-safe message.
 */
export async function createEstimateBooking(
  orgId: string,
  estimateId: string,
  siteId: string | null,
  settings: EstimateSettings,
  input: CreateBookingInput,
  now: Date = new Date()
) {
  if (!settings.onlineBookingEnabled) throw new Error('Online booking is not available')
  if (!siteId) throw new Error('Online booking is not available for this estimate')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new Error('Please choose a valid date and time')

  const avail = await getAvailability(orgId, siteId, settings, now)
  const day = avail.days.find((d) => d.date === input.date)
  const slot = day?.slots.find((s) => s.time === input.time)
  if (!day || day.full || !slot || !slot.available) {
    throw new Error('That slot is no longer available — please choose another')
  }

  // Replace any prior live booking for this estimate (customer changing their mind).
  await supabaseAdmin
    .from('estimate_bookings')
    .update({ status: 'cancelled' })
    .eq('estimate_id', estimateId)
    .neq('status', 'cancelled')

  const { data, error } = await supabaseAdmin
    .from('estimate_bookings')
    .insert({
      estimate_id: estimateId,
      organization_id: orgId,
      site_id: siteId,
      requested_date: input.date,
      requested_time: input.time,
      slot_minutes: settings.bookingSlotMinutes,
      courtesy_car_requested: !!input.courtesyCar && settings.bookingCourtesyCar,
      customer_name: input.customerName || null,
      ip_address: input.ip || null,
      user_agent: input.userAgent || null
    })
    .select('id, requested_date, requested_time, slot_minutes, courtesy_car_requested, status')
    .single()

  if (error) throw new Error(error.message)
  return data
}

// Current (non-cancelled) booking for an estimate, if any — lets the portal show the
// confirmed state on reload.
export async function getEstimateBooking(estimateId: string) {
  const { data } = await supabaseAdmin
    .from('estimate_bookings')
    .select('id, requested_date, requested_time, slot_minutes, courtesy_car_requested, status')
    .eq('estimate_id', estimateId)
    .neq('status', 'cancelled')
    .maybeSingle()
  return data
}
