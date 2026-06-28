import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface NegRow {
  id: string
  partNumber: string
  description: string
  categoryName: string
  qtyOnHand: number
  averageCost: number
  binLocation: string | null
}

export default function NegativeStock() {
  const { session } = useAuth()
  const [rows, setRows] = useState<NegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: NegRow[] }>('/api/v1/reports/negative-stock', { token: session?.accessToken })
      setRows(data.rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load negative stock')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  const exposure = rows.reduce((s, r) => s + r.qtyOnHand * r.averageCost, 0)

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Negative Stock</h1>
        <p className="text-gray-500 text-sm mt-1">Stocked items issued below zero — reconcile against the catch-up receipt</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Items Negative" value={formatNumber(rows.length)} valueClassName={rows.length ? 'text-red-600' : undefined} />
            <StatCard label="Valuation Exposure" value={formatCurrency(exposure)} />
          </div>

          <ChartCard title="Negative items">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No negative stock — every stocked item is at or above zero. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Part</th>
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2">Bin</th>
                      <th className="py-2 px-2 text-right">Qty on hand</th>
                      <th className="py-2 px-2 text-right">Avg cost</th>
                      <th className="py-2 pl-2 text-right">Exposure</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-900">
                          <div className="font-medium">{r.partNumber || r.description}</div>
                          {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[220px]">{r.description}</div>}
                        </td>
                        <td className="py-2 px-2 text-gray-600">{r.categoryName}</td>
                        <td className="py-2 px-2 text-gray-500">{r.binLocation || '—'}</td>
                        <td className="py-2 px-2 text-right text-red-600 font-medium">{formatNumber(r.qtyOnHand)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.averageCost)}</td>
                        <td className="py-2 pl-2 text-right text-gray-900">{formatCurrency(r.qtyOnHand * r.averageCost)}</td>
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
