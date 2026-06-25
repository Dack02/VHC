import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface EstimateRow {
  id: string
  reference: string
  status: string
  validUntil: string | null
  createdAt: string
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null } | null
  advisor: { firstName: string; lastName: string } | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', opened: 'Opened', accepted: 'Accepted',
  partial: 'Partly accepted', declined: 'Declined', expired: 'Expired',
  converted: 'Converted', cancelled: 'Cancelled'
}
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  opened: 'bg-indigo-100 text-indigo-700',
  accepted: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
  converted: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-gray-100 text-gray-500'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function EstimatesList() {
  const { session } = useAuth()
  const [rows, setRows] = useState<EstimateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const token = session?.accessToken

  const fetchRows = useCallback(async (q: string) => {
    if (!token) return
    setLoading(true)
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
      const data = await api<{ estimates: EstimateRow[] }>(`/api/v1/estimates${qs}`, { token })
      setRows(data.estimates || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    const debounce = setTimeout(() => fetchRows(search), 300)
    return () => clearTimeout(debounce)
  }, [search, fetchRows])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimates</h1>
          <p className="text-gray-600 mt-1">Pre-booking priced quotes — send to the customer, then convert to a jobsheet.</p>
        </div>
        <Link to="/estimates/new" className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark">
          + New Estimate
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by estimate number…"
          className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          No estimates yet. Create one to get started.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
          {rows.map(row => (
            <Link key={row.id} to={`/estimates/${row.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
              <div className="w-32 shrink-0">
                <div className="text-sm font-semibold text-gray-900">{row.reference || 'Draft'}</div>
                <div className="text-xs text-gray-500">{formatDate(row.createdAt)}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {row.vehicle?.registration || '—'}
                  {row.vehicle?.make && <span className="text-gray-500 font-normal"> · {row.vehicle.make} {row.vehicle.model}</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {row.customer ? `${row.customer.firstName} ${row.customer.lastName}` : 'No customer'}
                  {row.advisor && <span> · {row.advisor.firstName} {row.advisor.lastName}</span>}
                </div>
              </div>
              {row.validUntil && (
                <div className="hidden sm:block text-xs text-gray-500 shrink-0">
                  Valid until {formatDate(row.validUntil)}
                </div>
              )}
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[row.status] || 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[row.status] || row.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
