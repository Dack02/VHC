import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import { formatCurrency, formatNumber } from './utils/formatters'

interface ReturnRow {
  id: string
  partNumber: string
  description: string
  supplierId: string | null
  supplierName: string
  quantity: number
  qtyToReturn: number
  unitCost: number
  returnValue: number
  lineStatus: string
}

export default function PartsToReturn() {
  const { session } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [totals, setTotals] = useState<{ lineCount: number; returnValue: number }>({ lineCount: 0, returnValue: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ rows: ReturnRow[]; totals: { lineCount: number; returnValue: number } }>(
        '/api/v1/reports/parts-to-return',
        { token: session?.accessToken }
      )
      setRows(data.rows || [])
      setTotals(data.totals || { lineCount: 0, returnValue: 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load parts to return')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken])

  useEffect(() => { fetchData() }, [fetchData])

  // Group by supplier — a return note goes to one factor at a time.
  const bySupplier = rows.reduce<Record<string, ReturnRow[]>>((acc, r) => {
    (acc[r.supplierName] ||= []).push(r)
    return acc
  }, {})

  const createReturn = async (supplier: string, list: ReturnRow[]) => {
    setCreating(supplier)
    try {
      const res = await api<{ rmaRef: string }>('/api/v1/supplier-returns', {
        method: 'POST', token: session?.accessToken,
        body: {
          supplierId: list.find(r => r.supplierId)?.supplierId ?? null,
          lines: list.map(r => ({
            repairPartId: r.id,
            partNumber: r.partNumber,
            description: r.description,
            qty: r.qtyToReturn,
            unitCost: r.unitCost,
            reason: r.lineStatus === 'declined' ? 'declined' : 'unused',
          })),
        },
      })
      toast.success(`Created return ${res.rmaRef}`)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create return')
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <Link to="/reports" className="text-sm text-gray-500 hover:text-gray-700">← Reports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Parts to Return</h1>
        <p className="text-gray-500 text-sm mt-1">Ordered-in parts that are unused or declined — send them back for credit</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <StatCard label="Lines to Return" value={formatNumber(totals.lineCount)} valueClassName={totals.lineCount ? 'text-amber-600' : undefined} />
            <StatCard label="Credit at Risk" value={formatCurrency(totals.returnValue)} />
          </div>

          {rows.length === 0 ? (
            <ChartCard title="Returns">
              <p className="text-sm text-gray-400 py-8 text-center">Nothing to return — no unused or declined order-in parts. 🎉</p>
            </ChartCard>
          ) : (
            Object.entries(bySupplier).map(([supplier, list]) => (
              <ChartCard key={supplier} title={`${supplier} · ${list.length} line${list.length > 1 ? 's' : ''}`}>
                <div className="flex justify-end mb-2">
                  <button
                    onClick={() => createReturn(supplier, list)}
                    disabled={creating === supplier}
                    className="px-3 py-1.5 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-50"
                  >
                    {creating === supplier ? 'Creating…' : 'Create return'}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                        <th className="py-2 pr-4">Part</th>
                        <th className="py-2 px-2 text-center">Status</th>
                        <th className="py-2 px-2 text-right">Qty to return</th>
                        <th className="py-2 px-2 text-right">Unit cost</th>
                        <th className="py-2 pl-2 text-right">Credit value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {list.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="py-2 pr-4 text-gray-900">
                            <div className="font-medium">{r.partNumber || r.description}</div>
                            {r.partNumber && <div className="text-xs text-gray-400 truncate max-w-[260px]">{r.description}</div>}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.lineStatus === 'declined' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                              {r.lineStatus === 'declined' ? 'Declined' : 'To return'}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-gray-900">{formatNumber(r.qtyToReturn)}</td>
                          <td className="py-2 px-2 text-right text-gray-600">{formatCurrency(r.unitCost)}</td>
                          <td className="py-2 pl-2 text-right text-gray-900">{formatCurrency(r.returnValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            ))
          )}
        </>
      )}
    </div>
  )
}
