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
}

export default function LowStock() {
  const { session } = useAuth()
  const [rows, setRows] = useState<LowStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Low Stock</h1>
        <p className="text-gray-500 text-sm mt-1">Stocked items at or below their reorder point</p>
      </div>

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
