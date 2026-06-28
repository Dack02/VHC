import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface ReturnRow {
  id: string
  rmaRef: string | null
  status: string
  supplierName: string | null
  creditNoteRef: string | null
  creditAmount: number | null
  returnedAt: string | null
  createdAt: string
  lineCount: number
  value: number
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const STATUS_BADGE: Record<string, string> = {
  to_return: 'bg-amber-100 text-amber-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  credited: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = {
  to_return: 'To return', shipped: 'Shipped', credited: 'Credited', rejected: 'Rejected',
}

export default function SupplierReturns() {
  const { session } = useAuth()
  const toast = useToast()
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ returns: ReturnRow[] }>('/api/v1/supplier-returns', { token: session?.accessToken })
      setReturns(data.returns || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load returns')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const ship = async (id: string) => {
    setBusy(id)
    try {
      await api(`/api/v1/supplier-returns/${id}/ship`, { method: 'POST', token: session?.accessToken })
      toast.success('Marked shipped')
      await fetchData()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') } finally { setBusy(null) }
  }

  const credit = async (id: string) => {
    const ref = prompt('Supplier credit note reference?')
    if (ref === null) return
    const amt = prompt('Credit amount (£, optional)?') || ''
    setBusy(id)
    try {
      await api(`/api/v1/supplier-returns/${id}/credit`, {
        method: 'POST', token: session?.accessToken,
        body: { creditNoteRef: ref || null, creditAmount: amt ? parseFloat(amt) : null },
      })
      toast.success('Credit recorded — Event 5 posted')
      await fetchData()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') } finally { setBusy(null) }
  }

  const reject = async (id: string) => {
    if (!confirm('Mark this return as rejected by the factor?')) return
    setBusy(id)
    try {
      await api(`/api/v1/supplier-returns/${id}/reject`, { method: 'POST', token: session?.accessToken })
      toast.success('Marked rejected')
      await fetchData()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') } finally { setBusy(null) }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supplier Returns</h1>
        <p className="text-sm text-gray-500 mt-1">Send unused or declined parts back and reconcile the credit</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RMA</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Lines</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {returns.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No returns yet. Create one from the Parts to Return report.</td></tr>
              ) : returns.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{r.rmaRef || '—'}</td>
                  <td className="px-6 py-4 text-gray-700">{r.supplierName || <span className="text-gray-400">Unassigned</span>}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-700'}`}>{STATUS_LABEL[r.status] || r.status}</span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">{r.lineCount}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{GBP.format(r.value)}{r.creditAmount != null && <div className="text-xs text-green-600">credit {GBP.format(r.creditAmount)}</div>}</td>
                  <td className="px-6 py-4 text-right text-sm font-medium space-x-3">
                    {r.status === 'to_return' && <button disabled={busy === r.id} onClick={() => ship(r.id)} className="text-primary hover:text-primary-dark">Mark shipped</button>}
                    {r.status === 'shipped' && <>
                      <button disabled={busy === r.id} onClick={() => credit(r.id)} className="text-green-600 hover:text-green-800">Record credit</button>
                      <button disabled={busy === r.id} onClick={() => reject(r.id)} className="text-red-600 hover:text-red-800">Reject</button>
                    </>}
                    {(r.status === 'credited' || r.status === 'rejected') && <span className="text-gray-400">{r.creditNoteRef || '—'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
