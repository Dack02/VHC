// Table list view — a dense, configurable table over the week range. Columns can
// be shown/hidden (persisted), sorted, searched and exported to CSV; the first
// column is frozen on horizontal scroll. Built to absorb more columns over time.
import { useMemo, useState, type ReactNode } from 'react'
import { useDiaryRange } from './useDiaryData'
import {
  Spinner, ErrorNote, Badge, BadgeStrip, useBookingOpener, RefreshButton,
  ToolbarButton, type Density
} from './shared'
import {
  weekStart, addDays, formatTime, jobTypeOf, humanizeState,
  type DiaryBooking
} from './types'

type ColKey =
  | 'day' | 'time' | 'registration' | 'customer' | 'serviceType' | 'type'
  | 'description' | 'advisor' | 'technician' | 'bay' | 'status' | 'hours' | 'source'

interface Column {
  key: ColKey
  label: string
  align?: 'right'
  sortVal: (b: DiaryBooking) => string | number
  text: (b: DiaryBooking) => string           // plain text (search + CSV)
  render: (b: DiaryBooking) => ReactNode
}

function dayShort(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

const COLUMNS: Column[] = [
  { key: 'day', label: 'Day', sortVal: b => b.apptDate, text: b => dayShort(b.apptDate),
    render: b => <span className="text-gray-700 whitespace-nowrap">{dayShort(b.apptDate)}</span> },
  { key: 'time', label: 'Time', sortVal: b => (b.apptTime && b.apptTime.slice(0, 5) !== '00:00') ? b.apptTime : '~', text: b => formatTime(b.apptTime),
    render: b => <span className="font-medium text-gray-900">{formatTime(b.apptTime)}</span> },
  { key: 'registration', label: 'Reg', sortVal: b => b.registration || '', text: b => b.registration || '',
    render: b => <span className="font-mono text-gray-700 whitespace-nowrap">{b.registration || '—'}</span> },
  { key: 'customer', label: 'Customer', sortVal: b => (b.customerName || '').toLowerCase(), text: b => b.customerName || '',
    render: b => <span className="text-gray-700">{b.customerName || '—'}</span> },
  { key: 'serviceType', label: 'Service', sortVal: b => (b.serviceType || '').toLowerCase(), text: b => b.serviceType || '',
    render: b => <span className="text-gray-700">{b.serviceType || '—'}</span> },
  { key: 'type', label: 'Type', sortVal: b => jobTypeOf(b).toLowerCase(), text: b => jobTypeOf(b),
    render: b => {
      const hasFlags = b.isMot || b.isWaiting || b.isLoan || b.isOutreach
      return hasFlags ? <BadgeStrip booking={b} /> : <span className="text-gray-500">{jobTypeOf(b)}</span>
    } },
  { key: 'description', label: 'Job', sortVal: b => (b.description || '').toLowerCase(), text: b => b.description || '',
    render: b => <span className="text-gray-500 block max-w-[260px] truncate" title={b.description || ''}>{b.description || '—'}</span> },
  { key: 'advisor', label: 'Advisor', sortVal: b => (b.advisor?.name || '').toLowerCase(), text: b => b.advisor?.name || '',
    render: b => <span className="text-gray-700 whitespace-nowrap">{b.advisor?.name || '—'}</span> },
  { key: 'technician', label: 'Technician', sortVal: b => (b.technician?.name || '').toLowerCase(), text: b => b.technician?.name || '',
    render: b => <span className="text-gray-700 whitespace-nowrap">{b.technician?.name || <span className="text-gray-400">Unassigned</span>}</span> },
  { key: 'bay', label: 'Bay', sortVal: b => b.bayNumber || '', text: b => b.bayNumber || '',
    render: b => <span className="text-gray-700">{b.bayNumber || '—'}</span> },
  { key: 'status', label: 'Status', sortVal: b => (b.jobState || b.status || '').toLowerCase(), text: b => humanizeState(b.jobState || b.status),
    render: b => (b.jobState || b.status)
      ? <Badge label={humanizeState(b.jobState || b.status)} classes="bg-gray-100 text-gray-600" />
      : <span className="text-gray-400">—</span> },
  { key: 'hours', label: 'Hrs', align: 'right', sortVal: b => b.estimatedHours, text: b => `${b.estimatedHours}`,
    render: b => <span className="text-gray-700">{b.estimatedHours}h</span> },
  { key: 'source', label: 'Src', sortVal: b => b.source, text: b => b.source.toUpperCase(),
    render: b => <span className="text-[10px] uppercase tracking-wide text-gray-400">{b.source}</span> },
]

const COLUMNS_KEY = 'vhc_diary_columns'
const DEFAULT_VISIBLE: ColKey[] = ['day', 'time', 'registration', 'customer', 'type', 'advisor', 'technician', 'hours', 'source']

function loadVisible(): Set<ColKey> {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY)
    if (raw) return new Set(JSON.parse(raw) as ColKey[])
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE)
}

interface SortState { key: ColKey; dir: 'asc' | 'desc' }

export default function TableListView({ today, weekOffset, onWeek, density, onChangeDensity }: {
  today: string
  weekOffset: number
  onWeek: (delta: number) => void
  density: Density
  onChangeDensity: (d: Density) => void
}) {
  const weekFrom = useMemo(() => weekStart(addDays(today, weekOffset * 7)), [today, weekOffset])
  const weekTo = useMemo(() => addDays(weekFrom, 6), [weekFrom])
  const { bookings, loading, error, refresh } = useDiaryRange(weekFrom, weekTo)
  const { open, modal } = useBookingOpener()

  const [visible, setVisible] = useState<Set<ColKey>>(loadVisible)
  const [sort, setSort] = useState<SortState>({ key: 'day', dir: 'asc' })
  const [query, setQuery] = useState('')
  const [colMenuOpen, setColMenuOpen] = useState(false)

  const persistVisible = (next: Set<ColKey>) => {
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
  }
  const toggleCol = (key: ColKey) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) { if (next.size > 1) next.delete(key) } else next.add(key)
      persistVisible(next)
      return next
    })
  }
  const resetCols = () => { const next = new Set(DEFAULT_VISIBLE); setVisible(next); persistVisible(next) }

  const cols = useMemo(() => COLUMNS.filter(c => visible.has(c.key)), [visible])

  const rangeLabel = `${new Date(`${weekFrom}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(`${weekTo}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`

  const rows = useMemo(() => {
    let r = bookings || []
    const q = query.trim().toLowerCase()
    if (q) {
      r = r.filter(b =>
        [b.registration, b.customerName, b.description, b.advisor?.name, b.technician?.name, b.serviceType]
          .some(v => v && v.toLowerCase().includes(q))
      )
    }
    const col = COLUMNS.find(c => c.key === sort.key)
    if (col) {
      const dir = sort.dir === 'asc' ? 1 : -1
      r = [...r].sort((a, b) => {
        const av = col.sortVal(a), bv = col.sortVal(b)
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
        return 0
      })
    }
    return r
  }, [bookings, query, sort])

  const setSortKey = (key: ColKey) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const exportCsv = () => {
    const header = cols.map(c => c.label)
    const lines = rows.map(b => cols.map(c => {
      const v = c.text(b).replace(/"/g, '""')
      return /[",\n]/.test(v) ? `"${v}"` : v
    }))
    const csv = [header, ...lines].map(l => l.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `booking-diary-${weekFrom}-to-${weekTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cellPad = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5'

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <ToolbarButton onClick={() => onWeek(-1)} title="Previous week">‹ Prev</ToolbarButton>
            <ToolbarButton active={weekOffset === 0} onClick={() => onWeek(-weekOffset)}>This week</ToolbarButton>
            <ToolbarButton onClick={() => onWeek(1)} title="Next week">Next ›</ToolbarButton>
          </div>
          <span className="text-sm font-medium text-gray-600 hidden sm:inline">{rangeLabel}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search reg, customer…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:ring-primary focus:border-primary"
          />
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <ToolbarButton active={density === 'normal'} onClick={() => onChangeDensity('normal')} title="Comfortable rows">≣</ToolbarButton>
            <ToolbarButton active={density === 'compact'} onClick={() => onChangeDensity('compact')} title="Compact rows">≡</ToolbarButton>
          </div>
          <div className="relative">
            <button
              onClick={() => setColMenuOpen(o => !o)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Columns
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 w-48 bg-white border border-gray-200 rounded-xl shadow-lg p-2">
                  <div className="max-h-72 overflow-y-auto">
                    {COLUMNS.map(c => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                        <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggleCol(c.key)} className="rounded text-primary focus:ring-primary" />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  <button onClick={resetCols} className="w-full mt-1 px-2 py-1.5 text-sm text-primary hover:bg-gray-50 rounded-lg text-left">Reset to default</button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Export CSV
          </button>
          <RefreshButton onClick={() => refresh()} />
        </div>
      </div>

      {loading && !bookings ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          No bookings {query ? 'match your search' : 'for this week'}.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {cols.map((c, i) => (
                  <th
                    key={c.key}
                    scope="col"
                    tabIndex={0}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => setSortKey(c.key)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSortKey(c.key) } }}
                    className={`${cellPad} font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'sticky left-0 bg-gray-50 z-[2]' : 'bg-gray-50'}`}
                  >
                    {c.label}
                    {sort.key === c.key && <span className="text-gray-400">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(b => (
                <tr
                  key={b.bookingId}
                  onClick={() => open(b)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open booking ${[b.registration, b.customerName].filter(Boolean).join(' ') || b.bookingId}`}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(b) } }}
                  className="group border-b border-gray-100 last:border-0 hover:bg-gray-50 focus:bg-gray-50 cursor-pointer focus:outline-none"
                >
                  {cols.map((c, i) => (
                    <td
                      key={c.key}
                      className={`${cellPad} ${c.align === 'right' ? 'text-right' : 'text-left'} ${i === 0 ? 'sticky left-0 bg-white group-hover:bg-gray-50 z-[1]' : ''}`}
                    >
                      {c.render(b)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal}
    </div>
  )
}
