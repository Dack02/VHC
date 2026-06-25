import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface BoardColumnRow {
  id: string
  columnType: 'technician' | 'queue'
  technicianId: string | null
  technician: { id: string; first_name: string; last_name: string } | null
  name: string
  colour: string | null
  availableHours: number
  sortOrder: number
  isVisible: boolean
}

interface BoardResponse {
  siteId: string
  config: {
    defaultTechHours: number
    dayStartTime: string
    dayEndTime: string
    lunchStartTime: string | null
    lunchEndTime: string | null
    operatingDays: number[]
  }
  columns: BoardColumnRow[]
}

// ISO dow (1=Mon..7=Sun) for the Operating days picker.
const DOWS: { d: number; l: string }[] = [
  { d: 1, l: 'Mon' }, { d: 2, l: 'Tue' }, { d: 3, l: 'Wed' }, { d: 4, l: 'Thu' },
  { d: 5, l: 'Fri' }, { d: 6, l: 'Sat' }, { d: 7, l: 'Sun' }
]

export default function WorkshopBoardSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [columns, setColumns] = useState<BoardColumnRow[]>([])
  const [siteId, setSiteId] = useState<string | null>(null)
  const [defaultHours, setDefaultHours] = useState('8')
  const [dayStart, setDayStart] = useState('08:00')
  const [dayEnd, setDayEnd] = useState('17:30')
  const [lunchStart, setLunchStart] = useState('')
  const [lunchEnd, setLunchEnd] = useState('')
  const [operatingDays, setOperatingDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7])
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)

  const toggleDay = (d: number) =>
    setOperatingDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b))

  const token = session?.accessToken

  const fetchBoard = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<BoardResponse>(`/api/v1/workshop-board?${params}`, { token })
      setColumns(data.columns)
      setSiteId(data.siteId)
      setDefaultHours(String(data.config.defaultTechHours))
      setDayStart(data.config.dayStartTime)
      setDayEnd(data.config.dayEndTime)
      setLunchStart(data.config.lunchStartTime || '')
      setLunchEnd(data.config.lunchEndTime || '')
      setOperatingDays(data.config.operatingDays?.length ? data.config.operatingDays : [1, 2, 3, 4, 5, 6, 7])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load board settings')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  const handleSaveConfig = async () => {
    if (!token || !siteId) return
    const hours = Number(defaultHours)
    if (Number.isNaN(hours) || hours <= 0 || hours > 24) {
      toast.error('Default hours must be between 0 and 24')
      return
    }
    if (dayStart >= dayEnd) {
      toast.error('Day start must be before day end')
      return
    }
    if ((lunchStart && !lunchEnd) || (!lunchStart && lunchEnd)) {
      toast.error('Set both lunch times, or neither')
      return
    }
    if (operatingDays.length === 0) {
      toast.error('Select at least one operating day')
      return
    }
    setSavingConfig(true)
    try {
      await api(`/api/v1/workshop-board/config?siteId=${siteId}`, {
        method: 'PATCH',
        token,
        body: {
          defaultTechHours: hours,
          dayStartTime: dayStart,
          dayEndTime: dayEnd,
          lunchStartTime: lunchStart || null,
          lunchEndTime: lunchEnd || null,
          operatingDays
        }
      })
      toast.success('Planner settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSavingConfig(false)
    }
  }

  const handleUpdateColumn = async (column: BoardColumnRow, fields: Record<string, unknown>) => {
    if (!token) return
    try {
      await api(`/api/v1/workshop-board/columns/${column.id}`, {
        method: 'PATCH',
        token,
        body: fields
      })
      fetchBoard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update column')
    }
  }

  const handleDeleteColumn = async (column: BoardColumnRow) => {
    if (!token) return
    const label = column.columnType === 'technician' ? `${column.name}'s column` : `"${column.name}"`
    if (!window.confirm(`Remove ${label} from the board? Cards in it will return to their automatic position.`)) {
      return
    }
    try {
      await api(`/api/v1/workshop-board/columns/${column.id}`, { method: 'DELETE', token })
      toast.success('Column removed')
      fetchBoard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove column')
    }
  }

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!token) return
    const target = index + direction
    if (target < 0 || target >= columns.length) return
    const reordered = [...columns]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    setColumns(reordered)
    try {
      await api('/api/v1/workshop-board/columns/reorder', {
        method: 'POST',
        token,
        body: { columnIds: reordered.map(c => c.id) }
      })
    } catch {
      toast.error('Failed to reorder')
      fetchBoard()
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Workshop Planner</h1>
        <p className="text-gray-600 mt-1">
          Working day, columns and capacity for this site's board ({user?.site?.name || 'your site'}). Statuses are managed in{' '}
          <Link to="/settings/workshop-statuses" className="text-primary hover:underline">Job Statuses</Link>.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Working day + capacity defaults */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Working day & capacity</h2>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Operating days</label>
              <div className="flex flex-wrap gap-2">
                {DOWS.map(({ d, l }) => {
                  const on = operatingDays.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${on ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
                    >
                      {l}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1">Days the workshop is open. The Booking Diary hides closed weekdays (a day that has bookings still shows). Click Save to apply.</p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Day starts</label>
                <input
                  type="time"
                  value={dayStart}
                  onChange={e => setDayStart(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Day ends</label>
                <input
                  type="time"
                  value={dayEnd}
                  onChange={e => setDayEnd(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Lunch from (optional)</label>
                <input
                  type="time"
                  value={lunchStart}
                  onChange={e => setLunchStart(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Lunch to</label>
                <input
                  type="time"
                  value={lunchEnd}
                  onChange={e => setLunchEnd(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Default tech hours/day</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="24"
                  value={defaultHours}
                  onChange={e => setDefaultHours(e.target.value)}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {savingConfig ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              The day start/end set the timeline's bounds; lunch shows as a shaded band. Default hours seed new technician columns — each column's hours can be adjusted below.
            </p>
          </div>

          {/* Columns */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Board columns</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Order here matches the board (after the fixed Due In / Checked In columns). Add columns from the board itself.
                </p>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {columns.map((column, index) => (
                <div key={column.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => handleMove(index, -1)}
                      disabled={index === 0}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                      aria-label="Move up"
                    >▲</button>
                    <button
                      onClick={() => handleMove(index, 1)}
                      disabled={index === columns.length - 1}
                      className="text-gray-300 hover:text-gray-600 disabled:opacity-30"
                      aria-label="Move down"
                    >▼</button>
                  </div>

                  {column.columnType === 'queue' ? (
                    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: column.colour || '#6B7280' }} />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {column.name.split(' ').map(p => p.charAt(0)).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{column.name}</div>
                    <div className="text-xs text-gray-400">
                      {column.columnType === 'technician' ? 'Technician column' : 'Queue column'}
                    </div>
                  </div>

                  {column.columnType === 'technician' && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        defaultValue={column.availableHours}
                        onBlur={e => {
                          const hours = Number(e.target.value)
                          if (!Number.isNaN(hours) && hours !== column.availableHours) {
                            handleUpdateColumn(column, { availableHours: hours })
                          }
                        }}
                        className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <span className="text-xs text-gray-400">hrs/day</span>
                    </div>
                  )}

                  <button
                    onClick={() => handleDeleteColumn(column)}
                    className="text-sm text-red-500 hover:text-red-700 px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {columns.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No columns yet - open the Workshop Board and use "+ Add column" to set up technicians and queues.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
