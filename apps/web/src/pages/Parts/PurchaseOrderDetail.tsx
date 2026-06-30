import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import PartsLineEditor, { blankPartLine, type PartLine } from '../../components/parts/PartsLineEditor'

interface PoLine {
  id: string
  stockItemId: string | null
  repairPartId: string | null
  partNumber: string | null
  description: string
  qtyOrdered: number
  qtyReceived: number
  unitCost: number
  lineStatus: string
  isStocked: boolean
  reconciled: boolean
}
interface PurchaseOrder {
  id: string
  poNumber: string | null
  status: string
  supplierId: string | null
  supplierName: string | null
  locationId: string | null
  supplierInvoiceRef: string | null
  notes: string | null
  orderedAt: string | null
  receivedAt: string | null
  createdAt: string
  lines: PoLine[]
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', ordered: 'bg-indigo-100 text-indigo-800',
  part_received: 'bg-amber-100 text-amber-800', received: 'bg-green-100 text-green-800',
  invoiced: 'bg-blue-100 text-blue-800', closed: 'bg-gray-100 text-gray-500', cancelled: 'bg-red-100 text-red-700',
}
const LABEL: Record<string, string> = {
  draft: 'Draft', ordered: 'Ordered', part_received: 'Part received',
  received: 'Received', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled',
}

interface ReceiveDraft { qty: string; cost: string; condition: 'ok' | 'damaged' }

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const orgId = user?.organization?.id
  const toast = useToast()
  const [po, setPo] = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showReceive, setShowReceive] = useState(false)
  const [receiveDraft, setReceiveDraft] = useState<Record<string, ReceiveDraft>>({})
  const [draftLines, setDraftLines] = useState<PartLine[]>([blankPartLine()])
  const [showInvoice, setShowInvoice] = useState(false)
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceDraft, setInvoiceDraft] = useState<Record<string, { qty: string; cost: string }>>({})

  const fetchPo = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const data = await api<{ order: PurchaseOrder }>(`/api/v1/purchase-orders/${id}`, { token: session?.accessToken })
      setPo(data.order)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load PO')
    } finally {
      setLoading(false)
    }
  }, [id, session?.accessToken, toast])

  useEffect(() => { fetchPo() }, [fetchPo])

  const setStatus = async (status: string) => {
    if (!id) return
    setBusy(true)
    try {
      await api(`/api/v1/purchase-orders/${id}`, { method: 'PATCH', token: session?.accessToken, body: { status } })
      await fetchPo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update PO')
    } finally { setBusy(false) }
  }

  // Persist the draft add-line grid: one POST per line (a stocked catalogue pick links its
  // stock_item_id; free text creates a fresh part on receipt). Then reset the grid + refetch.
  const saveDraftLines = async () => {
    if (!id) return
    const toAdd = draftLines.filter(l => l.description.trim() && (parseFloat(l.qty) || 0) > 0)
    if (!toAdd.length) { toast.error('Add at least one line with a description and quantity'); return }
    setBusy(true)
    try {
      for (const l of toAdd) {
        await api(`/api/v1/purchase-orders/${id}/lines`, {
          method: 'POST', token: session?.accessToken,
          body: { description: l.description.trim(), partNumber: l.partNumber.trim() || null, qtyOrdered: parseFloat(l.qty) || 1, unitCost: parseFloat(l.cost) || 0, stockItemId: l.partId },
        })
      }
      setDraftLines([blankPartLine()])
      await fetchPo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add lines')
    } finally { setBusy(false) }
  }

  const deleteLine = async (lineId: string) => {
    if (!confirm('Remove this line?')) return
    setBusy(true)
    try {
      await api(`/api/v1/purchase-orders/lines/${lineId}`, { method: 'DELETE', token: session?.accessToken })
      await fetchPo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete line')
    } finally { setBusy(false) }
  }

  const openReceive = () => {
    if (!po) return
    const draft: Record<string, ReceiveDraft> = {}
    po.lines.forEach(l => {
      const outstanding = Math.max(l.qtyOrdered - l.qtyReceived, 0)
      if (outstanding > 0) draft[l.id] = { qty: String(outstanding), cost: String(l.unitCost), condition: 'ok' }
    })
    setReceiveDraft(draft)
    setShowReceive(true)
  }

  const submitReceive = async () => {
    if (!id || !po) return
    const lines = Object.entries(receiveDraft)
      .map(([poLineId, d]) => ({ poLineId, qtyReceived: parseFloat(d.qty) || 0, unitCost: parseFloat(d.cost) || 0, condition: d.condition }))
      .filter(l => l.qtyReceived > 0)
    if (!lines.length) { toast.error('Enter a quantity to receive'); return }
    setBusy(true)
    try {
      const res = await api<{ grnNumber: string; movementsWritten: number }>(`/api/v1/purchase-orders/${id}/receive`, {
        method: 'POST', token: session?.accessToken, body: { lines },
      })
      toast.success(`Received — ${res.grnNumber}${res.movementsWritten ? ` (${res.movementsWritten} stock movement${res.movementsWritten > 1 ? 's' : ''})` : ''}`)
      setShowReceive(false)
      await fetchPo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to receive goods')
    } finally { setBusy(false) }
  }

  const openInvoice = () => {
    if (!po) return
    const draft: Record<string, { qty: string; cost: string }> = {}
    po.lines.forEach(l => {
      const qty = l.qtyReceived > 0 ? l.qtyReceived : l.qtyOrdered
      draft[l.id] = { qty: String(qty), cost: String(l.unitCost) }
    })
    setInvoiceDraft(draft)
    setInvoiceRef('')
    setShowInvoice(true)
  }

  const submitInvoice = async () => {
    if (!id || !po) return
    const lines = Object.entries(invoiceDraft)
      .map(([poLineId, d]) => ({ poLineId, qty: parseFloat(d.qty) || 0, unitCost: parseFloat(d.cost) || 0 }))
      .filter(l => l.qty > 0)
    if (!lines.length) { toast.error('Enter at least one line'); return }
    // Guard the reported gap: invoicing books the cost but does NOT add stock. If stocked lines
    // haven't been received yet, on-hand won't build — confirm before posting (Cancel = go back).
    const unreceived = po.lines.filter(l => l.isStocked && l.qtyReceived < l.qtyOrdered)
    if (unreceived.length && !confirm(
      `${unreceived.length} stocked line${unreceived.length > 1 ? 's' : ''} on this PO ${unreceived.length > 1 ? "haven't" : "hasn't"} been received into stock yet.\n\n` +
      'Invoicing books the cost to your accounts but will NOT add stock on hand. Receive the goods first if you want on-hand to build.\n\n' +
      'OK = invoice anyway · Cancel = go back and receive first'
    )) return
    setBusy(true)
    try {
      await api(`/api/v1/purchase-orders/${id}/supplier-invoice`, {
        method: 'POST', token: session?.accessToken,
        body: { invoiceRef: invoiceRef.trim() || null, lines },
      })
      toast.success('Supplier invoice recorded — inventory/AP journal posted')
      setShowInvoice(false)
      await fetchPo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record supplier invoice')
    } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
  }
  if (!po) return <div className="max-w-4xl mx-auto p-6 text-gray-500">Purchase order not found.</div>

  const isDraft = po.status === 'draft'
  const canReceive = ['ordered', 'part_received'].includes(po.status)
  const canInvoice = ['ordered', 'part_received', 'received'].includes(po.status)
  const linesTotal = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitCost, 0)
  // Stocked lines not yet fully received → invoicing books cost but won't add stock.
  const unreceivedStocked = po.lines.filter(l => l.isStocked && l.qtyReceived < l.qtyOrdered)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link to="/parts/purchase-orders" className="text-sm text-gray-500 hover:text-gray-700">← Purchase Orders</Link>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{po.poNumber || 'Draft PO'}</h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[po.status]}`}>{LABEL[po.status] || po.status}</span>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {isDraft && <button disabled={busy || !po.lines.length} onClick={() => setStatus('ordered')} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">Mark as Ordered</button>}
              {canReceive && (
                <button disabled={busy} onClick={openReceive} title="Goods-in: records a GRN and adds stock on hand (do this first)"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-50">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                  Receive goods
                </button>
              )}
              {canInvoice && (
                <button disabled={busy} onClick={openInvoice} title="Books the supplier's cost to your accounts — does NOT add stock"
                  className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                  Supplier invoice
                </button>
              )}
              {(isDraft || po.status === 'ordered') && <button disabled={busy} onClick={() => { if (confirm('Cancel this PO?')) setStatus('cancelled') }} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>}
            </div>
            {(canReceive || canInvoice) && (
              <p className="text-[11px] text-gray-400 text-right">
                <span className="font-medium text-gray-500">Receive</span> adds stock · <span className="font-medium text-gray-500">Invoice</span> books the cost
              </p>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500 mt-1">{po.supplierName || 'Unassigned supplier'} · created {new Date(po.createdAt).toLocaleDateString()}{po.orderedAt ? ` · ordered ${new Date(po.orderedAt).toLocaleDateString()}` : ''}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Part</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ordered</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Received</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit cost</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Line total</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              {isDraft && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {po.lines.length === 0 ? (
              <tr><td colSpan={isDraft ? 7 : 6} className="px-4 py-8 text-center text-gray-500">No lines yet.</td></tr>
            ) : po.lines.map(l => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{l.partNumber || l.description}</div>
                  {l.partNumber && <div className="text-xs text-gray-400">{l.description}</div>}
                  {l.isStocked && <span className="inline-flex mt-0.5 items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700">stocked</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{l.qtyOrdered}</td>
                <td className="px-4 py-3 text-right text-gray-700">{l.qtyReceived}</td>
                <td className="px-4 py-3 text-right text-gray-600">{GBP.format(l.unitCost)}</td>
                <td className="px-4 py-3 text-right text-gray-900">{GBP.format(l.qtyOrdered * l.unitCost)}</td>
                <td className="px-4 py-3 text-center"><span className="text-xs text-gray-500">{l.lineStatus}</span></td>
                {isDraft && <td className="px-4 py-3 text-right"><button onClick={() => deleteLine(l.id)} className="text-red-600 hover:text-red-800 text-sm">Remove</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={4} className="px-4 py-3 text-right text-sm font-medium text-gray-500">Order total</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-900">{GBP.format(linesTotal)}</td>
              <td colSpan={isDraft ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>

      {isDraft && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Add lines</h2>
            <p className="text-xs text-gray-500 mt-0.5">Search the catalogue or type new parts. Press Enter to jump to the next line, then add them to the order.</p>
          </div>
          <PartsLineEditor lines={draftLines} onChange={setDraftLines} orgId={orgId} token={session?.accessToken} />
          <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
            <button onClick={saveDraftLines} disabled={busy} className="px-4 py-2 bg-[#16191f] text-white rounded-[10px] text-sm font-semibold hover:bg-black disabled:opacity-50">Add to order</button>
          </div>
        </div>
      )}

      {/* Receive modal */}
      {showReceive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowReceive(false)}>
          <div className="bg-white rounded-[18px] shadow-xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Receive goods</h3>
              <p className="text-sm text-gray-500">Confirm what arrived. Stocked lines update stock on hand.</p>
            </div>
            <div className="px-6 py-4 max-h-[55vh] overflow-y-auto space-y-3">
              {po.lines.filter(l => l.qtyOrdered - l.qtyReceived > 0).map(l => {
                const d = receiveDraft[l.id]
                if (!d) return null
                return (
                  <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <div className="text-sm font-medium text-gray-900">{l.partNumber || l.description}</div>
                      <div className="text-xs text-gray-400">outstanding {Math.max(l.qtyOrdered - l.qtyReceived, 0)}{l.isStocked ? ' · stocked' : ''}</div>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-gray-400 uppercase">Qty</label>
                      <input type="number" min="0" value={d.qty} onChange={e => setReceiveDraft({ ...receiveDraft, [l.id]: { ...d, qty: e.target.value } })} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] text-gray-400 uppercase">Unit cost</label>
                      <input type="number" min="0" step="0.01" value={d.cost} onChange={e => setReceiveDraft({ ...receiveDraft, [l.id]: { ...d, cost: e.target.value } })} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-gray-400 uppercase">Condition</label>
                      <select value={d.condition} onChange={e => setReceiveDraft({ ...receiveDraft, [l.id]: { ...d, condition: e.target.value as 'ok' | 'damaged' } })} className="w-full border border-gray-300 rounded-lg px-1 py-1.5 text-sm">
                        <option value="ok">OK</option>
                        <option value="damaged">Damaged</option>
                      </select>
                    </div>
                  </div>
                )
              })}
              {po.lines.filter(l => l.qtyOrdered - l.qtyReceived > 0).length === 0 && (
                <p className="text-sm text-gray-400 py-4 text-center">All lines already fully received.</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowReceive(false)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] text-sm">Cancel</button>
              <button onClick={submitReceive} disabled={busy} className="px-4 py-2 bg-[#16191f] text-white rounded-[10px] text-sm font-semibold hover:bg-black disabled:opacity-50">Post receipt</button>
            </div>
          </div>
        </div>
      )}

      {/* Supplier invoice modal */}
      {showInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowInvoice(false)}>
          <div className="bg-white rounded-[18px] shadow-xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Supplier invoice</h3>
              <p className="text-sm text-gray-500">Books the inventory asset (stocked) or parks the cost in WIP (non-stock), plus VAT and the supplier payable.</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              {unreceivedStocked.length > 0 && (
                <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
                  <svg className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" /></svg>
                  <div className="text-sm">
                    <p className="font-medium text-amber-800">These goods haven't been received into stock yet.</p>
                    <p className="text-amber-700 mt-0.5">Invoicing books the cost to your accounts but won't add stock on hand — {unreceivedStocked.length} stocked line{unreceivedStocked.length > 1 ? 's are' : ' is'} still outstanding. Receive the goods first so on-hand builds.</p>
                    {canReceive && (
                      <button onClick={() => { setShowInvoice(false); openReceive() }}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#16191f] text-white rounded-[10px] text-xs font-semibold hover:bg-black">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Receive goods first
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-400 uppercase mb-1">Invoice reference</label>
                <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="Factor invoice no." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="max-h-[45vh] overflow-y-auto space-y-2">
                {po.lines.map(l => {
                  const d = invoiceDraft[l.id]
                  if (!d) return null
                  return (
                    <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <div className="text-sm font-medium text-gray-900">{l.partNumber || l.description}</div>
                        <div className="text-xs text-gray-400">{l.isStocked ? 'stocked → inventory' : 'non-stock → WIP'}</div>
                      </div>
                      <div className="col-span-3">
                        <label className="block text-[10px] text-gray-400 uppercase">Qty</label>
                        <input type="number" min="0" value={d.qty} onChange={e => setInvoiceDraft({ ...invoiceDraft, [l.id]: { ...d, qty: e.target.value } })} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                      </div>
                      <div className="col-span-3">
                        <label className="block text-[10px] text-gray-400 uppercase">Unit cost</label>
                        <input type="number" min="0" step="0.01" value={d.cost} onChange={e => setInvoiceDraft({ ...invoiceDraft, [l.id]: { ...d, cost: e.target.value } })} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowInvoice(false)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] text-sm">Cancel</button>
              <button onClick={submitInvoice} disabled={busy} className="px-4 py-2 bg-[#16191f] text-white rounded-[10px] text-sm font-semibold hover:bg-black disabled:opacity-50">Post invoice</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
