/**
 * SelectionActionBar Component
 * Floating action bar shown when items are selected on Health Check tab
 */

interface SelectionActionBarProps {
  selectedCount: number
  onCreateGroup: () => void
  onClearSelection: () => void
}

export function SelectionActionBar({
  selectedCount,
  onCreateGroup,
  onClearSelection
}: SelectionActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
      <div className="bg-gray-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-4">
        {/* Selection count */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-sm font-medium">
            {selectedCount}
          </div>
          <span className="text-sm">
            item{selectedCount !== 1 ? 's' : ''} selected
          </span>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-700" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onCreateGroup}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Create Group
          </button>

          <button
            onClick={onClearSelection}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
