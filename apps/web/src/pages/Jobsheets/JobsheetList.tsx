import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface ArrivalLite {
  id: string
  healthCheckId: string | null
  hasVhc: boolean
  status: 'awaiting_arrival' | 'awaiting_checkin'
  origin: 'dms' | 'jobsheet' | 'manual'
  jobsheetId: string | null
  jobsheetReference: string | null
  registration: string
  make: string
  model: string
  customerName: string
  customerWaiting: boolean
  dueDate: string | null
}

interface JobsheetRow {
  id: string
  reference: string
  createdAt: string
  dueInDate: string
  dueInTime: string | null
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

function formatDueIn(dateStr: string, time: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) + (time ? ` · ${time}` : '')
}

export default function JobsheetList() {
  const { session } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [rows, setRows] = useState<JobsheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [arrivals, setArrivals] = useState<ArrivalLite[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const token = session?.accessToken

  // Jobsheet bookings due in soon (today + overdue) that still need arrival / check-in.
  const fetchArrivals = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ arrivals: ArrivalLite[] }>('/api/v1/arrivals?window=soon', { token })
      setArrivals((data.arrivals || []).filter(a => a.origin === 'jobsheet'))
    } catch {
      setArrivals([])
    }
  }, [token])

  useEffect(() => { fetchArrivals() }, [fetchArrivals])

  // Inline check-in from the list: mark arrived (VHC) then jump to the check-in form, or
  // continue an in-progress check-in. No-VHC jobsheets just get marked on site.
  const handleCheckIn = async (item: ArrivalLite) => {
    if (!token) return
    if (item.status === 'awaiting_checkin' && item.healthCheckId) {
      navigate(`/health-checks/${item.healthCheckId}?tab=checkin`)
      return
    }
    setBusyId(item.id)
    try {
      if (item.hasVhc && item.healthCheckId) {
        const res = await api<{ healthCheck: { requiresCheckin: boolean } }>(
          `/api/v1/health-checks/${item.healthCheckId}/mark-arrived`, { method: 'POST', token }
        )
        if (res.healthCheck?.requiresCheckin) {
          navigate(`/health-checks/${item.healthCheckId}?tab=checkin`)
          return
        }
        toast.success('Vehicle marked as arrived')
      } else if (item.jobsheetId) {
        await api(`/api/v1/jobsheets/${item.jobsheetId}`, { method: 'PATCH', token, body: { jobState: 'arrived', vehicleOnSite: true } })
        toast.success('Vehicle marked on site')
      }
      fetchArrivals()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check in')
    } finally {
      setBusyId(null)
    }
  }

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

      {/* Due in — today + overdue jobsheet bookings still needing arrival / check-in */}
      {arrivals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-gray-800">Due in</h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{arrivals.length}</span>
            <Link to="/arrivals" className="ml-auto text-xs font-semibold text-primary hover:underline">Open arrivals</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {arrivals.map(item => (
              <div key={item.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${item.customerWaiting ? 'bg-red-50/50' : ''}`}>
                <Link to={item.jobsheetId ? `/jobsheets/${item.jobsheetId}` : '/arrivals'} className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[11.5px] bg-[#fdf6dd] border border-[#efe2a8] text-[#796a1f] rounded-[5px] px-[7px] py-0.5 whitespace-nowrap">{item.registration || '—'}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">
                      {item.make} {item.model}
                      {item.jobsheetReference && <span className="text-gray-400"> · {item.jobsheetReference}</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{item.customerName || 'No customer'}</div>
                  </div>
                  {item.customerWaiting && <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-rag-red rounded-full">WAITING</span>}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === 'awaiting_checkin' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                    {item.status === 'awaiting_checkin' ? 'Awaiting check-in' : 'Due in'}
                  </span>
                  <button onClick={() => handleCheckIn(item)} disabled={busyId === item.id}
                    className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">
                    {busyId === item.id ? '…' : item.status === 'awaiting_checkin' ? 'Check in' : item.hasVhc ? 'Arrived' : 'On site'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
              <div className="w-32 shrink-0">
                <div className="text-sm font-semibold text-gray-900">{row.reference}</div>
                <div className="text-xs text-gray-500">Due {formatDueIn(row.dueInDate, row.dueInTime)}</div>
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
