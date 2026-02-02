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
import { WorkflowBadges, WorkflowLegend, WorkflowStatus, CompletionInfo, AuthorisationInfo } from '../../components/WorkflowBadges'
import { Tooltip } from '../../components/ui/Tooltip'
import { InspectionTimer } from '../../components/InspectionTimer'

// Currency formatter helper
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount)
}

// View type
type ViewMode = 'kanban' | 'list'
const VIEW_PREFERENCE_KEY = 'vhc_health_checks_view'

const statusLabels: Record<string, string> = {
  awaiting_arrival: 'Awaiting Arrival',
  awaiting_checkin: 'Awaiting Check-In',
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
  cancelled: 'Cancelled',
  no_show: 'No Show'
}

const statusColors: Record<string, string> = {
  awaiting_arrival: 'bg-blue-100 text-blue-700',
  awaiting_checkin: 'bg-red-100 text-red-700',
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
  cancelled: 'bg-gray-100 text-gray-700',
  no_show: 'bg-red-100 text-red-700'
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
  customer_waiting?: boolean
  loan_car_required?: boolean
  booked_repairs?: Array<{ code?: string; description?: string; notes?: string }>
  vehicle?: { id: string; registration: string; make: string; model: string }
  customer?: { id: string; first_name: string; last_name: string }
  technician?: { id: string; first_name: string; last_name: string }
  advisor?: { id: string; first_name: string; last_name: string }
  isOverdue: boolean
  isExpiringSoon: boolean
  validTransitions: string[]
  // Technician inspection timestamps
  tech_started_at?: string | null
  tech_completed_at?: string | null
  // Workflow status fields
  workflowStatus?: WorkflowStatus
  technicianCompletion?: CompletionInfo
  authorisationInfo?: AuthorisationInfo
  // Outcome aggregation fields - identified vs authorised
  identified_total?: number
  authorised_total?: number
  red_identified?: number
  red_authorised?: number
  amber_identified?: number
  amber_authorised?: number
  green_identified?: number
  green_authorised?: number
  // MRI (Manufacturer Recommended Items) data
  mri_count?: number
  mri_total?: number
  // Timer data for in_progress inspections
  timer_data?: {
    total_closed_minutes: number
    active_clock_in_at: string | null
  } | null
  // Unread inbound SMS count
  unread_sms_count?: number
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
  const isAwaitingCheckin = card.status === 'awaiting_checkin'

  return (
    <Link
      to={`/health-checks/${card.id}${isAwaitingCheckin ? '?tab=checkin' : ''}`}
      className={`block border rounded-lg shadow-sm p-3 mb-2 hover:shadow transition-shadow ${
        isAwaitingCheckin
          ? 'bg-red-50 border-red-300'
          : 'bg-white border-gray-200 rounded-xl'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: Registration + Status Badges */}
      <div className="flex items-start justify-between mb-2">
        <span className="font-bold text-lg text-gray-900">
          {card.vehicle?.registration}
        </span>
        <div className="flex gap-1 flex-wrap justify-end">
          {isAwaitingCheckin && (
            <span className="px-2 py-0.5 text-xs font-bold bg-red-600 text-white rounded-lg animate-pulse">
              CHECK-IN REQUIRED
            </span>
          )}
          {card.customer_waiting && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded">
              Waiting
            </span>
          )}
          {card.loan_car_required && (
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded">
              Loan
            </span>
          )}
          {card.isOverdue && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded">
              Overdue
            </span>
          )}
          {card.isExpiringSoon && !card.isOverdue && (
            <span className="px-2 py-0.5 text-xs font-medium bg-amber-500 text-white rounded">
              Expiring
            </span>
          )}
          {(card.unread_sms_count ?? 0) > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              {card.unread_sms_count}
            </span>
          )}
        </div>
      </div>

      {/* Customer */}
      <div className="text-sm font-medium text-gray-800 mb-1">
        {card.customer?.first_name} {card.customer?.last_name}
      </div>

      {/* Vehicle */}
      <div className="text-xs text-gray-500 mb-2">
        {card.vehicle?.make} {card.vehicle?.model}
      </div>

      {/* Technician & Advisor */}
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
        {card.technician && (
          <span>Tech: {card.technician.first_name} {card.technician.last_name}</span>
        )}
        {card.advisor && (
          <span>SA: {card.advisor.first_name} {card.advisor.last_name}</span>
        )}
      </div>

      {/* RAG Summary with identified:authorised */}
      <div className="flex items-center gap-3 mb-2">
        <span className="flex items-center gap-1 text-xs">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
          <span className="text-gray-700 font-medium">
            {card.red_identified ?? card.red_count ?? 0}:{card.red_authorised ?? 0}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs">
          <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
          <span className="text-gray-700 font-medium">
            {card.amber_identified ?? card.amber_count ?? 0}:{card.amber_authorised ?? 0}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
          <span className="text-gray-700 font-medium">
            {card.green_identified ?? card.green_count ?? 0}:{card.green_authorised ?? 0}
          </span>
        </span>
      </div>

      {/* MRI Badge - only show if there are MRI items */}
      {(card.mri_count ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 text-xs mb-2">
          <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-semibold">MRI</span>
          <span className="text-gray-700 font-medium">
            {card.mri_count} {formatCurrency(card.mri_total ?? 0)}
          </span>
        </div>
      )}

      {/* Total Identified vs Authorised KPI */}
      <div className="flex items-center gap-4 text-xs mb-2">
        <span className="flex items-center gap-1">
          <span className="text-gray-400 font-medium">I:</span>
          <span className="font-semibold text-gray-700">
            {formatCurrency(card.identified_total ?? card.total_amount ?? 0)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-green-500 font-medium">A:</span>
          <span className="font-semibold text-green-600">
            {formatCurrency(card.authorised_total ?? 0)}
          </span>
        </span>
      </div>

      {/* Footer Bar: Status + Timer + Workflow Badges */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        {/* Status indicator and Timer */}
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
            </svg>
            <span className="capitalize">{card.status.replace(/_/g, ' ')}</span>
          </div>
          {/* Timer for in_progress cards */}
          {card.status === 'in_progress' && card.timer_data && (
            <InspectionTimer
              status={card.status}
              totalClosedMinutes={card.timer_data.total_closed_minutes}
              activeClockInAt={card.timer_data.active_clock_in_at}
              variant="compact"
            />
          )}
        </div>

        {/* Workflow Badges (T-L-P-S-A) */}
        {card.workflowStatus && (
          <WorkflowBadges
            status={card.workflowStatus}
            compact
            technicianCompletion={card.technicianCompletion}
            authorisationInfo={card.authorisationInfo}
          />
        )}
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

  const headerColors: Record<string, string> = {
    technician: 'bg-blue-100 border-b-blue-200',
    tech_done: 'bg-amber-100 border-b-amber-200',
    advisor: 'bg-green-100 border-b-green-200',
    customer: 'bg-purple-100 border-b-purple-200',
    actioned: 'bg-gray-100 border-b-gray-200'
  }

  const dotColors: Record<string, string> = {
    technician: 'bg-blue-500',
    tech_done: 'bg-amber-500',
    advisor: 'bg-green-500',
    customer: 'bg-purple-500',
    actioned: 'bg-gray-500'
  }

  const countColors: Record<string, string> = {
    technician: 'bg-blue-200 text-blue-800',
    tech_done: 'bg-amber-200 text-amber-800',
    advisor: 'bg-green-200 text-green-800',
    customer: 'bg-purple-200 text-purple-800',
    actioned: 'bg-gray-200 text-gray-800'
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col h-full bg-gray-50 border border-gray-200 rounded-lg overflow-hidden transition-colors min-w-[280px] md:min-w-0 snap-center ${isOver ? 'ring-2 ring-primary ring-opacity-50' : ''}`}
    >
      {/* Column Header */}
      <div className={`px-4 py-3 border-b ${headerColors[column.id]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${dotColors[column.id]}`} />
            <h3 className="text-base font-semibold text-gray-900">{column.title}</h3>
            {/* Info icon with floating-ui tooltip showing statuses */}
            <Tooltip content={column.statuses.map(s => statusLabels[s] || s.replace('_', ' ')).join(' · ')}>
              <span className="text-gray-400 hover:text-gray-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </span>
            </Tooltip>
          </div>
          <span className={`px-2.5 py-0.5 text-sm font-bold rounded-full ${countColors[column.id]}`}>
            {cards.length}
          </span>
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
    <div className="flex bg-gray-100 p-1 rounded-lg">
      <button
        onClick={() => onViewChange('kanban')}
        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
          view === 'kanban'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        Kanban
      </button>
      <button
        onClick={() => onViewChange('list')}
        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
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

      // Process cards to add technicianCompletion for tooltip (workflowStatus now comes from API)
      const processedData: BoardData = {
        ...data,
        columns: Object.fromEntries(
          Object.entries(data.columns).map(([key, column]) => [
            key,
            {
              ...column,
              cards: column.cards.map(card => ({
                ...card,
                // Create technicianCompletion for tooltip
                technicianCompletion: {
                  startedAt: card.tech_started_at,
                  startedBy: card.technician ? `${card.technician.first_name} ${card.technician.last_name}` : undefined,
                  completedAt: card.tech_completed_at,
                  completedBy: card.technician ? `${card.technician.first_name} ${card.technician.last_name}` : undefined
                }
              }))
            }
          ])
        ) as BoardData['columns']
      }

      setBoardData(processedData)
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

    // Block drag for awaiting_checkin status - must complete check-in first
    if (draggedCard.status === 'awaiting_checkin') {
      setError('Cannot assign: Check-in must be completed first')
      setTimeout(() => setError(null), 3000)
      return
    }

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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3 sm:gap-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Health Checks</h1>
          {/* Connection Status */}
          <span className={`flex items-center gap-1 text-xs ${isConnected ? 'text-rag-green' : 'text-gray-400'}`}>
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-rag-green' : 'bg-gray-400'}`} />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ViewToggle view={viewMode} onViewChange={handleViewChange} />
          <Link
            to="/health-checks/new"
            className="px-3 py-2 sm:px-4 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark text-sm sm:text-base"
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
                <div className="flex-1 flex md:grid md:grid-cols-5 gap-3 md:gap-4 min-h-0 overflow-x-auto md:overflow-hidden snap-x snap-mandatory md:snap-none pb-4 md:pb-0">
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
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-3 md:gap-6 text-xs text-gray-500">
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-gray-600">Badges:</span>
                    <span className="px-2 py-0.5 bg-red-500 text-white rounded text-[10px]">Overdue</span>
                    <span className="px-2 py-0.5 bg-amber-500 text-white rounded text-[10px]">Expiring</span>
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">Waiting</span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px]">Loan</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-600">RAG:</span>
                    <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                    <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                  </div>
                  <span className="italic hidden md:inline">Drag cards between columns to change status</span>
                  <div className="ml-auto text-sm text-gray-500">
                    {boardData.totalCount} health checks
                  </div>
                </div>
                <WorkflowLegend />
              </div>
            </>
          )}
        </>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Filters */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 mb-6">
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
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
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
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 hidden md:table-cell">Workflow</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">RAG</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Technician</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 hidden md:table-cell">Days on Site</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 hidden md:table-cell">Created</th>
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
                      <td className="px-4 py-3 hidden md:table-cell">
                        {(hc as unknown as HealthCheckCard).workflowStatus ? (
                          <WorkflowBadges status={(hc as unknown as HealthCheckCard).workflowStatus!} compact />
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
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
                      <td className="px-4 py-3 hidden md:table-cell">
                        {hc.arrived_at ? (() => {
                          const arrived = new Date(hc.arrived_at)
                          const now = new Date()
                          const diffDays = Math.floor((now.getTime() - arrived.getTime()) / (1000 * 60 * 60 * 24))
                          const colorClass = diffDays > 2 ? 'text-red-600 font-bold' :
                                            diffDays > 1 ? 'text-amber-600 font-medium' :
                                            'text-gray-600'
                          return (
                            <span className={colorClass}>
                              {diffDays} {diffDays === 1 ? 'day' : 'days'}
                            </span>
                          )
                        })() : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm hidden md:table-cell">
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

          {/* Workflow Legend */}
          <div className="mt-4 px-4">
            <WorkflowLegend />
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center sm:justify-between mt-4 gap-2 sm:gap-0">
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
