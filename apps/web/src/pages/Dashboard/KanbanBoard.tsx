import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragStartEvent,
  DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api } from '../../lib/api'

interface HealthCheckCard {
  id: string
  status: string
  promise_time?: string
  created_at: string
  updated_at: string
  sent_at?: string
  token_expires_at?: string
  green_count: number
  amber_count: number
  red_count: number
  total_amount: number
  vehicle?: { id: string; registration: string; make: string; model: string }
  customer?: { id: string; first_name: string; last_name: string }
  technician?: { id: string; first_name: string; last_name: string }
  advisor?: { id: string; first_name: string; last_name: string }
  isOverdue: boolean
  isExpiringSoon: boolean
  validTransitions: string[]
}

interface Column {
  id: string
  title: string
  statuses: string[]
  cards: HealthCheckCard[]
}

interface BoardData {
  columns: {
    technician: Column
    tech_done: Column
    advisor: Column
    customer: Column
    actioned: Column
  }
  totalCount: number
}

// Sortable Card Component
function SortableCard({ card, columnId }: { card: HealthCheckCard; columnId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: card.id, data: { columnId, card } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <CardContent card={card} />
    </div>
  )
}

// Card Content Component
function CardContent({ card }: { card: HealthCheckCard }) {
  return (
    <Link
      to={`/health-checks/${card.id}`}
      className={`block bg-white border shadow-sm p-3 mb-2 hover:shadow-md transition-shadow ${
        card.isOverdue ? 'border-rag-red border-l-4' :
        card.isExpiringSoon ? 'border-rag-amber border-l-4' :
        'border-gray-200'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-gray-900">{card.vehicle?.registration}</span>
        {(card.isOverdue || card.isExpiringSoon) && (
          <span className={`px-1.5 py-0.5 text-xs font-medium ${
            card.isOverdue ? 'bg-rag-red text-white' : 'bg-rag-amber text-white'
          }`}>
            {card.isOverdue ? 'OVERDUE' : 'EXPIRING'}
          </span>
        )}
      </div>

      {/* Customer */}
      <div className="text-sm text-gray-600 mb-2">
        {card.customer?.first_name} {card.customer?.last_name}
      </div>

      {/* Vehicle */}
      <div className="text-xs text-gray-500 mb-2">
        {card.vehicle?.make} {card.vehicle?.model}
      </div>

      {/* RAG Summary */}
      <div className="flex items-center gap-2 mb-2">
        {card.red_count > 0 && (
          <span className="flex items-center gap-1 text-xs">
            <span className="w-2 h-2 bg-rag-red rounded-full" />
            <span className="text-rag-red font-medium">{card.red_count}</span>
          </span>
        )}
        {card.amber_count > 0 && (
          <span className="flex items-center gap-1 text-xs">
            <span className="w-2 h-2 bg-rag-amber rounded-full" />
            <span className="text-rag-amber font-medium">{card.amber_count}</span>
          </span>
        )}
        {card.green_count > 0 && (
          <span className="flex items-center gap-1 text-xs">
            <span className="w-2 h-2 bg-rag-green rounded-full" />
            <span className="text-rag-green font-medium">{card.green_count}</span>
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{card.technician ? `${card.technician.first_name} ${card.technician.last_name?.charAt(0)}.` : 'Unassigned'}</span>
        {card.total_amount > 0 && (
          <span className="font-medium text-gray-900">£{card.total_amount.toFixed(0)}</span>
        )}
      </div>

      {/* Status Badge */}
      <div className="mt-2">
        <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 capitalize">
          {card.status.replace('_', ' ')}
        </span>
      </div>
    </Link>
  )
}

// Column Component
function BoardColumn({ column, cards }: { column: Column; cards: HealthCheckCard[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { columnId: column.id }
  })

  const columnColors: Record<string, string> = {
    technician: 'bg-blue-50 border-blue-200',
    tech_done: 'bg-amber-50 border-amber-200',
    advisor: 'bg-green-50 border-green-200',
    customer: 'bg-purple-50 border-purple-200',
    actioned: 'bg-gray-50 border-gray-200'
  }

  const headerColors: Record<string, string> = {
    technician: 'bg-blue-100 text-blue-800',
    tech_done: 'bg-amber-100 text-amber-800',
    advisor: 'bg-green-100 text-green-800',
    customer: 'bg-purple-100 text-purple-800',
    actioned: 'bg-gray-100 text-gray-800'
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col h-full border transition-colors ${columnColors[column.id] || 'bg-gray-50 border-gray-200'} ${isOver ? 'ring-2 ring-primary ring-opacity-50' : ''}`}
    >
      {/* Column Header */}
      <div className={`p-3 border-b ${headerColors[column.id] || 'bg-gray-100 text-gray-800'}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{column.title}</h3>
          <span className="bg-white px-2 py-0.5 text-sm font-medium rounded">
            {cards.length}
          </span>
        </div>
        <div className="text-xs mt-1 opacity-75">
          {column.statuses.join(', ')}
        </div>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-2 overflow-y-auto min-h-0">
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} columnId={column.id} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No items
          </div>
        )}
      </div>
    </div>
  )
}

export default function KanbanBoard() {
  const { session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const token = session?.accessToken
  const [boardData, setBoardData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCard, setActiveCard] = useState<HealthCheckCard | null>(null)
  const [updating, setUpdating] = useState(false)
  const [liveUpdate, setLiveUpdate] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const fetchBoard = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const data = await api<BoardData>('/api/v1/dashboard/board', { token })
      setBoardData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  // Subscribe to real-time WebSocket events
  useEffect(() => {
    const handleStatusChange = (data: { healthCheckId: string; status: string; vehicleReg: string }) => {
      setLiveUpdate(`${data.vehicleReg} → ${data.status.replace('_', ' ')}`)
      setTimeout(() => setLiveUpdate(null), 3000)
      fetchBoard()
    }

    const handleCustomerAction = (data: { vehicleReg: string; action: string }) => {
      const actionText = data.action === 'authorized' ? 'Authorized' : data.action === 'declined' ? 'Declined' : 'Signed'
      setLiveUpdate(`${data.vehicleReg} - ${actionText}!`)
      setTimeout(() => setLiveUpdate(null), 3000)
      fetchBoard()
    }

    on(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, handleStatusChange)
    on(WS_EVENTS.CUSTOMER_AUTHORIZED, handleCustomerAction)
    on(WS_EVENTS.CUSTOMER_DECLINED, handleCustomerAction)

    return () => {
      off(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED)
      off(WS_EVENTS.CUSTOMER_AUTHORIZED)
      off(WS_EVENTS.CUSTOMER_DECLINED)
    }
  }, [on, off, fetchBoard])

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const card = Object.values(boardData?.columns || {})
      .flatMap(col => col.cards)
      .find(c => c.id === active.id)
    setActiveCard(card || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveCard(null)

    if (!over || !boardData) return

    const activeCard = Object.values(boardData.columns)
      .flatMap(col => col.cards)
      .find(c => c.id === active.id)

    if (!activeCard) return

    // Determine target column from over id
    const overColumnId = over.data?.current?.columnId || over.id
    const targetColumn = boardData.columns[overColumnId as keyof typeof boardData.columns]

    if (!targetColumn) return

    // Check if this is a valid transition
    const targetStatus = targetColumn.statuses[0] // Use first status of target column
    const canTransition = activeCard.validTransitions.includes(targetStatus)

    if (!canTransition) {
      // Show error or shake animation
      return
    }

    // Update the status via API
    try {
      setUpdating(true)
      await api(`/api/v1/health-checks/${activeCard.id}/status`, {
        method: 'PATCH',
        token,
        body: { status: targetStatus }
      })

      // Refresh board
      await fetchBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!boardData) {
    return (
      <div className="text-center py-8 text-gray-500">
        Failed to load board data
        <button onClick={fetchBoard} className="ml-4 text-primary underline">Retry</button>
      </div>
    )
  }

  const columns = Object.values(boardData.columns)

  return (
    <div className="h-full flex flex-col">
      {/* Live Update Toast */}
      {liveUpdate && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-white px-4 py-2 shadow-lg animate-pulse">
          {liveUpdate}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Kanban Board</h1>
          {/* Connection Status */}
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{boardData.totalCount} health checks</span>
          <button
            onClick={fetchBoard}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 p-3 mb-4 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">Dismiss</button>
        </div>
      )}

      {updating && (
        <div className="bg-blue-50 border border-blue-200 p-3 mb-4 text-blue-700 text-sm">
          Updating status...
        </div>
      )}

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 grid grid-cols-5 gap-4 min-h-0 overflow-hidden">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              cards={column.cards}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard && <CardContent card={activeCard} />}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-l-4 border-rag-red bg-white"></div>
          <span>Overdue</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-l-4 border-rag-amber bg-white"></div>
          <span>Link Expiring</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="italic">Drag cards between columns to change status</span>
        </div>
      </div>
    </div>
  )
}
