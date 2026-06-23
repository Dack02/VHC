import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface JobsheetRow {
  id: string
  reference: string
  createdAt: string
  mileage: number | null
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null } | null
  serviceType: { code: string; colour: string } | null
  advisor: { firstName: string; lastName: string } | null
  healthCheck: { id: string; vehicleStatus: string; vhcReference: string | null } | null
  bookingCodes: { id: string; code: string; colour: string }[]
}

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  due_in: 'Due In',
  arrived: 'Arrived',
  in_workshop: 'In Workshop',
  work_complete: 'Work Complete',
  collected: 'Collected'
}

const VEHICLE_STATUS_STYLES: Record<string, string> = {
  due_in: 'bg-gray-100 text-gray-700',
  arrived: 'bg-blue-100 text-blue-700',
  in_workshop: 'bg-amber-100 text-amber-700',
  work_complete: 'bg-green-100 text-green-700',
  collected: 'bg-gray-100 text-gray-500'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function JobsheetList() {
  const { session } = useAuth()
  const [rows, setRows] = useState<JobsheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const token = session?.accessToken

  const fetchRows = useCallback(async (q: string) => {
    if (!token) return
    setLoading(true)
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
      const data = await api<{ jobsheets: JobsheetRow[] }>(`/api/v1/jobsheets${qs}`, { token })
      setRows(data.jobsheets || [])
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
          <h1 className="text-2xl font-bold text-gray-900">Jobsheets</h1>
          <p className="text-gray-600 mt-1">Booking documents — the top-level record for upcoming work.</p>
        </div>
        <Link to="/jobsheets/new" className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark">
          + New Jobsheet
        </Link>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by jobsheet number…"
          className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          No jobsheets yet. Create one to get started.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
          {rows.map(row => (
            <Link key={row.id} to={`/jobsheets/${row.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
              <div className="w-24 shrink-0">
                <div className="text-sm font-semibold text-gray-900">{row.reference}</div>
                <div className="text-xs text-gray-400">{formatDate(row.createdAt)}</div>
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
              <div className="hidden sm:flex flex-wrap gap-1 max-w-[220px] justify-end">
                {row.serviceType && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: row.serviceType.colour }}>
                    {row.serviceType.code}
                  </span>
                )}
                {row.bookingCodes.slice(0, 2).map(bc => (
                  <span key={bc.id} className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: `${bc.colour}22`, color: bc.colour }}>
                    {bc.code}
                  </span>
                ))}
                {row.bookingCodes.length > 2 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">+{row.bookingCodes.length - 2}</span>
                )}
              </div>
              {row.healthCheck && (
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${VEHICLE_STATUS_STYLES[row.healthCheck.vehicleStatus] || 'bg-gray-100 text-gray-700'}`}>
                  {VEHICLE_STATUS_LABELS[row.healthCheck.vehicleStatus] || row.healthCheck.vehicleStatus}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
