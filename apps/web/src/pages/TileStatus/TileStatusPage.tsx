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

function formatDue(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function ClockIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

// "4 in workshop · 2 arrived" — top entries by count, with a "+N" overflow.
function summarizeCounts(pairs: Array<{ label: string; count: number }>, max = 2): string {
  const shown = pairs.slice(0, max).map(p => `${p.count} ${p.label.toLowerCase()}`)
  const extra = pairs.length - max
  if (extra > 0) shown.push(`+${extra}`)
  return shown.join(' · ')
}

function TileCard({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const colour = tile.colour || GRAY
  const age = daysLabel(tile.oldestDays)

  const vehicle = summarizeCounts(
    VEHICLE_STATUS_ORDER
      .map(k => ({ label: vehicleStatusLabels[k] || k, count: tile.vehicleStatus?.[k] || 0 }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
  )
  const vhc = summarizeCounts(
    Object.entries(tile.vhcState || {})
      .map(([k, n]) => ({ label: labelForVhc(k), count: n }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
  )

  return (
    <button
      onClick={onClick}
      className="flex w-full text-left overflow-hidden bg-white border border-gray-200 rounded-xl shadow-sm hover:border-gray-300 hover:shadow transition-all"
    >
      {/* Colour accent = the Job Status identity; text stays neutral so the count leads */}
      <span className="w-1 self-stretch flex-shrink-0" style={{ backgroundColor: colour }} aria-hidden="true" />
      <div className="flex-1 min-w-0 p-4">
        <p className="text-sm font-medium text-gray-900 truncate mb-2.5">{tile.name}</p>
        <div className="flex items-end justify-between gap-2 mb-3">
          <span className="text-3xl font-medium text-gray-900 leading-none">{tile.count}</span>
          {age && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
              <ClockIcon />
              {age}
            </span>
          )}
        </div>
        {(vehicle || vhc) && (
          <div className="border-t border-gray-100 pt-2.5 flex flex-col gap-1.5">
            {vehicle && (
              <div className="flex gap-2.5 items-baseline">
                <span className="text-[11px] text-gray-400 w-12 flex-shrink-0">Vehicle</span>
                <span className="text-[13px] text-gray-600 truncate">{vehicle}</span>
              </div>
            )}
            {vhc && (
              <div className="flex gap-2.5 items-baseline">
                <span className="text-[11px] text-gray-400 w-12 flex-shrink-0">VHC</span>
                <span className="text-[13px] text-gray-600 truncate">{vhc}</span>
              </div>
            )}
          </div>
        )}
      </div>
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
  onOpenJob: (job: TileJob) => void
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
              <th className="px-4 py-2.5 font-medium">Due in</th>
              <th className="px-4 py-2.5 font-medium text-right">In status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(job => (
              <tr
                key={job.jobsheetId || job.healthCheckId}
                onClick={() => onOpenJob(job)}
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
                <td className="px-4 py-2.5 text-gray-600">{job.vhcStatus ? labelForVhc(job.vhcStatus) : '—'}</td>
                <td className="px-4 py-2.5 text-gray-600">{job.dueDate ? formatDue(job.dueDate) : '—'}</td>
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
          onOpenJob={(job) => navigate(job.jobsheetId ? `/jobsheets/${job.jobsheetId}` : `/health-checks/${job.healthCheckId}`)}
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
