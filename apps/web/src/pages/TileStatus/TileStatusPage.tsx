import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, type User } from '../../lib/api'
import { jobPath } from '../../lib/jobLink'
import { useTileData } from './useTileData'
import { TileIcon, resolveTileIcon } from './tileIcons'
import {
  type Tile,
  type TileJob,
  type TileJobsResponse,
  type AgePill,
  VEHICLE_STATUS_ORDER,
  vehicleStatusLabels,
  vehicleStatusColour,
  daysLabel,
  dueCountdownLabel,
  labelForVhc,
  labelForVehicle,
  agePill,
  AGE_WARN_DAYS
} from './types'

const GRAY = '#9CA3AF'

// KPI summary ribbon visibility — a simple flag (default on). The natural
// follow-up is a per-org setting; hardcoded is fine for v1.
const SHOW_KPI_RIBBON = true

function formatDue(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// "19 parts pricing · 4 pricing" — top entries by count, with a "+N" overflow.
function summarizeCounts(pairs: Array<{ label: string; count: number }>, max = 2): string {
  const shown = pairs.slice(0, max).map(p => `${p.count} ${p.label.toLowerCase()}`)
  const extra = pairs.length - max
  if (extra > 0) shown.push(`+${extra}`)
  return shown.join(' · ')
}

// The shared clock+text ageing pill — used on tiles, the drill header, and the
// "Waiting" column. Colour/background come from the pill descriptor.
function AgeChip({ age, className = 'text-[11.5px] px-[9px] py-[3px]', prefix = '' }: {
  age: AgePill
  className?: string
  prefix?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-[4px] font-semibold rounded-[20px] whitespace-nowrap ${className}`}
      style={{ color: age.color, background: age.bg }}
    >
      <TileIcon name="clock" size={13} />
      {prefix}{age.text}
    </span>
  )
}

// All the per-tile presentation derived from the (unchanged) Tile payload.
function deriveTile(tile: Tile) {
  const colour = tile.colour || GRAY

  // Distribution segments follow lifecycle order; chips/labels sort by count.
  const present = VEHICLE_STATUS_ORDER.filter(k => (tile.vehicleStatus?.[k] || 0) > 0)
  const segs = present.map(k => ({ key: k, grow: tile.vehicleStatus[k], color: vehicleStatusColour(k) }))
  const chips = present
    .map(k => ({ key: k, label: vehicleStatusLabels[k] || k, count: tile.vehicleStatus[k], color: vehicleStatusColour(k) }))
    .sort((a, b) => b.count - a.count)

  const vhcText = summarizeCounts(
    Object.entries(tile.vhcState || {})
      .map(([k, n]) => ({ label: labelForVhc(k), count: n }))
      .filter(p => p.count > 0)
      .sort((a, b) => b.count - a.count)
  )

  return {
    colour,
    iconBg: colour + '1F', // status colour at ~12% alpha
    iconName: resolveTileIcon(tile),
    age: agePill(tile.oldestDays),
    segs,
    vehTop: chips.slice(0, 2),
    vehMore: chips.length > 2 ? `+${chips.length - 2}` : '',
    vhcText
  }
}

function TileCard({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const d = deriveTile(tile)

  return (
    <button
      onClick={onClick}
      className="group flex flex-col text-left bg-white border border-[#ededeb] rounded-[14px] p-4 cursor-pointer transition-all duration-[120ms] hover:border-[#d6d6d2] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)]"
    >
      {/* Row 1 — identity: status-colour icon chip + name */}
      <div className="flex items-center gap-[10px] mb-[14px]">
        <span
          className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-none"
          style={{ background: d.iconBg, color: d.colour }}
        >
          <TileIcon name={d.iconName} size={18} />
        </span>
        <div className="text-[13.5px] font-bold text-[#16181d] leading-[1.18]">{tile.name}</div>
      </div>

      {/* Row 2 — large tabular count + ageing pill */}
      <div className="flex items-end justify-between gap-2 mb-[13px]">
        <div className="flex items-baseline gap-[6px]">
          <span className="text-[31px] font-extrabold tracking-[-0.025em] text-[#16181d] leading-none tabular-nums">{tile.count}</span>
          <span className="text-[12px] font-medium text-[#a4a8b0]">jobs</span>
        </div>
        {d.age && <AgeChip age={d.age} />}
      </div>

      {/* Distribution bar — one segment per Vehicle Status, sized by count */}
      <div className="flex gap-[2px] mb-[11px]">
        {d.segs.length > 0 ? (
          d.segs.map(s => (
            <div key={s.key} className="h-[7px] rounded-[3px]" style={{ flex: `${s.grow} 1 0`, background: s.color }} />
          ))
        ) : (
          <div className="h-[7px] rounded-[3px] flex-1" style={{ background: '#f0f0ee' }} />
        )}
      </div>

      {/* Breakdown chips — top 2 Vehicle Statuses by count, then "+N" */}
      {d.vehTop.length > 0 && (
        <div className="flex flex-wrap gap-x-[11px] gap-y-[5px] mb-[12px]">
          {d.vehTop.map(c => (
            <span key={c.key} className="inline-flex items-center gap-[5px] text-[11.5px] font-medium text-[#5f636c]">
              <span className="w-[7px] h-[7px] rounded-[2px] flex-none" style={{ background: c.color }} />
              {c.label} <span className="text-[#16181d] font-bold">{c.count}</span>
            </span>
          ))}
          {d.vehMore && <span className="text-[11.5px] font-medium text-[#a4a8b0] self-center">{d.vehMore}</span>}
        </div>
      )}

      {/* VHC footer — mono micro-label + truncated pipeline summary */}
      <div className="border-t border-[#f1f1ef] pt-[10px] mt-auto flex items-center gap-2">
        <span className="font-mono text-[10px] font-medium text-[#a4a8b0] tracking-[0.06em] flex-none">VHC</span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#7b7f88]">{d.vhcText || '—'}</span>
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

// Advisor scope filter — a real dropdown (the /tiles endpoint accepts advisorId).
// Keeps the handoff's button look; closes on outside-click / Escape.
function AdvisorFilter({ advisors, value, onChange }: {
  advisors: User[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = advisors.find(a => a.id === value)
  const label = selected ? `${selected.firstName} ${selected.lastName}` : 'All advisors'

  const Option = ({ optLabel, active, onSelect }: { optLabel: string; active: boolean; onSelect: () => void }) => (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-[12px] py-[7px] text-[13px] transition-colors hover:bg-[#fafaf8] ${active ? 'font-semibold text-[#16181d] bg-[#f4f4f2]' : 'text-[#5f636c]'}`}
    >
      {optLabel}
    </button>
  )

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold text-[#5f636c] bg-white border border-[#e6e6e3] rounded-[9px] px-[14px] py-[8px] hover:bg-[#f7f7f5] transition-colors"
      >
        <TileIcon name="users" size={16} />
        <span className="max-w-[160px] truncate">{label}</span>
        <TileIcon name="chevron-down" size={16} className={`text-[#a4a8b0] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-[6px] w-[220px] max-h-[300px] overflow-auto bg-white border border-[#e6e6e3] rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.10)] py-[5px]"
        >
          <Option optLabel="All advisors" active={!value} onSelect={() => { onChange(null); setOpen(false) }} />
          {advisors.map(a => (
            <Option
              key={a.id}
              optLabel={`${a.firstName} ${a.lastName}`}
              active={a.id === value}
              onSelect={() => { onChange(a.id); setOpen(false) }}
            />
          ))}
          {advisors.length === 0 && (
            <div className="px-[12px] py-[7px] text-[12.5px] text-[#a4a8b0]">No advisors</div>
          )}
        </div>
      )}
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
  if (error) return <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-[14px] px-4 py-3 text-sm">{error}</div>
  if (!jobs || jobs.length === 0) {
    return <div className="bg-white border border-[#ededeb] rounded-[14px] px-4 py-12 text-center text-sm text-[#a4a8b0]">No active jobs in {tile.name}.</div>
  }

  // Future Bookings haven't arrived, so "days in status" (age since import) is
  // meaningless — show a countdown to the booking date instead (no threshold colour).
  const isFuture = tile.statusId === 'future'

  return (
    <div className="bg-white border border-[#ededeb] rounded-[14px] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-[#fafaf8] text-left text-[10.5px] uppercase tracking-wide text-[#a4a8b0]">
              <th className="px-[16px] py-[11px] font-semibold">Job</th>
              <th className="px-[16px] py-[11px] font-semibold">Vehicle</th>
              <th className="px-[16px] py-[11px] font-semibold">Customer</th>
              <th className="px-[16px] py-[11px] font-semibold">Advisor</th>
              <th className="px-[16px] py-[11px] font-semibold">Tech</th>
              <th className="px-[16px] py-[11px] font-semibold">Vehicle status</th>
              <th className="px-[16px] py-[11px] font-semibold">VHC state</th>
              <th className="px-[16px] py-[11px] font-semibold">Due</th>
              <th className="px-[16px] py-[11px] font-semibold text-right">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => {
              const waiting: AgePill = isFuture
                ? { text: dueCountdownLabel(job.dueDate) ?? '—', level: 'ok', color: '#7b7f88', bg: '#f0f0ee' }
                : agePill(job.daysInStatus) ?? { text: '—', level: 'ok', color: '#7b7f88', bg: '#f0f0ee' }
              return (
                <tr
                  key={job.jobsheetId || job.healthCheckId}
                  onClick={() => onOpenJob(job)}
                  className="border-t border-[#f1f1ef] hover:bg-[#fafaf8] cursor-pointer"
                >
                  <td className="px-[16px] py-[11px] font-bold text-[#16181d] tabular-nums whitespace-nowrap">{job.jobNumber || '—'}</td>
                  <td className="px-[16px] py-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10.5px] bg-[#fdf6dd] border border-[#efe2a8] text-[#796a1f] rounded-[4px] px-[6px] py-[2px] whitespace-nowrap">
                        {job.registration || '—'}
                      </span>
                      {(job.make || job.model) && (
                        <span className="text-[12px] text-[#7b7f88] whitespace-nowrap">{[job.make, job.model].filter(Boolean).join(' ')}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-[16px] py-[11px] text-[#5f636c] whitespace-nowrap">{job.customerName || '—'}</td>
                  <td className="px-[16px] py-[11px] text-[#5f636c] whitespace-nowrap">{job.advisorName || '—'}</td>
                  <td className="px-[16px] py-[11px] text-[#5f636c] whitespace-nowrap">{job.technicianName || '—'}</td>
                  <td className="px-[16px] py-[11px]">
                    <span className="inline-flex items-center gap-[6px] text-[#5f636c] whitespace-nowrap">
                      <span className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: vehicleStatusColour(job.jobState) }} />
                      {labelForVehicle(job.jobState)}
                    </span>
                  </td>
                  <td className="px-[16px] py-[11px] text-[#5f636c] whitespace-nowrap">{job.vhcStatus ? labelForVhc(job.vhcStatus) : '—'}</td>
                  <td className="px-[16px] py-[11px] text-[#5f636c] whitespace-nowrap">{job.dueDate ? formatDue(job.dueDate) : '—'}</td>
                  <td className="px-[16px] py-[11px] text-right">
                    <AgeChip age={waiting} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ADVISOR_ROLES = ['service_advisor', 'site_admin', 'org_admin']

export default function TileStatusPage() {
  const { user, session } = useAuth()
  const navigate = useNavigate()

  const [advisorId, setAdvisorId] = useState<string | null>(null)
  const [advisors, setAdvisors] = useState<User[]>([])
  const { tiles, loading, error, refresh } = useTileData(advisorId)

  const [selected, setSelected] = useState<Tile | null>(null)
  const [jobs, setJobs] = useState<TileJob[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsError, setJobsError] = useState<string | null>(null)

  // Advisor-capable users for the scope filter (org-wide, role-filtered — mirrors
  // the Health Checks list). Best-effort: the page still works if this fails.
  useEffect(() => {
    if (!session?.accessToken) return
    let cancelled = false
    api<{ users: User[] }>('/api/v1/users', { token: session.accessToken })
      .then(d => {
        if (cancelled) return
        setAdvisors((d.users || []).filter(u => ADVISOR_ROLES.includes(u.role)))
      })
      .catch(() => { /* non-fatal: leave the filter empty */ })
    return () => { cancelled = true }
  }, [session?.accessToken])

  const openTile = useCallback(async (tile: Tile) => {
    setSelected(tile)
    setJobs(null)
    setJobsError(null)
    setJobsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('status', tile.statusId ?? 'none')
      if (user?.site?.id) params.set('siteId', user.site.id)
      if (advisorId) params.set('advisorId', advisorId)
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
  }, [user?.site?.id, session?.accessToken, advisorId])

  // KPI ribbon — all derived client-side from the tiles array, no new endpoint.
  const kpis = useMemo(() => {
    const list = tiles ?? []
    const active = list.reduce((s, t) => s + t.count, 0)
    const oldest = list.reduce((m, t) => (t.oldestDays != null && t.oldestDays > m ? t.oldestDays : m), -1)
    const oldestPill = oldest >= 0 ? agePill(oldest) : null
    const needs = list.filter(t => (t.oldestDays ?? 0) >= AGE_WARN_DAYS).length
    const readyTile = list.find(t => /ready/.test(t.name.toLowerCase()) && /collect/.test(t.name.toLowerCase()))
    const ready = readyTile
      ? readyTile.count
      : list.reduce((s, t) => s + (t.vehicleStatus?.work_complete || 0), 0)
    return [
      { label: 'Active jobs', value: String(active), color: '#16181d' },
      { label: 'Oldest wait', value: oldest >= 0 ? (daysLabel(oldest) ?? '—') : '—', color: oldestPill?.color ?? '#16181d' },
      { label: 'Needs attention', value: `${needs} ${needs === 1 ? 'tile' : 'tiles'}`, color: needs > 0 ? '#a9760f' : '#16181d' },
      { label: 'Ready to collect', value: String(ready), color: '#2c9367' }
    ]
  }, [tiles])

  // ---- Drill-in view ------------------------------------------------------
  if (selected) {
    const d = deriveTile(selected)
    const showingNote = jobs
      ? (selected.count > jobs.length ? `Showing oldest ${jobs.length} of ${selected.count}` : 'Showing oldest first')
      : ''
    return (
      <div className="max-w-[1320px] mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-[7px] text-[12.5px] text-[#7b7f88] mb-[16px] hover:text-[#16181d] transition-colors"
        >
          <TileIcon name="arrow-left" size={15} />
          Back to tiles
        </button>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-[18px]">
          <div className="flex items-center gap-[12px]">
            <span
              className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center flex-none"
              style={{ background: d.iconBg, color: d.colour }}
            >
              <TileIcon name={d.iconName} size={18} />
            </span>
            <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-[#16181d]">{selected.name}</h1>
            <span className="text-[14px] font-medium text-[#a4a8b0]">{selected.count} jobs</span>
            {d.age && <AgeChip age={d.age} className="text-[12px] px-[10px] py-[3px]" prefix="oldest " />}
          </div>
          {showingNote && <div className="text-[12px] text-[#a4a8b0]">{showingNote}</div>}
        </div>
        <JobList
          tile={selected}
          jobs={jobs}
          loading={jobsLoading}
          error={jobsError}
          onOpenJob={(job) => navigate(jobPath(job))}
        />
      </div>
    )
  }

  // ---- Tile grid ----------------------------------------------------------
  return (
    <div className="max-w-[1320px] mx-auto">
      {/* Header row — title + Live pill / subtitle, then scope + advisor + refresh */}
      <div className="flex items-end justify-between flex-wrap gap-5 mb-[22px]">
        <div>
          <div className="flex items-center gap-[11px]">
            <h1 className="text-[28px] font-extrabold tracking-[-0.025em] text-[#16181d]">Tiles</h1>
            <span className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-[#2c9367]">
              <span className="w-[7px] h-[7px] rounded-full bg-[#2c9367]" />
              Live
            </span>
          </div>
          <div className="text-[13.5px] text-[#7b7f88] mt-[5px]">
            Job counts by status{user?.site?.name ? ` · ${user.site.name}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AdvisorFilter advisors={advisors} value={advisorId} onChange={setAdvisorId} />
          <button
            type="button"
            onClick={() => refresh()}
            aria-label="Refresh"
            className="inline-flex items-center justify-center w-[38px] h-[38px] text-[#5f636c] bg-white border border-[#e6e6e3] rounded-[9px] hover:bg-[#f7f7f5] transition-colors"
          >
            <TileIcon name="refresh-cw" size={16} />
          </button>
        </div>
      </div>

      {/* KPI ribbon (optional) */}
      {SHOW_KPI_RIBBON && !loading && !error && tiles && tiles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-[22px]">
          {kpis.map(k => (
            <div key={k.label} className="bg-white border border-[#ededeb] rounded-[13px] px-[17px] py-[14px]">
              <div className="text-[11px] font-bold text-[#a4a8b0] uppercase tracking-[0.05em]">{k.label}</div>
              <div className="text-[24px] font-extrabold tracking-[-0.02em] leading-none mt-[8px]" style={{ color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-[14px] px-4 py-3 text-sm">{error}</div>
      ) : !tiles || tiles.length === 0 ? (
        <div className="bg-white border border-[#ededeb] rounded-[14px] px-4 py-16 text-center text-sm text-[#a4a8b0]">
          No active jobs right now.
        </div>
      ) : (
        <div className="grid gap-[14px] grid-cols-[repeat(auto-fill,minmax(258px,1fr))]">
          {tiles.map(tile => (
            <TileCard key={tile.statusId ?? 'none'} tile={tile} onClick={() => openTile(tile)} />
          ))}
        </div>
      )}
    </div>
  )
}
