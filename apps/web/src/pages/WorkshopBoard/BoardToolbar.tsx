import type { BoardFilters } from './hooks/useBoardFilters'
import type { BoardStatus } from './hooks/useBoardData'

interface BoardToolbarProps {
  date: string
  onDateChange: (date: string) => void
  filters: BoardFilters
  onFiltersChange: (partial: Partial<BoardFilters>) => void
  hasActiveFilters: boolean
  onClearFilters: () => void
  statuses: BoardStatus[]
  advisors: { id: string; name: string }[]
}

export default function BoardToolbar({
  date,
  onDateChange,
  filters,
  onFiltersChange,
  hasActiveFilters,
  onClearFilters,
  statuses,
  advisors,
}: BoardToolbarProps) {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dayAfter = new Date(Date.now() + 172800000).toISOString().split('T')[0]

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Date quick buttons */}
      <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => onDateChange(today)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${date === today ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          Today
        </button>
        <button
          onClick={() => onDateChange(tomorrow)}
          className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors ${date === tomorrow ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          Tomorrow
        </button>
        <button
          onClick={() => onDateChange(dayAfter)}
          className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 transition-colors ${date === dayAfter ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          +2 Days
        </button>
      </div>

      <input
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
      />

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search reg, name, job..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ search: e.target.value })}
          className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs w-48"
        />
      </div>

      {/* Advisor filter */}
      {advisors.length > 0 && (
        <select
          value={filters.advisorId || ''}
          onChange={(e) => onFiltersChange({ advisorId: e.target.value || null })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="">All Advisors</option>
          {advisors.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      )}

      {/* Status filter */}
      {statuses.length > 0 && (
        <select
          value={filters.statusIds[0] || ''}
          onChange={(e) => onFiltersChange({ statusIds: e.target.value ? [e.target.value] : [] })}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="">All Statuses</option>
          {statuses.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Flag toggles */}
      <div className="flex items-center gap-1">
        <ToggleButton
          label="WYW"
          active={filters.customerWaiting}
          onClick={() => onFiltersChange({ customerWaiting: !filters.customerWaiting })}
          activeClass="bg-rag-red text-white"
        />
        <ToggleButton
          label="LOAN"
          active={filters.loanCar}
          onClick={() => onFiltersChange({ loanCar: !filters.loanCar })}
          activeClass="bg-blue-500 text-white"
        />
        <ToggleButton
          label="Overdue"
          active={filters.overdue}
          onClick={() => onFiltersChange({ overdue: !filters.overdue })}
          activeClass="bg-red-500 text-white"
        />
        <ToggleButton
          label="Priority"
          active={filters.highPriority}
          onClick={() => onFiltersChange({ highPriority: !filters.highPriority })}
          activeClass="bg-amber-500 text-white"
        />
      </div>

      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function ToggleButton({ label, active, onClick, activeClass }: {
  label: string
  active: boolean
  onClick: () => void
  activeClass: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${active ? activeClass : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {label}
    </button>
  )
}
