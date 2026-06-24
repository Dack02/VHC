import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import PackagePickerModal from './components/PackagePickerModal'

/**
 * Work Details — the jobsheet's labour + parts lines.
 *
 * A work line IS a repair_item. Booked lines (origin 'booking') are added here and
 * are fully editable + pre-authorised. Inspection findings (origin 'inspection') from
 * the linked VHC are shown read-only — edit those in the VHC. All pricing/VAT/totals
 * come from the server (the repair pricing engine), so this panel just renders + sums.
 */

interface LabourCode { id: string; code: string; description: string; hourlyRate: number; isDefault?: boolean }
interface SupplierOpt { id: string; name: string }
interface PackageOpt { id: string; name: string; description?: string | null }

interface WLLabour { id: string; labourCode: { code: string; description: string } | null; hours: number; rate: number; total: number; isVatExempt: boolean; notes: string | null }
interface WLPart { id: string; partNumber: string | null; description: string; quantity: number; sellPrice: number; costPrice: number; lineTotal: number; marginPercent: number | null; supplierName: string | null }
interface WorkLine {
  id: string; name: string; description: string | null; origin: 'booking' | 'inspection'
  labourTotal: number; partsTotal: number; subtotal: number; vatAmount: number; totalIncVat: number
  outcomeStatus: string | null; labour: WLLabour[]; parts: WLPart[]
}
interface Totals { labourTotal: number; partsTotal: number; subtotal: number; vatAmount: number; totalIncVat: number }

const ZERO: Totals = { labourTotal: 0, partsTotal: 0, subtotal: 0, vatAmount: 0, totalIncVat: 0 }
const money = (n: number) => `£${(n || 0).toFixed(2)}`

export default function WorkDetailsPanel({
  jobsheetId, token, organizationId, initialBookingNotes, onChange, className = 'lg:col-span-2'
}: {
  jobsheetId: string
  token: string
  organizationId: string | undefined
  initialBookingNotes: string | null
  onChange?: () => void
  className?: string
}) {
  const toast = useToast()
  const [lines, setLines] = useState<WorkLine[]>([])
  const [totals, setTotals] = useState<Totals>(ZERO)
  const [loading, setLoading] = useState(true)
  const [labourCodes, setLabourCodes] = useState<LabourCode[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [packages, setPackages] = useState<PackageOpt[]>([])
  const [notes, setNotes] = useState(initialBookingNotes || '')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newLineName, setNewLineName] = useState('')
  const [addingLine, setAddingLine] = useState(false)
  const [showPackages, setShowPackages] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api<{ workLines: WorkLine[]; totals: Totals }>(`/api/v1/jobsheets/${jobsheetId}/work-lines`, { token })
      setLines(data.workLines || [])
      setTotals(data.totals || ZERO)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load work details')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsheetId, token])

  useEffect(() => { load() }, [load])
  useEffect(() => { setNotes(initialBookingNotes || '') }, [initialBookingNotes])

  useEffect(() => {
    if (!organizationId) return
    api<{ labourCodes: LabourCode[] }>(`/api/v1/organizations/${organizationId}/labour-codes`, { token })
      .then(d => setLabourCodes(d.labourCodes || [])).catch(() => {})
    api<{ suppliers: SupplierOpt[] }>(`/api/v1/organizations/${organizationId}/suppliers`, { token })
      .then(d => setSuppliers(d.suppliers || [])).catch(() => {})
    api<{ servicePackages: PackageOpt[] }>(`/api/v1/organizations/${organizationId}/service-packages`, { token })
      .then(d => setPackages(d.servicePackages || [])).catch(() => {})
  }, [organizationId, token])

  const refresh = useCallback(async () => { await load(); onChange?.() }, [load, onChange])

  const saveNotes = async () => {
    if ((initialBookingNotes || '') === notes) return
    try {
      await api(`/api/v1/jobsheets/${jobsheetId}`, { method: 'PATCH', token, body: { bookingNotes: notes } })
      onChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes')
    }
  }

  const addLine = async () => {
    if (!newLineName.trim()) return
    setBusy(true)
    try {
      const created = await api<WorkLine>(`/api/v1/jobsheets/${jobsheetId}/work-lines`, { method: 'POST', token, body: { name: newLineName.trim() } })
      setNewLineName(''); setAddingLine(false)
      setExpanded(s => new Set(s).add(created.id))
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add work line')
    } finally { setBusy(false) }
  }

  const addPackages = async (pkgIds: string[]) => {
    if (pkgIds.length === 0) return
    setBusy(true)
    try {
      for (const pkgId of pkgIds) {
        await api(`/api/v1/jobsheets/${jobsheetId}/work-lines/from-package`, { method: 'POST', token, body: { servicePackageId: pkgId } })
      }
      await refresh()
      toast.success(pkgIds.length === 1 ? 'Package added' : `${pkgIds.length} packages added`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add package')
    } finally { setBusy(false) }
  }

  const deleteLine = async (lineId: string) => {
    if (!window.confirm('Remove this work line?')) return
    try { await api(`/api/v1/repair-items/${lineId}`, { method: 'DELETE', token }); await refresh() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to remove line') }
  }

  const addLabour = async (lineId: string, labourCodeId: string, hours: number, description: string) => {
    try { await api(`/api/v1/repair-items/${lineId}/labour`, { method: 'POST', token, body: { labour_code_id: labourCodeId, hours, notes: description || undefined } }); await refresh(); return true }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add labour'); return false }
  }
  const deleteLabour = async (id: string) => {
    try { await api(`/api/v1/repair-labour/${id}`, { method: 'DELETE', token }); await refresh() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete labour') }
  }
  const addPart = async (lineId: string, body: Record<string, unknown>) => {
    try { await api(`/api/v1/repair-items/${lineId}/parts`, { method: 'POST', token, body }); await refresh(); return true }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add part'); return false }
  }
  const deletePart = async (id: string) => {
    try { await api(`/api/v1/repair-parts/${id}`, { method: 'DELETE', token }); await refresh() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to delete part') }
  }

  const toggle = (id: string) => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const booked = lines.filter(l => l.origin === 'booking')
  const inspection = lines.filter(l => l.origin === 'inspection')

  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Work Details</h2>
        <div className="text-right">
          <div className="text-xs text-gray-400">Total inc VAT</div>
          <div className="text-lg font-semibold text-gray-900 leading-tight">{money(totals.totalIncVat)}</div>
        </div>
      </div>

      {/* Booking notes — overview of the work / customer concern */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Booking Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={2}
          placeholder="Overview of the job / customer concern…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-4">
          {/* Booked work */}
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Booked work</p>
            <div className="space-y-2">
              {booked.length === 0 && <p className="text-sm text-gray-400 py-1">No booked work yet.</p>}
              {booked.map(line => (
                <WorkLineCard key={line.id} line={line} editable expanded={expanded.has(line.id)}
                  labourCodes={labourCodes} suppliers={suppliers}
                  onToggle={() => toggle(line.id)} onDeleteLine={() => deleteLine(line.id)}
                  onAddLabour={addLabour} onDeleteLabour={deleteLabour} onAddPart={addPart} onDeletePart={deletePart} />
              ))}
            </div>

            {/* Add controls */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {addingLine ? (
                <div className="flex items-center gap-2">
                  <input autoFocus value={newLineName} onChange={e => setNewLineName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addLine(); if (e.key === 'Escape') { setAddingLine(false); setNewLineName('') } }}
                    placeholder="Work line name (e.g. Full Service)"
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  <button onClick={addLine} disabled={busy || !newLineName.trim()} className="px-3 py-1.5 bg-primary text-white text-sm rounded-lg disabled:opacity-50">Add</button>
                  <button onClick={() => { setAddingLine(false); setNewLineName('') }} className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setAddingLine(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                  <span className="text-base leading-none">+</span> Add work line
                </button>
              )}
              <button onClick={() => setShowPackages(true)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50">
                <span className="text-base leading-none">+</span> Add from package
              </button>
              {showPackages && (
                <PackagePickerModal
                  packages={packages}
                  selectedIds={[]}
                  onClose={() => setShowPackages(false)}
                  onConfirm={addPackages}
                />
              )}
            </div>
          </div>

          {/* Inspection findings (read-only here) */}
          {inspection.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">From inspection (VHC)</p>
              <div className="space-y-2">
                {inspection.map(line => (
                  <WorkLineCard key={line.id} line={line} editable={false} expanded={expanded.has(line.id)}
                    labourCodes={labourCodes} suppliers={suppliers}
                    onToggle={() => toggle(line.id)} onDeleteLine={() => {}}
                    onAddLabour={async () => false} onDeleteLabour={async () => {}} onAddPart={async () => false} onDeletePart={async () => {}} />
                ))}
              </div>
            </div>
          )}

          {/* Document totals */}
          <div className="border-t border-gray-100 pt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">Labour <span className="text-gray-900 font-medium ml-1">{money(totals.labourTotal)}</span></span>
            <span className="text-gray-500">Parts <span className="text-gray-900 font-medium ml-1">{money(totals.partsTotal)}</span></span>
            <span className="text-gray-500">Net <span className="text-gray-900 font-medium ml-1">{money(totals.subtotal)}</span></span>
            <span className="text-gray-500">VAT <span className="text-gray-900 font-medium ml-1">{money(totals.vatAmount)}</span></span>
            <span className="text-gray-900 font-semibold">Total inc VAT {money(totals.totalIncVat)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function WorkLineCard({
  line, editable, expanded, labourCodes, suppliers,
  onToggle, onDeleteLine, onAddLabour, onDeleteLabour, onAddPart, onDeletePart
}: {
  line: WorkLine
  editable: boolean
  expanded: boolean
  labourCodes: LabourCode[]
  suppliers: SupplierOpt[]
  onToggle: () => void
  onDeleteLine: () => void
  onAddLabour: (lineId: string, labourCodeId: string, hours: number, description: string) => Promise<boolean>
  onDeleteLabour: (id: string) => Promise<void>
  onAddPart: (lineId: string, body: Record<string, unknown>) => Promise<boolean>
  onDeletePart: (id: string) => Promise<void>
}) {
  const [labCode, setLabCode] = useState('')
  const [labDesc, setLabDesc] = useState('')
  const [labHours, setLabHours] = useState('')
  const [savingLab, setSavingLab] = useState(false)
  const [part, setPart] = useState({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' })
  const [savingPart, setSavingPart] = useState(false)

  useEffect(() => {
    if (!labCode && labourCodes.length) setLabCode((labourCodes.find(c => c.isDefault) || labourCodes[0]).id)
  }, [labourCodes, labCode])

  const sp = parseFloat(part.sellPrice)
  const cp = parseFloat(part.costPrice) || 0
  const margin = !isNaN(sp) && sp > 0 ? ((sp - cp) / sp) * 100 : null

  const submitLabour = async () => {
    const h = parseFloat(labHours)
    if (!labCode || !labDesc.trim() || isNaN(h) || h <= 0) return
    setSavingLab(true)
    const ok = await onAddLabour(line.id, labCode, h, labDesc.trim())
    setSavingLab(false)
    if (ok) { setLabHours(''); setLabDesc('') }
  }
  const submitPart = async () => {
    if (!part.description.trim() || part.sellPrice === '' || isNaN(parseFloat(part.sellPrice))) return
    setSavingPart(true)
    const ok = await onAddPart(line.id, {
      description: part.description.trim(),
      quantity: parseFloat(part.quantity) || 1,
      cost_price: part.costPrice === '' ? 0 : parseFloat(part.costPrice),
      sell_price: parseFloat(part.sellPrice),
      supplier_id: part.supplierId || undefined
    })
    setSavingPart(false)
    if (ok) setPart({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' })
  }

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 text-left">
        <div className="flex items-center gap-2 min-w-0">
          <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="font-medium text-gray-900 truncate">{line.name}</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${line.origin === 'booking' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
            {line.origin === 'booking' ? 'Booked' : 'Inspection'}
          </span>
          {line.outcomeStatus === 'authorised' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 shrink-0">Authorised</span>}
        </div>
        <span className="text-sm font-semibold text-gray-900 shrink-0 ml-2">{money(line.totalIncVat)}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-3">
          {/* Labour */}
          <div>
            <div className="flex justify-between text-xs font-medium text-gray-500 mb-1"><span>Labour</span><span>{money(line.labourTotal)}</span></div>
            {line.labour.length === 0 && <p className="text-xs text-gray-400">No labour.</p>}
            {line.labour.map(l => (
              <div key={l.id} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-700 truncate">{l.labourCode?.code || 'Labour'}{l.notes ? ` · ${l.notes}` : ''} · {l.hours}h @ {money(l.rate)}{l.isVatExempt ? ' · VAT exempt' : ''}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-900">{money(l.total)}</span>
                  {editable && <button onClick={() => onDeleteLabour(l.id)} className="text-gray-400 hover:text-red-600" title="Delete">✕</button>}
                </span>
              </div>
            ))}
            {editable && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <select value={labCode} onChange={e => setLabCode(e.target.value)} className={inputCls}>
                  {labourCodes.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                </select>
                <input value={labDesc} onChange={e => setLabDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitLabour() }} placeholder="Description" className={`${inputCls} flex-1 min-w-[8rem]`} />
                <input type="number" step="0.1" min="0" value={labHours} onChange={e => setLabHours(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitLabour() }} placeholder="hrs" className={`${inputCls} w-20 text-right`} />
                <button onClick={submitLabour} disabled={savingLab || !labCode || !labDesc.trim() || !labHours} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 disabled:opacity-50">Add labour</button>
              </div>
            )}
          </div>

          {/* Parts */}
          <div>
            <div className="flex justify-between text-xs font-medium text-gray-500 mb-1"><span>Parts</span><span>{money(line.partsTotal)}</span></div>
            {line.parts.length === 0 && <p className="text-xs text-gray-400">No parts.</p>}
            {line.parts.map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-700 truncate">{p.quantity} × {p.description}{p.supplierName ? ` · ${p.supplierName}` : ''}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-900">{money(p.lineTotal)}</span>
                  {editable && <button onClick={() => onDeletePart(p.id)} className="text-gray-400 hover:text-red-600" title="Delete">✕</button>}
                </span>
              </div>
            ))}
            {editable && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <input value={part.description} onChange={e => setPart({ ...part, description: e.target.value })} placeholder="Part description" className={`${inputCls} flex-1 min-w-[8rem]`} />
                <input type="number" step="1" min="0" value={part.quantity} onChange={e => setPart({ ...part, quantity: e.target.value })} placeholder="qty" className={`${inputCls} w-16 text-right`} />
                <input type="number" step="0.01" min="0" value={part.costPrice} onChange={e => setPart({ ...part, costPrice: e.target.value })} placeholder="cost" className={`${inputCls} w-20 text-right`} />
                <input type="number" step="0.01" min="0" value={part.sellPrice} onChange={e => setPart({ ...part, sellPrice: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') submitPart() }} placeholder="sell" className={`${inputCls} w-20 text-right`} />
                <select value={part.supplierId} onChange={e => setPart({ ...part, supplierId: e.target.value })} className={inputCls}>
                  <option value="">Supplier…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {margin != null && <span className="text-xs text-gray-400">{margin.toFixed(0)}% margin</span>}
                <button onClick={submitPart} disabled={savingPart || !part.description.trim() || part.sellPrice === ''} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 disabled:opacity-50">Add part</button>
              </div>
            )}
          </div>

          {/* Line totals + remove */}
          <div className="flex items-center justify-between border-t border-gray-100 pt-2">
            <div className="text-xs text-gray-500">Net {money(line.subtotal)} · VAT {money(line.vatAmount)}</div>
            {editable
              ? <button onClick={onDeleteLine} className="text-xs text-red-600 hover:underline">Remove line</button>
              : <span className="text-xs text-gray-400">Edit in VHC</span>}
          </div>
        </div>
      )}
    </div>
  )
}
