import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import PackagePickerModal from './components/PackagePickerModal'

/**
 * Work Details — a document's labour + parts lines. Shared by the Jobsheet and the
 * Estimate (parameterised by `parent`).
 *
 * A work line IS a repair_item. Editable lines (jobsheet 'booking' / estimate 'estimate')
 * are added here. Inspection findings (origin 'inspection') from a linked VHC are shown
 * read-only — edit those in the VHC. All pricing/VAT/totals come from the server (the
 * repair pricing engine), so this panel just renders + sums.
 *
 * Layout: an invoice-style line-item grid. Each work line is a group header with its
 * labour + parts as column-aligned sub-rows; entry happens in roomy panels under the
 * expanded group, and a stacked summary sits bottom-right.
 */

interface LabourCode { id: string; code: string; description: string; hourlyRate: number; isDefault?: boolean }
interface RepairTypeOpt { id: string; code: string; colour: string; defaultLabourCodeId: string | null }
interface SupplierOpt { id: string; name: string }
interface PackageOpt { id: string; name: string; description?: string | null }

interface WLLabour { id: string; labourCode: { code: string; description: string } | null; hours: number; rate: number; total: number; isVatExempt: boolean; notes: string | null }
interface WLPart { id: string; partNumber: string | null; description: string; quantity: number; sellPrice: number; costPrice: number; lineTotal: number; marginPercent: number | null; supplierName: string | null }
interface WorkLine {
  id: string; name: string; description: string | null; origin: 'booking' | 'inspection' | 'estimate'
  repairTypeId: string | null
  labourTotal: number; partsTotal: number; subtotal: number; vatAmount: number; totalIncVat: number
  outcomeStatus: string | null; labour: WLLabour[]; parts: WLPart[]
}
interface Totals { labourTotal: number; partsTotal: number; subtotal: number; vatAmount: number; totalIncVat: number }

const ZERO: Totals = { labourTotal: 0, partsTotal: 0, subtotal: 0, vatAmount: 0, totalIncVat: 0 }
const money = (n: number) => `£${(n || 0).toFixed(2)}`

// Invoice grid: Description (flex) · Type · Qty/Hr · Rate · Total · action.
// Full-width layout — the panel now spans the whole page, so the description gets
// real room and the numeric columns are comfortably readable / right-aligned.
const GRID_COLS = 'minmax(280px,1fr) 130px 100px 120px 130px 36px'

// Shared field/button styling — follows docs/form-design-guidelines.md (dark focus ring,
// 10px radius, neutral-dark primary action), sized a touch tighter for inline entry.
const fieldCls =
  'h-[38px] w-full box-border rounded-lg border border-[#e4e7ec] bg-white px-3 text-sm text-[#16191f] ' +
  'placeholder:text-[#aeb4be] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'
const labelMini = 'block text-[11px] font-medium text-gray-500 mb-1'
const btnPrimary = 'h-[38px] inline-flex items-center justify-center rounded-lg bg-[#16191f] px-4 text-sm font-medium text-white hover:bg-black disabled:opacity-50'
const btnSecondary = 'h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-[#d7dbe0] bg-white px-3.5 text-sm font-medium text-[#3a3f4a] hover:bg-[#f6f7f9] disabled:opacity-50'
const btnGhost = 'h-[38px] inline-flex items-center rounded-lg px-3 text-sm font-medium text-gray-500 hover:text-gray-700'

export interface WorkDetailsParent { type: 'jobsheet' | 'estimate'; id: string }

export default function WorkDetailsPanel({
  parent, token, organizationId, notes: notesConfig, primaryLabel, onChange, className = 'lg:col-span-2'
}: {
  parent: WorkDetailsParent
  token: string
  organizationId: string | undefined
  /** Optional notes box (e.g. jobsheet Booking Notes). Omit to hide it. */
  notes?: { label: string; value: string | null; onSave: (value: string) => Promise<void> }
  /** Section header for the editable lines. Defaults by parent type. */
  primaryLabel?: string
  onChange?: () => void
  className?: string
}) {
  const basePath = `/api/v1/${parent.type}s/${parent.id}`
  const toast = useToast()
  const [lines, setLines] = useState<WorkLine[]>([])
  const [totals, setTotals] = useState<Totals>(ZERO)
  const [loading, setLoading] = useState(true)
  const [labourCodes, setLabourCodes] = useState<LabourCode[]>([])
  const [repairTypes, setRepairTypes] = useState<RepairTypeOpt[]>([])
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([])
  const [packages, setPackages] = useState<PackageOpt[]>([])
  const [notes, setNotes] = useState(notesConfig?.value || '')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newLineName, setNewLineName] = useState('')
  const [addingLine, setAddingLine] = useState(false)
  const [showPackages, setShowPackages] = useState(false)
  const [busy, setBusy] = useState(false)
  const didInitExpand = useRef(false)

  const load = useCallback(async () => {
    try {
      const data = await api<{ workLines: WorkLine[]; totals: Totals }>(`${basePath}/work-lines`, { token })
      const wl = data.workLines || []
      setLines(wl)
      setTotals(data.totals || ZERO)
      // Default to a fully-expanded invoice on first load; respect the user's collapses after that.
      if (!didInitExpand.current) { setExpanded(new Set(wl.map(l => l.id))); didInitExpand.current = true }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load work details')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, token])

  useEffect(() => { load() }, [load])
  useEffect(() => { setNotes(notesConfig?.value || '') }, [notesConfig?.value])

  useEffect(() => {
    if (!organizationId) return
    api<{ labourCodes: LabourCode[] }>(`/api/v1/organizations/${organizationId}/labour-codes`, { token })
      .then(d => setLabourCodes(d.labourCodes || [])).catch(() => {})
    api<{ repairTypes: RepairTypeOpt[] }>(`/api/v1/repair-types?active_only=true`, { token })
      .then(d => setRepairTypes(d.repairTypes || [])).catch(() => {})
    api<{ suppliers: SupplierOpt[] }>(`/api/v1/organizations/${organizationId}/suppliers`, { token })
      .then(d => setSuppliers(d.suppliers || [])).catch(() => {})
    api<{ servicePackages: PackageOpt[] }>(`/api/v1/organizations/${organizationId}/service-packages`, { token })
      .then(d => setPackages(d.servicePackages || [])).catch(() => {})
  }, [organizationId, token])

  const refresh = useCallback(async () => { await load(); onChange?.() }, [load, onChange])

  const saveNotes = async () => {
    if (!notesConfig || (notesConfig.value || '') === notes) return
    try {
      await notesConfig.onSave(notes)
      onChange?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes')
    }
  }

  const addLine = async () => {
    if (!newLineName.trim()) return
    setBusy(true)
    try {
      const created = await api<WorkLine>(`${basePath}/work-lines`, { method: 'POST', token, body: { name: newLineName.trim() } })
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
        await api(`${basePath}/work-lines/from-package`, { method: 'POST', token, body: { servicePackageId: pkgId } })
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

  // Labour is locked to the line's Repair Type — no labour code is sent; the server resolves the
  // rate from the type's default labour code (and 400s if the line has no type).
  const addLabour = async (lineId: string, hours: number, description: string) => {
    try { await api(`/api/v1/repair-items/${lineId}/labour`, { method: 'POST', token, body: { hours, notes: description || undefined } }); await refresh(); return true }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add labour'); return false }
  }
  const setLineRepairType = async (lineId: string, repairTypeId: string) => {
    try { await api(`/api/v1/repair-items/${lineId}`, { method: 'PATCH', token, body: { repairTypeId: repairTypeId || null } }); await refresh() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to set repair type') }
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

  const editableLines = lines.filter(l => l.origin !== 'inspection')
  const inspection = lines.filter(l => l.origin === 'inspection')
  const sectionLabel = primaryLabel ?? (parent.type === 'estimate' ? 'Quote lines' : 'Booked work')
  const emptyLabel = parent.type === 'estimate' ? 'No quote lines yet.' : 'No booked work yet.'
  const hasRows = editableLines.length > 0 || inspection.length > 0

  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Work details</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {editableLines.length > 0
              ? `${editableLines.length} ${editableLines.length === 1 ? 'line' : 'lines'}`
              : 'Add labour, parts and packages'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setAddingLine(true)} disabled={addingLine} className={btnSecondary}>
            <span className="text-base leading-none">+</span> Add line
          </button>
          <button onClick={() => setShowPackages(true)} disabled={busy}
            className="h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3.5 text-sm font-medium text-primary hover:bg-indigo-50 disabled:opacity-50">
            <span className="text-base leading-none">+</span> Add from package
          </button>
        </div>
      </div>

      {/* Optional notes box — overview of the work / customer concern */}
      {notesConfig && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">{notesConfig.label}</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={2}
            placeholder="Overview of the job / customer concern…"
            className="w-full border border-[#e4e7ec] rounded-lg px-3 py-2 text-sm text-[#16191f] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]"
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : !hasRows && !addingLine ? (
        <div className="text-center py-10 border border-dashed border-gray-200 rounded-xl">
          <p className="text-sm text-gray-500">{emptyLabel}</p>
          <button onClick={() => setAddingLine(true)} className={`${btnPrimary} mt-3`}>Add your first line</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{sectionLabel}</p>

          {hasRows && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Column header band */}
              <div className="grid gap-x-2 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wide text-gray-400" style={{ gridTemplateColumns: GRID_COLS }}>
                <span className="truncate">Description</span>
                <span className="truncate">Type</span>
                <span className="text-right">Qty/Hr</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Total</span>
                <span aria-hidden="true" />
              </div>

              <div className="divide-y divide-gray-100">
                {editableLines.map(line => (
                  <WorkLineGroup key={line.id} line={line} editable expanded={expanded.has(line.id)}
                    labourCodes={labourCodes} repairTypes={repairTypes} suppliers={suppliers}
                    onToggle={() => toggle(line.id)} onDeleteLine={() => deleteLine(line.id)} onSetRepairType={setLineRepairType}
                    onAddLabour={addLabour} onDeleteLabour={deleteLabour} onAddPart={addPart} onDeletePart={deletePart} />
                ))}

                {inspection.length > 0 && (
                  <div className="px-3 py-2 bg-gray-50/60 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    From inspection (VHC)
                  </div>
                )}
                {inspection.map(line => (
                  <WorkLineGroup key={line.id} line={line} editable={false} expanded={expanded.has(line.id)}
                    labourCodes={labourCodes} repairTypes={repairTypes} suppliers={suppliers}
                    onToggle={() => toggle(line.id)} onDeleteLine={() => {}} onSetRepairType={async () => {}}
                    onAddLabour={async () => false} onDeleteLabour={async () => {}} onAddPart={async () => false} onDeletePart={async () => {}} />
                ))}
              </div>
            </div>
          )}

          {/* Add work line */}
          {addingLine && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 p-3">
              <label className={labelMini}>Work line name</label>
              <div className="flex flex-wrap items-center gap-2">
                <input autoFocus value={newLineName} onChange={e => setNewLineName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addLine(); if (e.key === 'Escape') { setAddingLine(false); setNewLineName('') } }}
                  placeholder="e.g. Full service" className={`${fieldCls} flex-1 min-w-[14rem]`} />
                <button onClick={addLine} disabled={busy || !newLineName.trim()} className={btnPrimary}>Add line</button>
                <button onClick={() => { setAddingLine(false); setNewLineName('') }} className={btnGhost}>Cancel</button>
              </div>
            </div>
          )}

          {/* Document totals — invoice-style summary */}
          <div className="flex justify-end">
            <div className="w-full sm:w-80 text-sm">
              <div className="flex justify-between py-1 text-gray-500"><span>Labour</span><span className="text-gray-900">{money(totals.labourTotal)}</span></div>
              <div className="flex justify-between py-1 text-gray-500"><span>Parts</span><span className="text-gray-900">{money(totals.partsTotal)}</span></div>
              <div className="flex justify-between py-1 text-gray-500"><span>Net</span><span className="text-gray-900">{money(totals.subtotal)}</span></div>
              <div className="flex justify-between py-1 pb-2 text-gray-500 border-b border-gray-100"><span>VAT</span><span className="text-gray-900">{money(totals.vatAmount)}</span></div>
              <div className="flex justify-between pt-2 text-base font-semibold text-gray-900"><span>Total inc VAT</span><span>{money(totals.totalIncVat)}</span></div>
            </div>
          </div>
        </div>
      )}

      {showPackages && (
        <PackagePickerModal
          packages={packages}
          selectedIds={[]}
          onClose={() => setShowPackages(false)}
          onConfirm={addPackages}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function WorkLineGroup({
  line, editable, expanded, labourCodes, repairTypes, suppliers,
  onToggle, onDeleteLine, onSetRepairType, onAddLabour, onDeleteLabour, onAddPart, onDeletePart
}: {
  line: WorkLine
  editable: boolean
  expanded: boolean
  labourCodes: LabourCode[]
  repairTypes: RepairTypeOpt[]
  suppliers: SupplierOpt[]
  onToggle: () => void
  onDeleteLine: () => void
  onSetRepairType: (lineId: string, repairTypeId: string) => Promise<void>
  onAddLabour: (lineId: string, hours: number, description: string) => Promise<boolean>
  onDeleteLabour: (id: string) => Promise<void>
  onAddPart: (lineId: string, body: Record<string, unknown>) => Promise<boolean>
  onDeletePart: (id: string) => Promise<void>
}) {
  const [labDesc, setLabDesc] = useState('')
  const [labHours, setLabHours] = useState('')
  const [savingLab, setSavingLab] = useState(false)
  const [part, setPart] = useState({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' })
  const [savingPart, setSavingPart] = useState(false)
  // Which inline editor is open in this line: none, labour, or part. One at a time.
  const [editor, setEditor] = useState<null | 'labour' | 'part'>(null)

  // Labour is locked to the line's Repair Type → its default labour code → rate.
  const repairType = repairTypes.find(rt => rt.id === line.repairTypeId) || null
  const lockedCode = repairType?.defaultLabourCodeId ? (labourCodes.find(c => c.id === repairType.defaultLabourCodeId) || null) : null
  const canAddLabour = !!repairType && !!lockedCode

  const sp = parseFloat(part.sellPrice)
  const cp = parseFloat(part.costPrice) || 0
  const margin = !isNaN(sp) && sp > 0 ? ((sp - cp) / sp) * 100 : null

  const submitLabour = async () => {
    const h = parseFloat(labHours)
    if (!canAddLabour || !labDesc.trim() || isNaN(h) || h <= 0) return
    setSavingLab(true)
    const ok = await onAddLabour(line.id, h, labDesc.trim())
    setSavingLab(false)
    if (ok) { setLabHours(''); setLabDesc(''); setEditor(null) }
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
    if (ok) { setPart({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' }); setEditor(null) }
  }

  const compactSelect = 'h-9 rounded-lg border border-[#e4e7ec] bg-white px-2.5 text-sm text-[#16191f] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'
  const btnSave = 'h-9 px-4 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50'
  const btnCancel = 'h-9 px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50'
  const cellInput = 'h-9 w-full rounded-lg border border-[#e4e7ec] bg-white px-2.5 text-sm text-[#16191f] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'

  return (
    <div>
      {/* Group header row */}
      <div className="grid items-center gap-x-2 px-3 py-2.5 hover:bg-gray-50/60" style={{ gridTemplateColumns: GRID_COLS }}>
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 overflow-hidden text-left">
          <svg className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="font-medium text-gray-900 truncate">{line.name}</span>
          {line.origin === 'booking' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 bg-indigo-100 text-indigo-700">Booked</span>}
          {line.origin === 'inspection' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 bg-gray-100 text-gray-600">Inspection</span>}
          {line.outcomeStatus === 'authorised' && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 bg-green-100 text-green-700">Authorised</span>}
        </button>
        <span className="text-xs text-gray-400 truncate">{repairType?.code || '—'}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="text-right text-sm font-semibold text-gray-900">{money(line.totalIncVat)}</span>
        <span className="text-right">
          {editable && <button onClick={onDeleteLine} className="text-gray-300 hover:text-red-600" title="Remove line">✕</button>}
        </span>
      </div>

      {expanded && (
        <div className="pb-3">
          {/* Repair Type — drives the labour rate (locked) */}
          <div className="flex items-center flex-wrap gap-2 mx-3 mb-2 px-3 py-2 rounded-lg bg-gray-50/70">
            <span className="text-xs font-medium text-gray-500">Repair type</span>
            {editable ? (
              <select value={line.repairTypeId || ''} onChange={e => onSetRepairType(line.id, e.target.value)} className={compactSelect}>
                <option value="">— Select —</option>
                {repairTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.code}</option>)}
              </select>
            ) : (
              <span className="text-sm text-gray-700">{repairType?.code || '—'}</span>
            )}
            {repairType && (lockedCode
              ? <span className="text-xs text-gray-400">Labour @ {money(lockedCode.hourlyRate)}/hr</span>
              : <span className="text-xs text-amber-600">No labour code on this type</span>)}
          </div>

          {/* Labour + parts as column-aligned line items */}
          {line.labour.length === 0 && line.parts.length === 0 && (
            <p className="px-3 pl-9 py-1 text-xs text-gray-400">No labour or parts yet.</p>
          )}
          {line.labour.map(l => (
            <div key={l.id} className="grid items-center gap-x-2 px-3 py-1.5 text-sm" style={{ gridTemplateColumns: GRID_COLS }}>
              <span className="truncate pl-6 text-gray-700">{l.notes || l.labourCode?.description || 'Labour'}{l.isVatExempt ? ' · VAT exempt' : ''}</span>
              <span className="text-xs text-gray-500">Labour</span>
              <span className="text-right text-gray-600">{l.hours}h</span>
              <span className="text-right text-gray-600">{money(l.rate)}</span>
              <span className="text-right text-gray-900">{money(l.total)}</span>
              <span className="text-right">{editable && <button onClick={() => onDeleteLabour(l.id)} className="text-gray-300 hover:text-red-600" title="Delete">✕</button>}</span>
            </div>
          ))}
          {line.parts.map(p => (
            <div key={p.id} className="grid items-center gap-x-2 px-3 py-1.5 text-sm" style={{ gridTemplateColumns: GRID_COLS }}>
              <span className="truncate pl-6 text-gray-700">{p.description}{p.supplierName ? ` · ${p.supplierName}` : ''}</span>
              <span className="text-xs text-gray-500">Part</span>
              <span className="text-right text-gray-600">{p.quantity}</span>
              <span className="text-right text-gray-600">{money(p.sellPrice)}</span>
              <span className="text-right text-gray-900">{money(p.lineTotal)}</span>
              <span className="text-right">{editable && <button onClick={() => onDeletePart(p.id)} className="text-gray-300 hover:text-red-600" title="Delete">✕</button>}</span>
            </div>
          ))}

          {/* Inline entry — one editor at a time, aligned to the line-item grid */}
          {editable && (
            <>
              {/* LABOUR editor */}
              {editor === 'labour' && (
                canAddLabour ? (
                  <>
                    <div className="grid items-center gap-x-2 px-3 py-2 bg-green-50 border-y border-green-200" style={{ gridTemplateColumns: GRID_COLS }}>
                      <input autoFocus value={labDesc} onChange={e => setLabDesc(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitLabour(); if (e.key === 'Escape') setEditor(null) }}
                        placeholder="Labour description" className={`${cellInput} ml-6`} style={{ width: 'calc(100% - 1.5rem)' }} />
                      <span className="text-xs font-medium text-green-700">Labour</span>
                      <input type="number" step="0.1" min="0" value={labHours} onChange={e => setLabHours(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitLabour() }} placeholder="0.0" className={`${cellInput} text-right`} />
                      <span className="text-right text-sm text-gray-500">{money(lockedCode!.hourlyRate)}</span>
                      <span className="text-right text-sm font-semibold text-gray-900">{money((parseFloat(labHours) || 0) * lockedCode!.hourlyRate)}</span>
                      <span />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 pl-9 bg-green-50 border-b border-green-200">
                      <span className="text-xs text-gray-500">{lockedCode!.code} @ {money(lockedCode!.hourlyRate)}/hr</span>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => setEditor(null)} className={btnCancel}>Cancel</button>
                        <button onClick={submitLabour} disabled={savingLab || !labDesc.trim() || !labHours} className={btnSave}>Save labour</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="px-3 pl-9 py-2 text-xs text-amber-600">Pick a repair type {repairType && !lockedCode ? 'with a default labour code ' : ''}above to add labour.</p>
                )
              )}

              {/* PART editor */}
              {editor === 'part' && (
                <>
                  <div className="grid items-center gap-x-2 px-3 py-2 bg-green-50 border-y border-green-200" style={{ gridTemplateColumns: GRID_COLS }}>
                    <input autoFocus value={part.description} onChange={e => setPart({ ...part, description: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setEditor(null) }}
                      placeholder="Part description" className={`${cellInput} ml-6`} style={{ width: 'calc(100% - 1.5rem)' }} />
                    <span className="text-xs font-medium text-green-700">Part</span>
                    <input type="number" step="1" min="0" value={part.quantity} onChange={e => setPart({ ...part, quantity: e.target.value })} className={`${cellInput} text-right`} />
                    <input type="number" step="0.01" min="0" value={part.sellPrice} onChange={e => setPart({ ...part, sellPrice: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') submitPart() }} placeholder="Sell £" className={`${cellInput} text-right`} />
                    <span className="text-right text-sm font-semibold text-gray-900">{money((parseFloat(part.quantity) || 0) * (parseFloat(part.sellPrice) || 0))}</span>
                    <span />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 pl-9 bg-green-50 border-b border-green-200">
                    <select value={part.supplierId} onChange={e => setPart({ ...part, supplierId: e.target.value })} className={compactSelect}>
                      <option value="">Supplier —</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="number" step="0.01" min="0" value={part.costPrice} onChange={e => setPart({ ...part, costPrice: e.target.value })} placeholder="Cost £" className={`${cellInput} w-28`} />
                    {margin != null && <span className="text-xs text-gray-500">Margin <strong className="text-green-700">{margin.toFixed(0)}%</strong></span>}
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => setEditor(null)} className={btnCancel}>Cancel</button>
                      <button onClick={submitPart} disabled={savingPart || !part.description.trim() || part.sellPrice === ''} className={btnSave}>Save part</button>
                    </div>
                  </div>
                </>
              )}

              {/* Resting action row */}
              {editor === null && (
                <div className="flex gap-5 px-3 py-2 pl-12">
                  <button onClick={() => setEditor('labour')} className="text-sm font-semibold text-green-700 hover:text-green-800">+ Labour</button>
                  <button onClick={() => setEditor('part')} className="text-sm font-semibold text-green-700 hover:text-green-800">+ Part</button>
                </div>
              )}
            </>
          )}

          {/* Line subtotal */}
          <div className="flex items-center justify-end gap-3 px-3 pt-2 mt-1 text-xs text-gray-500">
            <span>Net {money(line.subtotal)}</span>
            <span>VAT {money(line.vatAmount)}</span>
            {!editable && <span className="text-gray-400">Edit in VHC</span>}
          </div>
        </div>
      )}
    </div>
  )
}
