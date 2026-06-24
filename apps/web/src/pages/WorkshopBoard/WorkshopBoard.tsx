import { useState, useMemo, useRef, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, MeasuringStrategy, closestCorners, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { moveCard, reorderCards, type MoveTarget, type SortPositionUpdate } from './boardActions'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
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

// Which view-column does an id belong to? An id is either a card's
// healthCheckId (→ the column holding it) or a column key itself.
function findContainerKey(viewColumns: ViewColumn[], id: string): string | null {
  if (viewColumns.some(vc => vc.key === id)) return id
  const col = viewColumns.find(vc => vc.cards.some(c => c.healthCheckId === id))
  return col?.key ?? null
}

// Translate a target column key into the move target + optional columnId, or
// null when the column isn't a real move destination (e.g. Due In / Checked In
// in the status view). View-aware: the same key means different things per view.
function resolveTarget(
  view: BoardView,
  board: BoardData,
  colKey: string,
  queueNameById: Map<string, string>
): { target: MoveTarget; columnId?: string } | null {
  if (view === 'status') {
    if (colKey === 'work_complete') return { target: 'work_complete' }
    if (colKey === 'in_workshop') return { target: 'workshop' }
    if (queueNameById.has(colKey)) return { target: 'queue', columnId: colKey }
    return null
  }
  if (colKey === 'work_complete') return { target: 'work_complete' }
  if (colKey === 'checked_in') return { target: 'checked_in' }
  const col = board.columns.find(c => c.id === colKey && c.columnType === 'technician')
  if (col) return { target: 'technician', columnId: col.id }
  return null
}

// Is moving this card to `target` legal? Mirrors the backend guards so we never
// preview or commit a move the server will reject.
function canDropCard(card: BoardCard, target: { target: MoveTarget }): boolean {
  // Due In bookings can only be pre-allocated to a technician (kept due_in by
  // the backend); never pushed into the workshop flow before they arrive.
  if (card.position === 'due_in') return target.target === 'technician'
  // A checked-in-but-not-arrived booking can't be assigned (CHECKIN_REQUIRED).
  if (card.status === 'awaiting_checkin' && target.target === 'technician') return false
  // A clocked-on / in-progress job may be re-ordered but not unassigned or
  // completed out from under the technician working it.
  const locked = card.isClockedOn || card.status === 'in_progress'
  if (locked && (target.target === 'checked_in' || target.target === 'work_complete')) return false
  return true
}

// The card-field patch that visually lands a card in a resolved target column,
// used for the live cross-column drag preview. Only the fields the column
// bucketing reads need to change; jobState is left intact so a pre-allocated
// Due In booking keeps its "Due In" badge while being dragged onto a tech.
function previewPatch(
  card: BoardCard,
  resolved: { target: MoveTarget; columnId?: string },
  board: BoardData
): Partial<BoardCard> {
  switch (resolved.target) {
    case 'queue':
      return { position: 'column', columnId: resolved.columnId! }
    case 'work_complete':
      return { position: 'work_complete', columnId: null }
    case 'checked_in':
      return { position: 'checked_in', columnId: null, technician: null }
    case 'workshop':
      return { position: 'in_workshop', columnId: null }
    case 'technician': {
      const col = board.columns.find(c => c.id === resolved.columnId)
      const technician = col?.technician
        ? { id: col.technician.id, first_name: col.technician.first_name, last_name: col.technician.last_name }
        : card.technician
      return { position: 'column', columnId: resolved.columnId!, technician }
    }
  }
}

// True when the card already reflects the preview patch (so onDragOver can bail
// without producing a new board object - this is what stops drag thrash).
function matchesPreview(card: BoardCard, patch: Partial<BoardCard>): boolean {
  return (Object.keys(patch) as (keyof BoardCard)[]).every(k => {
    if (k === 'technician') return (card.technician?.id ?? null) === (patch.technician?.id ?? null)
    return card[k] === patch[k]
  })
}

export default function WorkshopBoard() {
  const { user, session } = useAuth()
  const toast = useToast()
  const now = useNow(30000)

  const [date, setDate] = useState(() => dateForOffset(0))
  const { board, setBoard, loading, error, refresh, setPaused } = useBoardData(date)

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
  // Pristine board captured at drag start - the rollback point if a move fails
  // (the live board carries the optimistic cross-column preview by then).
  const dragSnapshotRef = useRef<BoardData | null>(null)
  // The card's column at drag start, so the commit can tell a same-column
  // reorder from a cross-column move even after the preview moved the card.
  const dragOriginColRef = useRef<string | null>(null)

  // Mouse keeps the instant 6px lift; touch needs a long-press so a tap still
  // opens the card and a swipe still scrolls the column (tablets/TVs); keyboard
  // gives the sortable cards accessible drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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
          card.jobsheetReference,
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
      if (card.position === 'due_in') {
        // Pre-allocated bookings ride in their technician's column (re-allocate
        // by drag); unassigned Due In has no home here - plan it on the timeline.
        if (card.technician && techColumnByUserId.has(card.technician.id)) push(techColumnByUserId.get(card.technician.id)!, card)
        continue
      }
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
    setPaused(true)
    dragSnapshotRef.current = board
    dragOriginColRef.current = findContainerKey(viewColumns, event.active.id as string)
    const card = board?.cards.find(c => c.healthCheckId === event.active.id)
    setActiveDragCard(card || null)
  }

  const openCard = (healthCheckId: string) => {
    if (recentDragRef.current) return
    setSelectedCardId(healthCheckId)
  }

  // Live cross-column preview: while the card hovers a different, legal column,
  // move it there in local state so the board makes room under the cursor. The
  // idempotence guard returns the same board reference when nothing changed,
  // which is what stops the continuous onDragOver firing from thrashing.
  const handleDragOver = (event: DragOverEvent) => {
    if (!board) return
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    if (activeId === overId) return
    const activeCol = findContainerKey(viewColumns, activeId)
    const overCol = findContainerKey(viewColumns, overId)
    if (!activeCol || !overCol || activeCol === overCol) return
    const targetCol = viewColumns.find(vc => vc.key === overCol)
    if (!targetCol?.droppable) return
    const card = board.cards.find(c => c.healthCheckId === activeId)
    if (!card) return
    const resolved = resolveTarget(view, board, overCol, queueNameById)
    if (!resolved || !canDropCard(card, resolved)) return
    const patch = previewPatch(card, resolved, board)
    setBoard(prev => {
      if (!prev) return prev
      const cur = prev.cards.find(c => c.healthCheckId === activeId)
      if (!cur || matchesPreview(cur, patch)) return prev
      return { ...prev, cards: prev.cards.map(c => (c.healthCheckId === activeId ? { ...c, ...patch } : c)) }
    })
  }

  const handleDragCancel = () => {
    setActiveDragCard(null)
    setTimeout(() => { recentDragRef.current = false }, 150)
    if (dragSnapshotRef.current) setBoard(dragSnapshotRef.current)
    dragSnapshotRef.current = null
    dragOriginColRef.current = null
    setPaused(false)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragCard(null)
    setTimeout(() => { recentDragRef.current = false }, 150)
    const snapshot = dragSnapshotRef.current
    const originCol = dragOriginColRef.current
    dragSnapshotRef.current = null
    dragOriginColRef.current = null
    try {
      const { active, over } = event
      if (!over || !board || !session?.accessToken) {
        if (snapshot) setBoard(snapshot)
        return
      }
      const card = board.cards.find(c => c.healthCheckId === active.id)
      if (!card) { if (snapshot) setBoard(snapshot); return }

      const overId = over.id as string
      // The drop target is either another card (sortable) or a column body
      const overCard = overId !== card.healthCheckId ? board.cards.find(c => c.healthCheckId === overId) || null : null
      const targetKey = findContainerKey(viewColumns, overId)
      const targetCol = targetKey ? viewColumns.find(vc => vc.key === targetKey) : null
      if (!targetCol) { if (snapshot) setBoard(snapshot); return }

      // Same original column → set the manual work order only (restore any
      // mid-drag preview if the drop doesn't actually reorder anything)
      if (originCol && targetCol.key === originCol) {
        if (!overCard) { if (snapshot) setBoard(snapshot); return }
        const oldIndex = targetCol.cards.findIndex(c => c.healthCheckId === card.healthCheckId)
        const newIndex = targetCol.cards.findIndex(c => c.healthCheckId === overCard.healthCheckId)
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) { if (snapshot) setBoard(snapshot); return }
        const positions = arrayMove(targetCol.cards, oldIndex, newIndex)
          .map((c, i) => ({ healthCheckId: c.healthCheckId, sortPosition: (i + 1) * 10 }))
        const posById = new Map(positions.map(p => [p.healthCheckId, p.sortPosition]))
        setBoard({
          ...board,
          cards: board.cards.map(c => (posById.has(c.healthCheckId) ? { ...c, sortPosition: posById.get(c.healthCheckId)! } : c))
        })
        try {
          await reorderCards(session.accessToken, positions)
        } catch (err) {
          if (snapshot) setBoard(snapshot)
          toast.error(err instanceof Error ? err.message : 'Could not reorder jobs')
        }
        return
      }

      // Cross-column move
      if (!targetCol.droppable) { if (snapshot) setBoard(snapshot); return }
      const resolved = resolveTarget(view, board, targetCol.key, queueNameById)
      if (!resolved) { if (snapshot) setBoard(snapshot); return }
      if (!canDropCard(card, resolved)) {
        if (snapshot) setBoard(snapshot)
        toast.error('That job can’t be moved there')
        return
      }
      const { target, columnId } = resolved

      // Dropped onto a card in another column: land exactly there, renumbering
      // the target column. Dropped onto the column body: clear any manual
      // position so the auto rules (waiters, priority, promise time) place it.
      let movedPosition = 0
      let positions: SortPositionUpdate[] = []
      if (overCard) {
        const insertIndex = targetCol.cards.findIndex(c => c.healthCheckId === overCard.healthCheckId)
        const newOrder = targetCol.cards.filter(c => c.healthCheckId !== card.healthCheckId)
        newOrder.splice(insertIndex < 0 ? newOrder.length : insertIndex, 0, card)
        positions = newOrder.map((c, i) => ({ healthCheckId: c.healthCheckId, sortPosition: (i + 1) * 10 }))
        movedPosition = positions.find(p => p.healthCheckId === card.healthCheckId)!.sortPosition
      }
      const posById = new Map(positions.map(p => [p.healthCheckId, p.sortPosition]))

      // Optimistic update: placement + order (the preview already moved the
      // card; this re-asserts its fields and the surrounding sort order)
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

      // The move carries the moved card's own slot, so a failed neighbour
      // renumber leaves the move correct - re-pull instead of reverting it.
      try {
        await moveCard(session.accessToken, card.healthCheckId, { target, columnId, sortPosition: movedPosition })
      } catch (err) {
        if (snapshot) setBoard(snapshot)
        toast.error(err instanceof Error ? err.message : 'Could not move card')
        return
      }
      const neighbourPositions = positions.filter(p => p.healthCheckId !== card.healthCheckId)
      if (neighbourPositions.length > 0) {
        try {
          await reorderCards(session.accessToken, neighbourPositions)
        } catch {
          toast.error('Moved, but couldn’t save the new order — refreshing')
          refresh(true)
        }
      }
    } finally {
      setPaused(false)
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

  // Drop affordance for a column while a card is being dragged: 'blocked' when
  // the move is illegal (red, not-allowed), 'ok' when legal, null otherwise.
  const columnDropState = (colKey: string): 'ok' | 'blocked' | null => {
    if (!activeDragCard || !board || dragOriginColRef.current === colKey) return null
    const col = viewColumns.find(vc => vc.key === colKey)
    if (!col?.droppable) return null
    const resolved = resolveTarget(view, board, colKey, queueNameById)
    if (!resolved) return null
    return canDropCard(activeDragCard, resolved) ? 'ok' : 'blocked'
  }

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
            onDragActive={setPaused}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            autoScroll={{ threshold: { x: 0.2, y: 0.2 } }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
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
                  dropState={columnDropState(col.key)}
                  tvMode={tvMode}
                >
                  <SortableContext items={col.cards.map(c => c.healthCheckId)} strategy={verticalListSortingStrategy}>
                    {col.cards.map(card => (
                      <JobCard
                        key={card.healthCheckId}
                        card={card}
                        statuses={board.statuses}
                        now={now}
                        draggable={canDrag && (view === 'tech' || card.position !== 'due_in')}
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
                <div className="rotate-2 opacity-95 w-64 scale-105 drop-shadow-xl cursor-grabbing">
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
