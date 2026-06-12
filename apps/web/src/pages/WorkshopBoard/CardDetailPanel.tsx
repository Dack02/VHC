import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import type { BoardCard, BoardStatus, WorkshopNoteEntry, CardPriority } from './types'
import { pipelineStage, renderSmsTemplate } from './types'
import SmsConfirmModal from './SmsConfirmModal'

interface CardDetailPanelProps {
  card: BoardCard
  statuses: BoardStatus[]
  onClose: () => void
  onChanged: () => void
}

export default function CardDetailPanel({ card, statuses, onClose, onChanged }: CardDetailPanelProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const [notes, setNotes] = useState<WorkshopNoteEntry[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [hoursDraft, setHoursDraft] = useState(card.estimatedHours?.toString() ?? '')
  const [smsPrompt, setSmsPrompt] = useState<{ message: string; statusName: string } | null>(null)

  const token = session?.accessToken
  const stage = pipelineStage(card.status)
  const activeStatuses = statuses.filter(s => s.isActive)
  const currentStatus = card.workshopStatusId ? statuses.find(s => s.id === card.workshopStatusId) : null

  const fetchNotes = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ notes: WorkshopNoteEntry[] }>(
        `/api/v1/workshop-board/cards/${card.healthCheckId}/notes`,
        { token }
      )
      setNotes(data.notes)
    } catch {
      // Non-fatal - panel still works without history
    } finally {
      setNotesLoading(false)
    }
  }, [token, card.healthCheckId])

  useEffect(() => {
    setNotesLoading(true)
    fetchNotes()
  }, [fetchNotes])

  const updateCard = async (fields: Record<string, unknown>) => {
    if (!token) return false
    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}`, {
        method: 'PATCH',
        token,
        body: fields
      })
      onChanged()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update card')
      return false
    }
  }

  const handleStatusChange = async (statusId: string) => {
    const newStatusId = statusId || null
    const ok = await updateCard({ workshopStatusId: newStatusId })
    if (!ok || !newStatusId) return

    // Status with an SMS template? Always confirm with a popup before sending.
    const status = statuses.find(s => s.id === newStatusId)
    if (status?.smsMessage) {
      const rendered = renderSmsTemplate(
        status.smsMessage,
        card,
        user?.site?.name || '',
        user?.organization?.name || ''
      )
      setSmsPrompt({ message: rendered, statusName: status.name })
    }
  }

  const handleAddNote = async () => {
    if (!token || !newNote.trim()) return
    setSavingNote(true)
    try {
      const data = await api<{ note: WorkshopNoteEntry }>(
        `/api/v1/workshop-board/cards/${card.healthCheckId}/notes`,
        { method: 'POST', token, body: { content: newNote.trim() } }
      )
      setNotes(prev => [data.note, ...prev])
      setNewNote('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setSavingNote(false)
    }
  }

  const handleHoursBlur = async () => {
    const value = hoursDraft.trim() === '' ? null : Number(hoursDraft)
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setHoursDraft(card.estimatedHours?.toString() ?? '')
      return
    }
    if (value !== card.estimatedHours) {
      await updateCard({ estimatedHours: value })
    }
  }

  const formatDateTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—'

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-xl z-[60] flex flex-col animate-[slideIn_0.2s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">{card.vehicle?.registration || 'No reg'}</h2>
              {card.customerWaiting && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rag-red text-white">WAITING</span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-0.5">
              {[card.vehicle?.make, card.vehicle?.model].filter(Boolean).join(' ')}
              {card.vehicle?.year ? ` (${card.vehicle.year})` : ''}
              {card.vehicle?.color ? ` · ${card.vehicle.color}` : ''}
            </p>
            {card.customer && (
              <p className="text-sm text-gray-500">
                {card.customer.first_name} {card.customer.last_name}
                {card.customer.mobile ? ` · ${card.customer.mobile}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label="Close">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Quick facts */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Promised</div>
              <div className="font-medium text-gray-800">{formatDateTime(card.promiseTime || card.dueDate)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Arrived</div>
              <div className="font-medium text-gray-800">{formatDateTime(card.arrivedAt)}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Jobsheet</div>
              <div className="font-medium text-gray-800">{card.jobsheetNumber || card.jobNumber || '—'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Service advisor</div>
              <div className="font-medium text-gray-800">
                {card.advisor ? `${card.advisor.first_name} ${card.advisor.last_name}` : '—'}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Technician</div>
              <div className="font-medium text-gray-800">
                {card.technician ? `${card.technician.first_name} ${card.technician.last_name}` : 'Unassigned'}
                {card.isClockedOn && <span className="ml-1.5 text-green-600 text-xs">● clocked on</span>}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-0.5">Key location</div>
              <div className="font-medium text-gray-800">{card.keyLocation || '—'}</div>
            </div>
          </div>

          {/* VHC pipeline stage */}
          <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
            <div>
              <div className="text-xs text-indigo-400 font-medium">VHC PIPELINE</div>
              <div className="text-sm font-semibold text-indigo-800">{stage.label}</div>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rag-red inline-block" />{card.ragCounts.red}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rag-amber inline-block" />{card.ragCounts.amber}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rag-green inline-block" />{card.ragCounts.green}</span>
            </div>
          </div>

          {/* Workshop status + priority + hours */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Workshop status</label>
              <div className="flex items-center gap-2">
                {currentStatus && (
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: currentStatus.colour }} />
                )}
                <select
                  value={card.workshopStatusId || ''}
                  onChange={e => handleStatusChange(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">No status</option>
                  {activeStatuses.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.smsMessage ? ' ✉' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">Statuses marked ✉ offer to text the customer (you confirm first).</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                <select
                  value={card.priority}
                  onChange={e => updateCard({ priority: e.target.value as CardPriority })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Estimated hours</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={hoursDraft}
                  onChange={e => setHoursDraft(e.target.value)}
                  onBlur={handleHoursBlur}
                  placeholder="e.g. 2.5"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Booked work from DMS */}
          {card.bookedRepairs.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">BOOKED WORK</h4>
              <ul className="space-y-1.5">
                {card.bookedRepairs.map((repair, i) => (
                  <li key={i} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-gray-800">
                      {repair.description || repair.code || 'Booked item'}
                    </span>
                    {repair.notes && <p className="text-xs text-gray-500 mt-0.5">{repair.notes}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Booking notes from DMS / check-in */}
          {(card.advisorNotes || card.checkinNotes) && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">BOOKING NOTES</h4>
              {card.advisorNotes && (
                <p className="text-sm text-gray-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 whitespace-pre-wrap">
                  {card.advisorNotes}
                </p>
              )}
              {card.checkinNotes && (
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 whitespace-pre-wrap mt-1.5">
                  {card.checkinNotes}
                </p>
              )}
            </div>
          )}

          {/* Workshop notes */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-2">WORKSHOP NOTES</h4>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                maxLength={500}
                placeholder="Add a note…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleAddNote}
                disabled={savingNote || !newNote.trim()}
                className="px-3 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {notesLoading ? (
              <div className="text-sm text-gray-400">Loading notes…</div>
            ) : notes.length === 0 ? (
              <div className="text-sm text-gray-400">No notes yet.</div>
            ) : (
              <ul className="space-y-2">
                {notes.map(note => (
                  <li key={note.id} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <p className="text-gray-800 whitespace-pre-wrap">{note.content}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {note.user ? `${note.user.first_name} ${note.user.last_name}` : 'Unknown'} ·{' '}
                      {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
          <Link
            to={`/health-checks/${card.healthCheckId}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Open full health check →
          </Link>
        </div>
      </div>

      {smsPrompt && (
        <SmsConfirmModal
          healthCheckId={card.healthCheckId}
          customerName={card.customer ? `${card.customer.first_name} ${card.customer.last_name}` : 'the customer'}
          customerMobile={card.customer?.mobile || null}
          initialMessage={smsPrompt.message}
          statusName={smsPrompt.statusName}
          onClose={() => setSmsPrompt(null)}
          onSent={() => setSmsPrompt(null)}
        />
      )}
    </>
  )
}
