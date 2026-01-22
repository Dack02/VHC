/**
 * BulkOutcomeActionBar Component
 * Floating action bar for bulk outcome actions on repair items
 * Shows when items in "ready" state are selected
 */

interface BulkOutcomeActionBarProps {
  selectedCount: number
  onAuthoriseAll: () => void
  onDeferAll: () => void
  onDeclineAll: () => void
  onClearSelection: () => void
  loading?: boolean
}

export function BulkOutcomeActionBar({
  selectedCount,
  onAuthoriseAll,
  onDeferAll,
  onDeclineAll,
  onClearSelection,
  loading = false
}: BulkOutcomeActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
      <div className="bg-purple-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-4">
        {/* Selection count */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-purple-500 rounded-full flex items-center justify-center text-sm font-bold">
            {selectedCount}
          </div>
          <span className="text-sm font-medium">
            ready item{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-purple-700" />

        {/* Bulk Actions */}
        <div className="flex items-center gap-2">
          {/* Authorise All */}
          <button
            onClick={onAuthoriseAll}
            disabled={loading}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="hidden sm:inline">Authorise All</span>
            <span className="sm:hidden">Auth</span>
          </button>

          {/* Defer All */}
          <button
            onClick={onDeferAll}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">Defer All...</span>
            <span className="sm:hidden">Defer</span>
          </button>

          {/* Decline All */}
          <button
            onClick={onDeclineAll}
            disabled={loading}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="hidden sm:inline">Decline All...</span>
            <span className="sm:hidden">Decline</span>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-purple-700" />

        {/* Clear selection */}
        <button
          onClick={onClearSelection}
          disabled={loading}
          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
