import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface SessionRow {
  id: string
  reference: string | null
  scopeType: string
  locationName: string | null
  status: string
  lineCount: number
  varianceValue: number
  committedAt: string | null
  createdAt: string
}
interface Category { id: string; name: string }
interface Supplier { id: string; name: string }

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const STATUS_BADGE: Record<string, string> = {
  counting: 'bg-amber-100 text-amber-800',
  committed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = { counting: 'Counting', committed: 'Committed', cancelled: 'Cancelled' }

export default function Stocktake() {
  const { session, user } = useAuth()
  const orgId = user?.organization?.id
  const toast = useToast()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [scopeType, setScopeType] = useState('all')
  const [scopeCategoryId, setScopeCategoryId] = useState('')
  const [scopeSupplierId, setScopeSupplierId] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [creating, setCreating] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ sessions: SessionRow[] }>('/api/v1/stocktake', { token: session?.accessToken })
      setSessions(data.sessions || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stocktakes')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const openModal = async () => {
    setScopeType('all'); setScopeCategoryId(''); setScopeSupplierId('')
    setShowModal(true)
    try {
      const [cats, sups] = await Promise.all([
        api<{ categories: Category[] }>('/api/v1/parts-stock/part-categories', { token: session?.accessToken }),
        api<{ suppliers: Supplier[] }>(`/api/v1/organizations/${orgId}/suppliers`, { token: session?.accessToken }),
      ])
      setCategories(cats.categories || [])
      setSuppliers(sups.suppliers || [])
    } catch { /* selectors stay empty; "all" scope still works */ }
  }

  const create = async () => {
    if (scopeType === 'category' && !scopeCategoryId) { toast.error('Pick a category'); return }
    if (scopeType === 'supplier' && !scopeSupplierId) { toast.error('Pick a supplier'); return }
    setCreating(true)
    try {
      const res = await api<{ id: string }>('/api/v1/stocktake', {
        method: 'POST', token: session?.accessToken,
        body: {
          scopeType,
          scopeCategoryId: scopeType === 'category' ? scopeCategoryId : undefined,
          scopeSupplierId: scopeType === 'supplier' ? scopeSupplierId : undefined,
        },
      })
      setShowModal(false)
      navigate(`/parts/stocktake/${res.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start stocktake')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stocktake</h1>
          <p className="text-sm text-gray-500 mt-1">Count your stock, freeze the expected figures, and post the variance with a reason</p>
        </div>
        <button onClick={openModal} className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black">
          New stocktake
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reference</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scope</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Lines</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Variance</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sessions.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No stocktakes yet. Click "New stocktake" to start counting.</td></tr>
              ) : sessions.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/parts/stocktake/${s.id}`)}>
                  <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{s.reference || '—'}</td>
                  <td className="px-6 py-4 text-gray-700 capitalize">{s.scopeType}{s.locationName ? ` · ${s.locationName}` : ''}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-700'}`}>{STATUS_LABEL[s.status] || s.status}</span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">{s.lineCount}</td>
                  <td className="px-6 py-4 text-right font-medium">
                    {s.status === 'committed'
                      ? <span className={s.varianceValue < 0 ? 'text-red-600' : s.varianceValue > 0 ? 'text-green-600' : 'text-gray-500'}>{GBP.format(s.varianceValue)}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-500 text-sm">{new Date(s.createdAt).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500/75" onClick={() => setShowModal(false)} />
            <div className="relative bg-white w-full max-w-md p-6 rounded-[18px] shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">New stocktake</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">What to count</label>
                  <select value={scopeType} onChange={(e) => setScopeType(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                    <option value="all">All stocked items</option>
                    <option value="category">A category</option>
                    <option value="supplier">A supplier's items</option>
                  </select>
                </div>
                {scopeType === 'category' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select value={scopeCategoryId} onChange={(e) => setScopeCategoryId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                      <option value="">Select…</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {scopeType === 'supplier' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                    <select value={scopeSupplierId} onChange={(e) => setScopeSupplierId(e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                      <option value="">Select…</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <p className="text-xs text-gray-400">Expected quantities are frozen the moment you start, so later movements won't skew the variance.</p>
              </div>
              <div className="flex gap-3 pt-5">
                <button onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={create} disabled={creating} className="flex-1 px-4 py-2 bg-[#16191f] text-white rounded-[10px] font-semibold hover:bg-black disabled:opacity-50">
                  {creating ? 'Starting…' : 'Start counting'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
