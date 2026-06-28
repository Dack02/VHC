import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber, formatDate } from './utils/formatters'

interface SlobRow {
  stockItemId: string
  partNumber: string
  description: string
  categoryName: string
  qtyOnHand: number
  averageCost: number
  stockValue: number
  lastMovementAt: string | null
  daysIdle: number
}

const PRESETS = [30, 60, 90, 180, 365]

export default function SlowMovingStock() {
  const { session } = useAuth()
  const [rows, setRows] = useState<SlobRow[]>([])
  const [totals, setTotals] = useState<{ lineCount: number; stockValue: number }>({ lineCount: 0, stockValue: 0 })
  const [days, setDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: SlobRow[]; totals: { lineCount: number; stockValue: number } }>(
        `/api/v1/reports/slow-moving?days=${days}`,
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { lineCount: 0, stockValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load slow-moving stock')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, days])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Slow-Moving / Obsolete Stock</h1>
        <p className="text-gray-500 text-sm mt-1">Stocked items with capital tied up but no movement in the chosen window</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">No movement in:</span>
        {PRESETS.map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${days === d ? 'bg-[#16191f] text-white border-[#16191f]' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Dead Items" value={formatNumber(totals.lineCount)} valueClassName={totals.lineCount ? 'text-amber-600' : undefined} />
            <StatCard label="Capital Tied Up" value={formatCurrency(totals.stockValue)} />
          </div>

          {rows.length === 0 ? (
            <ChartCard title="Slow-moving stock">
              <p className="text-sm text-gray-400 py-8 text-center">No dead stock over {days} days — everything's turning over. 🎉</p>
            </ChartCard>
          ) : (
            <ChartCard title={`${rows.length} item${rows.length > 1 ? 's' : ''} idle ≥ ${days} days`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Part</th>
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2 text-right">On hand</th>
                      <th className="py-2 px-2 text-right">Avg cost</th>
                      <th className="py-2 px-2 text-right">Stock value</th>
                      <th className="py-2 px-2 text-right">Last moved</th>
                      <th className="py-2 pl-2 text-right">Days idle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.stockItemId} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-900">
                          <div className="font-medium">{r.partNumber || r.description}</div>
                          {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[260px]">{r.description}</div>}
                        </td>
                        <td className="py-2 px-2 text-gray-600">{r.categoryName}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatNumber(r.qtyOnHand)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.averageCost)}</td>
                        <td className="py-2 px-2 text-right text-gray-900 font-medium">{formatCurrency(r.stockValue)}</td>
                        <td className="py-2 px-2 text-right text-gray-500">{r.lastMovementAt ? formatDate(r.lastMovementAt) : 'Never'}</td>
                        <td className="py-2 pl-2 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.daysIdle >= 365 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                            {formatNumber(r.daysIdle)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  )
}
