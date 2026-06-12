import { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'

// A technician's day: completed work stays booked (finishing a job consumes
// hours, it doesn't free them), and pre-allocated Due In bookings count too.
interface ColumnCapacity {
  done: number
  active: number
  dueIn: number
  available: number
}

interface BoardColumnProps {
  id: string
  title: string
  subtitle?: string
  accentColour?: string | null
  capacity?: ColumnCapacity | null
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

  const booked = capacity ? capacity.done + capacity.active + capacity.dueIn : 0
  const loadPercent = capacity && capacity.available > 0
    ? Math.round((booked / capacity.available) * 100)
    : null

  const barColour =
    loadPercent == null ? '' : loadPercent > 100 ? 'bg-rag-red' : loadPercent >= 80 ? 'bg-rag-amber' : 'bg-rag-green'

  // Bar fills with the day's booked hours: faded = done, solid = still to do
  const barWidth = Math.min(loadPercent ?? 0, 100)
  const doneWidth = booked > 0 && capacity ? (capacity.done / booked) * barWidth : 0

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
          <div
            className="mt-1.5"
            title={`${capacity.done.toFixed(1)}h done · ${capacity.active.toFixed(1)}h to do${
              capacity.dueIn > 0 ? ` · ${capacity.dueIn.toFixed(1)}h due in` : ''
            } · ${capacity.available.toFixed(1)}h day`}
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className={`${tvMode ? 'text-sm' : 'text-xs'} text-gray-500`}>
                {booked.toFixed(1)} / {capacity.available.toFixed(1)} hrs
                {capacity.done > 0 && (
                  <span className="text-gray-400"> · {capacity.done.toFixed(1)} done</span>
                )}
              </span>
              {loadPercent != null && (
                <span className={`${tvMode ? 'text-sm' : 'text-xs'} font-medium ${
                  loadPercent > 100 ? 'text-red-600' : loadPercent >= 80 ? 'text-amber-600' : 'text-gray-500'
                }`}>
                  {loadPercent}%
                </span>
              )}
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
              <div className={`h-full ${barColour} opacity-40`} style={{ width: `${doneWidth}%` }} />
              <div className={`h-full ${barColour}`} style={{ width: `${barWidth - doneWidth}%` }} />
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
