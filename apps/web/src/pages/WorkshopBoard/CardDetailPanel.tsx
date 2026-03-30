import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import CardBadges from './CardBadges'
import type { BoardCard, BoardStatus } from './hooks/useBoardData'

interface Note {
  id: string
  content: string
  createdAt: string
  user: { id: string; firstName: string; lastName: string } | null
}

interface CardDetailPanelProps {
  card: BoardCard
  statuses: BoardStatus[]
  date: string
  onClose: () => void
  onUpdate: () => void
}

export default function CardDetailPanel({ card, statuses, date, onClose, onUpdate }: CardDetailPanelProps) {
  const { session } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [notesLoading, setNotesLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchNotes = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ notes: Note[] }>(`/api/v1/tcard/notes/${card.healthCheckId}`, {
        token: session.accessToken,
      })
      setNotes(data.notes || [])
    } catch {
      // Silently fail
    } finally {
      setNotesLoading(false)
    }
  }, [card.healthCheckId, session?.accessToken])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const handleAddNote = async () => {
    if (!newNote.trim() || !session?.accessToken) return
    try {
      await api('/api/v1/tcard/notes', {
        method: 'POST',
        token: session.accessToken,
        body: { healthCheckId: card.healthCheckId, content: newNote.trim() },
      })
      setNewNote('')
      fetchNotes()
    } catch {
      toast.error('Failed to add note')
    }
  }

  const handleSetStatus = async (statusId: string | null) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/tcard/cards/${card.healthCheckId}/status`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { statusId, boardDate: date },
      })
      onUpdate()
    } catch {
      toast.error('Failed to update status')
    }
  }

  const handleSetPriority = async (priority: string) => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/tcard/cards/${card.healthCheckId}/priority`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { priority, boardDate: date },
      })
      onUpdate()
    } catch {
      toast.error('Failed to update priority')
    }
  }

  const handleMoveToColumn = async (columnType: string) => {
    if (!session?.accessToken) return
    setSaving(true)
    try {
      await api('/api/v1/tcard/cards/move', {
        method: 'POST',
        token: session.accessToken,
        body: { healthCheckId: card.healthCheckId, columnType, boardDate: date },
      })
      onUpdate()
    } catch {
      toast.error('Failed to move card')
    } finally {
      setSaving(false)
    }
  }

  const daysOnSite = card.arrivedAt
    ? Math.floor((Date.now() - new Date(card.arrivedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0
  const isOverdue = card.promiseTime && new Date(card.promiseTime) < new Date()

  const labourHours = calculateLabourHours(card)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-xl overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {card.vehicle?.registration || 'No Reg'}
              </h2>
              <p className="text-sm text-gray-600">
                {card.customer ? `${card.customer.firstName} ${card.customer.lastName}` : 'No customer'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Quick Info */}
          <div className="grid grid-cols-2 gap-3">
            <InfoItem
              label="Make / Model"
              value={[card.vehicle?.make, card.vehicle?.model, card.vehicle?.year].filter(Boolean).join(' ') || '—'}
            />
            <InfoItem
              label="Promise Time"
              value={card.promiseTime ? formatDateTime(card.promiseTime) : '—'}
              highlight={!!isOverdue}
            />
            <InfoItem label="Labour Hours" value={labourHours > 0 ? `${labourHours} hrs` : '—'} />
            <InfoItem label="Days on Site" value={daysOnSite > 0 ? `Day ${daysOnSite + 1}` : 'Today'} />
            {card.jobsheetNumber && <InfoItem label="Jobsheet" value={card.jobsheetNumber} />}
            {card.advisor && <InfoItem label="Service Advisor" value={`${card.advisor.firstName} ${card.advisor.lastName}`} />}
          </div>

          {/* Badges */}
          <CardBadges card={card} />

          {/* Status Selector */}
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Job Status</label>
            <select
              value={card.tcardStatusId || ''}
              onChange={(e) => handleSetStatus(e.target.value || null)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">No status</option>
              {statuses.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Priority</label>
            <div className="flex gap-2">
              {(['normal', 'high', 'urgent'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => handleSetPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    card.priority === p
                      ? p === 'urgent' ? 'bg-red-500 text-white' : p === 'high' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Pre-booked Work */}
          {card.bookedRepairs && Array.isArray(card.bookedRepairs) && card.bookedRepairs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Pre-Booked Work</label>
              <div className="space-y-1">
                {card.bookedRepairs.map((r: any, i: number) => (
                  <div key={i} className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    {r.description || r.name || `Item ${i + 1}`}
                    {(r.labourHours || r.hours) && (
                      <span className="text-gray-400 ml-1">({r.labourHours || r.hours} hrs)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Notes</label>
            <div className="space-y-2 mb-2 max-h-48 overflow-y-auto">
              {notesLoading ? (
                <p className="text-xs text-gray-400">Loading notes...</p>
              ) : notes.length === 0 ? (
                <p className="text-xs text-gray-400">No notes yet</p>
              ) : (
                notes.map(n => (
                  <div key={n.id} className="bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-700">{n.content}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {n.user ? `${n.user.firstName} ${n.user.lastName}` : 'System'} — {formatDateTime(n.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                placeholder="Add a note..."
                maxLength={500}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={handleAddNote}
                disabled={!newNote.trim()}
                className="px-3 py-2 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2 border-t border-gray-200 pt-4">
            <button
              onClick={() => navigate(`/health-checks/${card.healthCheckId}`)}
              className="w-full px-4 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary/5 transition-colors"
            >
              Open Health Check
            </button>
            {card.columnType !== 'completed' && (
              <button
                onClick={() => handleMoveToColumn('completed')}
                disabled={saving}
                className="w-full px-4 py-2 text-sm font-medium text-green-700 border border-green-300 rounded-lg hover:bg-green-50 transition-colors disabled:opacity-50"
              >
                Mark Complete
              </button>
            )}
            {card.columnType !== 'due_in' && (
              <button
                onClick={() => handleMoveToColumn('due_in')}
                disabled={saving}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Return to Due In
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function formatDateTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function calculateLabourHours(card: BoardCard): number {
  if (!card.bookedRepairs || !Array.isArray(card.bookedRepairs)) return 0
  let total = 0
  for (const repair of card.bookedRepairs) {
    if (repair && typeof repair === 'object') {
      total += Number((repair as any).labourHours || (repair as any).hours || 0)
    }
  }
  return Math.round(total * 10) / 10
}
