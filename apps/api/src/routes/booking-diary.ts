/**
 * Booking Diary API
 *
 * Advisor-facing daily/weekly diary over the unified booking feed
 * (vw_diary_bookings: GMS jobsheets + Gemini-DMS imports). Per day it returns
 * total jobs, booked hours vs available hours (a "booked %"), and MOT /
 * While-You-Wait / Loan-car counts; the day endpoint drills into every booking.
 *
 * All capacity/aggregation lives in SQL RPCs (diary_day_summary /
 * diary_day_bookings / diary_available_hours) so the figures match the workshop
 * board. Every query is scoped to the caller's organisation + a resolved site.
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { DMS_BOOKING_DETAIL_SELECT, mapDmsBookingDetailRow } from '../services/dms-booking-detail.js'

const bookingDiary = new Hono()

bookingDiary.use('*', authMiddleware)
bookingDiary.use('*', requireModule('booking_diary'))

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin'] as const
const ADVISOR_ROLES = [...ADMIN_ROLES, 'service_advisor'] as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31

// Resolve the target site: an explicit ?siteId (validated against the org) or
// the caller's own site. Returns null when neither yields a site.
async function resolveSiteId(c: any): Promise<string | null> {
  const auth = c.get('auth')
  const requested = c.req.query('siteId')
  if (requested) {
    const { data: site } = await supabaseAdmin
      .from('sites')
      .select('id')
      .eq('id', requested)
      .eq('organization_id', auth.orgId)
      .single()
    return site ? site.id : null
  }
  return auth.user.siteId
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Shape a diary_day_summary row into the API's per-day DiaryDay.
function mapSummaryDay(r: any) {
  const booked = Number(r.booked_hours) || 0
  const available = Number(r.available_hours) || 0
  return {
    date: r.day,
    totalJobs: r.total_jobs,
    bookedHours: round2(booked),
    availableHours: round2(available),
    bookedPct: available > 0 ? round2(booked / available) : null,
    freeHours: round2(available - booked),
    totalMots: r.total_mots,
    totalWaiting: r.total_waiting,
    totalLoans: r.total_loans,
    totalOutreach: r.total_outreach ?? 0
  }
}

// Shape a diary_day_bookings / diary_range_bookings row into a DiaryBooking.
// `fallbackDate` supplies appt_date for the single-day RPC (which omits it).
function mapBookingRow(r: any, fallbackDate?: string) {
  return {
    bookingId: r.booking_id,
    source: r.source,
    apptDate: r.appt_date ?? fallbackDate ?? null,
    apptTime: r.appt_time,
    registration: r.registration,
    customerName: r.customer_name,
    serviceType: r.service_type_label,
    description: r.description,
    estimatedHours: Number(r.estimated_hours) || 0,
    isMot: r.is_mot,
    isWaiting: r.is_waiting,
    isLoan: r.is_loan,
    isOutreach: r.origin_source === 'follow_up',
    followUpCaseId: r.follow_up_case_id,
    status: r.status,
    jobState: r.job_state,
    technician: r.technician_id ? { id: r.technician_id, name: r.technician_name ?? null } : null,
    advisor: r.advisor_id ? { id: r.advisor_id, name: r.advisor_name ?? null } : null,
    bayNumber: r.bay_number ?? null,
    routeTarget: { jobsheetId: r.jobsheet_id, healthCheckId: r.health_check_id }
  }
}

// GET /summary?from=YYYY-MM-DD&to=YYYY-MM-DD&siteId=...  → one row per day
bookingDiary.get('/summary', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return c.json({ error: 'from and to (YYYY-MM-DD) are required' }, 400)
  }
  const span = daysBetween(from, to)
  if (span < 0) return c.json({ error: 'to must be on or after from' }, 400)
  if (span > MAX_RANGE_DAYS) {
    return c.json({ error: `Range too large (max ${MAX_RANGE_DAYS} days)` }, 400)
  }

  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const { data, error } = await supabaseAdmin.rpc('diary_day_summary', {
    p_org_id: auth.orgId,
    p_site_id: siteId,
    p_from: from,
    p_to: to
  })
  if (error) {
    console.error('diary_day_summary error:', error)
    return c.json({ error: 'Failed to load diary summary' }, 500)
  }

  const days = (data || []).map(mapSummaryDay)

  return c.json({ siteId, from, to, days })
})

// GET /range?from=YYYY-MM-DD&to=YYYY-MM-DD&siteId=...
//   → per-day headers + every booking across the window (Agenda / Table views)
bookingDiary.get('/range', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return c.json({ error: 'from and to (YYYY-MM-DD) are required' }, 400)
  }
  const span = daysBetween(from, to)
  if (span < 0) return c.json({ error: 'to must be on or after from' }, 400)
  if (span > MAX_RANGE_DAYS) {
    return c.json({ error: `Range too large (max ${MAX_RANGE_DAYS} days)` }, 400)
  }

  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const [summaryRes, bookingsRes] = await Promise.all([
    supabaseAdmin.rpc('diary_day_summary', {
      p_org_id: auth.orgId,
      p_site_id: siteId,
      p_from: from,
      p_to: to
    }),
    supabaseAdmin.rpc('diary_range_bookings', {
      p_org_id: auth.orgId,
      p_site_id: siteId,
      p_from: from,
      p_to: to
    })
  ])

  if (summaryRes.error || bookingsRes.error) {
    console.error('diary range error:', summaryRes.error || bookingsRes.error)
    return c.json({ error: 'Failed to load diary range' }, 500)
  }

  const days = (summaryRes.data || []).map(mapSummaryDay)
  const bookings = (bookingsRes.data || []).map((r: any) => mapBookingRow(r))

  return c.json({ siteId, from, to, days, bookings })
})

// GET /day?date=YYYY-MM-DD&siteId=...  → capacity header + every booking
bookingDiary.get('/day', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const date = c.req.query('date')

  if (!date || !DATE_RE.test(date)) {
    return c.json({ error: 'date (YYYY-MM-DD) is required' }, 400)
  }

  const siteId = await resolveSiteId(c)
  if (!siteId) return c.json({ error: 'No site selected' }, 400)

  const [summaryRes, bookingsRes] = await Promise.all([
    supabaseAdmin.rpc('diary_day_summary', {
      p_org_id: auth.orgId,
      p_site_id: siteId,
      p_from: date,
      p_to: date
    }),
    supabaseAdmin.rpc('diary_day_bookings', {
      p_org_id: auth.orgId,
      p_site_id: siteId,
      p_date: date
    })
  ])

  if (summaryRes.error || bookingsRes.error) {
    console.error('diary day error:', summaryRes.error || bookingsRes.error)
    return c.json({ error: 'Failed to load day' }, 500)
  }

  const s = (summaryRes.data || [])[0] || {}
  const booked = Number(s.booked_hours) || 0
  const available = Number(s.available_hours) || 0
  const capacity = {
    bookedHours: round2(booked),
    availableHours: round2(available),
    bookedPct: available > 0 ? round2(booked / available) : null,
    freeHours: round2(available - booked),
    totalJobs: s.total_jobs ?? 0,
    totalMots: s.total_mots ?? 0,
    totalWaiting: s.total_waiting ?? 0,
    totalLoans: s.total_loans ?? 0,
    totalOutreach: s.total_outreach ?? 0
  }

  const bookings = (bookingsRes.data || []).map((r: any) => mapBookingRow(r, date))

  return c.json({ date, siteId, capacity, bookings })
})

// GET /booking?id=<healthCheckId>  → full captured detail for one DMS booking
// (everything the Gemini import landed on the health_check + customer + vehicle).
bookingDiary.get('/booking', authorize([...ADVISOR_ROLES]), async (c) => {
  const auth = c.get('auth')
  const id = c.req.query('id')
  if (!id) return c.json({ error: 'id is required' }, 400)

  const { data, error } = await supabaseAdmin
    .from('health_checks')
    .select(DMS_BOOKING_DETAIL_SELECT)
    .eq('id', id)
    .eq('organization_id', auth.orgId)
    .maybeSingle()

  if (error) {
    console.error('diary booking detail error:', error)
    return c.json({ error: 'Failed to load booking' }, 500)
  }
  if (!data) return c.json({ error: 'Booking not found' }, 404)

  return c.json(mapDmsBookingDetailRow(data))
})

export default bookingDiary
