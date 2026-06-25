import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'
import { JobTimeSummary, JobTimeData } from '../components/JobTimeSummary'

/**
 * Repair re-clock screen. After a VHC is authorised the technician returns to
 * clock back onto the same job for the repair work. The clock-in endpoint
 * auto-tags the new segment as 'repair' (split-by-milestone — the job is past
 * its health-check-done milestone), so the tech never picks a productive
 * category. They see a live timer + job-time breakdown, can clock on/off across
 * multiple sessions, and finally mark the work complete.
 * See docs/technician-job-clocking-spec.md §4, §6 (mobile row).
 */
export function Repair() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState<HealthCheck | null>(null)
  const [timeData, setTimeData] = useState<JobTimeData | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session || !id) return
    api<{ healthCheck: HealthCheck }>(`/api/v1/health-checks/${id}`, { token: session.access_token })
      .then(d => setJob(d.healthCheck))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load job'))
      .finally(() => setLoading(false))
  }, [id, session])

  // JobTimeSummary owns the single fetch of /time-entries; we observe it here to
  // drive the clock-on/off button (no second fetch of the same endpoint).
  const handleTimeData = useCallback((d: JobTimeData) => setTimeData(d), [])

  const clockedOn = !!timeData?.activeClockInAt
  const isComplete = job?.status === 'completed'
  const canComplete = job?.status === 'authorized'

  const refresh = () => setRefreshKey(k => k + 1)

  const clockOn = async () => {
    if (!session || !id) return
    setBusy(true)
    setError(null)
    try {
      // Empty body → backend resolves the category by split-by-milestone (repair).
      await api(`/api/v1/health-checks/${id}/clock-in`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({})
      })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock on')
    } finally {
      setBusy(false)
    }
  }

  const clockOff = async () => {
    if (!session || !id) return
    setBusy(true)
    setError(null)
    try {
      // complete:false closes the open segment without the inspection-completion
      // path; an authorised job's status is left untouched so the tech can
      // re-clock for more repair sessions.
      await api(`/api/v1/health-checks/${id}/clock-out`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({ complete: false })
      })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock off')
    } finally {
      setBusy(false)
    }
  }

  const completeWork = async () => {
    if (!session || !id) return
    if (!window.confirm('Mark the repair work as complete? This finishes the job.')) return
    setBusy(true)
    setError(null)
    try {
      // Close any open segment first (clock-out rejects when not clocked in).
      if (clockedOn) {
        await api(`/api/v1/health-checks/${id}/clock-out`, {
          method: 'POST',
          token: session.access_token,
          body: JSON.stringify({ complete: false })
        })
      }
      // authorized → completed is the sanctioned technician transition.
      await api(`/api/v1/health-checks/${id}/status`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({ status: 'completed', notes: 'Repair work completed by technician' })
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark work complete')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="h-full bg-gray-100 flex flex-col">
        <header className="bg-primary text-white px-4 py-3 sticky top-0 z-10">
          <h1 className="text-lg font-bold">Job Not Found</h1>
        </header>
        <main className="flex-1 p-4">
          <Card padding="lg">
            <p className="text-gray-600">{error || 'Unable to load this job'}</p>
            <Button onClick={() => navigate('/')} className="mt-4" fullWidth>
              Back to Jobs
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const vehicle = job.vehicle
  const customer = job.customer
  const bookedRepairs = (job.booked_repairs || []).filter(r => r.description || r.code)

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top sticky top-0 z-10">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/')}
            className="mr-3 p-2 -ml-2 hover:bg-blue-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">🔧 Repair</h1>
            <p className="text-sm text-blue-200">
              {job.vhc_reference && <span className="mr-2">{job.vhc_reference}</span>}
              {vehicle?.registration}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 space-y-4 overflow-auto">
        {/* Live time + breakdown */}
        {id && (
          <JobTimeSummary
            healthCheckId={id}
            refreshKey={refreshKey}
            onData={handleTimeData}
          />
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
                  <span className="font-medium">{customer.first_name} {customer.last_name}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Booked work for context, when present on the job */}
        {bookedRepairs.length > 0 && (
          <Card>
            <CardHeader title="Booked work" subtitle="From the original booking" />
            <CardContent>
              <ul className="space-y-2">
                {bookedRepairs.map((r, i) => (
                  <li key={i} className="text-sm text-gray-800">
                    <span className="font-medium">{r.description || r.code}</span>
                    {r.notes && <p className="text-xs text-gray-500 mt-0.5">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {isComplete && (
          <Card className="border-l-4 border-rag-green bg-rag-green-bg">
            <CardContent>
              <p className="font-medium text-gray-900">Work complete</p>
              <p className="text-sm text-gray-600">This job has been marked complete.</p>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4">{error}</div>
        )}
      </main>

      {/* Footer — clock controls */}
      {!isComplete && (
        <footer className="bg-white border-t border-gray-200 safe-area-inset-bottom">
          <div className="p-4 space-y-2">
            {clockedOn ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" onClick={clockOff} loading={busy} className="flex-1">
                  Clock Off
                </Button>
                {canComplete && (
                  <Button size="lg" onClick={completeWork} loading={busy} className="flex-1">
                    Mark Complete
                  </Button>
                )}
              </div>
            ) : (
              <>
                <Button size="lg" fullWidth onClick={clockOn} loading={busy}>
                  Clock On — Start Repair
                </Button>
                {canComplete && (
                  <Button variant="ghost" size="md" fullWidth onClick={completeWork} loading={busy}>
                    Mark work complete
                  </Button>
                )}
              </>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}
