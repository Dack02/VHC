import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import CardBadges from './CardBadges'
import type { BoardCard } from './hooks/useBoardData'

interface JobCardProps {
  card: BoardCard
  onClick: (card: BoardCard) => void
  isDragOverlay?: boolean
}

export default function JobCard({ card, onClick, isDragOverlay }: JobCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.healthCheckId,
    data: { card },
    disabled: isDragOverlay,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const daysOnSite = card.arrivedAt
    ? Math.floor((Date.now() - new Date(card.arrivedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const daysColor = daysOnSite >= 3 ? 'text-red-600' : daysOnSite >= 2 ? 'text-amber-600' : 'text-gray-500'

  const isOverdue = card.promiseTime && new Date(card.promiseTime) < new Date()

  const labourHours = calculateLabourHours(card)

  // Left border colour from tcard status
  const borderColor = card.tcardStatus?.colour || (isOverdue ? '#EF4444' : undefined)

  const priorityIcon = card.priority === 'urgent' ? '!!' : card.priority === 'high' ? '!' : null

  return (
    <div
      ref={!isDragOverlay ? setNodeRef : undefined}
      style={style}
      {...(!isDragOverlay ? attributes : {})}
      {...(!isDragOverlay ? listeners : {})}
      onClick={() => onClick(card)}
      className={`bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${isDragOverlay ? 'shadow-xl ring-2 ring-primary/30' : ''}`}
      role="button"
      tabIndex={0}
    >
      {/* Left colour accent */}
      {borderColor && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ backgroundColor: borderColor }}
        />
      )}

      <div className={borderColor ? 'pl-1.5' : ''}>
        {/* Row 1: Reg + promise time */}
        <div className="flex items-center justify-between gap-1">
          <span className="font-bold text-sm text-gray-900 tracking-wide">
            {card.vehicle?.registration || 'No Reg'}
          </span>
          <div className="flex items-center gap-1">
            {priorityIcon && (
              <span className="text-red-500 font-bold text-xs">{priorityIcon}</span>
            )}
            {card.promiseTime && (
              <span className={`text-[11px] ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                Due {formatTime(card.promiseTime)}
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Customer name */}
        {card.customer && (
          <p className="text-xs text-gray-700 truncate mt-0.5">
            {card.customer.firstName} {card.customer.lastName}
          </p>
        )}

        {/* Row 3: Make/model */}
        {card.vehicle && (card.vehicle.make || card.vehicle.model) && (
          <p className="text-[11px] text-gray-500 truncate">
            {[card.vehicle.make, card.vehicle.model, card.vehicle.year].filter(Boolean).join(' ')}
          </p>
        )}

        {/* Row 4: Advisor */}
        {card.advisor && (
          <p className="text-[11px] text-gray-400 truncate">
            SA: {card.advisor.firstName} {card.advisor.lastName}
          </p>
        )}

        {/* Row 5: Hours + days on site */}
        <div className="flex items-center justify-between mt-1">
          {labourHours > 0 && (
            <span className="text-[11px] text-gray-600">
              {labourHours} hrs
            </span>
          )}
          {daysOnSite > 0 && (
            <span className={`text-[11px] font-medium ${daysColor}`}>
              Day {daysOnSite + 1}
            </span>
          )}
        </div>

        {/* Row 6: Badges */}
        <div className="mt-1">
          <CardBadges card={card} />
        </div>

        {/* Row 7: Status */}
        {card.tcardStatus && (
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: card.tcardStatus.colour }}
            />
            <span className="text-[11px] text-gray-600 truncate">{card.tcardStatus.name}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
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
