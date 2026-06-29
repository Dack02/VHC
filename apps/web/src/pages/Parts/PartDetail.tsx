import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useModules } from '../../contexts/ModulesContext'
import { api } from '../../lib/api'

interface PartInfo {
  id: string
  partNumber: string
  description: string
  costPrice: number
  isActive: boolean
  isStocked: boolean
  categoryName: string | null
  sellPrice: number | null
  binLocation: string | null
  minQty: number | null
  maxQty: number | null
  preferredSupplierName: string | null
  barcode: string | null
}
interface Kpis { onHand: number; available: number; averageCost: number; stockValue: number; onOrder: number }
interface Movement { id: string; movementType: string; qtyDelta: number; unitCost: number; totalCost: number; referenceType: string | null; reasonCode: string | null; documentDate: string | null; movementAt: string }
interface OpenOrder { lineId: string; poId: string | null; poNumber: string | null; supplierName: string | null; qtyOutstanding: number; unitCost: number }
interface Used { id: string; quantity: number; sellPrice: number | null; lineStatus: string | null; healthCheckId: string | null; jobsheetId: string | null; createdAt: string }

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const MOVE_LABEL: Record<string, string> = {
  receipt: 'Goods in', issue: 'Issued to job', adjustment: 'Adjustment',
  return_in: 'Returned to stock', return_out: 'Returned to supplier', transfer: 'Transfer',
}
const ADJUST_REASONS = ['stock_take', 'shrinkage', 'damaged', 'found', 'data_error', 'other']

export default function PartDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const toast = useToast()
  const { isEnabled } = useModules()
  const stockOn = isEnabled('parts_stock')
  const orgId = user?.organization?.id

  const [part, setPart] = useState<PartInfo | null>(null)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [movements, setMovements] = useState<Movement[]>([])
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([])
  const [whereUsed, setWhereUsed] = useState<Used[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [showAdjust, setShowAdjust] = useState(false)
  const [adjQty, setAdjQty] = useState('')
  const [adjReason, setAdjReason] = useState('stock_take')

  const fetchDetail = useCallback(async () => {
    if (!orgId || !id) return
    try {
      setLoading(true)
      const d = await api<{ part: PartInfo; kpis: Kpis; movements: Movement[]; openOrders: OpenOrder[]; whereUsed: Used[] }>(
        `/api/v1/organizations/${orgId}/parts-catalog/${id}`,
        { token: session?.accessToken }
      )
      setPart(d.part); setKpis(d.kpis); setMovements(d.movements || []); setOpenOrders(d.openOrders || []); setWhereUsed(d.whereUsed || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load part')
    } finally {
      setLoading(false)
    }
  }, [orgId, id, session?.accessToken, toast])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const promote = async () => {
    if (!orgId || !id) return
    if (!confirm('Start tracking this part in stock? Its on-hand will build from goods-in and adjustments.')) return
    setBusy(true)
    try {
      const res = await api<{ healedReceipt?: { qty: number; unitCost: number } | null }>(
        `/api/v1/organizations/${orgId}/parts-catalog/${id}`,
        { method: 'PATCH', token: session?.accessToken, body: { is_stocked: true } }
      )
      const healed = res?.healedReceipt?.qty
      toast.success(healed ? `Now tracked in stock — recovered ${healed} previously received into on-hand` : 'Now tracked in stock')
      await fetchDetail()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') } finally { setBusy(false) }
  }

  const submitAdjust = async () => {
    const delta = parseFloat(adjQty)
    if (!Number.isFinite(delta) || delta === 0) { toast.error('Enter a non-zero quantity (e.g. -1 or 3)'); return }
    setBusy(true)
    try {
      await api(`/api/v1/parts-stock/stock-items/${id}/adjust`, { method: 'POST', token: session?.accessToken, body: { qty_delta: delta, reason_code: adjReason } })
      toast.success('Stock adjusted')
      setShowAdjust(false); setAdjQty('')
      await fetchDetail()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to adjust') } finally { setBusy(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
  if (!part) return null

  const jobLink = (u: Used) => u.jobsheetId ? `/jobsheets/${u.jobsheetId}` : u.healthCheckId ? `/health-checks/${u.healthCheckId}` : null

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link to="/parts" className="text-sm text-gray-500 hover:text-gray-700">← Parts</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{part.partNumber}</h1>
              {part.isStocked
                ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Stocked</span>
                : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Catalogue only</span>}
            </div>
            <p className="text-gray-600 mt-1">{part.description}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mt-2">
              {part.categoryName && <span>Category: <span className="text-gray-700">{part.categoryName}</span></span>}
              {part.preferredSupplierName && <span>Supplier: <span className="text-gray-700">{part.preferredSupplierName}</span></span>}
              {part.binLocation && <span>Bin: <span className="text-gray-700">{part.binLocation}</span></span>}
              {part.barcode && <span>Barcode: <span className="text-gray-700">{part.barcode}</span></span>}
              <span>Cost: <span className="text-gray-700">{GBP.format(part.costPrice)}</span></span>
              {part.sellPrice != null && <span>Sell: <span className="text-gray-700">{GBP.format(part.sellPrice)}</span></span>}
            </div>
          </div>
          {stockOn && (
            <div className="flex items-center gap-2">
              {part.isStocked
                ? <button onClick={() => setShowAdjust(true)} className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black">Adjust stock</button>
                : <button onClick={promote} disabled={busy} className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-50">Track in stock</button>}
            </div>
          )}
        </div>
      </div>

      {stockOn && part.isStocked && kpis && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'On hand', value: String(kpis.onHand) },
            { label: 'Available', value: String(kpis.available) },
            { label: 'On order', value: String(kpis.onOrder) },
            { label: 'Avg cost', value: GBP.format(kpis.averageCost) },
            { label: 'Stock value', value: GBP.format(kpis.stockValue) },
          ].map(k => (
            <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-xs text-gray-500">{k.label}</div>
              <div className="text-lg font-semibold text-gray-900 mt-1">{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {openOrders.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">On order ({openOrders.length})</div>
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">PO</th>
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
              <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Outstanding</th>
              <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit cost</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {openOrders.map(o => (
                <tr key={o.lineId}>
                  <td className="px-5 py-2">{o.poId ? <Link to={`/parts/purchase-orders/${o.poId}`} className="text-primary hover:underline">{o.poNumber || '—'}</Link> : (o.poNumber || '—')}</td>
                  <td className="px-5 py-2 text-gray-600">{o.supplierName || '—'}</td>
                  <td className="px-5 py-2 text-right text-gray-900">{o.qtyOutstanding}</td>
                  <td className="px-5 py-2 text-right text-gray-600">{GBP.format(o.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stockOn && part.isStocked && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Movement history</div>
          {movements.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">No movements yet.</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50"><tr>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit cost</th>
                <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Value</th>
                <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {movements.map(m => (
                  <tr key={m.id}>
                    <td className="px-5 py-2 text-gray-500">{new Date(m.movementAt).toLocaleDateString('en-GB')}</td>
                    <td className="px-5 py-2 text-gray-700">{MOVE_LABEL[m.movementType] || m.movementType}</td>
                    <td className={`px-5 py-2 text-right font-medium ${m.qtyDelta < 0 ? 'text-red-600' : 'text-green-600'}`}>{m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}</td>
                    <td className="px-5 py-2 text-right text-gray-600">{GBP.format(m.unitCost)}</td>
                    <td className="px-5 py-2 text-right text-gray-700">{GBP.format(m.totalCost)}</td>
                    <td className="px-5 py-2 text-gray-500">{m.reasonCode || m.referenceType || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {whereUsed.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">Where used ({whereUsed.length})</div>
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-5 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 uppercase">Job</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {whereUsed.map(u => {
                const link = jobLink(u)
                return (
                  <tr key={u.id}>
                    <td className="px-5 py-2 text-gray-500">{new Date(u.createdAt).toLocaleDateString('en-GB')}</td>
                    <td className="px-5 py-2 text-right text-gray-900">{u.quantity}</td>
                    <td className="px-5 py-2 text-gray-600">{u.lineStatus || '—'}</td>
                    <td className="px-5 py-2">{link ? <Link to={link} className="text-primary hover:underline">Open job</Link> : <span className="text-gray-400">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-500/75" onClick={() => setShowAdjust(false)} />
          <div className="relative bg-white w-full max-w-sm p-6 rounded-[18px] shadow-xl space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Adjust stock</h3>
            <p className="text-xs text-gray-500">Enter the change (+ to add, − to remove). Posts a stock movement and the adjustment journal.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity change</label>
              <input type="number" step="1" value={adjQty} onChange={e => setAdjQty(e.target.value)} placeholder="e.g. -1" className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <select value={adjReason} onChange={e => setAdjReason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                {ADJUST_REASONS.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowAdjust(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={submitAdjust} disabled={busy} className="flex-1 px-4 py-2 bg-[#16191f] text-white rounded-[10px] font-semibold hover:bg-black disabled:opacity-50">{busy ? 'Saving…' : 'Apply'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
