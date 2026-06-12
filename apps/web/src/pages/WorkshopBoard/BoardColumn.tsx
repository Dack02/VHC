import { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { BoardCard } from './types'

interface BoardColumnProps {
  id: string
  title: string
  subtitle?: string
  accentColour?: string | null
  capacity?: { allocated: number; available: number } | null
  count: number
  isClockedOn?: boolean
  tvMode?: boolean
  droppable: boolean
  children: ReactNode
}

export default function BoardColumn({
  id,
  title,
  subtitle,
  accentColour,
  capacity,
  count,
  isClockedOn,
  tvMode,
  droppable,
  children
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable })

  const loadPercent = capacity && capacity.available > 0
    ? Math.round((capacity.allocated / capacity.available) * 100)
    : null

  const barColour =
    loadPercent == null ? '' : loadPercent > 100 ? 'bg-rag-red' : loadPercent >= 80 ? 'bg-rag-amber' : 'bg-rag-green'

  return (
    <div
      className={`flex flex-col flex-shrink-0 ${tvMode ? 'w-80' : 'w-72'} max-h-full rounded-xl border ${
        isOver ? 'border-primary bg-indigo-50/60' : 'border-gray-200 bg-gray-50'
      } transition-colors`}
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 border-b border-gray-200 rounded-t-xl bg-white"
        style={accentColour ? { borderTopColor: accentColour, borderTopWidth: 3 } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isClockedOn !== undefined && (
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isClockedOn ? 'bg-green-500' : 'bg-gray-300'}`}
                title={isClockedOn ? 'Clocked on to a job' : 'Not clocked on'}
              />
            )}
            <h3 className={`font-semibold text-gray-900 truncate ${tvMode ? 'text-base' : 'text-sm'}`}>
              {title}
            </h3>
          </div>
          <span className={`${tvMode ? 'text-sm' : 'text-xs'} font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0`}>
            {count}
          </span>
        </div>

        {subtitle && (
          <div className={`${tvMode ? 'text-sm' : 'text-xs'} text-gray-400 mt-0.5 truncate`}>{subtitle}</div>
        )}

        {capacity && (
          <div className="mt-1.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className={`${tvMode ? 'text-sm' : 'text-xs'} text-gray-500`}>
                {capacity.allocated.toFixed(1)} / {capacity.available.toFixed(1)} hrs
              </span>
              {loadPercent != null && (
                <span className={`${tvMode ? 'text-sm' : 'text-xs'} font-medium ${
                  loadPercent > 100 ? 'text-red-600' : loadPercent >= 80 ? 'text-amber-600' : 'text-gray-500'
                }`}>
                  {loadPercent}%
                </span>
              )}
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${barColour}`}
                style={{ width: `${Math.min(loadPercent ?? 0, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Cards */}
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]">
        {children}
        {count === 0 && (
          <div className={`text-center text-gray-300 py-6 ${tvMode ? 'text-sm' : 'text-xs'}`}>
            {droppable ? 'Drop a job here' : 'No jobs'}
          </div>
        )}
      </div>
    </div>
  )
}

export function cardsAllocatedHours(cards: BoardCard[]): number {
  return cards.reduce((sum, card) => sum + (card.estimatedHours ?? 0), 0)
}
