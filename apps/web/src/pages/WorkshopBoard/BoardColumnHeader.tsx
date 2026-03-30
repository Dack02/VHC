interface BoardColumnHeaderProps {
  title: string
  subtitle?: string
  jobCount: number
  allocatedHours?: number
  availableHours?: number
  onRemove?: () => void
}

export default function BoardColumnHeader({
  title,
  subtitle,
  jobCount,
  allocatedHours,
  availableHours,
  onRemove,
}: BoardColumnHeaderProps) {
  const utilization = availableHours && availableHours > 0
    ? (allocatedHours || 0) / availableHours
    : 0
  const barColor = utilization > 1 ? 'bg-red-500' : utilization >= 0.8 ? 'bg-amber-500' : 'bg-green-500'
  const barWidth = Math.min(utilization * 100, 100)

  return (
    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 rounded-t-xl">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-500">{jobCount} job{jobCount !== 1 ? 's' : ''}</span>
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Remove column"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Hours progress bar for technician columns */}
      {availableHours !== undefined && (
        <div className="mt-1.5">
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>{allocatedHours?.toFixed(1) || '0.0'} / {availableHours.toFixed(1)} hrs</span>
          </div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
