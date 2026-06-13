import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, type TimelineEvent } from '../../lib/api'
import type { BoardCard, BoardColumnDef, BoardStatus, CardPriority } from './types'
import { pipelineStage, renderSmsTemplate, actualWorkedMinutes } from './types'
import SmsConfirmModal from './SmsConfirmModal'
import WorkshopNotesPanel from '../../components/WorkshopNotesPanel'

interface JobDetailModalProps {
  card: BoardCard
  statuses: BoardStatus[]
  columns: BoardColumnDef[]
  boardDate: string
  onClose: () => void
  onChanged: () => void
}

const STAGE_TONE_CLASSES: Record<string, string> = {
  grey: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  indigo: 'bg-indigo-100 text-indigo-700'
}

// Compact category colours for the activity feed
function activityDotColor(eventType: string): string {
  if (eventType === 'status_change') return 'bg-blue-400'
  if (eventType.startsWith('labour_')) return 'bg-indigo-400'
  if (eventType.startsWith('parts_')) return 'bg-purple-400'
  if (eventType === 'outcome_authorised') return 'bg-rag-green'
  if (eventType === 'outcome_declined') return 'bg-rag-red'
  if (eventType.startsWith('outcome_')) return 'bg-rag-amber'
  return 'bg-gray-400'
}

export default function JobDetailModal({ card, statuses, columns, boardDate, onClose, onChanged }: JobDetailModalProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken

  const [tab, setTab] = useState<'notes' | 'activity'>('notes')
  const [notesCount, setNotesCount] = useState(card.notesCount)
  const [activity, setActivity] = useState<TimelineEvent[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [hoursDraft, setHoursDraft] = useState(card.estimatedHours?.toString() ?? '')
  const [smsPrompt, setSmsPrompt] = useState<{ message: string; statusName: string | null } | null>(null)

  const stage = pipelineStage(card.status)
  const activeStatuses = statuses.filter(s => s.isActive)
  const currentStatus = card.workshopStatusId ? statuses.find(s => s.id === card.workshopStatusId) : null
  const isTechnician = (user?.role || 'technician') === 'technician'

  const techColumns = columns.filter(c => c.columnType === 'technician')
  const queueColumns = columns.filter(c => c.columnType === 'queue')
  const currentTechColumn = card.technician ? techColumns.find(c => c.technicianId === card.technician!.id) : null
  const inQueueColumn = card.position === 'column' && card.columnId && queueColumns.some(c => c.id === card.columnId)
  const placementValue = inQueueColumn ? card.columnId! : 'auto'
  const canUnassign = ['created', 'assigned', 'awaiting_checkin'].includes(card.status)

  const workedMinutes = Math.round(actualWorkedMinutes(card, new Date()))

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lazy-load the activity feed the first time the tab is opened
  useEffect(() => {
    if (tab !== 'activity' || activity !== null || !token) return
    setActivityLoading(true)
    api<{ timeline: TimelineEvent[] }>(`/api/v1/health-checks/${card.healthCheckId}/timeline`, { token })
      .then(data => setActivity(data.timeline))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false))
  }, [tab, activity, token, card.healthCheckId])

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

  const moveCard = async (body: Record<string, unknown>) => {
    if (!token) return false
    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}/move`, {
        method: 'POST',
        token,
        body
      })
      onChanged()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move card')
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

  const handleTechnicianChange = (value: string) => {
    if (value === 'unassign') {
      moveCard({ target: 'checked_in' })
    } else if (value) {
      moveCard({ target: 'technician', columnId: value })
    }
  }

  const handlePlacementChange = (value: string) => {
    if (value === 'auto') {
      moveCard({ target: 'workshop' })
    } else {
      moveCard({ target: 'queue', columnId: value })
    }
  }

  const handleJobStateChange = (value: string) => {
    updateCard({ jobState: value })
  }

  const plannedTimeValue = card.plannedStartAt
    ? new Date(card.plannedStartAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : ''

  const handlePlannedTimeChange = (value: string) => {
    if (!value) {
      updateCard({ plannedStartAt: null })
      return
    }
    const planned = new Date(`${boardDate}T${value}:00`)
    if (!Number.isNaN(planned.getTime())) {
      updateCard({ plannedStartAt: planned.toISOString() })
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

  const handleComposeSms = () => {
    const firstName = card.customer?.first_name?.trim()
    setSmsPrompt({ message: firstName ? `Hi ${firstName}, ` : '', statusName: null })
  }

  const formatDateTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—'

  const formatWorked = (mins: number) => {
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">{card.vehicle?.registration || 'No reg'}</h2>
                {card.customerWaiting && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rag-red text-white">WAITING</span>
                )}
                {card.loanCarRequired && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500 text-white">LOAN</span>
                )}
                {card.isInternal && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500 text-white">INTERNAL</span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_TONE_CLASSES[stage.tone]}`}>
                  {stage.label}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-0.5 truncate">
                {[card.vehicle?.make, card.vehicle?.model].filter(Boolean).join(' ')}
                {card.vehicle?.year ? ` (${card.vehicle.year})` : ''}
                {card.vehicle?.color ? ` · ${card.vehicle.color}` : ''}
              </p>
              {card.customer && (
                <p className="text-sm text-gray-500 truncate">
                  {card.customer.first_name} {card.customer.last_name}
                  {card.customer.mobile ? ` · ${card.customer.mobile}` : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to={`/health-checks/${card.healthCheckId}`}
                className="px-3.5 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90"
              >
                Open health check
              </Link>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Close">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
              {/* Left: job details */}
              <div className="space-y-5">
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
                      {!card.isClockedOn && workedMinutes > 0 && (
                        <span className="ml-1.5 text-gray-400 text-xs">{formatWorked(workedMinutes)} worked</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-400 mb-0.5">Key location</div>
                    <div className="font-medium text-gray-800">
                      {card.keyLocation || '—'}
                      {card.mileageIn != null && (
                        <span className="ml-1.5 text-gray-400 text-xs">{card.mileageIn.toLocaleString()} mi in</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Two axes: the job's workshop lifecycle (editable - drives the
                    board column) and the read-only VHC pipeline stage. */}
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Job state</label>
                    <select
                      value={card.jobState}
                      onChange={e => handleJobStateChange(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="due_in">Due in</option>
                      <option value="arrived">Arrived (on site)</option>
                      <option value="in_workshop">In workshop</option>
                      <option value="work_complete">Work complete</option>
                      <option value="collected">Collected / closed</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      Where the vehicle sits in the workshop — sets the board column, independent of the VHC stage.
                    </p>
                  </div>
                  <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2.5">
                    <div>
                      <div className="text-xs text-indigo-400 font-medium">VHC PIPELINE</div>
                      <div className="text-sm font-semibold text-indigo-800">{stage.label}</div>
                    </div>
                    <div className="flex items-center gap-2.5 text-xs font-medium text-gray-600">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rag-red inline-block" />{card.ragCounts.red}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rag-amber inline-block" />{card.ragCounts.amber}</span>
                    </div>
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

                {/* Assignment & planning (controllers only) */}
                {!isTechnician && (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                    <h4 className="text-xs font-medium text-gray-500">ASSIGNMENT &amp; PLANNING</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Technician</label>
                        <select
                          value={currentTechColumn?.id || ''}
                          onChange={e => handleTechnicianChange(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          {!currentTechColumn && (
                            <option value="" disabled>
                              {card.technician
                                ? `${card.technician.first_name} ${card.technician.last_name} (no column)`
                                : 'Unassigned'}
                            </option>
                          )}
                          {currentTechColumn && canUnassign && <option value="unassign">Unassign</option>}
                          {techColumns.map(col => (
                            <option key={col.id} value={col.id}>{col.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Park in queue</label>
                        <select
                          value={placementValue}
                          onChange={e => handlePlacementChange(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="auto">On workshop flow</option>
                          {queueColumns.map(col => (
                            <option key={col.id} value={col.id}>{col.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Planned start ({boardDate})</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={plannedTimeValue}
                          onChange={e => handlePlannedTimeChange(e.target.value)}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        {card.plannedStartAt && (
                          <button
                            onClick={() => updateCard({ plannedStartAt: null })}
                            className="text-xs text-gray-400 hover:text-gray-600 underline"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

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
              </div>

              {/* Right: notes & activity */}
              <div>
                <div className="flex items-center gap-1 border-b border-gray-200 mb-3">
                  <button
                    onClick={() => setTab('notes')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                      tab === 'notes'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Notes
                    {notesCount > 0 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">{notesCount}</span>
                    )}
                  </button>
                  <button
                    onClick={() => setTab('activity')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                      tab === 'activity'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Activity
                  </button>
                </div>

                {tab === 'notes' ? (
                  <WorkshopNotesPanel
                    healthCheckId={card.healthCheckId}
                    onChanged={onChanged}
                    onCountChange={setNotesCount}
                  />
                ) : activityLoading ? (
                  <div className="text-sm text-gray-400">Loading activity…</div>
                ) : !activity || activity.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
                    No activity recorded yet.
                  </div>
                ) : (
                  <ul className="relative space-y-3">
                    <span className="absolute left-[5px] top-2 bottom-2 w-px bg-gray-200" aria-hidden="true" />
                    {activity.map(event => (
                      <li key={event.id} className="relative pl-5">
                        <span className={`absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2 border-white shadow ${activityDotColor(event.event_type)}`} />
                        <p className="text-sm text-gray-800">{event.description}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {event.user ? `${event.user.first_name} ${event.user.last_name} · ` : ''}
                          {formatDateTime(event.timestamp)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
            <button
              onClick={handleComposeSms}
              disabled={!card.customer?.mobile}
              title={card.customer?.mobile ? undefined : 'No mobile number on file'}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Text customer
            </button>
            <Link
              to={`/health-checks/${card.healthCheckId}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open full health check →
            </Link>
          </div>
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
