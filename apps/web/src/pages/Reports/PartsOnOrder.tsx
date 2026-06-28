import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface OnOrderRow {
  poId: string
  poNumber: string
  supplierName: string
  orderedAt: string | null
  poStatus: string
  lineId: string
  partNumber: string
  description: string
  qtyOrdered: number
  qtyReceived: number
  qtyOutstanding: number
  unitCost: number
  outstandingValue: number
  daysOpen: number | null
}

export default function PartsOnOrder() {
  const { session } = useAuth()
  const [rows, setRows] = useState<OnOrderRow[]>([])
  const [totals, setTotals] = useState<{ lineCount: number; outstandingValue: number }>({ lineCount: 0, outstandingValue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: OnOrderRow[]; totals: { lineCount: number; outstandingValue: number } }>(
        '/api/v1/reports/parts-on-order',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { lineCount: 0, outstandingValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load parts on order')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Parts on Order</h1>
        <p className="text-gray-500 text-sm mt-1">Open purchase-order lines awaiting delivery, by supplier</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Open Lines" value={formatNumber(totals.lineCount)} />
            <StatCard label="Outstanding Value" value={formatCurrency(totals.outstandingValue)} valueClassName="text-amber-600" />
          </div>

          <ChartCard title="Open order lines">
            {rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Nothing on order. Raise a PO from a job card or the Low-Stock report.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="py-2 pr-4">PO</th>
                      <th className="py-2 px-2">Supplier</th>
                      <th className="py-2 px-2">Part</th>
                      <th className="py-2 px-2 text-right">Outstanding</th>
                      <th className="py-2 px-2 text-right">Unit cost</th>
                      <th className="py-2 px-2 text-right">Value</th>
                      <th className="py-2 pl-2 text-right">Days open</th>
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
                        <td className="py-2 px-2 text-right text-gray-900">{formatNumber(r.qtyOutstanding)}<span className="text-gray-400"> / {formatNumber(r.qtyOrdered)}</span></td>
                        <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.unitCost)}</td>
                        <td className="py-2 px-2 text-right text-gray-900">{formatCurrency(r.outstandingValue)}</td>
                        <td className="py-2 pl-2 text-right">
                          {r.daysOpen == null ? <span className="text-gray-400">—</span> : (
                            <span className={r.daysOpen > 7 ? 'text-red-600 font-medium' : 'text-gray-600'}>{r.daysOpen}</span>
                          )}
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
