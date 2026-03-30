import { useState, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import { useBoardData, type BoardCard } from './hooks/useBoardData'
import { useBoardFilters } from './hooks/useBoardFilters'
import BoardColumn from './BoardColumn'
import BoardToolbar from './BoardToolbar'
import JobCard from './JobCard'
import AddColumnModal from './AddColumnModal'
import CardDetailPanel from './CardDetailPanel'

export default function WorkshopBoard() {
  const { user, session } = useAuth()
  const toast = useToast()

  const siteId = user?.site?.id || null
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const { data, loading, error, refresh } = useBoardData(siteId, date)
  const { filters, updateFilters, clearFilters, hasActiveFilters, filterCard } = useBoardFilters()

  const [activeCard, setActiveCard] = useState<BoardCard | null>(null)
  const [selectedCard, setSelectedCard] = useState<BoardCard | null>(null)
  const [showAddColumn, setShowAddColumn] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Build filtered card lists
  const filteredDueIn = useMemo(() => (data?.dueIn || []).filter(filterCard), [data?.dueIn, filterCard])
  const filteredCompleted = useMemo(() => (data?.completed || []).filter(filterCard), [data?.completed, filterCard])
  const filteredColumns = useMemo(() => {
    return (data?.columns || []).map(col => ({
      ...col,
      cards: col.cards.filter(filterCard),
    }))
  }, [data?.columns, filterCard])

  // Extract unique advisors for filter dropdown
  const advisors = useMemo(() => {
    if (!data) return []
    const allCards = [...(data.dueIn || []), ...(data.completed || []), ...(data.columns || []).flatMap(c => c.cards)]
    const seen = new Map<string, string>()
    for (const card of allCards) {
      if (card.advisor && !seen.has(card.advisor.id)) {
        seen.set(card.advisor.id, `${card.advisor.firstName} ${card.advisor.lastName}`)
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [data])

  const handleDragStart = (event: DragStartEvent) => {
    const card = event.active.data.current?.card as BoardCard | undefined
    setActiveCard(card || null)
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveCard(null)
    const { active, over } = event
    if (!over || !session?.accessToken) return

    const card = active.data.current?.card as BoardCard | undefined
    if (!card) return

    const targetId = over.id as string

    // Determine column type and technician
    let columnType: string
    let technicianId: string | null = null

    if (targetId === 'due_in') {
      columnType = 'due_in'
    } else if (targetId === 'completed') {
      columnType = 'completed'
    } else {
      // It's a technician column or a card inside one
      // Check if target is a column id
      const column = data?.columns.find(c => c.id === targetId)
      if (column) {
        columnType = 'technician'
        technicianId = column.technicianId
      } else {
        // Target is another card — find which column it's in
        const parentCol = data?.columns.find(c => c.cards.some(cc => cc.healthCheckId === targetId))
        if (parentCol) {
          columnType = 'technician'
          technicianId = parentCol.technicianId
        } else if ((data?.dueIn || []).some(c => c.healthCheckId === targetId)) {
          columnType = 'due_in'
        } else if ((data?.completed || []).some(c => c.healthCheckId === targetId)) {
          columnType = 'completed'
        } else {
          return
        }
      }
    }

    // Don't move if it's the same position
    if (columnType === card.columnType && technicianId === card.assignedTechnicianId) return

    try {
      await api('/api/v1/tcard/cards/move', {
        method: 'POST',
        token: session.accessToken,
        body: {
          healthCheckId: card.healthCheckId,
          columnType,
          technicianId,
          boardDate: date,
        },
      })
      refresh()
    } catch {
      toast.error('Failed to move card')
      refresh()
    }
  }, [data, date, session?.accessToken, refresh, toast])

  const handleAddColumn = async (techId: string) => {
    if (!session?.accessToken || !siteId) return
    try {
      await api('/api/v1/tcard/columns', {
        method: 'POST',
        token: session.accessToken,
        body: { siteId, technicianId: techId },
      })
      setShowAddColumn(false)
      refresh()
      toast.success('Technician column added')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add column')
    }
  }

  const handleRemoveColumn = async (columnId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Remove this column? Cards will return to Checked In.')) return
    try {
      await api(`/api/v1/tcard/columns/${columnId}`, {
        method: 'DELETE',
        token: session.accessToken,
      })
      refresh()
      toast.success('Column removed')
    } catch {
      toast.error('Failed to remove column')
    }
  }

  const handleCardClick = (card: BoardCard) => {
    setSelectedCard(card)
  }

  // Seed default statuses on first load if none exist
  const seedStatuses = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      await api('/api/v1/tcard/board/seed-statuses', {
        method: 'POST',
        token: session.accessToken,
      })
    } catch {
      // Ignore — statuses may already exist
    }
  }, [session?.accessToken])

  // Seed on first successful load with no statuses
  useMemo(() => {
    if (data && data.statuses.length === 0) {
      seedStatuses().then(refresh)
    }
  }, [data?.statuses.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!siteId) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-4 text-sm">
          No site assigned to your account. Please contact an administrator.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold text-gray-900">Workshop Board</h1>
          <button
            onClick={() => setShowAddColumn(true)}
            className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Technician
          </button>
        </div>

        <BoardToolbar
          date={date}
          onDateChange={setDate}
          filters={filters}
          onFiltersChange={updateFilters}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          statuses={data?.statuses || []}
          advisors={advisors}
        />
      </div>

      {/* Board */}
      {loading && !data ? (
        <div className="flex items-center justify-center flex-1">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="px-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex-1 overflow-x-auto px-4 pb-4">
            <div className="flex gap-3 min-h-0 h-full">
              {/* Due In */}
              <BoardColumn
                id="due_in"
                title="Due In"
                subtitle={formatDate(date)}
                cards={filteredDueIn}
                onCardClick={handleCardClick}
              />

              {/* Technician columns */}
              {filteredColumns.map(col => (
                <BoardColumn
                  key={col.id}
                  id={col.id}
                  title={col.technician ? `${col.technician.firstName} ${col.technician.lastName}` : 'Technician'}
                  cards={col.cards}
                  allocatedHours={col.allocatedHours}
                  availableHours={col.availableHours}
                  onCardClick={handleCardClick}
                  onRemove={() => handleRemoveColumn(col.id)}
                />
              ))}

              {/* Completed */}
              <BoardColumn
                id="completed"
                title="Completed"
                cards={filteredCompleted}
                onCardClick={handleCardClick}
              />
            </div>
          </div>

          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <JobCard card={activeCard} onClick={() => {}} isDragOverlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Detail panel */}
      {selectedCard && (
        <CardDetailPanel
          card={selectedCard}
          statuses={data?.statuses || []}
          date={date}
          onClose={() => setSelectedCard(null)}
          onUpdate={() => { refresh(); setSelectedCard(null) }}
        />
      )}

      {/* Add column modal */}
      {showAddColumn && (
        <AddColumnModal
          siteId={siteId}
          existingTechIds={(data?.columns || []).map(c => c.technicianId)}
          onAdd={handleAddColumn}
          onClose={() => setShowAddColumn(false)}
        />
      )}
    </div>
  )
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}
