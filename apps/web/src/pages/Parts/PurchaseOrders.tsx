import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface PoRow {
  id: string
  poNumber: string | null
  status: string
  supplierId: string | null
  supplierName: string | null
  orderedAt: string | null
  receivedAt: string | null
  createdAt: string
  lineCount: number
  totalValue: number
}
interface Supplier { id: string; name: string }

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ordered: 'bg-indigo-100 text-indigo-800',
  part_received: 'bg-amber-100 text-amber-800',
  received: 'bg-green-100 text-green-800',
  invoiced: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', ordered: 'Ordered', part_received: 'Part received',
  received: 'Received', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled',
}
const FILTERS = ['all', 'draft', 'ordered', 'part_received', 'received'] as const

export default function PurchaseOrders() {
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<PoRow[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const organizationId = user?.organization?.id

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const q = filter === 'all' ? '' : `?status=${filter}`
      const data = await api<{ orders: PoRow[] }>(`/api/v1/purchase-orders${q}`, { token: session?.accessToken })
      setOrders(data.orders || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load purchase orders')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, filter, toast])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!organizationId) return
    api<{ suppliers: Supplier[] }>(`/api/v1/organizations/${organizationId}/suppliers`, { token: session?.accessToken })
      .then(d => setSuppliers(d.suppliers || []))
      .catch(() => {})
  }, [organizationId, session?.accessToken])

  const handleCreate = async (supplierId: string | null) => {
    try {
      setCreating(true)
      const res = await api<{ id: string }>('/api/v1/purchase-orders', {
        method: 'POST', token: session?.accessToken, body: { supplierId },
      })
      navigate(`/parts/purchase-orders/${res.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create PO')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Order parts in from suppliers and receive them against goods-in</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            disabled={creating}
            defaultValue=""
            onChange={e => { if (e.target.value !== '') handleCreate(e.target.value === '__none__' ? null : e.target.value) }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="" disabled>+ New PO for…</option>
            <option value="__none__">No supplier yet</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === f ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PO</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Lines</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {orders.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No purchase orders. Create one above, or raise one from a job card.</td></tr>
              ) : orders.map(po => (
                <tr key={po.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/parts/purchase-orders/${po.id}`)}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-primary">{po.poNumber || '—'}</td>
                  <td className="px-6 py-4 text-gray-700">{po.supplierName || <span className="text-gray-400">Unassigned</span>}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[po.status] || 'bg-gray-100 text-gray-700'}`}>
                      {STATUS_LABEL[po.status] || po.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">{po.lineCount}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{GBP.format(po.totalValue)}</td>
                  <td className="px-6 py-4 text-right text-gray-500 text-sm">{new Date(po.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
