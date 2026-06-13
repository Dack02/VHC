import { useState, useMemo, useRef, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, closestCorners, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import { useBoardData, useNow } from './useBoardData'
import { sortCards, type BoardCard, type BoardData } from './types'
import BoardColumn from './BoardColumn'
import JobCard, { promiseCountdown } from './JobCard'
import JobDetailModal from './JobDetailModal'
import AddColumnModal from './AddColumnModal'
import TimelineView from './TimelineView'

type BoardView = 'status' | 'tech'
type TechMode = 'cards' | 'timeline'

const VIEW_KEY = 'vhc-board-view'
const TECH_MODE_KEY = 'vhc-board-tech-mode'

function dateForOffset(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

interface ViewColumn {
  key: string
  title: string
  subtitle?: string
  accent?: string | null
  capacity?: { done: number; active: number; dueIn: number; available: number } | null
  isClockedOn?: boolean
  droppable: boolean
  cards: BoardCard[]
}

const EMPTY_LOAD = { done: 0, active: 0, dueIn: 0 }

export default function WorkshopBoard() {
  const { user, session } = useAuth()
  const toast = useToast()
  const now = useNow(30000)

  const [date, setDate] = useState(() => dateForOffset(0))
  const { board, setBoard, loading, error, refresh } = useBoardData(date)

  const [view, setView] = useState<BoardView>(() => (localStorage.getItem(VIEW_KEY) as BoardView) || 'status')
  const [techMode, setTechMode] = useState<TechMode>(() => (localStorage.getItem(TECH_MODE_KEY) as TechMode) || 'cards')
  const [search, setSearch] = useState('')
  const [advisorFilter, setAdvisorFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [waitingOnly, setWaitingOnly] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [activeDragCard, setActiveDragCard] = useState<BoardCard | null>(null)
  const [tvMode, setTvMode] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  // Browsers fire a click on the card right after a drag ends - suppress it
  const recentDragRef = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const role = user?.role || 'technician'
  const canDrag = ['super_admin', 'org_admin', 'site_admin', 'service_advisor'].includes(role)
  const isTimeline = view === 'tech' && techMode === 'timeline'

  const switchView = (v: BoardView) => {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }
  const switchTechMode = (m: TechMode) => {
    setTechMode(m)
    localStorage.setItem(TECH_MODE_KEY, m)
  }

  // ---- Filtering ----------------------------------------------------------
  const filteredCards = useMemo(() => {
    if (!board) return []
    const query = search.trim().toLowerCase()
    return board.cards.filter(card => {
      if (waitingOnly && !card.customerWaiting) return false
      if (advisorFilter && card.advisor?.id !== advisorFilter) return false
      if (statusFilter && card.workshopStatusId !== statusFilter) return false
      if (query) {
        const haystack = [
          card.vehicle?.registration,
          card.customer?.first_name,
          card.customer?.last_name,
          card.jobsheetNumber,
          card.jobNumber
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [board, search, advisorFilter, statusFilter, waitingOnly])

  const queueNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const col of board?.columns || []) {
      if (col.columnType === 'queue') map.set(col.id, col.name)
    }
    return map
  }, [board?.columns])

  const techColumnByUserId = useMemo(() => {
    const map = new Map<string, string>()
    for (const col of board?.columns || []) {
      if (col.columnType === 'technician' && col.technicianId) map.set(col.technicianId, col.id)
    }
    return map
  }, [board?.columns])

  // Per-technician load for the selected date. Computed from the full card
  // set (not the filtered view) so the bar always reflects the tech's real
  // day: completed jobs stay counted - finishing a job consumes the day's
  // hours rather than freeing them - and pre-allocated Due In bookings count
  // towards the day they're expected.
  const techLoadByUserId = useMemo(() => {
    const map = new Map<string, { done: number; active: number; dueIn: number }>()
    for (const card of board?.cards || []) {
      const techId = card.technician?.id
      if (!techId) continue
      const hours = card.estimatedHours ?? 0
      const load = map.get(techId) || { done: 0, active: 0, dueIn: 0 }
      if (card.position === 'work_complete') load.done += hours
      else if (card.position === 'due_in') load.dueIn += hours
      else load.active += hours
      map.set(techId, load)
    }
    return map
  }, [board?.cards])

  // ---- View column assembly ----------------------------------------------
  const viewColumns: ViewColumn[] = useMemo(() => {
    if (!board) return []
    const visible = board.columns.filter(c => c.isVisible)
    const queueCols = visible.filter(c => c.columnType === 'queue')
    const techCols = visible.filter(c => c.columnType === 'technician')

    const buckets = new Map<string, BoardCard[]>()
    const push = (key: string, card: BoardCard) => {
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(card)
    }

    if (view === 'status') {
      // Due In → Checked In → In Workshop → queue columns → Work Complete
      for (const card of filteredCards) {
        if (card.position === 'due_in') push('due_in', card)
        else if (card.position === 'work_complete') push('work_complete', card)
        else if (card.position === 'column' && card.columnId && queueNameById.has(card.columnId)) push(card.columnId, card)
        else if (card.position === 'in_workshop' || card.technician) push('in_workshop', card)
        else push('checked_in', card)
      }
      return [
        { key: 'due_in', title: 'Due In', subtitle: date === dateForOffset(0) ? 'Expected today' : `Expected ${date}`, droppable: false, cards: sortCards(buckets.get('due_in') || []) },
        { key: 'checked_in', title: 'Checked In', subtitle: 'Awaiting allocation', droppable: false, cards: sortCards(buckets.get('checked_in') || []) },
        { key: 'in_workshop', title: 'In Workshop', subtitle: 'With technicians', droppable: canDrag, cards: sortCards(buckets.get('in_workshop') || []) },
        ...queueCols.map(col => ({
          key: col.id,
          title: col.name,
          accent: col.colour,
          droppable: canDrag,
          cards: sortCards(buckets.get(col.id) || [])
        })),
        { key: 'work_complete', title: 'Work Complete', subtitle: 'Awaiting collection', droppable: canDrag, cards: sortCards(buckets.get('work_complete') || []) }
      ]
    }

    // Technician view (cards): Checked In → tech columns → Work Complete.
    // A job parked in a queue stays visible in its technician's column.
    for (const card of filteredCards) {
      if (card.position === 'due_in') continue
      if (card.position === 'work_complete') push('work_complete', card)
      else if (card.technician && techColumnByUserId.has(card.technician.id)) push(techColumnByUserId.get(card.technician.id)!, card)
      else push('checked_in', card)
    }
    return [
      { key: 'checked_in', title: 'Checked In', subtitle: 'Awaiting allocation', droppable: canDrag, cards: sortCards(buckets.get('checked_in') || []) },
      ...techCols.map(col => {
        const cards = sortCards(buckets.get(col.id) || [])
        const load = (col.technicianId && techLoadByUserId.get(col.technicianId)) || EMPTY_LOAD
        return {
          key: col.id,
          title: col.name,
          capacity: { ...load, available: col.availableHours },
          isClockedOn: cards.some(c => c.isClockedOn),
          droppable: canDrag,
          cards
        }
      }),
      { key: 'work_complete', title: 'Work Complete', subtitle: 'Awaiting collection', droppable: canDrag, cards: sortCards(buckets.get('work_complete') || []) }
    ]
  }, [board, filteredCards, view, queueNameById, techColumnByUserId, techLoadByUserId, canDrag, date])

  const advisors = useMemo(() => {
    if (!board) return []
    const seen = new Map<string, { id: string; name: string }>()
    for (const card of board.cards) {
      if (card.advisor && !seen.has(card.advisor.id)) {
        seen.set(card.advisor.id, { id: card.advisor.id, name: `${card.advisor.first_name} ${card.advisor.last_name}` })
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [board])

  // ---- Header stats -------------------------------------------------------
  const stats = useMemo(() => {
    if (!board) return null
    const techCols = board.columns.filter(c => c.columnType === 'technician' && c.isVisible)
    let booked = 0
    let done = 0
    let available = 0
    for (const col of techCols) {
      const load = (col.technicianId && techLoadByUserId.get(col.technicianId)) || EMPTY_LOAD
      booked += load.done + load.active + load.dueIn
      done += load.done
      available += col.availableHours
    }
    const active = board.cards.filter(c => c.position !== 'work_complete' && c.position !== 'due_in')
    const waiters = active.filter(c => c.customerWaiting).length
    const overdue = active.filter(c => promiseCountdown(c, now)?.tone === 'overdue').length
    return { booked, done, available, waiters, overdue, onSite: active.length }
  }, [board, techLoadByUserId, now])

  // ---- Drag and drop (kanban views) ---------------------------------------
  const handleDragStart = (event: DragStartEvent) => {
    recentDragRef.current = true
    const card = board?.cards.find(c => c.healthCheckId === event.active.id)
    setActiveDragCard(card || null)
  }

  const openCard = (healthCheckId: string) => {
    if (recentDragRef.current) return
    setSelectedCardId(healthCheckId)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragCard(null)
    setTimeout(() => { recentDragRef.current = false }, 100)
    const { active, over } = event
    if (!over || !board || !session?.accessToken) return

    const card = board.cards.find(c => c.healthCheckId === active.id)
    if (!card) return

    const overId = over.id as string
    // The drop target is either another card (sortable) or a column body
    const overCard = overId !== card.healthCheckId ? board.cards.find(c => c.healthCheckId === overId) || null : null
    const sourceCol = viewColumns.find(vc => vc.cards.some(c => c.healthCheckId === card.healthCheckId))
    const targetCol = overCard
      ? viewColumns.find(vc => vc.cards.some(c => c.healthCheckId === overCard.healthCheckId))
      : viewColumns.find(vc => vc.key === overId)
    if (!sourceCol || !targetCol) return

    // Dropped onto a card in the same column: set the manual work order
    if (overCard && targetCol.key === sourceCol.key) {
      const oldIndex = sourceCol.cards.findIndex(c => c.healthCheckId === card.healthCheckId)
      const newIndex = sourceCol.cards.findIndex(c => c.healthCheckId === overCard.healthCheckId)
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      const positions = arrayMove(sourceCol.cards, oldIndex, newIndex)
        .map((c, i) => ({ healthCheckId: c.healthCheckId, sortPosition: (i + 1) * 10 }))

      const previous = board
      const posById = new Map(positions.map(p => [p.healthCheckId, p.sortPosition]))
      setBoard({
        ...board,
        cards: board.cards.map(c =>
          posById.has(c.healthCheckId) ? { ...c, sortPosition: posById.get(c.healthCheckId)! } : c
        )
      })
      try {
        await api('/api/v1/workshop-board/cards/reorder', {
          method: 'POST',
          token: session.accessToken,
          body: { positions }
        })
      } catch (err) {
        setBoard(previous)
        toast.error(err instanceof Error ? err.message : 'Could not reorder jobs')
      }
      return
    }

    if (!targetCol.droppable) return
    if (targetCol.key === sourceCol.key && !overCard && card.position !== 'column') return

    let target: 'checked_in' | 'technician' | 'queue' | 'work_complete' | 'workshop'
    let columnId: string | undefined

    if (view === 'status') {
      if (targetCol.key === 'work_complete') target = 'work_complete'
      else if (targetCol.key === 'in_workshop') target = 'workshop'
      else if (queueNameById.has(targetCol.key)) {
        target = 'queue'
        columnId = targetCol.key
      } else return
    } else {
      if (targetCol.key === 'work_complete') target = 'work_complete'
      else if (targetCol.key === 'checked_in') target = 'checked_in'
      else {
        const column = board.columns.find(c => c.id === targetCol.key && c.columnType === 'technician')
        if (!column) return
        target = 'technician'
        columnId = column.id
      }
    }

    // Dropped onto a card in another column: land exactly there, renumbering
    // the target column. Dropped onto the column body: clear any manual
    // position so the auto rules (waiters, priority, promise time) place it.
    let movedPosition = 0
    let positions: Array<{ healthCheckId: string; sortPosition: number }> = []
    if (overCard) {
      const insertIndex = targetCol.cards.findIndex(c => c.healthCheckId === overCard.healthCheckId)
      const newOrder = targetCol.cards.filter(c => c.healthCheckId !== card.healthCheckId)
      newOrder.splice(insertIndex < 0 ? newOrder.length : insertIndex, 0, card)
      positions = newOrder.map((c, i) => ({ healthCheckId: c.healthCheckId, sortPosition: (i + 1) * 10 }))
      movedPosition = positions.find(p => p.healthCheckId === card.healthCheckId)!.sortPosition
    }
    const posById = new Map(positions.map(p => [p.healthCheckId, p.sortPosition]))

    // Optimistic update: placement + order
    const previous = board
    const optimistic: BoardData = {
      ...board,
      cards: board.cards.map(c => {
        const sortPosition = posById.get(c.healthCheckId) ?? (c.healthCheckId === card.healthCheckId ? 0 : c.sortPosition)
        if (c.healthCheckId !== card.healthCheckId) {
          return sortPosition !== c.sortPosition ? { ...c, sortPosition } : c
        }
        if (target === 'queue') return { ...c, sortPosition, position: 'column', columnId: columnId! }
        if (target === 'work_complete') return { ...c, sortPosition, position: 'work_complete', columnId: null }
        if (target === 'checked_in') return { ...c, sortPosition, position: 'checked_in', columnId: null, technician: null }
        if (target === 'technician') {
          const col = board.columns.find(x => x.id === columnId)
          return {
            ...c,
            sortPosition,
            position: 'column',
            columnId: columnId!,
            technician: col?.technician ? { id: col.technician.id, first_name: col.technician.first_name, last_name: col.technician.last_name } : c.technician
          }
        }
        // workshop: back to derived tech column / checked in
        const techColId = c.technician ? techColumnByUserId.get(c.technician.id) : undefined
        return techColId
          ? { ...c, sortPosition, position: 'column', columnId: techColId }
          : { ...c, sortPosition, position: 'checked_in', columnId: null }
      })
    }
    setBoard(optimistic)

    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}/move`, {
        method: 'POST',
        token: session.accessToken,
        body: { target, columnId, sortPosition: movedPosition }
      })
      // Renumber the rest of the target column so the drop slot sticks
      const neighbourPositions = positions.filter(p => p.healthCheckId !== card.healthCheckId)
      if (neighbourPositions.length > 0) {
        await api('/api/v1/workshop-board/cards/reorder', {
          method: 'POST',
          token: session.accessToken,
          body: { positions: neighbourPositions }
        })
      }
    } catch (err) {
      setBoard(previous)
      toast.error(err instanceof Error ? err.message : 'Could not move card')
    }
  }

  // ---- TV mode ------------------------------------------------------------
  const toggleTvMode = useCallback(() => {
    if (!tvMode) {
      boardRef.current?.requestFullscreen?.().catch(() => {})
      setTvMode(true)
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      setTvMode(false)
    }
  }, [tvMode])

  // ---- Render -------------------------------------------------------------
  if (!user?.site?.id && !loading && !board) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
        Your user has no site assigned - the workshop board is per-site. Ask an admin to assign you to a site.
      </div>
    )
  }

  const selectedCard = selectedCardId ? board?.cards.find(c => c.healthCheckId === selectedCardId) || null : null

  const dateOptions = [
    { label: 'Today', value: dateForOffset(0) },
    { label: 'Tomorrow', value: dateForOffset(1) },
    { label: dateForOffset(2).slice(5), value: dateForOffset(2) }
  ]

  const viewSwitcher = (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => switchView('status')}
        className={`px-3 py-1.5 text-sm font-medium rounded-md ${view === 'status' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
      >
        Job Status
      </button>
      <button
        onClick={() => switchView('tech')}
        className={`px-3 py-1.5 text-sm font-medium rounded-md ${view === 'tech' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
      >
        Technicians
      </button>
    </div>
  )

  return (
    <div
      ref={boardRef}
      className={`flex flex-col h-full ${tvMode ? 'bg-gray-900 p-4 overflow-auto' : ''}`}
      onDoubleClick={tvMode ? toggleTvMode : undefined}
    >
      {/* Header / toolbar */}
      {tvMode ? (
        <div className="flex items-center justify-between mb-4 text-white">
          <h1 className="text-2xl font-bold">{user?.site?.name || 'Workshop'} — {view === 'status' ? 'Job Status' : 'Technicians'}</h1>
          <div className="flex items-center gap-6">
            {stats && (
              <span className="text-lg text-gray-300">
                {stats.onSite} on site · {stats.waiters} waiting · {stats.overdue} overdue
              </span>
            )}
            <span className="text-2xl font-mono">
              {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Workshop Board</h1>
                <p className="text-sm text-gray-500">Live view of every job in the workshop</p>
              </div>
              {viewSwitcher}
              {view === 'tech' && (
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => switchTechMode('cards')}
                    className={`px-2.5 py-1.5 text-sm font-medium rounded-md ${techMode === 'cards' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                    title="Card columns"
                  >
                    ▦ Cards
                  </button>
                  <button
                    onClick={() => switchTechMode('timeline')}
                    className={`px-2.5 py-1.5 text-sm font-medium rounded-md ${techMode === 'timeline' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                    title="Day planner timeline"
                  >
                    ☰ Timeline
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canDrag && (
                <button
                  onClick={() => setShowAddColumn(true)}
                  className="px-3 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
                >
                  + Add column
                </button>
              )}
              <button
                onClick={toggleTvMode}
                className="px-3 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800"
                title="Full-screen wallboard for a workshop TV"
              >
                📺 TV mode
              </button>
            </div>
          </div>

          {/* Stats strip */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5">
                <div className="text-xs text-gray-400">On site</div>
                <div className="text-lg font-bold text-gray-900">{stats.onSite}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5" title="Estimated hours booked across technicians today, including completed work">
                <div className="text-xs text-gray-400">Workshop loading</div>
                <div className="text-lg font-bold text-gray-900">
                  {stats.booked.toFixed(1)}<span className="text-sm font-normal text-gray-400"> / {stats.available.toFixed(1)} hrs{stats.done > 0 ? ` · ${stats.done.toFixed(1)} done` : ''}</span>
                </div>
              </div>
              <div className={`border rounded-xl px-4 py-2.5 ${stats.waiters > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <div className="text-xs text-gray-400">Customers waiting</div>
                <div className={`text-lg font-bold ${stats.waiters > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.waiters}</div>
              </div>
              <div className={`border rounded-xl px-4 py-2.5 ${stats.overdue > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <div className="text-xs text-gray-400">Past promise time</div>
                <div className={`text-lg font-bold ${stats.overdue > 0 ? 'text-amber-600' : 'text-gray-900'}`}>{stats.overdue}</div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {dateOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDate(opt.value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${date === opt.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reg, customer, jobsheet…"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <select
              value={advisorFilter}
              onChange={e => setAdvisorFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All advisors</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All statuses</option>
              {board?.statuses.filter(s => s.isActive).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={waitingOnly}
                onChange={e => setWaitingOnly(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              Waiting only
            </label>
          </div>
        </div>
      )}

      {/* Board body */}
      {loading && !board ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : error && !board ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600 mb-3">{error}</p>
          <button onClick={() => refresh()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">
            Retry
          </button>
        </div>
      ) : board ? (
        isTimeline ? (
          <TimelineView
            board={board}
            cards={filteredCards}
            date={date}
            now={now}
            canDrag={canDrag}
            onOpenCard={setSelectedCardId}
            refresh={refresh}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex-1 flex gap-3 overflow-x-auto pb-4 items-stretch min-h-0">
              {viewColumns.map(col => (
                <BoardColumn
                  key={col.key}
                  id={col.key}
                  title={col.title}
                  subtitle={col.subtitle}
                  accentColour={col.accent}
                  capacity={col.capacity}
                  isClockedOn={col.isClockedOn}
                  count={col.cards.length}
                  droppable={col.droppable}
                  tvMode={tvMode}
                >
                  <SortableContext items={col.cards.map(c => c.healthCheckId)} strategy={verticalListSortingStrategy}>
                    {col.cards.map(card => (
                      <JobCard
                        key={card.healthCheckId}
                        card={card}
                        statuses={board.statuses}
                        now={now}
                        draggable={canDrag && card.position !== 'due_in'}
                        tvMode={tvMode}
                        showTechChip={view === 'status'}
                        queueChipName={
                          view === 'tech' && card.position === 'column' && card.columnId
                            ? queueNameById.get(card.columnId) || null
                            : null
                        }
                        onClick={() => openCard(card.healthCheckId)}
                      />
                    ))}
                  </SortableContext>
                </BoardColumn>
              ))}
            </div>

            <DragOverlay>
              {activeDragCard && (
                <div className="rotate-2 opacity-95 w-64">
                  <JobCard
                    card={activeDragCard}
                    statuses={board.statuses}
                    now={now}
                    draggable={false}
                    tvMode={tvMode}
                    onClick={() => {}}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )
      ) : null}

      {/* Job detail modal */}
      {selectedCard && board && (
        <JobDetailModal
          card={selectedCard}
          statuses={board.statuses}
          columns={board.columns}
          boardDate={board.date}
          onClose={() => setSelectedCardId(null)}
          onChanged={() => refresh(true)}
        />
      )}

      {/* Add column */}
      {showAddColumn && board && (
        <AddColumnModal
          siteId={board.siteId}
          existingColumns={board.columns}
          initialTab={view === 'status' ? 'queue' : 'technician'}
          onClose={() => setShowAddColumn(false)}
          onAdded={() => refresh(true)}
        />
      )}
    </div>
  )
}
