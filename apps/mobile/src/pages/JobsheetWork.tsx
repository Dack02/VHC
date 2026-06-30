import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, Jobsheet, JobWorkLine } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'
import { Badge } from '../components/Badge'
import { JobTimeSummary, JobTimeData } from '../components/JobTimeSummary'

/**
 * Jobsheet work screen (TECH_JOB_MODEL.md §9.3/§14 — the net-new mobile half).
 *
 * The jobsheet — not the health check — is the unit of work in GMS mode. A
 * technician reaches this screen for a jobsheet they own that has no inspection
 * to drive the VHC flow (estimate conversions / "Requires VHC" unticked); the
 * VHC-backed jobs still flow through the existing pre-check → inspection → repair
 * screens. Here the tech clocks on/off the JOBSHEET (segments key off
 * jobsheet_id, summed by the same /time-entries breakdown) and ticks / claims the
 * individual work lines.
 *
 * Reached only in GMS mode (operatingMode === 'gms'); VHC-only orgs never link
 * here, so their technician flow is unchanged.
 */
export function JobsheetWork() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const navigate = useNavigate()

  const [jobsheet, setJobsheet] = useState<Jobsheet | null>(null)
  const [lines, setLines] = useState<JobWorkLine[]>([])
  const [timeData, setTimeData] = useState<JobTimeData | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lineBusyId, setLineBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const token = session?.access_token

  const loadLines = useCallback(async () => {
    if (!token || !id) return
    const d = await api<{ workLines: JobWorkLine[] }>(
      `/api/v1/jobsheets/${id}/work-lines`,
      { token }
    )
    setLines(d.workLines || [])
  }, [token, id])

  useEffect(() => {
    if (!token || !id) return
    let cancelled = false
    // The jobsheet header/clock controls don't need the work lines, so load them
    // independently — a work-lines failure leaves an empty list + inline error
    // rather than blanking the whole screen as "Jobsheet Not Found".
    ;(async () => {
      try {
        const js = await api<Jobsheet>(`/api/v1/jobsheets/${id}`, { token })
        if (!cancelled) setJobsheet(js)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load jobsheet')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    ;(async () => {
      try { await loadLines() }
      catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load work lines') }
    })()
    return () => { cancelled = true }
  }, [token, id, loadLines])

  // JobTimeSummary owns the single /time-entries fetch; observe it to drive the
  // clock-on/off button (no second fetch of the same endpoint). Scope the clock
  // state to THIS user's own open segment — the payload spans every tech on the
  // job (multi-tech, §7), and clock-out only closes the caller's own segment, so
  // a colleague being clocked on must not flip this tech's button to "Clock Off".
  const handleTimeData = useCallback((d: JobTimeData) => setTimeData(d), [])
  const clockedOn = !!timeData?.entries.some(e => e.clockOut === null && e.technician?.id === user?.id)
  const refreshTime = () => setRefreshKey(k => k + 1)

  const clockOn = async () => {
    if (!token || !id) return
    setBusy(true); setError(null)
    try {
      await api(`/api/v1/jobsheets/${id}/clock-in`, { method: 'POST', token, body: JSON.stringify({}) })
      refreshTime()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock on')
    } finally { setBusy(false) }
  }

  const clockOff = async () => {
    if (!token || !id) return
    setBusy(true); setError(null)
    try {
      await api(`/api/v1/jobsheets/${id}/clock-out`, { method: 'POST', token, body: JSON.stringify({}) })
      refreshTime()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock off')
    } finally { setBusy(false) }
  }

  const toggleDone = async (line: JobWorkLine) => {
    if (!token || !id || lineBusyId) return
    setLineBusyId(line.id); setError(null)
    const done = !!line.workCompletedAt
    try {
      await api(`/api/v1/jobsheets/${id}/repair-items/${line.id}/work-done`, {
        method: done ? 'DELETE' : 'POST',
        token,
        body: JSON.stringify({})
      })
      await loadLines()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update line')
    } finally { setLineBusyId(null) }
  }

  const claim = async (line: JobWorkLine) => {
    if (!token || !id || lineBusyId) return
    setLineBusyId(line.id); setError(null)
    const mine = line.assignedTechnicianId === user?.id
    try {
      await api(`/api/v1/jobsheets/${id}/repair-items/${line.id}/claim`, {
        method: 'POST',
        token,
        body: JSON.stringify(mine ? { unassign: true } : {})
      })
      await loadLines()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim line')
    } finally { setLineBusyId(null) }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!jobsheet) {
    return (
      <div className="h-full bg-gray-100 flex flex-col">
        <header className="bg-primary text-white px-4 py-3 sticky top-0 z-10">
          <h1 className="text-lg font-bold">Jobsheet Not Found</h1>
        </header>
        <main className="flex-1 p-4">
          <Card padding="lg">
            <p className="text-gray-600">{error || 'Unable to load this jobsheet'}</p>
            <Button onClick={() => navigate('/')} className="mt-4" fullWidth>Back to Jobs</Button>
          </Card>
        </main>
      </div>
    )
  }

  const vehicle = jobsheet.vehicle
  const customer = jobsheet.customer
  // The completion gate is over non-declined lines (TECH_JOB_MODEL.md §9.2.4).
  const actionable = lines.filter(l => l.outcomeStatus !== 'declined')
  const doneCount = actionable.filter(l => l.workCompletedAt).length

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top sticky top-0 z-10">
        <div className="flex items-center">
          <button onClick={() => navigate('/')} className="mr-3 p-2 -ml-2 hover:bg-blue-800 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">Job sheet</h1>
            <p className="text-sm text-blue-200">
              {jobsheet.reference && <span className="mr-2">{jobsheet.reference}</span>}
              {vehicle?.registration}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 space-y-4 overflow-auto">
        {/* Live time + breakdown (jobsheet-anchored) */}
        {id && (
          <JobTimeSummary jobsheetId={id} refreshKey={refreshKey} onData={handleTimeData} />
        )}

        {/* Vehicle / customer */}
        <Card>
          <CardHeader title="Vehicle" />
          <CardContent>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Registration</span>
                <span className="font-bold text-lg">{vehicle?.registration || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Vehicle</span>
                <span className="font-medium">
                  {[vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || '-'}
                  {vehicle?.year ? ` (${vehicle.year})` : ''}
                </span>
              </div>
              {customer && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="font-medium">{customer.firstName} {customer.lastName}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Work lines — tick done + claim */}
        <Card>
          <CardHeader
            title="Work lines"
            subtitle={actionable.length > 0 ? `${doneCount}/${actionable.length} complete` : 'Tick each line as you finish it'}
          />
          <CardContent>
            {lines.length === 0 ? (
              <p className="text-sm text-gray-500">No work lines on this jobsheet yet.</p>
            ) : (
              <ul className="space-y-2">
                {lines.map(line => {
                  const done = !!line.workCompletedAt
                  const declined = line.outcomeStatus === 'declined'
                  const mine = line.assignedTechnicianId === user?.id
                  const claimedByOther = !!line.assignedTechnicianId && !mine
                  return (
                    <li
                      key={line.id}
                      className={`border ${done ? 'border-rag-green bg-rag-green-bg' : 'border-gray-200 bg-white'} p-3`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Done toggle — a large glove-friendly tick box */}
                        <button
                          onClick={() => toggleDone(line)}
                          disabled={declined || !!lineBusyId}
                          aria-label={done ? 'Mark not done' : 'Mark done'}
                          className={`mt-0.5 w-9 h-9 flex-shrink-0 flex items-center justify-center border-2 ${
                            done ? 'bg-rag-green border-rag-green text-white' : 'border-gray-300 text-transparent'
                          } ${declined ? 'opacity-40' : 'active:bg-gray-100'}`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium ${done ? 'text-gray-600 line-through' : 'text-gray-900'}`}>
                            {line.name || 'Work line'}
                          </p>
                          {line.description && (
                            <p className="text-xs text-gray-500 mt-0.5">{line.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {declined && <Badge variant="red" size="sm">Declined</Badge>}
                            {line.origin === 'inspection' && <Badge variant="gray" size="sm">From VHC</Badge>}
                            {/* Claim / release */}
                            {!declined && (
                              claimedByOther ? (
                                <Badge variant="amber" size="sm">Claimed</Badge>
                              ) : (
                                <button
                                  onClick={() => claim(line)}
                                  disabled={!!lineBusyId}
                                  className={`px-2 py-0.5 text-xs font-medium border ${
                                    mine ? 'border-primary text-primary' : 'border-gray-300 text-gray-600'
                                  } active:bg-gray-100`}
                                >
                                  {mine ? '✓ Mine — release' : 'Claim'}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {error && <div className="bg-rag-red-bg text-rag-red p-4">{error}</div>}
      </main>

      {/* Footer — clock controls */}
      <footer className="bg-white border-t border-gray-200 safe-area-inset-bottom">
        <div className="p-4">
          {clockedOn ? (
            <Button variant="secondary" size="lg" fullWidth onClick={clockOff} loading={busy}>
              Clock Off
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={clockOn} loading={busy}>
              Clock On — Start Work
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}

export default JobsheetWork
