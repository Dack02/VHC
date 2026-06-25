import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api } from '../lib/api'
import { Card } from '../components/Card'
import { Button } from '../components/Button'

interface BoardStatus {
  id: string
  name: string
  colour: string
  isActive: boolean
}

interface BoardColumnDef {
  id: string
  columnType: 'technician' | 'queue'
  technicianId: string | null
  name: string
  colour: string | null
}

interface BoardCard {
  healthCheckId: string
  position: 'due_in' | 'checked_in' | 'column' | 'work_complete'
  columnId: string | null
  status: string
  workshopStatusId: string | null
  priority: 'normal' | 'high' | 'urgent'
  promiseTime: string | null
  customerWaiting: boolean
  loanCarRequired: boolean
  vehicle: { registration: string; make: string | null; model: string | null } | null
  customer: { first_name: string; last_name: string } | null
  technician: { id: string } | null
  advisor: { first_name: string; last_name: string } | null
  latestNote: { content: string; advisorAttention?: boolean } | null
}

interface BoardData {
  statuses: BoardStatus[]
  columns: BoardColumnDef[]
  cards: BoardCard[]
}

/**
 * Technician view of the workshop board: your own jobs, with the ability to
 * set workshop statuses, move a job into a queue (e.g. Awaiting Parts), mark
 * work complete, and leave notes for the service advisor.
 */
export function MyBoard() {
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteAttention, setNoteAttention] = useState(false)
  const [busy, setBusy] = useState(false)

  const token = session?.access_token

  const fetchBoard = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<BoardData>('/api/v1/workshop-board', { token })
      setBoard(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load board')
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

  const myCards = (board?.cards || []).filter(c => c.technician?.id === user?.id)
  const activeCards = myCards.filter(c => c.position !== 'work_complete')
  const completedCards = myCards.filter(c => c.position === 'work_complete')
  const queueColumns = (board?.columns || []).filter(c => c.columnType === 'queue')
  const activeStatuses = (board?.statuses || []).filter(s => s.isActive)

  const setWorkshopStatus = async (card: BoardCard, statusId: string | null) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ workshopStatusId: statusId })
      })
      toast.success('Status updated')
      fetchBoard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  const moveCard = async (card: BoardCard, target: 'queue' | 'work_complete' | 'technician', columnId?: string) => {
    if (!token || busy) return
    setBusy(true)
    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}/move`, {
        method: 'POST',
        token,
        body: JSON.stringify({ target, columnId })
      })
      toast.success(target === 'work_complete' ? 'Marked work complete' : 'Job moved')
      setExpandedId(null)
      fetchBoard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move job')
    } finally {
      setBusy(false)
    }
  }

  const addNote = async (card: BoardCard) => {
    if (!token || !noteDraft.trim() || busy) return
    setBusy(true)
    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}/notes`, {
        method: 'POST',
        token,
        body: JSON.stringify({ content: noteDraft.trim(), advisorAttention: noteAttention })
      })
      toast.success(noteAttention ? 'Note added - flagged for advisor attention' : 'Note added')
      setNoteDraft('')
      setNoteAttention(false)
      fetchBoard()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setBusy(false)
    }
  }

  const myTechColumn = (board?.columns || []).find(
    c => c.columnType === 'technician' && c.technicianId === user?.id
  )

  const renderCard = (card: BoardCard, completed = false) => {
    const expanded = expandedId === card.healthCheckId
    const workshopStatus = card.workshopStatusId
      ? board?.statuses.find(s => s.id === card.workshopStatusId)
      : null
    const inQueue = card.position === 'column' && card.columnId
      ? queueColumns.find(q => q.id === card.columnId)
      : null

    return (
      <Card key={card.healthCheckId} variant="elevated" padding="md" className={completed ? 'opacity-60' : ''}>
        <div
          className="cursor-pointer"
          onClick={() => setExpandedId(expanded ? null : card.healthCheckId)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900">{card.vehicle?.registration || 'No reg'}</h3>
              <p className="text-sm text-gray-600 truncate">
                {[card.vehicle?.make, card.vehicle?.model].filter(Boolean).join(' ')}
              </p>
              {card.customer && (
                <p className="text-sm text-gray-500">{card.customer.first_name} {card.customer.last_name}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              {card.customerWaiting && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rag-red text-white">WAITING</span>
              )}
              {card.promiseTime && (
                <span className="text-xs text-gray-500">
                  Due {new Date(card.promiseTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-2">
            {workshopStatus && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: workshopStatus.colour }}
              >
                {workshopStatus.name}
              </span>
            )}
            {inQueue && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                In: {inQueue.name}
              </span>
            )}
            {completed && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-rag-green text-white">
                WORK COMPLETE
              </span>
            )}
            {card.advisor && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                SA: {card.advisor.first_name} {card.advisor.last_name.charAt(0)}
              </span>
            )}
          </div>

          {card.latestNote && (
            <p className={`text-xs mt-1.5 truncate ${card.latestNote.advisorAttention ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {card.latestNote.advisorAttention ? '⚠' : '📝'} {card.latestNote.content}
            </p>
          )}
        </div>

        {expanded && !completed && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
            {/* Job status picker */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1.5">Set status</p>
              <div className="flex flex-wrap gap-1.5">
                {activeStatuses.map(s => (
                  <button
                    key={s.id}
                    disabled={busy}
                    onClick={() => setWorkshopStatus(card, card.workshopStatusId === s.id ? null : s.id)}
                    className={`px-2.5 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                      card.workshopStatusId === s.id ? 'text-white' : 'bg-white text-gray-700'
                    }`}
                    style={
                      card.workshopStatusId === s.id
                        ? { backgroundColor: s.colour, borderColor: s.colour }
                        : { borderColor: s.colour }
                    }
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Move to queue */}
            {queueColumns.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Move to</p>
                <div className="flex flex-wrap gap-1.5">
                  {queueColumns.map(q => (
                    <button
                      key={q.id}
                      disabled={busy || card.columnId === q.id}
                      onClick={() => moveCard(card, 'queue', q.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 disabled:opacity-40"
                    >
                      {q.name}
                    </button>
                  ))}
                  {inQueue && myTechColumn && (
                    <button
                      disabled={busy}
                      onClick={() => moveCard(card, 'technician', myTechColumn.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-100 text-indigo-700"
                    >
                      ← Back to my column
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Note */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  maxLength={500}
                  placeholder="Add a note for the advisor…"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <Button size="sm" onClick={() => addNote(card)} disabled={busy || !noteDraft.trim()}>
                  Add
                </Button>
              </div>
              <label
                className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border select-none ${
                  noteAttention
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'border-gray-200 text-gray-500'
                }`}
              >
                <input
                  type="checkbox"
                  checked={noteAttention}
                  onChange={e => setNoteAttention(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                ⚠ Advisor attention — stays red until an advisor confirms
              </label>
            </div>

            {/* Work complete */}
            <Button
              variant="primary"
              fullWidth
              disabled={busy}
              onClick={() => moveCard(card, 'work_complete')}
            >
              ✓ Work Complete
            </Button>
          </div>
        )}
      </Card>
    )
  }

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Workshop Board</h1>
            <p className="text-sm text-blue-200">{user?.firstName} {user?.lastName}</p>
          </div>
          <button onClick={() => navigate('/')} className="text-sm text-blue-200 underline">
            My Jobs
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-3 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {activeCards.length === 0 && completedCards.length === 0 && (
              <Card variant="default" padding="lg" className="text-center">
                <p className="text-gray-600">No jobs on your board</p>
                <p className="text-sm text-gray-500 mt-1">Jobs assigned to you appear here</p>
              </Card>
            )}
            {activeCards.map(card => renderCard(card))}
            {completedCards.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide pt-2">Completed today</p>
                {completedCards.map(card => renderCard(card, true))}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default MyBoard
