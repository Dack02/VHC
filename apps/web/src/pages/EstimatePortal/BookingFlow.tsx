import { useState, useEffect, useCallback } from 'react'
import { UspIcon } from '../../lib/uspIcons'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface Slot { time: string; label: string; available: boolean }
interface Day { date: string; weekday: string; dayNum: string; monthShort: string; full: boolean; slots: Slot[] }
type BookingMode = 'drop_off' | 'timed_slot'
interface Availability { enabled: boolean; bookable: boolean; courtesyCar: boolean; slotMinutes: number; mode?: BookingMode; days: Day[] }

export interface ConfirmedBooking {
  requested_date: string
  requested_time: string
  slot_minutes: number
  courtesy_car_requested: boolean
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

// A downloadable .ics for the confirmed booking (floating local time — no TZ surprises).
function buildBookingIcs(booking: ConfirmedBooking, orgName: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const [y, m, d] = booking.requested_date.split('-').map(Number)
  const [hh, mm] = (booking.requested_time || '08:00').split(':').map(Number)
  const start = new Date(y, m - 1, d, hh, mm)
  const end = new Date(start.getTime() + (booking.slot_minutes || 60) * 60000)
  const fmt = (dt: Date) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VHC//Booking//EN', 'BEGIN:VEVENT',
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:Vehicle booking — ${orgName}`,
    'DESCRIPTION:Your booking. Please arrive at your drop-off time.',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n')
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics)
}

// TEMP PREVIEW DATA — used only when `previewMode` is on (portal `?booking=preview`) so the
// slot-picker design can be reviewed before the availability API exists. Delete with the flag.
const SAMPLE_SLOTS: Slot[] = [
  { time: '08:30', label: '08:30', available: true },
  { time: '09:00', label: '09:00', available: true },
  { time: '10:30', label: '10:30', available: true },
  { time: '11:00', label: '11:00', available: false },
  { time: '13:30', label: '13:30', available: true },
  { time: '15:00', label: '15:00', available: true },
]
const PREVIEW_AVAILABILITY: Availability = {
  enabled: true, bookable: true, courtesyCar: true, slotMinutes: 90, mode: 'drop_off',
  days: [
    { date: '2026-06-30', weekday: 'Mon', dayNum: '30', monthShort: 'Jun', full: false, slots: SAMPLE_SLOTS },
    { date: '2026-07-01', weekday: 'Tue', dayNum: '1', monthShort: 'Jul', full: false, slots: SAMPLE_SLOTS },
    { date: '2026-07-02', weekday: 'Wed', dayNum: '2', monthShort: 'Jul', full: true, slots: [] },
    { date: '2026-07-03', weekday: 'Thu', dayNum: '3', monthShort: 'Jul', full: false, slots: SAMPLE_SLOTS },
    { date: '2026-07-04', weekday: 'Fri', dayNum: '4', monthShort: 'Jul', full: false, slots: SAMPLE_SLOTS },
  ],
}

/**
 * Slot picker the customer reaches after approving. Availability comes from the API
 * (Booking Diary capacity) — this component never invents slots. On confirm it POSTs the
 * choice and calls onBooked with the saved booking.
 */
export default function BookingFlow({
  token,
  brand,
  approvedSummary,
  onBooked,
  previewMode = false,
}: {
  token: string
  brand: string
  approvedSummary?: string
  onBooked: (b: ConfirmedBooking) => void
  // TEMP: render mock slots + fake the confirm POST so the design is reviewable offline.
  previewMode?: boolean
}) {
  const [avail, setAvail] = useState<Availability | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selDate, setSelDate] = useState<string | null>(null)
  const [selTime, setSelTime] = useState<string | null>(null)
  const [courtesy, setCourtesy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    if (previewMode) {
      setAvail(PREVIEW_AVAILABILITY)
      setSelDate(PREVIEW_AVAILABILITY.days.find((d) => !d.full && d.slots.some((s) => s.available))?.date ?? null)
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`${API_URL}/api/public/estimate/${token}/availability`)
      if (!res.ok) { setError('Could not load available slots.'); return }
      const data: Availability & { existingBooking?: ConfirmedBooking | null } = await res.json()
      // Already booked (e.g. customer reopened the link) → jump straight to confirmation.
      if (data.existingBooking) { onBooked(data.existingBooking); return }
      setAvail(data)
      const firstOpen = data.days.find((d) => !d.full && d.slots.some((s) => s.available))
      if (firstOpen) setSelDate(firstOpen.date)
    } catch {
      setError('Could not load available slots.')
    } finally {
      setLoading(false)
    }
  }, [token, previewMode])

  useEffect(() => { load() }, [load])

  const day = avail?.days.find((d) => d.date === selDate) || null
  const tint = `color-mix(in srgb, ${brand} 9%, #ffffff)`
  const mode: BookingMode = avail?.mode ?? 'timed_slot'
  const isDropOff = mode === 'drop_off'
  const firstOpenDate = avail?.days.find((d) => !d.full && d.slots.some((s) => s.available))?.date ?? null

  const renderSlot = (s: Slot) => {
    const active = s.time === selTime
    return (
      <button
        key={s.time}
        disabled={!s.available}
        onClick={() => setSelTime(s.time)}
        className="rounded-xl py-2.5 text-center text-[13.5px] font-semibold border transition-colors"
        style={active
          ? { background: brand, borderColor: brand, color: '#fff' }
          : s.available
          ? { background: '#fff', borderColor: '#e6e7e3', color: '#3a3f4a' }
          : { background: '#fff', borderColor: '#eceeec', color: '#c2c6cc', textDecoration: 'line-through' }}
      >
        {s.label}
      </button>
    )
  }

  const confirm = async () => {
    if (!selDate || !selTime) return
    if (previewMode) {
      onBooked({ requested_date: selDate, requested_time: selTime, slot_minutes: avail?.slotMinutes ?? 90, courtesy_car_requested: courtesy })
      return
    }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${API_URL}/api/public/estimate/${token}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selDate, time: selTime, courtesyCar: courtesy })
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || 'Could not book that slot.'); await load(); return }
      onBooked(j.booking)
    } catch {
      setError('Could not book that slot. Please try again.')
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10"><div className="animate-spin h-7 w-7 border-4 border-gray-300 rounded-full" style={{ borderTopColor: brand }} /></div>
  }
  if (!avail || !avail.days.length || avail.days.every((d) => d.full)) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
        <p className="text-sm font-semibold text-gray-800">No online slots right now</p>
        <p className="text-xs text-gray-500 mt-1">We’ll call you to arrange a convenient time.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100" style={{ background: tint }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: brand }}>Pick your slot</div>
        <div className="text-[15px] font-bold text-gray-900 mt-1">When suits you?</div>
        {approvedSummary && <div className="text-[12px] text-gray-500 mt-0.5">{approvedSummary}</div>}
      </div>

      <div className="p-5">
        {/* Day strip */}
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2.5">Choose a day</div>
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {avail.days.map((d) => {
            const active = d.date === selDate
            const disabled = d.full || !d.slots.some((s) => s.available)
            return (
              <button
                key={d.date}
                disabled={disabled}
                onClick={() => { setSelDate(d.date); setSelTime(null) }}
                className="shrink-0 w-[58px] rounded-2xl py-2.5 text-center border transition-colors"
                style={active
                  ? { background: brand, borderColor: brand, color: '#fff' }
                  : disabled
                  ? { background: '#fff', borderColor: '#eceeec', color: '#c2c6cc', opacity: 0.55 }
                  : { background: '#fff', borderColor: '#e6e7e3', color: '#16191f' }}
              >
                <div className="text-[11px] font-semibold opacity-80">{d.weekday}</div>
                <div className="text-[18px] font-extrabold leading-tight mt-0.5">{d.dayNum}</div>
                <div className="text-[10px] opacity-80">{d.full ? 'Full' : (d.date === firstOpenDate ? 'Soonest' : d.monthShort)}</div>
              </button>
            )
          })}
        </div>

        {/* Time / drop-off */}
        {day && (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mt-5 mb-1">
              {isDropOff ? 'When will you drop off?' : 'Choose a time'} · {day.weekday} {day.dayNum} {day.monthShort}
            </div>
            {isDropOff && (
              <div className="text-[11.5px] text-gray-500 mb-2.5">Leave it with us for the day — we’ll have it ready by close.</div>
            )}
            {isDropOff ? (
              <div className="grid grid-cols-3 gap-2">{day.slots.map(renderSlot)}</div>
            ) : (
              ['Morning', 'Afternoon'].map((label) => {
                const list = day.slots.filter((s) => (label === 'Morning' ? s.time < '12:00' : s.time >= '12:00'))
                if (list.length === 0) return null
                return (
                  <div key={label} className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">
                      {label} · {list.filter((s) => s.available).length} free
                    </div>
                    <div className="grid grid-cols-3 gap-2">{list.map(renderSlot)}</div>
                  </div>
                )
              })
            )}
          </>
        )}

        {/* Courtesy car opt-in (only if the tenant offers it) */}
        {avail.courtesyCar && (
          <button
            onClick={() => setCourtesy((v) => !v)}
            className="w-full mt-4 bg-white border rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
            style={{ borderColor: courtesy ? brand : '#e9eae7' }}
          >
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: tint, color: brand }}><UspIcon name="car" size={19} /></span>
            <span className="flex-1 leading-tight">
              <span className="block text-[13.5px] font-bold text-gray-900">Add a courtesy car</span>
              <span className="block text-[11.5px] text-gray-500">Free · subject to availability</span>
            </span>
            <span className="w-11 h-6 rounded-full relative shrink-0 transition-colors" style={{ background: courtesy ? brand : '#d3d6d3' }}>
              <i className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all" style={{ left: courtesy ? '23px' : '3px' }} />
            </span>
          </button>
        )}

        {error && <div className="bg-red-50 text-red-700 p-3 mt-4 rounded-xl text-sm">{error}</div>}

        <button
          disabled={busy || !selDate || !selTime}
          onClick={confirm}
          style={{ backgroundColor: brand }}
          className="w-full h-13 mt-4 py-3.5 text-white font-bold rounded-2xl disabled:opacity-50"
        >
          {selDate && selTime
            ? `${isDropOff ? 'Confirm drop-off' : 'Confirm booking'} · ${day?.weekday} ${day?.dayNum} ${day?.monthShort}, ${selTime}`
            : (isDropOff ? 'Choose a day and drop-off time' : 'Choose a day and time')}
        </button>
      </div>
    </div>
  )
}

/** Booked-confirmation card (Step 3). */
export function BookingConfirmation({
  booking,
  brand,
  orgName,
  phone,
  address,
}: {
  booking: ConfirmedBooking
  brand: string
  orgName: string
  phone?: string
  address?: string
}) {
  const tint = `color-mix(in srgb, ${brand} 11%, #ffffff)`
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-8 text-center text-white" style={{ background: brand }}>
        <div className="w-16 h-16 rounded-full bg-white/15 flex items-center justify-center mx-auto mb-4"><UspIcon name="check" size={30} /></div>
        <h2 className="text-[24px] font-extrabold tracking-tight">You’re booked in</h2>
        <p className="text-[13px] text-white/80 mt-2 leading-snug">We’ve emailed your confirmation and sent {orgName} your approval.</p>
      </div>
      <div className="p-5">
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 p-4 border-b border-gray-100">
            <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 leading-none" style={{ background: tint, color: brand }}>
              <span className="text-[9px] font-bold tracking-wide uppercase">{new Date(`${booking.requested_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })}</span>
              <span className="text-[19px] font-extrabold mt-0.5">{new Date(`${booking.requested_date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit' })}</span>
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-bold text-gray-900">{longDate(booking.requested_date)}</div>
              <div className="text-[12.5px] text-gray-500">Drop off from {booking.requested_time} · approx. {Math.round((booking.slot_minutes / 60) * 10) / 10} hrs</div>
            </div>
          </div>
          {address && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 text-[13px] text-gray-700">
              <span className="text-gray-400 shrink-0"><UspIcon name="shield" size={18} /></span>
              <span><span className="font-semibold">{orgName}</span><br /><span className="text-gray-500 text-[12px]">{address}</span></span>
            </div>
          )}
          {booking.courtesy_car_requested && (
            <div className="flex items-center gap-3 px-4 py-3 text-[13px]" style={{ color: brand }}>
              <span className="shrink-0"><UspIcon name="car" size={18} /></span>
              <span><span className="font-semibold">Courtesy car reserved</span><br /><span className="text-gray-500 text-[12px]">Ready when you drop off</span></span>
            </div>
          )}
        </div>
        <a
          href={buildBookingIcs(booking, orgName)}
          download="booking.ics"
          className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-2xl border text-[13.5px] font-bold"
          style={{ borderColor: brand, color: brand }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          Add to calendar
        </a>
        {phone && <p className="text-center text-[11.5px] text-gray-400 mt-4">Need to change it? Call {phone}</p>}
      </div>
    </div>
  )
}
