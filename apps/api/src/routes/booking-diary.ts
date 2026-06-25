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

  const days = (data || []).map((r: any) => {
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
      totalLoans: r.total_loans
    }
  })

  return c.json({ siteId, from, to, days })
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
    totalLoans: s.total_loans ?? 0
  }

  const bookings = (bookingsRes.data || []).map((r: any) => ({
    bookingId: r.booking_id,
    source: r.source,
    apptTime: r.appt_time,
    registration: r.registration,
    customerName: r.customer_name,
    serviceType: r.service_type_label,
    description: r.description,
    estimatedHours: Number(r.estimated_hours) || 0,
    isMot: r.is_mot,
    isWaiting: r.is_waiting,
    isLoan: r.is_loan,
    status: r.status,
    jobState: r.job_state,
    routeTarget: { jobsheetId: r.jobsheet_id, healthCheckId: r.health_check_id }
  }))

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
    .select(`
      id, external_id, external_source, status, job_state,
      due_date, promise_time, booked_date, mileage_in, key_location,
      jobsheet_number, jobsheet_status, notes,
      booked_service_type, estimated_hours, is_mot_booking,
      customer_waiting, loan_car_required, is_internal, booked_repairs,
      customer:customers(title, first_name, last_name, contact_name, email, mobile, phone, address_line1, address_line2, town, county, postcode),
      vehicle:vehicles(registration, make, model, color, fuel_type, year, vin, mileage)
    `)
    .eq('id', id)
    .eq('organization_id', auth.orgId)
    .maybeSingle()

  if (error) {
    console.error('diary booking detail error:', error)
    return c.json({ error: 'Failed to load booking' }, 500)
  }
  if (!data) return c.json({ error: 'Booking not found' }, 404)

  const row = data as any
  const cust = row.customer || null
  const veh = row.vehicle || null
  const repairs = Array.isArray(row.booked_repairs) ? row.booked_repairs : []

  return c.json({
    bookingId: row.external_id,
    source: row.external_source === 'gemini_osi' ? 'dms' : 'other',
    status: row.status,
    jobState: row.job_state,
    dueDate: row.due_date,
    promiseTime: row.promise_time,
    bookedDate: row.booked_date,
    mileageIn: row.mileage_in,
    keyLocation: row.key_location,
    jobsheetNumber: row.jobsheet_number,
    jobsheetStatus: row.jobsheet_status,
    serviceType: row.booked_service_type,
    estimatedHours: row.estimated_hours,
    isMot: !!row.is_mot_booking,
    isWaiting: !!row.customer_waiting,
    isLoan: !!row.loan_car_required,
    isInternal: !!row.is_internal,
    notes: row.notes,
    customer: cust ? {
      name: [cust.title, cust.first_name, cust.last_name].filter(Boolean).join(' ').trim() || null,
      contactName: cust.contact_name,
      email: cust.email,
      mobile: cust.mobile,
      phone: cust.phone,
      address: [cust.address_line1, cust.address_line2, cust.town, cust.county, cust.postcode].filter(Boolean)
    } : null,
    vehicle: veh ? {
      registration: veh.registration,
      make: veh.make,
      model: veh.model,
      year: veh.year,
      color: veh.color,
      fuelType: veh.fuel_type,
      vin: veh.vin,
      mileage: veh.mileage
    } : null,
    bookedRepairs: repairs.map((r: any) => ({
      code: r.code ?? null,
      description: r.description ?? null,
      notes: r.notes ?? null,
      labour: Array.isArray(r.labourItems) ? r.labourItems.map((l: any) => ({
        description: l.description ?? null,
        units: l.units ?? null,
        price: l.price ?? null,
        fitter: l.fitter ?? null
      })) : []
    }))
  })
})

export default bookingDiary
