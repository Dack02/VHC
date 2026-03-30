import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import JobCard from './JobCard'
import BoardColumnHeader from './BoardColumnHeader'
import type { BoardCard } from './hooks/useBoardData'

interface BoardColumnProps {
  id: string
  title: string
  subtitle?: string
  cards: BoardCard[]
  allocatedHours?: number
  availableHours?: number
  onCardClick: (card: BoardCard) => void
  onRemove?: () => void
}

export default function BoardColumn({
  id,
  title,
  subtitle,
  cards,
  allocatedHours,
  availableHours,
  onCardClick,
  onRemove,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const cardIds = cards.map(c => c.healthCheckId)

  return (
    <div className={`flex flex-col bg-white border border-gray-200 rounded-xl min-w-[260px] w-[280px] flex-shrink-0 transition-colors ${isOver ? 'border-primary bg-primary/5' : ''}`}>
      <BoardColumnHeader
        title={title}
        subtitle={subtitle}
        jobCount={cards.length}
        allocatedHours={allocatedHours}
        availableHours={availableHours}
        onRemove={onRemove}
      />

      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px] max-h-[calc(100vh-220px)]"
      >
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <JobCard key={card.healthCheckId} card={card} onClick={onCardClick} />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-400">
            No jobs
          </div>
        )}
      </div>
    </div>
  )
}
