import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useModules } from '../../contexts/ModulesContext'
import { api } from '../../lib/api'
import { UpcomingPanel } from '../Upcoming'

/**
 * Arrivals queue — the unified list of vehicles due in, across DMS-imported bookings AND GMS
 * jobsheet bookings (both are health_checks in awaiting_arrival / awaiting_checkin). This is the
 * primary place to bring a booked vehicle into the workshop: mark it arrived, then check it in
 * (the check-in form itself is the existing VHC Check-In tab, reached via deep-link).
 *
 * Fed by GET /api/v1/arrivals. Actions reuse the existing endpoints:
 *   - mark-arrived / mark-no-show on the VHC
 *   - PATCH /jobsheets/:id for no-VHC jobsheets ("Mark on site")
 *
 * Rendered as the "Arrivals" tab inside ArrivalsHub (default export at the bottom of this file),
 * which only mounts it when the jobsheets module is enabled.
 */

interface ArrivalItem {
  id: string
  healthCheckId: string | null
  hasVhc: boolean
  status: 'awaiting_arrival' | 'awaiting_checkin'
  jobState: string
  origin: 'dms' | 'jobsheet' | 'manual'
  jobsheetId: string | null
  jobsheetReference: string | null
  registration: string
  make: string
  model: string
  customerName: string
  customerMobile: string | null
  dueDate: string | null
  promiseTime: string | null
  arrivedAt: string | null
  customerWaiting: boolean
  loanCarRequired: boolean
  bookedRepairs: Array<{ code?: string; description?: string; notes?: string }>
}

interface ArrivalsResponse {
  arrivals: ArrivalItem[]
  counts: { awaitingArrival: number; awaitingCheckin: number; total: number }
}

function PlateChip({ reg }: { reg: string }) {
  return (
    <span className="font-mono text-[11.5px] bg-[#fdf6dd] border border-[#efe2a8] text-[#796a1f] rounded-[5px] px-[7px] py-0.5 whitespace-nowrap">
      {reg || '—'}
    </span>
  )
}

function OriginBadge({ item }: { item: ArrivalItem }) {
  if (item.origin === 'jobsheet') {
    return (
      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary">
        {item.jobsheetReference || 'JOBSHEET'}
      </span>
    )
  }
  if (item.origin === 'dms') {
    return <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500">DMS</span>
  }
  return <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gray-100 text-gray-500">MANUAL</span>
}

function dueLabel(item: ArrivalItem): string | null {
  const iso = item.dueDate || item.promiseTime
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (day.getTime() === today.getTime()) return `Today · ${time}`
  if (day.getTime() === tomorrow.getTime()) return `Tomorrow · ${time}`
  if (day.getTime() < today.getTime()) return `Overdue · ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) + ` · ${time}`
}

function ArrivalsQueue() {
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const token = session?.accessToken

  const [items, setItems] = useState<ArrivalItem[]>([])
  const [counts, setCounts] = useState({ awaitingArrival: 0, awaitingCheckin: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [windowMode, setWindowMode] = useState<'soon' | 'all'>('soon')
  const [actingId, setActingId] = useState<string | null>(null)
  const [checkinEnabled, setCheckinEnabled] = useState(false)

  // Jobsheet check-in lives on the jobsheet's Check-In tab; DMS check-in on the VHC.
  const checkinHref = (item: ArrivalItem) =>
    item.origin === 'jobsheet' && item.jobsheetId
      ? `/jobsheets/${item.jobsheetId}?tab=checkin`
      : `/health-checks/${item.healthCheckId}?tab=checkin`

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await api<ArrivalsResponse>(`/api/v1/arrivals?window=${windowMode}`, { token })
      setItems(data.arrivals || [])
      setCounts(data.counts || { awaitingArrival: 0, awaitingCheckin: 0, total: 0 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load arrivals')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, windowMode])

  useEffect(() => { load() }, [load])

  // Org check-in setting — when on, jobsheet arrivals route to their Check-In tab.
  useEffect(() => {
    if (!token || !user?.organization?.id) return
    api<{ checkinEnabled: boolean }>(`/api/v1/organizations/${user.organization.id}/checkin-settings`, { token })
      .then(d => setCheckinEnabled(!!d.checkinEnabled)).catch(() => setCheckinEnabled(false))
  }, [token, user?.organization?.id])

  const handleArrived = async (item: ArrivalItem) => {
    if (!token || !item.healthCheckId) return
    setActingId(item.id)
    try {
      const res = await api<{ healthCheck: { requiresCheckin: boolean } }>(
        `/api/v1/health-checks/${item.healthCheckId}/mark-arrived`, { method: 'POST', token }
      )
      if (res.healthCheck?.requiresCheckin) {
        navigate(`/health-checks/${item.healthCheckId}?tab=checkin`)
        return
      }
      toast.success('Vehicle marked as arrived')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark arrived')
    } finally {
      setActingId(null)
    }
  }

  const handleNoShow = async (item: ArrivalItem) => {
    if (!token || !item.healthCheckId) return
    setActingId(item.id)
    try {
      await api(`/api/v1/health-checks/${item.healthCheckId}/mark-no-show`, { method: 'POST', token })
      toast.success('Marked as no-show')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark no-show')
    } finally {
      setActingId(null)
    }
  }

  // No-VHC jobsheet: there's no check-in form, so arrival just marks it on site.
  const handleMarkOnSite = async (item: ArrivalItem) => {
    if (!token || !item.jobsheetId) return
    setActingId(item.id)
    try {
      await api(`/api/v1/jobsheets/${item.jobsheetId}`, {
        method: 'PATCH', token, body: { jobState: 'arrived', vehicleOnSite: true }
      })
      toast.success('Vehicle marked on site')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark on site')
    } finally {
      setActingId(null)
    }
  }

  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? items.filter(it =>
        it.registration.toLowerCase().includes(needle) ||
        it.customerName.toLowerCase().includes(needle) ||
        (it.jobsheetReference || '').toLowerCase().includes(needle))
    : items
  const checkinRows = filtered.filter(i => i.status === 'awaiting_checkin')
  const arrivalRows = filtered.filter(i => i.status === 'awaiting_arrival')

  const toggleCls = (on: boolean) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg ${on ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'}`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search reg, customer or jobsheet…"
          className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button className={toggleCls(windowMode === 'soon')} onClick={() => setWindowMode('soon')}>Due soon</button>
          <button className={toggleCls(windowMode === 'all')} onClick={() => setWindowMode('all')}>All</button>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          {windowMode === 'soon' ? 'Nothing due in right now.' : 'No vehicles awaiting arrival or check-in.'}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Check-in required — vehicle is on site already */}
          {checkinRows.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span className="w-2 h-2 rounded-full bg-rag-red" />
                <h2 className="text-sm font-semibold text-gray-800">Check-in required</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{checkinRows.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {checkinRows.map(item => (
                  <div key={item.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${item.customerWaiting ? 'bg-red-50/50' : ''}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <PlateChip reg={item.registration} />
                        {item.customerWaiting && <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-rag-red rounded-full animate-pulse">WAITING</span>}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900 truncate flex items-center gap-2">{item.make} {item.model} <OriginBadge item={item} /></div>
                        <div className="text-xs text-gray-500 truncate">{item.customerName || 'No customer'}{item.arrivedAt && ` · arrived ${new Date(item.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(checkinHref(item))}
                      className="shrink-0 px-4 py-2 bg-rag-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
                      Check in
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Awaiting arrival — not here yet */}
          {arrivalRows.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <h2 className="text-sm font-semibold text-gray-800">Awaiting arrival</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">{arrivalRows.length}</span>
              </div>
              <div className="divide-y divide-gray-100">
                {arrivalRows.map(item => {
                  const due = dueLabel(item)
                  const busy = actingId === item.id
                  return (
                    <div key={item.id} className={`flex items-center justify-between gap-3 px-5 py-3 ${item.customerWaiting ? 'bg-red-50/50' : ''}`}>
                      <div className="flex items-center gap-3 min-w-0 flex-wrap">
                        <div className="flex flex-col items-center gap-1 shrink-0">
                          <PlateChip reg={item.registration} />
                          {item.customerWaiting && <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-rag-red rounded-full animate-pulse">WAITING</span>}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 truncate flex items-center gap-2">
                            {item.make} {item.model}
                            <OriginBadge item={item} />
                            {item.loanCarRequired && <span className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded-full">LOAN</span>}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{item.customerName || 'No customer'}</div>
                        </div>
                        {due && <span className="text-xs text-gray-500">{due}</span>}
                        {item.bookedRepairs.length > 0 && <span className="text-[11px] text-gray-400">{item.bookedRepairs.length} pre-booked</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.origin === 'jobsheet' && checkinEnabled ? (
                          // Jobsheet + check-in on: do it on the jobsheet's Check-In tab (it handles
                          // arrival, the visit shell for no-VHC jobs, and the panel).
                          <>
                            <button onClick={() => navigate(`/jobsheets/${item.jobsheetId}?tab=checkin`)} className="px-4 py-2 bg-rag-green text-white text-sm font-semibold rounded-lg hover:opacity-90">
                              Check in
                            </button>
                            {item.hasVhc && (
                              <button onClick={() => handleNoShow(item)} disabled={busy} className="px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                No show
                              </button>
                            )}
                          </>
                        ) : item.hasVhc ? (
                          <>
                            <button onClick={() => handleArrived(item)} disabled={busy} className="px-4 py-2 bg-rag-green text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
                              {busy ? '…' : 'Arrived'}
                            </button>
                            <button onClick={() => handleNoShow(item)} disabled={busy} className="px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
                              No show
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleMarkOnSite(item)} disabled={busy} className="px-4 py-2 bg-rag-green text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
                            {busy ? '…' : 'Mark on site'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4">
        {counts.awaitingArrival} awaiting arrival · {counts.awaitingCheckin} to check in
      </p>
    </div>
  )
}

type HubTab = 'arrivals' | 'upcoming'

/**
 * Arrivals hub — the front-desk landing for the booking arrival pipeline, with two tabs:
 *   - "Arrivals": today's due-in / check-in queue (ArrivalsQueue) — jobsheets-module only
 *   - "Upcoming": the next 2 working days of bookings + MRI prep (UpcomingPanel) — always on
 *
 * The page is NOT hard-gated on the jobsheets module (the route used to be): Upcoming must stay
 * reachable for tenants without jobsheets, so gating happens per-tab here. The active tab is
 * URL-driven (?tab=) so /arrivals?tab=upcoming deep-links (and the old /upcoming redirect lands here).
 */
export default function ArrivalsHub() {
  const { isEnabled } = useModules()
  const [searchParams, setSearchParams] = useSearchParams()
  const jobsheetsOn = isEnabled('jobsheets')

  const tabs: { id: HubTab; label: string }[] = [
    ...(jobsheetsOn ? [{ id: 'arrivals' as const, label: 'Arrivals' }] : []),
    { id: 'upcoming', label: 'Upcoming' },
  ]
  const defaultTab: HubTab = jobsheetsOn ? 'arrivals' : 'upcoming'
  const urlTab = searchParams.get('tab') as HubTab | null
  const activeTab: HubTab = urlTab && tabs.some(t => t.id === urlTab) ? urlTab : defaultTab

  const setTab = (t: HubTab) =>
    setSearchParams(prev => { prev.set('tab', t); return prev }, { replace: true })

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{jobsheetsOn ? 'Arrivals' : 'Upcoming'}</h1>
        <p className="text-gray-600 mt-1">
          {activeTab === 'upcoming'
            ? 'Bookings on their way in — prep MRIs before the vehicle arrives.'
            : 'Vehicles due in — mark them arrived and check them in. Covers DMS bookings and jobsheets.'}
        </p>
      </div>

      {tabs.length > 1 && (
        <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'arrivals' && jobsheetsOn ? <ArrivalsQueue /> : <UpcomingPanel />}
    </div>
  )
}
