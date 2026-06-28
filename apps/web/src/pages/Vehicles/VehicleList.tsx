import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { customerName, fmtDate, LIFECYCLE_STYLES, type VehicleListRow } from './types'

function motBadge(status: string | null, expiry: string | null): { label: string; cls: string } {
  if (expiry) {
    const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
    if (days < 0) return { label: 'MOT expired', cls: 'bg-rag-red text-white' }
    if (days <= 30) return { label: `MOT ${days}d`, cls: 'bg-rag-amber text-white' }
    return { label: 'MOT valid', cls: 'bg-rag-green text-white' }
  }
  if (status) return { label: status, cls: 'bg-gray-100 text-gray-600' }
  return { label: 'No MOT data', cls: 'bg-gray-100 text-gray-400' }
}

export default function VehicleList() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [rows, setRows] = useState<VehicleListRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [motDue, setMotDue] = useState('')
  const [lifecycle, setLifecycle] = useState('')

  const fetchRows = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (motDue) params.set('mot_due', motDue)
      if (lifecycle) params.set('lifecycle_status', lifecycle)
      params.set('limit', '100')
      const data = await api<{ vehicles: VehicleListRow[]; total: number }>(`/api/v1/vehicles?${params.toString()}`, { token })
      setRows(data.vehicles || [])
      setTotal(data.total || 0)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [token, search, motDue, lifecycle])

  useEffect(() => {
    const t = setTimeout(fetchRows, 300)
    return () => clearTimeout(t)
  }, [fetchRows])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicles</h1>
          <p className="text-gray-600 mt-1">Your vehicle register — owners &amp; drivers, MOT/service expiries, notes and history.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reg, VIN, make or model…"
          className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <select value={motDue} onChange={e => setMotDue(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">All MOT</option>
          <option value="expired">MOT expired</option>
          <option value="30">MOT due ≤ 30d</option>
          <option value="60">MOT due ≤ 60d</option>
          <option value="90">MOT due ≤ 90d</option>
        </select>
        <select value={lifecycle} onChange={e => setLifecycle(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="scrapped">Scrapped</option>
          <option value="exported">Exported</option>
          <option value="destroyed">Destroyed</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          No vehicles found. Vehicles are added when you create a health check, jobsheet or customer record.
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-400 mb-2">{total} vehicle{total === 1 ? '' : 's'}</div>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm divide-y divide-gray-100">
            {rows.map(v => {
              const mot = motBadge(v.mot_status, v.mot_expiry_date)
              const lc = (v.lifecycle_status || 'active')
              return (
                <Link key={v.id} to={`/vehicles/${v.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                  <div className="bg-yellow-300 text-black px-2.5 py-1 font-bold text-sm tracking-wider rounded shrink-0 w-28 text-center">
                    {v.registration}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {[v.make, v.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
                      {v.derivative && <span className="text-gray-500 font-normal"> · {v.derivative}</span>}
                      {v.year && <span className="text-gray-400 font-normal"> ({v.year})</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{customerName(v.customer)}</div>
                  </div>
                  {v.mot_expiry_date && (
                    <div className="hidden md:block text-xs text-gray-400 shrink-0">MOT {fmtDate(v.mot_expiry_date)}</div>
                  )}
                  {lc !== 'active' && (
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${LIFECYCLE_STYLES[lc] || 'bg-gray-100 text-gray-600'}`}>
                      {lc.charAt(0).toUpperCase() + lc.slice(1)}
                    </span>
                  )}
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${mot.cls}`}>{mot.label}</span>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
