import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useTileData } from './useTileData'
import {
  type Tile,
  type TileJob,
  type TileJobsResponse,
  VEHICLE_STATUS_ORDER,
  vehicleStatusLabels,
  daysLabel,
  labelForVhc,
  labelForVehicle
} from './types'

const GRAY = '#9CA3AF'

function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 whitespace-nowrap">
      {children}
    </span>
  )
}

function TileCard({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const colour = tile.colour || GRAY
  const age = daysLabel(tile.oldestDays)

  const vehicleEntries = VEHICLE_STATUS_ORDER
    .filter(k => (tile.vehicleStatus?.[k] || 0) > 0)
    .map(k => ({ label: vehicleStatusLabels[k] || k, count: tile.vehicleStatus[k] }))

  const vhcEntries = Object.entries(tile.vhcState || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: labelForVhc(k), count: n }))

  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:border-gray-300 hover:shadow transition-all w-full"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: colour }} />
          <span className="font-medium text-gray-900 truncate">{tile.name}</span>
        </div>
        <span className="text-2xl font-bold text-gray-900 leading-none">{tile.count}</span>
      </div>

      {age && (
        <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <ClockIcon />
          {age}
        </span>
      )}

      {(vehicleEntries.length > 0 || vhcEntries.length > 0) && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {vehicleEntries.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Vehicle status</div>
              <div className="flex flex-wrap gap-1.5">
                {vehicleEntries.map(e => <Chip key={e.label}>{e.label} {e.count}</Chip>)}
              </div>
            </div>
          )}
          {vhcEntries.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">VHC state</div>
              <div className="flex flex-wrap gap-1.5">
                {vhcEntries.slice(0, 4).map(e => <Chip key={e.label}>{e.label} {e.count}</Chip>)}
                {vhcEntries.length > 4 && <Chip>+{vhcEntries.length - 4} more</Chip>}
              </div>
            </div>
          )}
        </div>
      )}
    </button>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

function JobList({ tile, jobs, loading, error, onOpenJob }: {
  tile: Tile
  jobs: TileJob[] | null
  loading: boolean
  error: string | null
  onOpenJob: (id: string) => void
}) {
  if (loading) return <Spinner />
  if (error) return <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{error}</div>
  if (!jobs || jobs.length === 0) {
    return <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-400">No active jobs in {tile.name}.</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5 font-medium">Vehicle</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Advisor</th>
              <th className="px-4 py-2.5 font-medium">Technician</th>
              <th className="px-4 py-2.5 font-medium">Vehicle status</th>
              <th className="px-4 py-2.5 font-medium">VHC state</th>
              <th className="px-4 py-2.5 font-medium text-right">In status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(job => (
              <tr
                key={job.healthCheckId}
                onClick={() => onOpenJob(job.healthCheckId)}
                className="hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-gray-900">{job.registration || '—'}</div>
                  {(job.make || job.model) && (
                    <div className="text-xs text-gray-400">{[job.make, job.model].filter(Boolean).join(' ')}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-700">{job.customerName || '—'}</td>
                <td className="px-4 py-2.5 text-gray-600">{job.advisorName || '—'}</td>
                <td className="px-4 py-2.5 text-gray-600">{job.technicianName || '—'}</td>
                <td className="px-4 py-2.5 text-gray-600">{labelForVehicle(job.jobState)}</td>
                <td className="px-4 py-2.5 text-gray-600">{labelForVhc(job.vhcStatus)}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <ClockIcon />
                    {daysLabel(job.daysInStatus)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TileStatusPage() {
  const { user, session } = useAuth()
  const navigate = useNavigate()
  const { tiles, loading, error, refresh } = useTileData()

  const [selected, setSelected] = useState<Tile | null>(null)
  const [jobs, setJobs] = useState<TileJob[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  const openTile = useCallback(async (tile: Tile) => {
    setSelected(tile)
    setJobs(null)
    setJobsError(null)
    setJobsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('status', tile.statusId ?? 'none')
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<TileJobsResponse>(
        `/api/v1/workshop-board/tiles/jobs?${params}`,
        { token: session?.accessToken }
      )
      setJobs(data.jobs)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      setJobsLoading(false)
    }
  }, [user?.site?.id, session?.accessToken])

  // ---- Drill-in view ------------------------------------------------------
  if (selected) {
    return (
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          ← Back to tiles
        </button>
        <div className="flex items-center gap-2 mb-4">
          <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected.colour || GRAY }} />
          <h1 className="text-2xl font-bold text-gray-900">{selected.name}</h1>
          <span className="text-gray-400">({selected.count})</span>
        </div>
        <JobList
          tile={selected}
          jobs={jobs}
          loading={jobsLoading}
          error={jobsError}
          onOpenJob={(id) => navigate(`/health-checks/${id}`)}
        />
      </div>
    )
  }

  // ---- Tile grid ----------------------------------------------------------
  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tile Status</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Live job counts by Job Status{user?.site?.name ? ` · ${user.site.name}` : ''}
          </p>
        </div>
        <button
          onClick={() => refresh()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">{error}</div>
      ) : !tiles || tiles.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-16 text-center text-sm text-gray-400">
          No active jobs right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tiles.map(tile => (
            <TileCard key={tile.statusId ?? 'none'} tile={tile} onClick={() => openTile(tile)} />
          ))}
        </div>
      )}
    </div>
  )
}
