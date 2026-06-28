import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface MovementRow {
  id: string
  movementAt: string
  documentDate: string
  movementType: string
  partNumber: string
  description: string
  categoryName: string
  qtyDelta: number
  unitCost: number
  totalCost: number
  referenceType: string | null
  reasonCode: string | null
  isNegativeFlagged: boolean
}

const TYPE_LABEL: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  adjustment: 'Adjustment',
  return_in: 'Return in',
  return_out: 'Return out',
  transfer: 'Transfer',
}

const TYPE_TONE: Record<string, string> = {
  receipt: 'bg-green-100 text-green-800',
  return_in: 'bg-green-100 text-green-800',
  issue: 'bg-amber-100 text-amber-800',
  return_out: 'bg-amber-100 text-amber-800',
  adjustment: 'bg-indigo-100 text-indigo-800',
  transfer: 'bg-gray-100 text-gray-700',
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

export default function StockMovements() {
  const { session } = useAuth()
  const [rows, setRows] = useState<MovementRow[]>([])
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: MovementRow[] }>(
        `/api/v1/reports/stock-movements?from=${from}&to=${to}`,
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock movements')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, from, to])

  useEffect(() => { fetchData() }, [fetchData])

  const totalIn = rows.filter(r => r.qtyDelta > 0).reduce((s, r) => s + r.totalCost, 0)
  const totalOut = rows.filter(r => r.qtyDelta < 0).reduce((s, r) => s + r.totalCost, 0)

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Stock Movements</h1>
        <p className="text-gray-500 text-sm mt-1">The stock audit trail — every receipt, issue and adjustment in the window</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">From</span>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">To</span>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2" />
        </label>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 max-w-2xl">
            <StatCard label="Movements" value={formatNumber(rows.length)} />
            <StatCard label="Cost in" value={formatCurrency(totalIn)} valueClassName="text-green-600" />
            <StatCard label="Cost out" value={formatCurrency(Math.abs(totalOut))} valueClassName="text-amber-600" />
          </div>

          <ChartCard title="Movements">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No stock movements in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 px-2">Type</th>
                      <th className="py-2 px-2">Part</th>
                      <th className="py-2 px-2">Category</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 px-2 text-right">Unit cost</th>
                      <th className="py-2 px-2 text-right">Total cost</th>
                      <th className="py-2 pl-2">Ref</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{new Date(r.documentDate).toLocaleDateString()}</td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_TONE[r.movementType] || 'bg-gray-100 text-gray-700'}`}>
                            {TYPE_LABEL[r.movementType] || r.movementType}
                          </span>
                          {r.isNegativeFlagged && (
                            <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700" title="Issued into negative stock — valuation needs a true-up at receipt">neg</span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-gray-900">
                          <div className="font-medium">{r.partNumber || r.description}</div>
                          {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[220px]">{r.description}</div>}
                        </td>
                        <td className="py-2 px-2 text-gray-600">{r.categoryName}</td>
                        <td className={`py-2 px-2 text-right font-medium ${r.qtyDelta < 0 ? 'text-amber-600' : 'text-green-600'}`}>{r.qtyDelta > 0 ? '+' : ''}{formatNumber(r.qtyDelta)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.unitCost)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.totalCost)}</td>
                        <td className="py-2 pl-2 text-gray-500 text-xs">{r.reasonCode || r.referenceType || '—'}</td>
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
