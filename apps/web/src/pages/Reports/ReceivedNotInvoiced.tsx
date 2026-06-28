import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface RniRow {
  lineId: string
  poId: string
  poNumber: string
  supplierId: string | null
  supplierName: string
  partNumber: string
  description: string
  qtyReceived: number
  unitCost: number
  uninvoicedValue: number
  receivedAt: string | null
  daysWaiting: number
}

export default function ReceivedNotInvoiced() {
  const { session } = useAuth()
  const [rows, setRows] = useState<RniRow[]>([])
  const [totals, setTotals] = useState<{ lineCount: number; uninvoicedValue: number }>({ lineCount: 0, uninvoicedValue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: RniRow[]; totals: { lineCount: number; uninvoicedValue: number } }>(
        '/api/v1/reports/received-not-invoiced',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { lineCount: 0, uninvoicedValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load received-not-invoiced')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Received, Not Invoiced</h1>
        <p className="text-gray-500 text-sm mt-1">Stock received from factors with no supplier invoice entered yet — chase invoices / accrue at period-end</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Lines Awaiting Invoice" value={formatNumber(totals.lineCount)} valueClassName={totals.lineCount ? 'text-amber-600' : undefined} />
            <StatCard label="Uninvoiced Exposure" value={formatCurrency(totals.uninvoicedValue)} />
          </div>

          {rows.length === 0 ? (
            <ChartCard title="Received, not invoiced">
              <p className="text-sm text-gray-400 py-8 text-center">Every received line has a supplier invoice — nothing to accrue. 🎉</p>
            </ChartCard>
          ) : (
            <ChartCard title={`${rows.length} line${rows.length > 1 ? 's' : ''} awaiting a supplier invoice`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">Part</th>
                      <th className="py-2 px-2">PO</th>
                      <th className="py-2 px-2">Supplier</th>
                      <th className="py-2 px-2 text-right">Qty received</th>
                      <th className="py-2 px-2 text-right">Unit cost</th>
                      <th className="py-2 px-2 text-right">Uninvoiced value</th>
                      <th className="py-2 pl-2 text-right">Days waiting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => (
                      <tr key={r.lineId} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 text-gray-900">
                          <div className="font-medium">{r.partNumber || r.description}</div>
                          {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[240px]">{r.description}</div>}
                        </td>
                        <td className="py-2 px-2">
                          <Link to={`/parts/purchase-orders/${r.poId}`} className="text-primary hover:underline">{r.poNumber || '—'}</Link>
                        </td>
                        <td className="py-2 px-2 text-gray-600">{r.supplierName}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatNumber(r.qtyReceived)}</td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.unitCost)}</td>
                        <td className="py-2 px-2 text-right text-gray-900 font-medium">{formatCurrency(r.uninvoicedValue)}</td>
                        <td className="py-2 pl-2 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.daysWaiting >= 30 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                            {formatNumber(r.daysWaiting)}
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
