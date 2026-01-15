import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck } from '../lib/api'
import { Card } from '../components/Card'
import { Badge, StatusBadge } from '../components/Badge'
import { Button } from '../components/Button'
import { usePWA } from '../hooks/usePWA'

type FilterType = 'mine' | 'unassigned' | 'all'

export function JobList() {
  const { session, user, signOut } = useAuth()
  const { isOnline } = usePWA()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<HealthCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<FilterType>('mine')
  const [error, setError] = useState<string | null>(null)

  const fetchJobs = useCallback(async (showRefreshing = false) => {
    if (!session) return

    if (showRefreshing) {
      setRefreshing(true)
    }
    setError(null)

    try {
      const params = new URLSearchParams()

      if (filter === 'mine') {
        // Show only jobs assigned to this technician
        if (user?.id) {
          params.set('technician_id', user.id)
        }
        params.set('status', 'assigned,in_progress,paused')
      } else if (filter === 'unassigned') {
        // Show unassigned jobs (created status, no technician)
        params.set('status', 'created')
        params.set('unassigned', 'true')
      } else {
        // Show all jobs for the site (mine + unassigned)
        params.set('status', 'created,assigned,in_progress,paused')
      }

      const data = await api<{ healthChecks: HealthCheck[] }>(
        `/api/v1/health-checks?${params}`,
        { token: session.access_token }
      )
      setJobs(data.healthChecks || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [session, user?.id, filter])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Pull-to-refresh handler
  const handleRefresh = () => {
    fetchJobs(true)
  }

  const handleJobClick = async (job: HealthCheck) => {
    if (job.status === 'created') {
      // Unassigned job - claim it first
      try {
        await api(
          `/api/v1/health-checks/${job.id}/assign`,
          {
            method: 'POST',
            token: session!.access_token,
            body: JSON.stringify({ technicianId: user?.id })
          }
        )
        // After claiming, go to pre-check
        navigate(`/job/${job.id}/pre-check`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to claim job')
      }
    } else if (job.status === 'assigned' || job.status === 'paused') {
      // Go to pre-check screen (need to clock in)
      navigate(`/job/${job.id}/pre-check`)
    } else {
      // in_progress - go directly to inspection
      navigate(`/job/${job.id}/inspection`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">My Jobs</h1>
            <p className="text-sm text-blue-200">
              {user?.firstName} {user?.lastName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isOnline && (
              <Badge variant="amber" size="sm">Offline</Badge>
            )}
            <button
              onClick={signOut}
              className="text-sm text-blue-200 underline"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Filter tabs */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex gap-2">
        <button
          className={`
            px-3 py-2 text-sm font-medium transition-colors
            ${filter === 'mine' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}
          `}
          onClick={() => setFilter('mine')}
        >
          My Jobs
        </button>
        <button
          className={`
            px-3 py-2 text-sm font-medium transition-colors
            ${filter === 'unassigned' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}
          `}
          onClick={() => setFilter('unassigned')}
        >
          Unassigned
        </button>
        <button
          className={`
            px-3 py-2 text-sm font-medium transition-colors
            ${filter === 'all' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'}
          `}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          loading={refreshing}
        >
          Refresh
        </Button>
      </div>

      {/* Main content */}
      <main className="flex-1 p-4 space-y-3 overflow-auto">
        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4 mb-4">
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchJobs()}
              className="ml-2"
            >
              Retry
            </Button>
          </div>
        )}

        {jobs.length === 0 ? (
          <Card variant="default" padding="lg" className="text-center">
            <div className="text-gray-400 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-gray-600">
              {filter === 'mine' && 'No jobs assigned to you'}
              {filter === 'unassigned' && 'No unassigned jobs'}
              {filter === 'all' && 'No jobs available'}
            </p>
            <p className="text-sm text-gray-500 mt-1">Pull down to refresh</p>
          </Card>
        ) : (
          jobs.map((job) => (
            <JobCard key={job.id} job={job} onClick={() => handleJobClick(job)} />
          ))
        )}
      </main>
    </div>
  )
}

interface JobCardProps {
  job: HealthCheck
  onClick: () => void
}

function JobCard({ job, onClick }: JobCardProps) {
  const vehicle = job.vehicle
  const customer = job.customer

  return (
    <Card
      variant="elevated"
      padding="md"
      className="cursor-pointer active:bg-gray-50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-lg font-bold text-gray-900">
            {vehicle?.registration || 'No Reg'}
          </h3>
          <p className="text-sm text-gray-600">
            {vehicle?.make} {vehicle?.model} {vehicle?.year && `(${vehicle.year})`}
          </p>
        </div>
        <StatusBadge status={job.status as any} />
      </div>

      {customer && (
        <p className="text-sm text-gray-600 mb-2">
          {customer.first_name} {customer.last_name}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          {job.promise_time
            ? `Due: ${new Date(job.promise_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'No deadline'}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Tap to {job.status === 'created' ? 'claim' : job.status === 'assigned' ? 'start' : job.status === 'paused' ? 'resume' : 'continue'}
        </span>
      </div>

      {/* Show RAG counts if in progress */}
      {job.status !== 'assigned' && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4">
          <span className="text-sm flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-rag-green" />
            {job.green_count}
          </span>
          <span className="text-sm flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-rag-amber" />
            {job.amber_count}
          </span>
          <span className="text-sm flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-rag-red" />
            {job.red_count}
          </span>
        </div>
      )}
    </Card>
  )
}
