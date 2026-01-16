import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { api, HealthCheck, User } from '../../lib/api'

// View type
type ViewMode = 'kanban' | 'list'
const VIEW_PREFERENCE_KEY = 'vhc_health_checks_view'

const statusLabels: Record<string, string> = {
  created: 'Created',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  paused: 'Paused',
  tech_completed: 'Tech Complete',
  awaiting_review: 'Awaiting Review',
  awaiting_pricing: 'Awaiting Pricing',
  ready_to_send: 'Ready to Send',
  sent: 'Sent',
  opened: 'Opened',
  partial_response: 'Partial Response',
  authorized: 'Authorized',
  declined: 'Declined',
  expired: 'Expired',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

const statusColors: Record<string, string> = {
  created: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  paused: 'bg-gray-100 text-gray-700',
  tech_completed: 'bg-green-100 text-green-700',
  awaiting_review: 'bg-orange-100 text-orange-700',
  awaiting_pricing: 'bg-orange-100 text-orange-700',
  ready_to_send: 'bg-blue-100 text-blue-700',
  sent: 'bg-purple-100 text-purple-700',
  opened: 'bg-green-100 text-green-700',
  partial_response: 'bg-yellow-100 text-yellow-700',
  authorized: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-700'
}

// Kanban Board Types
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

// View Toggle Component
function ViewToggle({ view, onViewChange }: { view: ViewMode; onViewChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 p-1">
      <button
        onClick={() => onViewChange('kanban')}
        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
          view === 'kanban'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        Kanban
      </button>
      <button
        onClick={() => onViewChange('list')}
        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
          view === 'list'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        List
      </button>
    </div>
  )
}

export default function HealthCheckList() {
  const { session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = session?.accessToken

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(VIEW_PREFERENCE_KEY)
    return (saved === 'list' || saved === 'kanban') ? saved : 'kanban'
  })

  // List view state
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)

  // Kanban view state
  const [boardData, setBoardData] = useState<BoardData | null>(null)
  const [activeCard, setActiveCard] = useState<HealthCheckCard | null>(null)
  const [updating, setUpdating] = useState(false)
  const [liveUpdate, setLiveUpdate] = useState<string | null>(null)

  // Filters from URL (for list view)
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  const technicianId = searchParams.get('technician') || ''
  const advisorId = searchParams.get('advisor') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const limit = 20

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Save view preference
  const handleViewChange = (newView: ViewMode) => {
    setViewMode(newView)
    localStorage.setItem(VIEW_PREFERENCE_KEY, newView)
  }

  // Fetch Kanban board data
  const fetchBoard = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      const data = await api<BoardData>('/api/v1/dashboard/board', { token })
      setBoardData(data)
      setTotalCount(data.totalCount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [token])

  // Fetch list data
  const fetchHealthChecks = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String((page - 1) * limit))

      if (status) params.set('status', status)
      if (technicianId) params.set('technician_id', technicianId)
      if (advisorId) params.set('advisor_id', advisorId)

      const data = await api<{ healthChecks: HealthCheck[]; total: number }>(
        `/api/v1/health-checks?${params}`,
        { token }
      )

      // Filter by search locally (registration or customer name)
      let filtered = data.healthChecks || []
      if (search) {
        const searchLower = search.toLowerCase()
        filtered = filtered.filter(hc =>
          hc.vehicle?.registration?.toLowerCase().includes(searchLower) ||
          `${hc.vehicle?.customer?.first_name} ${hc.vehicle?.customer?.last_name}`.toLowerCase().includes(searchLower)
        )
      }

      setHealthChecks(filtered)
      setTotalCount(data.total || filtered.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health checks')
    } finally {
      setLoading(false)
    }
  }, [token, status, technicianId, advisorId, page, search])

  const fetchUsers = useCallback(async () => {
    if (!token) return

    try {
      const data = await api<{ users: User[] }>('/api/v1/users', { token })
      setUsers(data.users || [])
    } catch (err) {
      console.error('Failed to load users:', err)
    }
  }, [token])

  // Fetch data based on view mode
  useEffect(() => {
    if (viewMode === 'kanban') {
      fetchBoard()
    } else {
      fetchHealthChecks()
    }
    fetchUsers()
  }, [viewMode, fetchBoard, fetchHealthChecks, fetchUsers])

  // Subscribe to real-time WebSocket events
  useEffect(() => {
    const handleStatusChange = (data: { healthCheckId: string; status: string; vehicleReg: string }) => {
      setLiveUpdate(`${data.vehicleReg} → ${data.status.replace('_', ' ')}`)
      setTimeout(() => setLiveUpdate(null), 3000)
      if (viewMode === 'kanban') {
        fetchBoard()
      } else {
        fetchHealthChecks()
      }
    }

    const handleCustomerAction = (data: { vehicleReg: string; action: string }) => {
      const actionText = data.action === 'authorized' ? 'Authorized' : data.action === 'declined' ? 'Declined' : 'Signed'
      setLiveUpdate(`${data.vehicleReg} - ${actionText}!`)
      setTimeout(() => setLiveUpdate(null), 3000)
      if (viewMode === 'kanban') {
        fetchBoard()
      } else {
        fetchHealthChecks()
      }
    }

    on(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, handleStatusChange)
    on(WS_EVENTS.CUSTOMER_AUTHORIZED, handleCustomerAction)
    on(WS_EVENTS.CUSTOMER_DECLINED, handleCustomerAction)

    return () => {
      off(WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED)
      off(WS_EVENTS.CUSTOMER_AUTHORIZED)
      off(WS_EVENTS.CUSTOMER_DECLINED)
    }
  }, [on, off, fetchBoard, fetchHealthChecks, viewMode])

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  const totalPages = Math.ceil(totalCount / limit)
  const technicians = users.filter(u => u.role === 'technician')
  const advisors = users.filter(u => ['service_advisor', 'site_admin', 'org_admin'].includes(u.role))

  // Kanban drag handlers
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

    const draggedCard = Object.values(boardData.columns)
      .flatMap(col => col.cards)
      .find(c => c.id === active.id)

    if (!draggedCard) return

    const overColumnId = over.data?.current?.columnId || over.id
    const targetColumn = boardData.columns[overColumnId as keyof typeof boardData.columns]

    if (!targetColumn) return

    const targetStatus = targetColumn.statuses[0]
    const canTransition = draggedCard.validTransitions.includes(targetStatus)

    if (!canTransition) return

    try {
      setUpdating(true)
      await api(`/api/v1/health-checks/${draggedCard.id}/status`, {
        method: 'PATCH',
        token,
        body: { status: targetStatus }
      })
      await fetchBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Live Update Toast */}
      {liveUpdate && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-white px-4 py-2 shadow-lg animate-pulse">
          {liveUpdate}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Health Checks</h1>
          {/* Connection Status */}
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={viewMode} onViewChange={handleViewChange} />
          <Link
            to="/health-checks/new"
            className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
          >
            New Health Check
          </Link>
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

      {/* Kanban View */}
      {viewMode === 'kanban' && (
        <>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : !boardData ? (
            <div className="text-center py-8 text-gray-500">
              Failed to load board data
              <button onClick={fetchBoard} className="ml-4 text-primary underline">Retry</button>
            </div>
          ) : (
            <>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <div className="flex-1 grid grid-cols-5 gap-4 min-h-0 overflow-hidden">
                  {Object.values(boardData.columns).map((column) => (
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
                <div className="ml-auto text-sm text-gray-500">
                  {boardData.totalCount} health checks
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Filters */}
          <div className="bg-white border border-gray-200 shadow-sm p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Search */}
              <div className="md:col-span-2">
                <input
                  type="text"
                  placeholder="Search by registration or customer..."
                  value={search}
                  onChange={(e) => updateFilter('search', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>

              {/* Status filter */}
              <select
                value={status}
                onChange={(e) => updateFilter('status', e.target.value)}
                className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>

              {/* Technician filter */}
              <select
                value={technicianId}
                onChange={(e) => updateFilter('technician', e.target.value)}
                className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Technicians</option>
                {technicians.map(tech => (
                  <option key={tech.id} value={tech.id}>
                    {tech.firstName} {tech.lastName}
                  </option>
                ))}
              </select>

              {/* Advisor filter */}
              <select
                value={advisorId}
                onChange={(e) => updateFilter('advisor', e.target.value)}
                className="px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Advisors</option>
                {advisors.map(adv => (
                  <option key={adv.id} value={adv.id}>
                    {adv.firstName} {adv.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
              </div>
            ) : healthChecks.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No health checks found
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Registration</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Customer</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">RAG</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Technician</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Created</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {healthChecks.map((hc) => (
                    <tr key={hc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {hc.vehicle?.registration || '-'}
                        </div>
                        <div className="text-sm text-gray-500">
                          {hc.vehicle?.make} {hc.vehicle?.model}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {hc.vehicle?.customer ? (
                          `${hc.vehicle.customer.first_name} ${hc.vehicle.customer.last_name}`
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 text-xs font-medium ${statusColors[hc.status] || 'bg-gray-100 text-gray-700'}`}>
                          {statusLabels[hc.status] || hc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-3 h-3 rounded-full bg-green-500" />
                            {hc.green_count}
                          </span>
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-3 h-3 rounded-full bg-yellow-500" />
                            {hc.amber_count}
                          </span>
                          <span className="flex items-center gap-1 text-sm">
                            <span className="w-3 h-3 rounded-full bg-red-500" />
                            {hc.red_count}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {hc.technician ? (
                          `${hc.technician.first_name} ${hc.technician.last_name}`
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {new Date(hc.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/health-checks/${hc.id}`}
                          className="text-primary hover:underline text-sm font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-500">
                Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, totalCount)} of {totalCount}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => updateFilter('page', String(page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="px-3 py-1 text-sm">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => updateFilter('page', String(page + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1 border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
