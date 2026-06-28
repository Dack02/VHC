import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface OrphanRow {
  lineId: string
  poId: string
  poNumber: string
  supplierName: string
  partNumber: string
  description: string
  qtyOrdered: number
  qtyReceived: number
  unitCost: number
  lineValue: number
  lineStatus: string
  reason: string
}

export default function OrphanParts() {
  const { session } = useAuth()
  const [rows, setRows] = useState<OrphanRow[]>([])
  const [totals, setTotals] = useState<{ lineCount: number; lineValue: number }>({ lineCount: 0, lineValue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: OrphanRow[]; totals: { lineCount: number; lineValue: number } }>(
        '/api/v1/reports/orphan-parts',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { lineCount: 0, lineValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orphan parts')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Orphan Parts</h1>
        <p className="text-gray-500 text-sm mt-1">Ordered or received but never put on a job card — the money-leak report</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Orphan Lines" value={formatNumber(totals.lineCount)} valueClassName={totals.lineCount ? 'text-red-600' : undefined} />
            <StatCard label="Value at Risk" value={formatCurrency(totals.lineValue)} />
          </div>

          <ChartCard title="Orphan PO lines">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No orphan parts — everything ordered is on a job card or returned. 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">PO</th>
                      <th className="py-2 px-2">Supplier</th>
                      <th className="py-2 px-2">Part</th>
                      <th className="py-2 px-2">Reason</th>
                      <th className="py-2 px-2 text-right">Qty</th>
                      <th className="py-2 pl-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.lineId} className="hover:bg-gray-50">
                        <td className="py-2 pr-4">
                          <Link to={`/parts/purchase-orders/${r.poId}`} className="text-primary hover:underline font-medium">{r.poNumber || '—'}</Link>
                        </td>
                        <td className="py-2 px-2 text-gray-700">{r.supplierName}</td>
                        <td className="py-2 px-2 text-gray-900">
                          <div className="font-medium">{r.partNumber || r.description}</div>
                          {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[220px]">{r.description}</div>}
                        </td>
                        <td className="py-2 px-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">{r.reason}</span>
                        </td>
                        <td className="py-2 px-2 text-right text-gray-700">{formatNumber(r.qtyReceived || r.qtyOrdered)}</td>
                        <td className="py-2 pl-2 text-right text-gray-900">{formatCurrency(r.lineValue)}</td>
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
