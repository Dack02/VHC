import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface ValuationRow {
  categoryId: string | null
  categoryName: string
  itemCount: number
  totalQty: number
  totalValue: number
}

export default function StockValuation() {
  const { session } = useAuth()
  const [rows, setRows] = useState<ValuationRow[]>([])
  const [totals, setTotals] = useState<{ itemCount: number; totalValue: number }>({ itemCount: 0, totalValue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: ValuationRow[]; totals: { itemCount: number; totalValue: number } }>(
        '/api/v1/reports/stock-valuation',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { itemCount: 0, totalValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock valuation')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  const maxValue = Math.max(1, ...rows.map(r => r.totalValue))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Stock Valuation</h1>
        <p className="text-gray-500 text-sm mt-1">Current inventory asset (ledger cost) by category — foots to the stock journals</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Inventory Value" value={formatCurrency(totals.totalValue)} valueClassName="text-green-600" />
            <StatCard label="Stocked Items" value={formatNumber(totals.itemCount)} />
          </div>

          <ChartCard title="By Category">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No stocked items yet. Mark catalog items as stocked to value them here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Category</th>
                      <th className="py-2 px-2 text-right">Items</th>
                      <th className="py-2 px-2 text-right">Qty on hand</th>
                      <th className="py-2 px-2 text-right">Value</th>
                      <th className="py-2 pl-2 w-40">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.categoryId ?? 'uncategorised'} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-900">{r.categoryName}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatNumber(r.itemCount)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatNumber(r.totalQty)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.totalValue)}</td>
                        <td className="py-2 pl-2">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.totalValue / maxValue) * 100}%` }} />
                          </div>
                        </td>
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
