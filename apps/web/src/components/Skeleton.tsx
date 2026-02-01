/**
 * Skeleton Loader Components
 * Display loading placeholders for content
 */

interface SkeletonProps {
  className?: string
}

// Base skeleton element with pulse animation
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 rounded ${className}`}
      role="status"
      aria-label="Loading..."
    />
  )
}

// Text line skeleton
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  )
}

// Avatar skeleton
export function SkeletonAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  }
  return <Skeleton className={`${sizes[size]} rounded-full`} />
}

// Card skeleton
export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <SkeletonAvatar />
        <div className="flex-1">
          <Skeleton className="h-4 w-1/3 mb-2" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

// Table row skeleton
export function SkeletonTableRow({ columns = 4 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  )
}

// Table skeleton
export function SkeletonTable({
  rows = 5,
  columns = 4,
  showHeader = true,
}: {
  rows?: number
  columns?: number
  showHeader?: boolean
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full">
        {showHeader && (
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-3 text-left">
                  <Skeleton className="h-4 w-20" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-gray-100">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// List item skeleton
export function SkeletonListItem({ className = '' }: SkeletonProps) {
  return (
    <div className={`flex items-center gap-3 p-3 ${className}`}>
      <SkeletonAvatar size="sm" />
      <div className="flex-1">
        <Skeleton className="h-4 w-1/3 mb-1" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  )
}

// List skeleton
export function SkeletonList({ items = 5, className = '' }: { items?: number; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 ${className}`}>
      {Array.from({ length: items }).map((_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  )
}

// Dashboard summary card skeleton
export function SkeletonSummaryCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 ${className}`}>
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-4 w-24" />
    </div>
  )
}

// Dashboard summary cards skeleton
export function SkeletonDashboardSummary({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonSummaryCard key={i} />
      ))}
    </div>
  )
}

// Health check card skeleton (for Kanban)
export function SkeletonHealthCheckCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-3 mb-2 ${className}`}>
      <div className="flex justify-between mb-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-4 w-32 mb-2" />
      <Skeleton className="h-3 w-40 mb-2" />
      <div className="flex gap-2 mb-2">
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
        <Skeleton className="h-4 w-8" />
      </div>
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  )
}

// Kanban column skeleton
export function SkeletonKanbanColumn({ cards = 3 }: { cards?: number }) {
  return (
    <div className="bg-gray-50 border border-gray-200">
      <div className="p-3 border-b border-gray-200">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-8" />
        </div>
        <Skeleton className="h-3 w-full mt-1" />
      </div>
      <div className="p-2">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonHealthCheckCard key={i} />
        ))}
      </div>
    </div>
  )
}

// Full Kanban board skeleton
export function SkeletonKanbanBoard({ columns = 5, cardsPerColumn = 3 }: { columns?: number; cardsPerColumn?: number }) {
  return (
    <div className="grid grid-cols-5 gap-4">
      {Array.from({ length: columns }).map((_, i) => (
        <SkeletonKanbanColumn key={i} cards={cardsPerColumn} />
      ))}
    </div>
  )
}

// Form skeleton
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i}>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32 mt-4" />
    </div>
  )
}

export default Skeleton
