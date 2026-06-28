import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import CustomerPicker, { type PickedCustomer } from './CustomerPicker'
import {
  customerName, fmtDate, dueTone, LIFECYCLE_STYLES, ROLE_LABELS,
  type VehicleDetailData, type VehicleLink, type VehicleNote, type VehicleExpiry,
  type MotHistory, type OwnershipHistoryRow, type VehicleRole
} from './types'

// ---------- small primitives ----------

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-[#16191f]">{title}</h3>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

const PRIMARY_BTN = 'px-4 h-[42px] rounded-[10px] bg-[#16191f] text-white text-sm font-medium hover:bg-black disabled:opacity-50'
const GHOST_BTN = 'px-4 h-[42px] rounded-[10px] border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50'

// ============================================================================

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const { isEnabled } = useModules()
  const toast = useToast()
  const token = session?.accessToken

  const [vehicle, setVehicle] = useState<VehicleDetailData | null>(null)
  const [mot, setMot] = useState<MotHistory | null>(null)
  const [history, setHistory] = useState<OwnershipHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showMotTests, setShowMotTests] = useState(false)

  // modals
  const [showTransfer, setShowTransfer] = useState(false)
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [correctingReg, setCorrectingReg] = useState(false)

  const load = useCallback(async () => {
    if (!token || !id) return
    try {
      const [v, m, h] = await Promise.all([
        api<VehicleDetailData>(`/api/v1/vehicles/${id}`, { token }),
        api<MotHistory>(`/api/v1/vehicles/${id}/mot-history`, { token }).catch(() => null),
        api<{ history: OwnershipHistoryRow[] }>(`/api/v1/vehicles/${id}/ownership-history`, { token }).catch(() => ({ history: [] }))
      ])
      setVehicle(v)
      setMot(m)
      setHistory(h?.history || [])
    } catch {
      toast.error('Failed to load vehicle')
    } finally {
      setLoading(false)
    }
  }, [token, id, toast])

  useEffect(() => { load() }, [load])

  const refresh = async (includePaidDetails: boolean) => {
    if (!token || !id) return
    setBusy(true)
    try {
      const res = await api<{ mot: { found: boolean } | null; details: { found: boolean; lifecycleStatus: string | null } | null }>(
        `/api/v1/vehicles/${id}/refresh`, { method: 'POST', token, body: { includePaidDetails } }
      )
      const bits: string[] = []
      if (res.mot) bits.push(res.mot.found ? 'MOT updated' : 'no MOT record')
      if (res.details) bits.push(res.details.found ? `DVLA spec updated${res.details.lifecycleStatus && res.details.lifecycleStatus !== 'active' ? ` (${res.details.lifecycleStatus})` : ''}` : 'no DVLA data')
      toast.success(`Refreshed — ${bits.join(', ') || 'done'}`)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }

  const correctReg = async (newReg: string) => {
    if (!token || !id) return
    setBusy(true)
    try {
      await api(`/api/v1/vehicles/${id}/refresh`, { method: 'POST', token, body: { newRegistration: newReg } })
      toast.success('Registration corrected and re-looked up')
      setCorrectingReg(false)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not correct registration')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }
  if (!vehicle) {
    return <div className="max-w-3xl mx-auto text-center text-gray-400 py-16">Vehicle not found. <Link to="/vehicles" className="text-primary">Back to vehicles</Link></div>
  }

  const lc = vehicle.lifecycle_status || 'active'

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <Link to="/vehicles" className="text-sm text-gray-500 hover:text-gray-700">← Vehicles</Link>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-yellow-300 text-black px-4 py-2 font-bold text-2xl tracking-wider rounded">{vehicle.registration}</div>
            <div>
              <div className="text-lg font-semibold text-gray-900">
                {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
                {vehicle.year && <span className="text-gray-400 font-normal"> ({vehicle.year})</span>}
              </div>
              {vehicle.derivative && <div className="text-sm text-gray-500">{vehicle.derivative}</div>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => refresh(false)} disabled={busy} className={GHOST_BTN}>↻ Refresh (MOT)</button>
            {isEnabled('vehicle_details') && (
              <button
                onClick={() => { if (confirm('Run a PAID DVLA spec lookup? This uses one Vehicle Data credit.')) refresh(true) }}
                disabled={busy}
                className={GHOST_BTN}
              >Update DVLA spec (paid)</button>
            )}
            <button onClick={() => setCorrectingReg(true)} className={GHOST_BTN}>Correct reg</button>
            <button onClick={() => setShowTransfer(true)} className={PRIMARY_BTN}>Change owner</button>
          </div>
        </div>

        {lc !== 'active' && (
          <div className={`mt-4 rounded-lg px-4 py-2 text-sm font-medium ${LIFECYCLE_STYLES[lc] || 'bg-amber-100 text-amber-700'}`}>
            This vehicle is marked <strong>{lc}</strong>
            {vehicle.lifecycle_changed_at && <> — detected {fmtDate(vehicle.lifecycle_changed_at)}</>}. Reminders &amp; marketing are suppressed.
          </div>
        )}

        {correctingReg && (
          <CorrectRegInline current={vehicle.registration} busy={busy} onCancel={() => setCorrectingReg(false)} onSave={correctReg} />
        )}

        {vehicle.vehicle_data_synced_at && (
          <div className="mt-3 text-[11px] text-gray-400">DVLA spec last synced {fmtDate(vehicle.vehicle_data_synced_at)}{vehicle.mot_last_synced_at ? ` · MOT synced ${fmtDate(vehicle.mot_last_synced_at)}` : ''}</div>
        )}
      </div>

      {/* Identity / spec */}
      <Card title="Identity &amp; specification">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="VIN" value={vehicle.vin ? <span className="font-mono text-xs">{vehicle.vin}</span> : null} />
          <Field label="Colour" value={vehicle.color} />
          <Field label="Fuel" value={vehicle.fuel_type} />
          <Field label="Powertrain" value={vehicle.powertrain_type} />
          <Field label="Engine" value={vehicle.engine_size ? `${vehicle.engine_size} cc` : null} />
          <Field label="Transmission" value={vehicle.transmission} />
          <Field label="Drive" value={vehicle.drive_type} />
          <Field label="Power" value={vehicle.power_bhp ? `${vehicle.power_bhp} bhp` : null} />
          <Field label="Body" value={vehicle.body_type} />
          <Field label="CO₂" value={vehicle.co2_gkm ? `${vehicle.co2_gkm} g/km` : null} />
          <Field label="Euro status" value={vehicle.euro_status} />
          <Field label="Tax class" value={vehicle.taxation_class} />
          <Field label="First registered" value={fmtDate(vehicle.date_first_registered)} />
          <Field label="Mileage" value={vehicle.mileage ? `${vehicle.mileage.toLocaleString()} mi` : null} />
          <Field label="Previous keepers" value={vehicle.number_of_previous_keepers ?? null} />
        </div>
        {!vehicle.vehicle_data_synced_at && (
          <p className="mt-4 text-xs text-gray-400">Full DVLA specification not yet retrieved.{isEnabled('vehicle_details') ? ' Use “Update DVLA spec” to enrich.' : ''}</p>
        )}
      </Card>

      {/* MOT */}
      <Card
        title="MOT history"
        action={mot?.tests?.length ? <button onClick={() => setShowMotTests(s => !s)} className="text-xs text-primary">{showMotTests ? 'Hide tests' : `Show ${mot.tests.length} tests`}</button> : undefined}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Status" value={mot?.motStatus || vehicle.mot_status} />
          <Field label="Expiry" value={fmtDate(mot?.motExpiryDate || vehicle.mot_expiry_date)} />
          <Field label="First used" value={fmtDate(mot?.firstUsedDate || vehicle.first_used_date)} />
        </div>
        {showMotTests && mot?.tests && (
          <div className="mt-4 space-y-2">
            {mot.tests.map(t => (
              <div key={t.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-900">{fmtDate(t.completedDate)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${t.testResult === 'PASSED' ? 'bg-rag-green text-white' : 'bg-rag-red text-white'}`}>{t.testResult || '—'}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {t.odometerValue != null && <>{t.odometerValue.toLocaleString()} {t.odometerUnit || 'mi'} · </>}
                  Expiry {fmtDate(t.expiryDate)}
                </div>
                {t.defects?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {t.defects.map((d, i) => (
                      <li key={i} className={`text-xs ${d.dangerous ? 'text-red-600' : 'text-gray-500'}`}>• [{d.type}] {d.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {!mot?.motStatus && !vehicle.mot_status && <p className="text-xs text-gray-400">No MOT data held. Refresh to look it up.</p>}
      </Card>

      {/* Owner & drivers */}
      <OwnerDriverCard vehicle={vehicle} token={token} onChanged={load} onAdd={() => setShowAddPerson(true)} toast={toast} />

      {/* Expiry & reminders */}
      <ExpiryCard vehicle={vehicle} token={token} onChanged={load} toast={toast} />

      {/* Notes */}
      <NotesCard vehicle={vehicle} token={token} onChanged={load} toast={toast} />

      {/* Ownership history */}
      {history.length > 0 && (
        <Card title="Ownership history">
          <ol className="space-y-3">
            {history.map(h => (
              <li key={h.id} className="text-sm">
                <span className="text-gray-400">{fmtDate(h.changed_at)}</span>{' — '}
                <span className="text-gray-900">{customerName(h.from_customer)} → {customerName(h.to_customer)}</span>
                {h.reason && <span className="text-gray-500"> ({h.reason.replace(/_/g, ' ')})</span>}
                {h.changed_by_user && <span className="text-gray-400"> · {h.changed_by_user.first_name} {h.changed_by_user.last_name}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Modals */}
      {showTransfer && (
        <TransferOwnerModal
          vehicleId={vehicle.id} token={token}
          onClose={() => setShowTransfer(false)}
          onDone={() => { setShowTransfer(false); load() }}
          toast={toast}
        />
      )}
      {showAddPerson && (
        <AddPersonModal
          vehicleId={vehicle.id} token={token}
          onClose={() => setShowAddPerson(false)}
          onDone={() => { setShowAddPerson(false); load() }}
          toast={toast}
        />
      )}
    </div>
  )
}

// ---------- inline reg corrector ----------
function CorrectRegInline({ current, busy, onSave, onCancel }: { current: string; busy: boolean; onSave: (r: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(current)
  return (
    <div className="mt-4 flex items-center gap-2">
      <input value={val} onChange={e => setVal(e.target.value.toUpperCase())} className="rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm font-bold tracking-wider w-40 focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
      <button disabled={busy || !val.trim() || val.trim() === current} onClick={() => onSave(val.trim())} className={PRIMARY_BTN}>Save &amp; re-lookup</button>
      <button onClick={onCancel} className={GHOST_BTN}>Cancel</button>
    </div>
  )
}

// ---------- owner & drivers ----------
function OwnerDriverCard({ vehicle, token, onChanged, onAdd, toast }: {
  vehicle: VehicleDetailData; token?: string; onChanged: () => void; onAdd: () => void; toast: ReturnType<typeof useToast>
}) {
  const setReminder = async (link: VehicleLink) => {
    try {
      await api(`/api/v1/vehicles/${vehicle.id}/links/${link.id}`, { method: 'PATCH', token, body: { isReminderRecipient: true } })
      toast.success(`Reminders will go to ${customerName(link.customer)}`)
      onChanged()
    } catch { toast.error('Could not update reminder recipient') }
  }
  const remove = async (link: VehicleLink) => {
    if (!confirm(`Remove ${customerName(link.customer)} as ${ROLE_LABELS[link.role]}?`)) return
    try {
      await api(`/api/v1/vehicles/${vehicle.id}/links/${link.id}`, { method: 'DELETE', token })
      onChanged()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not remove') }
  }
  return (
    <Card title="Owner &amp; drivers" action={<button onClick={onAdd} className="text-xs text-primary">+ Add person</button>}>
      {vehicle.links.length === 0 ? (
        <p className="text-xs text-gray-400">No people linked. Use “Change owner” to set an owner.</p>
      ) : (
        <div className="space-y-2">
          {vehicle.links.map(link => (
            <div key={link.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <Link to={`/customers/${link.customer_id}`} className="text-sm font-medium text-gray-900 hover:text-primary truncate">
                  {customerName(link.customer)}
                </Link>
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">{ROLE_LABELS[link.role]}</span>
                  {link.is_primary && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 text-indigo-700">Billed to</span>}
                  {link.is_reminder_recipient && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">Reminders to</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!link.is_reminder_recipient && <button onClick={() => setReminder(link)} className="text-xs text-gray-500 hover:text-primary">Reminders to</button>}
                {!link.is_primary && <button onClick={() => remove(link)} className="text-xs text-gray-400 hover:text-red-600">Remove</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------- expiry & reminders ----------
function ExpiryCard({ vehicle, token, onChanged, toast }: {
  vehicle: VehicleDetailData; token?: string; onChanged: () => void; toast: ReturnType<typeof useToast>
}) {
  const [adding, setAdding] = useState(false)
  const [types, setTypes] = useState<{ code: string; label: string; is_mileage_based: boolean }[]>([])
  const [form, setForm] = useState({ typeCode: '', dueDate: '', dueMileage: '' })

  const openAdd = async () => {
    setAdding(true)
    try {
      const data = await api<{ types: { code: string; label: string; is_mileage_based: boolean; is_active: boolean }[] }>(`/api/v1/expiry-types`, { token })
      setTypes((data.types || []).filter(t => t.is_active && t.code !== 'mot'))
    } catch { /* noop */ }
  }
  const save = async () => {
    if (!form.typeCode) return
    try {
      await api(`/api/v1/vehicles/${vehicle.id}/expiries`, {
        method: 'PUT', token,
        body: { typeCode: form.typeCode, dueDate: form.dueDate || null, dueMileage: form.dueMileage ? Number(form.dueMileage) : null }
      })
      setAdding(false); setForm({ typeCode: '', dueDate: '', dueMileage: '' })
      onChanged()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save expiry') }
  }
  const dismiss = async (e: VehicleExpiry) => {
    try {
      await api(`/api/v1/vehicles/${vehicle.id}/expiries/${e.type_code}`, { method: 'DELETE', token })
      onChanged()
    } catch { toast.error('Could not dismiss') }
  }
  const active = vehicle.expiries.filter(e => e.is_active)
  return (
    <Card title="Expiry &amp; reminders" action={<button onClick={openAdd} className="text-xs text-primary">+ Add date</button>}>
      {active.length === 0 && !adding && <p className="text-xs text-gray-400">No expiry dates yet. MOT appears automatically once synced; add Service, Tax or custom dates.</p>}
      <div className="space-y-2">
        {active.map(e => {
          const tone = dueTone(e.due_date)
          const label = e.expiry_type?.label || e.type_code
          return (
            <div key={e.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{label}</div>
                <div className="text-xs text-gray-500">
                  {e.due_date ? fmtDate(e.due_date) : 'No date'}
                  {e.due_mileage ? ` · ${e.due_mileage.toLocaleString()} mi` : ''}
                  <span className="ml-2 text-gray-300">{e.source}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone.cls}`}>{tone.label}</span>
                {e.type_code !== 'mot' && <button onClick={() => dismiss(e)} className="text-xs text-gray-400 hover:text-red-600">Dismiss</button>}
              </div>
            </div>
          )
        })}
      </div>
      {adding && (
        <div className="mt-3 border border-gray-200 rounded-lg p-3 space-y-2">
          <select value={form.typeCode} onChange={ev => setForm(f => ({ ...f, typeCode: ev.target.value }))} className="w-full rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm">
            <option value="">Select type…</option>
            {types.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="date" value={form.dueDate} onChange={ev => setForm(f => ({ ...f, dueDate: ev.target.value }))} className="flex-1 rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm" />
            <input type="number" placeholder="Due mileage" value={form.dueMileage} onChange={ev => setForm(f => ({ ...f, dueMileage: ev.target.value }))} className="w-32 rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={GHOST_BTN}>Cancel</button>
            <button onClick={save} disabled={!form.typeCode} className={PRIMARY_BTN}>Save</button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------- notes ----------
const NOTE_CAT_STYLES: Record<string, string> = {
  general: 'bg-gray-100 text-gray-600', warning: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700', internal: 'bg-indigo-100 text-indigo-700'
}
function NotesCard({ vehicle, token, onChanged, toast }: {
  vehicle: VehicleDetailData; token?: string; onChanged: () => void; toast: ReturnType<typeof useToast>
}) {
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('general')
  const add = async () => {
    if (!body.trim()) return
    try {
      await api(`/api/v1/vehicles/${vehicle.id}/notes`, { method: 'POST', token, body: { body: body.trim(), category } })
      setBody(''); setCategory('general'); onChanged()
    } catch { toast.error('Could not add note') }
  }
  const pin = async (n: VehicleNote) => {
    try { await api(`/api/v1/vehicles/${vehicle.id}/notes/${n.id}`, { method: 'PATCH', token, body: { isPinned: !n.is_pinned } }); onChanged() } catch { toast.error('Failed') }
  }
  const del = async (n: VehicleNote) => {
    if (!confirm('Delete this note?')) return
    try { await api(`/api/v1/vehicles/${vehicle.id}/notes/${n.id}`, { method: 'DELETE', token }); onChanged() }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not delete (needs site admin)') }
  }
  return (
    <Card title="Notes">
      <div className="space-y-2 mb-4">
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="Add a note about this vehicle…" className="w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
        <div className="flex items-center justify-between">
          <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-[10px] border border-gray-300 px-3 h-[38px] text-sm">
            <option value="general">General</option>
            <option value="warning">Warning</option>
            <option value="blocked">Blocked</option>
            <option value="internal">Internal</option>
          </select>
          <button onClick={add} disabled={!body.trim()} className={PRIMARY_BTN}>Add note</button>
        </div>
      </div>
      {vehicle.notes.length === 0 ? (
        <p className="text-xs text-gray-400">No notes yet.</p>
      ) : (
        <div className="space-y-2">
          {vehicle.notes.map(n => (
            <div key={n.id} className={`border rounded-lg px-3 py-2 ${n.is_pinned ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${NOTE_CAT_STYLES[n.category]}`}>{n.category}</span>
                  {n.is_pinned && <span className="text-[11px] text-amber-600">📌 pinned</span>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={() => pin(n)} className="text-gray-400 hover:text-amber-600">{n.is_pinned ? 'Unpin' : 'Pin'}</button>
                  <button onClick={() => del(n)} className="text-gray-400 hover:text-red-600">Delete</button>
                </div>
              </div>
              <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{n.body}</p>
              <div className="text-[11px] text-gray-400 mt-1">
                {n.author ? `${n.author.first_name} ${n.author.last_name}` : 'System'} · {fmtDate(n.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------- modals ----------
function TransferOwnerModal({ vehicleId, token, onClose, onDone, toast }: {
  vehicleId: string; token?: string; onClose: () => void; onDone: () => void; toast: ReturnType<typeof useToast>
}) {
  const [picked, setPicked] = useState<PickedCustomer | null>(null)
  const [reason, setReason] = useState('sold')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api(`/api/v1/vehicles/${vehicleId}/transfer-owner`, { method: 'POST', token, body: { toCustomerId: picked.id, reason, notes: notes || null } })
      toast.success('Owner transferred')
      onDone()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Transfer failed'); setBusy(false) }
  }
  return (
    <Modal title="Change owner" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">New owner <span className="text-[#d23f3f]">*</span></label>
          <div className="mt-1"><CustomerPicker value={picked} onChange={setPicked} /></div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Reason</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm">
            <option value="sold">Vehicle sold</option>
            <option value="data_correction">Data correction</option>
            <option value="merge">Customer merge</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Notes <span className="text-[#aeb4be]">· optional</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-[10px] border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <p className="text-[11px] text-gray-400">Past health checks &amp; jobs stay attached to the vehicle. If “sold”, reminders are suppressed.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={GHOST_BTN}>Cancel</button>
          <button onClick={submit} disabled={!picked || busy} className={PRIMARY_BTN}>Transfer</button>
        </div>
      </div>
    </Modal>
  )
}

function AddPersonModal({ vehicleId, token, onClose, onDone, toast }: {
  vehicleId: string; token?: string; onClose: () => void; onDone: () => void; toast: ReturnType<typeof useToast>
}) {
  const [picked, setPicked] = useState<PickedCustomer | null>(null)
  const [role, setRole] = useState<VehicleRole>('driver')
  const [reminder, setReminder] = useState(true)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api(`/api/v1/vehicles/${vehicleId}/links`, { method: 'POST', token, body: { customerId: picked.id, role, isReminderRecipient: reminder } })
      toast.success('Person added')
      onDone()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not add person'); setBusy(false) }
  }
  return (
    <Modal title="Add driver / keeper" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Customer <span className="text-[#d23f3f]">*</span></label>
          <div className="mt-1"><CustomerPicker value={picked} onChange={setPicked} /></div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Role</label>
          <select value={role} onChange={e => setRole(e.target.value as VehicleRole)} className="mt-1 w-full rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm">
            <option value="driver">Driver</option>
            <option value="keeper">Registered keeper</option>
            <option value="fleet_account">Fleet account</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={reminder} onChange={e => setReminder(e.target.checked)} />
          Send MOT/service reminders to this person
        </label>
        <p className="text-[11px] text-gray-400">For a lease car, add the driver here and tick reminders so they (not the leasing company) get the reminders.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={GHOST_BTN}>Cancel</button>
          <button onClick={submit} disabled={!picked || busy} className={PRIMARY_BTN}>Add</button>
        </div>
      </div>
    </Modal>
  )
}
