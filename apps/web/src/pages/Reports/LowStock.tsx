import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface LowStockRow {
  id: string
  partNumber: string
  description: string
  categoryName: string
  qtyOnHand: number
  minQty: number
  maxQty: number | null
  suggestedOrder: number
  averageCost: number
  preferredSupplierId: string | null
}

export default function LowStock() {
  const { session } = useAuth()
  const [rows, setRows] = useState<LowStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creatingPos, setCreatingPos] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: LowStockRow[] }>(
        '/api/v1/reports/low-stock',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load low stock')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  const estReorderValue = rows.reduce((s, r) => s + r.suggestedOrder * r.averageCost, 0)

  // §7.6 — turn the reorder list into draft POs, one per preferred supplier (items with
  // no preferred supplier are grouped into a single unassigned draft PO).
  const handleCreatePos = async () => {
    const orderable = rows.filter(r => r.suggestedOrder > 0)
    if (!orderable.length) { setNotice('Nothing with a positive suggested order.'); return }
    const bySupplier = new Map<string, LowStockRow[]>()
    orderable.forEach(r => {
      const key = r.preferredSupplierId ?? '__none__'
      if (!bySupplier.has(key)) bySupplier.set(key, [])
      bySupplier.get(key)!.push(r)
    })
    setCreatingPos(true)
    try {
      let count = 0
      for (const [key, group] of bySupplier) {
        await api('/api/v1/purchase-orders', {
          method: 'POST',
          token: session?.accessToken,
          body: {
            supplierId: key === '__none__' ? null : key,
            lines: group.map(r => ({
              stockItemId: r.id,
              partNumber: r.partNumber,
              description: r.description || r.partNumber,
              qtyOrdered: r.suggestedOrder,
              unitCost: r.averageCost,
            })),
          },
        })
        count++
      }
      setNotice(`Created ${count} draft purchase order${count > 1 ? 's' : ''} from ${orderable.length} item${orderable.length > 1 ? 's' : ''}. Review and send them under Purchase Orders.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create draft POs')
    } finally {
      setCreatingPos(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Low Stock</h1>
          <p className="text-gray-500 text-sm mt-1">Stocked items at or below their reorder point</p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={handleCreatePos}
            disabled={creatingPos}
            className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-50"
          >
            {creatingPos ? 'Creating…' : 'Create draft POs'}
          </button>
        )}
      </div>

      {notice && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-2 text-sm flex items-center justify-between">
          <span>{notice} <Link to="/parts/purchase-orders" className="underline font-medium">Open Purchase Orders →</Link></span>
          <button onClick={() => setNotice(null)} className="text-green-600 hover:text-green-800">✕</button>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Items to Reorder" value={formatNumber(rows.length)} valueClassName={rows.length > 0 ? 'text-rag-red' : undefined} />
            <StatCard label="Est. Reorder Cost" value={formatCurrency(estReorderValue)} />
          </div>

          <ChartCard title="Below Reorder Point">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Nothing below its reorder point. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Part</th>
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2 text-right">On hand</th>
                      <th className="py-2 px-2 text-right">Min</th>
                      <th className="py-2 px-2 text-right">Suggested order</th>
                      <th className="py-2 px-2 text-right">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <span className="font-medium text-gray-900">{r.partNumber}</span>
                          {r.description && <span className="text-gray-400"> — {r.description}</span>}
                        </td>
                        <td className="py-2 px-2 text-gray-600">{r.categoryName}</td>
                        <td className={`py-2 px-2 text-right font-medium ${r.qtyOnHand <= 0 ? 'text-rag-red' : 'text-rag-amber'}`}>{formatNumber(r.qtyOnHand)}</td>
                        <td className="py-2 px-2 text-right text-gray-500">{formatNumber(r.minQty)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatNumber(r.suggestedOrder)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.suggestedOrder * r.averageCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </>
      )}
    </div>
  )
}
