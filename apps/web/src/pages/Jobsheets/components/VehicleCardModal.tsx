import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useModules } from '../../../contexts/ModulesContext'
import { api } from '../../../lib/api'
import {
  fmtDate, dueTone, customerName, ROLE_LABELS, LIFECYCLE_STYLES,
  type VehicleDetailData, type MotHistory, type VehicleNote, type VehicleLink
} from '../../Vehicles/types'

/**
 * Read-only vehicle "card" shown as a modal from the New Jobsheet / New Estimate
 * screens, so an advisor can glance at full vehicle info (spec, MOT, key dates,
 * notes, owner/driver) without leaving the booking — navigating away would discard
 * the in-progress draft. "Open full vehicle" therefore opens in a new tab, and only
 * when the Vehicles module is enabled (that page is module-gated). Editing lives on
 * the full vehicle page.
 *
 * GET /vehicles/:id is itself ungated, so this works on jobsheet/estimate creation
 * regardless of whether the org has the Vehicles module.
 */

const num = (n: number | null | undefined) => (n || n === 0 ? n.toLocaleString('en-GB') : '—')
const titleCase = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '')

export default function VehicleCardModal({ vehicleId, onClose }: {
  vehicleId: string
  onClose: () => void
}) {
  const { session } = useAuth()
  const { isEnabled } = useModules()
  const token = session?.accessToken
  const [vehicle, setVehicle] = useState<VehicleDetailData | null>(null)
  const [mot, setMot] = useState<MotHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true); setError(null)
    api<VehicleDetailData>(`/api/v1/vehicles/${vehicleId}`, { token })
      .then(v => { if (!cancelled) setVehicle(v) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load vehicle') })
      .finally(() => { if (!cancelled) setLoading(false) })
    // MOT per-test history is non-critical — the summary status/expiry already
    // arrives with the vehicle, so a failure here just hides the history sub-list.
    api<MotHistory>(`/api/v1/vehicles/${vehicleId}/mot-history`, { token })
      .then(m => { if (!cancelled) setMot(m) })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [token, vehicleId])

  // Notes split: warning/blocked surface as a top banner (the actionable ones);
  // general/internal drop into the Notes section below.
  const alerts = (vehicle?.notes || []).filter(n => n.category === 'warning' || n.category === 'blocked')
  const otherNotes = (vehicle?.notes || []).filter(n => n.category === 'general' || n.category === 'internal')
  const expiries = (vehicle?.expiries || []).filter(e => e.is_active)
  const motStatus = mot?.motStatus || vehicle?.mot_status || null
  const motExpiry = vehicle?.mot_expiry_date || mot?.motExpiryDate || null

  // Identity / spec — only the rows we actually hold (keeps the grid tidy per vehicle).
  const specRows: Array<[string, string]> = vehicle ? ([
    ['Year', vehicle.year ? String(vehicle.year) : ''],
    ['Colour', vehicle.color || ''],
    ['Fuel', titleCase(vehicle.fuel_type)],
    ['Engine', vehicle.engine_size || ''],
    ['Transmission', titleCase(vehicle.transmission)],
    ['Drivetrain', titleCase(vehicle.drive_type)],
    ['Body', titleCase(vehicle.body_type)],
    ['Derivative', vehicle.derivative || ''],
    ['Power', vehicle.power_bhp ? `${vehicle.power_bhp} bhp` : ''],
    ['CO₂', vehicle.co2_gkm ? `${vehicle.co2_gkm} g/km` : ''],
    ['Euro status', vehicle.euro_status || ''],
    ['Current mileage', vehicle.mileage ? `${num(vehicle.mileage)} mi` : ''],
    ['VIN', vehicle.vin || '']
  ] as Array<[string, string]>).filter(([, v]) => v) : []

  // Provenance (DVLA) — only render the section if we hold at least one value.
  const provRows: Array<[string, string]> = vehicle ? ([
    ['First registered', vehicle.date_first_registered ? fmtDate(vehicle.date_first_registered) : ''],
    ['Previous keepers', vehicle.number_of_previous_keepers != null ? String(vehicle.number_of_previous_keepers) : ''],
    ['Keeper since', vehicle.keeper_start_date ? fmtDate(vehicle.keeper_start_date) : ''],
    ['V5C issued', vehicle.latest_v5c_issue_date ? fmtDate(vehicle.latest_v5c_issue_date) : '']
  ] as Array<[string, string]>).filter(([, v]) => v) : []

  const lifecycle = vehicle?.lifecycle_status && vehicle.lifecycle_status !== 'active' ? vehicle.lifecycle_status : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 truncate">{vehicle?.registration || 'Vehicle'}</h2>
              {lifecycle && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${LIFECYCLE_STYLES[lifecycle] || 'bg-gray-100 text-gray-600'}`}>
                  {titleCase(lifecycle)}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {[vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(' ') || 'Vehicle card'}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isEnabled('vehicles') && (
              <a href={`/vehicles/${vehicleId}`} target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-primary hover:underline whitespace-nowrap">Open full vehicle ↗</a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-7 w-7 border-4 border-primary border-t-transparent rounded-full" /></div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : vehicle ? (
            <>
              {/* Alerts — warning/blocked notes pinned to the top */}
              {alerts.map(n => (
                <div key={n.id} className={`rounded-lg px-3 py-2 text-sm ${n.category === 'blocked' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                  <span className="font-semibold uppercase text-[11px] tracking-wide mr-2">{n.category === 'blocked' ? 'Blocked' : 'Warning'}</span>
                  {n.body}
                </div>
              ))}

              {/* Identity & spec */}
              <Section title="Vehicle details">
                {specRows.length === 0 ? (
                  <p className="text-sm text-gray-400">No specification details held.</p>
                ) : (
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5 text-sm">
                    {specRows.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="text-gray-900 font-medium break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Section>

              {/* MOT */}
              <Section title="MOT">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div><span className="text-gray-500">Status </span><span className="text-gray-900 font-medium">{motStatus || '—'}</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Expiry</span>
                    <span className="text-gray-900 font-medium">{fmtDate(motExpiry)}</span>
                    {motExpiry && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${dueTone(motExpiry).cls}`}>{dueTone(motExpiry).label}</span>}
                  </div>
                  {vehicle.mot_last_synced_at && <div className="text-xs text-gray-400">Checked {fmtDate(vehicle.mot_last_synced_at)}</div>}
                </div>
                {mot && mot.tests.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {mot.tests.slice(0, 3).map(t => {
                      const passed = (t.testResult || '').toUpperCase() === 'PASSED'
                      return (
                        <li key={t.id} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500 w-20 shrink-0">{fmtDate(t.completedDate)}</span>
                          <span className={`px-1.5 py-0.5 rounded font-medium ${passed ? 'bg-rag-green text-white' : 'bg-rag-red text-white'}`}>{passed ? 'Pass' : 'Fail'}</span>
                          <span className="text-gray-500">{t.odometerValue != null ? `${num(t.odometerValue)} ${t.odometerUnit || 'mi'}` : ''}</span>
                          {t.defects.length > 0 && <span className="text-gray-400">{t.defects.length} defect{t.defects.length === 1 ? '' : 's'}</span>}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {!motStatus && (!mot || mot.tests.length === 0) && <p className="text-sm text-gray-400">No MOT data held.</p>}
              </Section>

              {/* Provenance (DVLA) */}
              {provRows.length > 0 && (
                <Section title="Provenance">
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2.5 text-sm">
                    {provRows.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="text-gray-900 font-medium break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </Section>
              )}

              {/* Key dates / expiries */}
              {expiries.length > 0 && (
                <Section title="Key dates">
                  <div className="space-y-2">
                    {expiries.map(e => {
                      const label = e.expiry_type?.label || e.type_code
                      return (
                        <div key={e.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm">
                          <span className="font-medium text-gray-900">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">{e.expiry_type?.is_mileage_based && e.due_mileage != null ? `${num(e.due_mileage)} mi` : fmtDate(e.due_date)}</span>
                            {e.due_date && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${dueTone(e.due_date).cls}`}>{dueTone(e.due_date).label}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}

              {/* People — owner / driver / keeper links (fall back to the linked customer) */}
              <Section title="People">
                {vehicle.links.length > 0 ? (
                  <div className="space-y-2">
                    {vehicle.links.map(l => <PersonRow key={l.id} link={l} />)}
                  </div>
                ) : vehicle.customer ? (
                  <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{customerName(vehicle.customer)}</div>
                      <div className="text-gray-500 truncate">{vehicle.customer.mobile || vehicle.customer.email || 'No contact details'}</div>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 ml-3">Owner</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">No owner on file.</p>
                )}
              </Section>

              {/* Notes (general / internal) */}
              {otherNotes.length > 0 && (
                <Section title="Notes">
                  <ul className="space-y-2">
                    {otherNotes.map(n => <NoteRow key={n.id} note={n} />)}
                  </ul>
                </Section>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      {children}
    </div>
  )
}

function PersonRow({ link }: { link: VehicleLink }) {
  return (
    <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="font-medium text-gray-900 truncate">{customerName(link.customer)}</div>
        <div className="text-gray-500 truncate">{link.customer?.mobile || link.customer?.email || 'No contact details'}</div>
      </div>
      <span className="text-xs text-gray-400 shrink-0 ml-3">{ROLE_LABELS[link.role]}</span>
    </div>
  )
}

function NoteRow({ note }: { note: VehicleNote }) {
  return (
    <li className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
      <div className="flex items-center gap-2 mb-0.5">
        {note.category === 'internal' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 uppercase tracking-wide">Internal</span>}
        {note.is_pinned && <span className="text-[10px] text-gray-400">📌 Pinned</span>}
        <span className="text-xs text-gray-400 ml-auto">{note.author ? `${note.author.first_name} ${note.author.last_name}` : ''}{note.author ? ' · ' : ''}{fmtDate(note.created_at)}</span>
      </div>
      <p className="text-gray-700 whitespace-pre-wrap">{note.body}</p>
    </li>
  )
}
