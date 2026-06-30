import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { Card } from '../components/Card'

interface BoardStatus { id: string; name: string; colour: string }
interface BoardCard {
  // null for VHC-less jobsheet cards (TECH_JOB_MODEL.md §7) — filtered out below,
  // since this read-only day list navigates to the VHC summary by healthCheckId.
  healthCheckId: string | null
  position: string
  status: string
  workshopStatusId: string | null
  plannedStartAt: string | null
  estimatedHours: number | null
  customerWaiting: boolean
  keyLocation: string | null
  bookedRepairs: Array<{ description?: string; code?: string }>
  vehicle: { registration: string; make: string | null; model: string | null } | null
  customer: { first_name: string; last_name: string } | null
  technician: { id: string } | null
}
interface BoardData { statuses: BoardStatus[]; cards: BoardCard[] }

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Read-only timed schedule of the signed-in technician's jobs for today,
 * ordered by planned start. Reuses the workshop board endpoint (technicians
 * don't plan — planned times are set by advisors on the web board).
 */
export function MyDay() {
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const token = session?.access_token

  const fetchBoard = useCallback(async () => {
    if (!token) return
    try {
      setBoard(await api<BoardData>('/api/v1/workshop-board', { token }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    fetchBoard()
    const interval = setInterval(fetchBoard, 30000)
    return () => clearInterval(interval)
  }, [fetchBoard])

  const statusById = new Map((board?.statuses || []).map(s => [s.id, s]))
  const myCards = (board?.cards || [])
    .filter(c => c.healthCheckId && c.technician?.id === user?.id && c.position !== 'work_complete')
    .sort((a, b) => (a.plannedStartAt || '~').localeCompare(b.plannedStartAt || '~'))
  const totalHours = myCards.reduce((s, c) => s + (c.estimatedHours ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">My Day</h1>
          <p className="text-xs text-gray-500">{myCards.length} job{myCards.length === 1 ? '' : 's'} · {Math.round(totalHours * 10) / 10}h</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/board')} className="text-sm text-primary font-medium">Board</button>
          <button onClick={() => navigate('/')} className="text-sm text-gray-500 font-medium">Jobs</button>
        </div>
      </div>

      <div className="p-4 space-y-2">
        {loading ? (
          <p className="text-center text-gray-400 py-8 text-sm">Loading…</p>
        ) : myCards.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">Nothing scheduled for you today.</p>
        ) : (
          myCards.map(c => {
            const ws = c.workshopStatusId ? statusById.get(c.workshopStatusId) : null
            const booked = (c.bookedRepairs || []).map(r => r.description || r.code).filter(Boolean).join(', ')
            const time = c.plannedStartAt ? fmtTime(c.plannedStartAt) : null
            return (
              <Card key={c.healthCheckId} padding="sm" onClick={() => navigate(`/job/${c.healthCheckId}/summary`)} className="cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="w-14 flex-shrink-0 text-center">
                    <div className="text-sm font-bold text-gray-900">{time || '—'}</div>
                    {c.estimatedHours != null && <div className="text-[11px] text-gray-400">{c.estimatedHours}h</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-900">{c.vehicle?.registration || 'No reg'}</span>
                      {c.customerWaiting && <span className="text-[10px] font-bold text-white bg-red-500 rounded px-1">WAITING</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {[c.vehicle?.make, c.vehicle?.model].filter(Boolean).join(' ')}
                      {c.customer ? ` · ${c.customer.first_name} ${c.customer.last_name}` : ''}
                    </div>
                    {booked && <div className="text-xs text-gray-600 truncate mt-0.5">{booked}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      {ws && <span className="text-[10px] font-medium text-white rounded-full px-1.5 py-px" style={{ backgroundColor: ws.colour }}>{ws.name}</span>}
                      {c.keyLocation && <span className="text-[10px] text-gray-500">🔑 {c.keyLocation}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
