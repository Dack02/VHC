import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BoardCard, BoardStatus } from './types'
import { pipelineStage, cardKey } from './types'

interface JobCardProps {
  card: BoardCard
  statuses: BoardStatus[]
  now: Date
  draggable: boolean
  tvMode?: boolean
  /** Show the assigned technician as a chip (Job Status view) */
  showTechChip?: boolean
  /** Name of the queue the card is parked in (Technician view) */
  queueChipName?: string | null
  onClick: () => void
}

const STAGE_TONE_CLASSES: Record<string, string> = {
  grey: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  indigo: 'bg-indigo-100 text-indigo-700'
}

export function promiseCountdown(card: BoardCard, now: Date): {
  label: string
  tone: 'ok' | 'warning' | 'overdue'
} | null {
  const promise = card.promiseTime || (card.position === 'due_in' ? card.dueDate : null)
  if (!promise) return null

  const target = new Date(promise)
  const diffMins = Math.round((target.getTime() - now.getTime()) / 60000)
  const timeStr = target.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const dateStr = target.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const isToday = target.toDateString() === now.toDateString()

  // Midnight promise times from the DMS mean "this date", not a real deadline
  const isDateOnly = target.getHours() === 0 && target.getMinutes() === 0
  if (isDateOnly) {
    if (isToday) return { label: 'Due today', tone: 'warning' }
    if (target.getTime() < now.getTime()) return { label: `Due ${dateStr}`, tone: 'overdue' }
    return { label: `Due ${dateStr}`, tone: 'ok' }
  }

  if (diffMins < 0) {
    // Beyond a day late, an elapsed counter is just noise - show the date
    if (diffMins < -1440) return { label: `Due ${dateStr}`, tone: 'overdue' }
    const overdue = Math.abs(diffMins)
    const overdueStr = overdue >= 60 ? `${Math.floor(overdue / 60)}h ${overdue % 60}m` : `${overdue}m`
    return { label: `${timeStr} · ${overdueStr} late`, tone: 'overdue' }
  }
  if (!isToday) return { label: `${dateStr} ${timeStr}`, tone: 'ok' }
  if (diffMins <= 60) {
    return { label: `${timeStr} · ${diffMins}m left`, tone: 'warning' }
  }
  return { label: timeStr, tone: 'ok' }
}

export default function JobCard({ card, statuses, now, draggable, tvMode, showTechChip, queueChipName, onClick }: JobCardProps) {
  // Sortable rather than plain draggable: cards can be dropped onto each
  // other to set the tech's top-to-bottom work order, not just onto columns
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardKey(card),
    disabled: !draggable
  })

  const workshopStatus = card.workshopStatusId
    ? statuses.find(s => s.id === card.workshopStatusId)
    : null
  const stage = pipelineStage(card.status)
  const countdown = promiseCountdown(card, now)

  const daysOnSite = card.arrivedAt
    ? Math.floor((now.getTime() - new Date(card.arrivedAt).getTime()) / 86400000)
    : null

  const borderColour = workshopStatus?.colour
    || (countdown?.tone === 'overdue' ? '#EF4444' : undefined)

  const smallScale = tvMode ? 'text-sm' : 'text-xs'

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        borderLeftColor: borderColour,
        borderLeftWidth: borderColour ? 4 : undefined,
        opacity: isDragging ? 0.4 : 1
      }}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-xl shadow-sm p-3 select-none transition-shadow hover:shadow-md ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${card.priority === 'urgent' ? 'ring-2 ring-red-400' : card.priority === 'high' ? 'ring-1 ring-amber-400' : ''}`}
    >
      {/* Reg + countdown */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {card.isClockedOn && (
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0" title="Technician clocked on">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
          )}
          <span className={`font-bold text-gray-900 truncate ${tvMode ? 'text-lg' : 'text-base'}`}>
            {card.vehicle?.registration || 'No reg'}
          </span>
        </div>
        {countdown && (
          <span
            className={`${smallScale} font-semibold whitespace-nowrap ${
              countdown.tone === 'overdue'
                ? 'text-red-600'
                : countdown.tone === 'warning'
                ? 'text-amber-600'
                : 'text-gray-500'
            }`}
          >
            {countdown.tone === 'overdue' && '⚠ '}
            {countdown.label}
          </span>
        )}
      </div>

      {/* Vehicle + customer */}
      <div className={`${smallScale} text-gray-600 truncate`}>
        {[card.vehicle?.make, card.vehicle?.model].filter(Boolean).join(' ')}
        {card.vehicle?.year ? ` (${card.vehicle.year})` : ''}
      </div>
      {card.customer && (
        <div className={`${smallScale} text-gray-500 truncate`}>
          {card.customer.first_name} {card.customer.last_name}
        </div>
      )}

      {/* Advisor + hours */}
      <div className={`flex items-center justify-between mt-1.5 ${smallScale}`}>
        <span className="text-gray-500 truncate">
          {card.advisor ? (
            <>
              <span className="text-gray-400">SA:</span>{' '}
              <span className="font-medium text-gray-600">
                {card.advisor.first_name} {card.advisor.last_name.charAt(0)}
              </span>
            </>
          ) : (
            <span className="text-gray-300">No advisor</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-gray-500 flex-shrink-0">
          {card.estimatedHours != null && <span>⏱ {card.estimatedHours}h</span>}
          {daysOnSite != null && daysOnSite >= 1 && (
            <span
              className={`px-1.5 py-0.5 rounded-full font-medium ${
                daysOnSite >= 3
                  ? 'bg-red-100 text-red-700'
                  : daysOnSite >= 2
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              Day {daysOnSite + 1}
            </span>
          )}
        </span>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        {card.customerWaiting && (
          <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-bold bg-rag-red text-white`}>
            WAITING
          </span>
        )}
        {card.loanCarRequired && (
          <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium bg-blue-500 text-white`}>
            LOAN
          </span>
        )}
        {card.isInternal && (
          <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium bg-purple-500 text-white`}>
            INT
          </span>
        )}
        <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium ${STAGE_TONE_CLASSES[stage.tone]}`}>
          {stage.label}
        </span>
        {showTechChip && card.technician && (
          <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium bg-gray-700 text-white`}>
            🔧 {card.technician.first_name} {card.technician.last_name.charAt(0)}
          </span>
        )}
        {queueChipName && (
          <span className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium bg-gray-200 text-gray-700`}>
            In: {queueChipName}
          </span>
        )}
        {workshopStatus && (
          <span
            className={`px-1.5 py-0.5 rounded-full ${smallScale} font-medium text-white`}
            style={{ backgroundColor: workshopStatus.colour }}
          >
            {workshopStatus.name}
          </span>
        )}
      </div>

      {/* Red/amber findings once inspection has produced results */}
      {(card.ragCounts.red > 0 || card.ragCounts.amber > 0) && (
        <div className={`flex items-center gap-2.5 mt-1.5 ${smallScale}`}>
          <span className="flex items-center gap-1 text-gray-600">
            <span className="w-2 h-2 rounded-full bg-rag-red inline-block" />
            {card.ragCounts.red}
          </span>
          <span className="flex items-center gap-1 text-gray-600">
            <span className="w-2 h-2 rounded-full bg-rag-amber inline-block" />
            {card.ragCounts.amber}
          </span>
        </div>
      )}

      {/* Latest note - red while it needs advisor attention */}
      {card.latestNote && (
        <div
          className={`mt-1.5 ${smallScale} truncate flex items-center gap-1 ${
            card.latestNote.advisorAttention ? 'text-red-600 font-medium' : 'text-gray-500'
          }`}
        >
          {card.latestNote.advisorAttention ? (
            <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 11.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
            </svg>
          ) : (
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          )}
          <span className="truncate">{card.latestNote.content}</span>
          {card.notesCount > 1 && <span className="text-gray-400 flex-shrink-0">+{card.notesCount - 1}</span>}
        </div>
      )}
    </div>
  )
}
