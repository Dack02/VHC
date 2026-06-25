import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import type { DmsBookingDetail } from './types'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return time === '00:00' ? date : `${date} · ${time}`
}

function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

// Booking-time hours: the captured estimate, else the sum of booked labour units
// (matches the diary's coalesce ladder so the modal agrees with the row).
function estHoursOf(d: DmsBookingDetail): number | null {
  if (d.estimatedHours != null) return d.estimatedHours
  let sum = 0
  let any = false
  for (const r of d.bookedRepairs) {
    for (const l of r.labour) {
      if (l.units != null) { sum += Number(l.units); any = true }
    }
  }
  return any ? Math.round(sum * 100) / 100 : null
}

function Flag({ label, classes }: { label: string; classes: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${classes}`}>{label}</span>
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900 break-words">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</h3>
      {children}
    </div>
  )
}

export default function DmsBookingModal({ healthCheckId, onClose, onOpenFull }: {
  healthCheckId: string
  onClose: () => void
  onOpenFull: () => void
}) {
  const { session } = useAuth()
  const [detail, setDetail] = useState<DmsBookingDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!session?.accessToken) return
    setLoading(true)
    setError(null)
    api<DmsBookingDetail>(`/api/v1/booking-diary/booking?id=${encodeURIComponent(healthCheckId)}`, { token: session.accessToken })
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load booking') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [healthCheckId, session?.accessToken])

  const v = detail?.vehicle
  const c = detail?.customer

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-mono font-semibold text-gray-900">{val(v?.registration)}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">DMS · Gemini</span>
            </div>
            <div className="text-sm text-gray-500 mt-0.5 truncate">{val(c?.name)}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-3">✕</button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : error ? (
            <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{error}</div>
          ) : detail ? (
            <>
              {/* Flags */}
              {(detail.isMot || detail.isWaiting || detail.isLoan || detail.isInternal || detail.isOutreach) && (
                <div className="flex flex-wrap gap-1.5">
                  {detail.isOutreach && <Flag label="Outreach booking" classes="bg-emerald-50 text-emerald-700" />}
                  {detail.isMot && <Flag label="MOT" classes="bg-blue-50 text-blue-700" />}
                  {detail.isWaiting && <Flag label="While you wait" classes="bg-amber-50 text-amber-700" />}
                  {detail.isLoan && <Flag label="Loan car" classes="bg-indigo-50 text-indigo-700" />}
                  {detail.isInternal && <Flag label="Internal" classes="bg-gray-100 text-gray-600" />}
                </div>
              )}

              {/* Booking */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                <Field label="Booking ref" value={val(detail.bookingId)} />
                <Field label="Jobsheet" value={val(detail.jobsheetNumber)} />
                <Field label="DMS status" value={val(detail.jobsheetStatus)} />
                <Field label="Service type" value={val(detail.serviceType)} />
                <Field label="Est. hours" value={estHoursOf(detail) != null ? `${estHoursOf(detail)}h` : '—'} />
                <Field label="Pipeline status" value={val(detail.status)} />
              </dl>

              {/* Vehicle */}
              <Section title="Vehicle">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <Field label="Make / model" value={val([v?.make, v?.model].filter(Boolean).join(' ') || null)} />
                  <Field label="Year" value={val(v?.year)} />
                  <Field label="Colour" value={val(v?.color)} />
                  <Field label="Fuel" value={val(v?.fuelType)} />
                  <Field label="Mileage" value={v?.mileage != null ? v.mileage.toLocaleString('en-GB') : '—'} />
                  <Field label="VIN" value={val(v?.vin)} />
                </dl>
              </Section>

              {/* Customer */}
              <Section title="Customer">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <Field label="Name" value={val(c?.name)} />
                  <Field label="Contact" value={val(c?.contactName)} />
                  <Field label="Mobile" value={val(c?.mobile)} />
                  <Field label="Phone" value={val(c?.phone)} />
                  <Field label="Email" value={val(c?.email)} />
                  <Field label="Address" value={c?.address && c.address.length > 0 ? c.address.join(', ') : '—'} />
                </dl>
              </Section>

              {/* Booked work */}
              <Section title={`Booked work${detail.bookedRepairs.length ? ` (${detail.bookedRepairs.length})` : ''}`}>
                {detail.bookedRepairs.length === 0 ? (
                  <p className="text-sm text-gray-400">No booked work lines.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.bookedRepairs.map((r, i) => {
                      const title = r.description || r.code
                      return (
                        <div key={i} className="border border-gray-200 rounded-lg p-3">
                          {title && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium text-gray-900">{title}</span>
                              {r.code && r.description && <span className="text-xs text-gray-400 font-mono shrink-0">{r.code}</span>}
                            </div>
                          )}
                          {r.notes && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{r.notes}</p>}
                          {r.labour.length > 0 ? (
                            <ul className={`${title || r.notes ? 'mt-2 ' : ''}space-y-1`}>
                              {r.labour.map((l, j) => (
                                <li key={j} className="flex items-center justify-between text-xs text-gray-600">
                                  <span className="truncate">{val(l.description)}{l.fitter ? ` · ${l.fitter}` : ''}</span>
                                  <span className="shrink-0 ml-2 tabular-nums">
                                    {l.units != null ? `${l.units}h` : ''}{l.price != null ? `  £${Number(l.price).toFixed(2)}` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : !title ? (
                            <span className="text-sm text-gray-400">—</span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Section>

              {/* Notes */}
              {detail.notes && (
                <Section title="Notes (from DMS)">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{detail.notes}</p>
                </Section>
              )}

              {/* Logistics */}
              <Section title="Booking dates">
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                  <Field label="Due in" value={fmtDate(detail.dueDate)} />
                  <Field label="Promised / ready" value={fmtDateTime(detail.promiseTime)} />
                  <Field label="Booking taken" value={fmtDate(detail.bookedDate)} />
                  <Field label="Mileage in" value={detail.mileageIn != null ? detail.mileageIn.toLocaleString('en-GB') : '—'} />
                  <Field label="Key location" value={val(detail.keyLocation)} />
                </dl>
              </Section>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-100">
          <button onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
          <button onClick={onOpenFull} className="px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:opacity-90">Open full health check →</button>
        </div>
      </div>
    </div>
  )
}
