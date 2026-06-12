import { useState, useMemo, useRef, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import { useBoardData, useNow } from './useBoardData'
import { sortCards, type BoardCard, type BoardData } from './types'
import BoardColumn, { cardsAllocatedHours } from './BoardColumn'
import JobCard, { promiseCountdown } from './JobCard'
import CardDetailPanel from './CardDetailPanel'
import AddColumnModal from './AddColumnModal'

type FixedColumnId = 'due_in' | 'checked_in' | 'work_complete'

function dateForOffset(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

export default function WorkshopBoard() {
  const { user } = useAuth()
  const { session } = useAuth()
  const toast = useToast()
  const now = useNow(30000)

  const [date, setDate] = useState(() => dateForOffset(0))
  const { board, setBoard, loading, error, refresh } = useBoardData(date)

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

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, BoardCard[]>()
    for (const card of filteredCards) {
      const key = card.position === 'column' && card.columnId ? card.columnId : card.position
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(card)
    }
    for (const [key, cards] of map) map.set(key, sortCards(cards))
    return map
  }, [filteredCards])

  const advisors = useMemo(() => {
    if (!board) return []
    const seen = new Map<string, { id: string; name: string }>()
    for (const card of board.cards) {
      if (card.advisor && !seen.has(card.advisor.id)) {
        seen.set(card.advisor.id, {
          id: card.advisor.id,
          name: `${card.advisor.first_name} ${card.advisor.last_name}`
        })
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [board])

  // ---- Header stats -------------------------------------------------------
  const stats = useMemo(() => {
    if (!board) return null
    const techColumns = board.columns.filter(c => c.columnType === 'technician' && c.isVisible)
    let allocated = 0
    let available = 0
    for (const col of techColumns) {
      allocated += cardsAllocatedHours(cardsByColumn.get(col.id) || [])
      available += col.availableHours
    }
    const active = board.cards.filter(c => c.position !== 'work_complete' && c.position !== 'due_in')
    const waiters = active.filter(c => c.customerWaiting).length
    const overdue = active.filter(c => {
      const cd = promiseCountdown(c, now)
      return cd?.tone === 'overdue'
    }).length
    return { allocated, available, waiters, overdue, onSite: active.length }
  }, [board, cardsByColumn, now])

  // ---- Drag and drop ------------------------------------------------------
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
    const currentKey = card.position === 'column' && card.columnId ? card.columnId : card.position
    if (overId === currentKey) return

    let target: 'checked_in' | 'technician' | 'queue' | 'work_complete'
    let columnId: string | undefined
    if (overId === 'checked_in' || overId === 'work_complete') {
      target = overId
    } else if (overId === 'due_in') {
      return // Due In is derived - nothing can be dragged into it
    } else {
      const column = board.columns.find(c => c.id === overId)
      if (!column) return
      target = column.columnType === 'technician' ? 'technician' : 'queue'
      columnId = column.id
    }

    // Optimistic move
    const previous = board
    const optimistic: BoardData = {
      ...board,
      cards: board.cards.map(c =>
        c.healthCheckId === card.healthCheckId
          ? {
              ...c,
              position: target === 'technician' || target === 'queue' ? 'column' : target,
              columnId: columnId ?? null,
              ...(target === 'technician' && columnId
                ? (() => {
                    const col = board.columns.find(x => x.id === columnId)
                    return col?.technician
                      ? { technician: { id: col.technician.id, first_name: col.technician.first_name, last_name: col.technician.last_name } }
                      : {}
                  })()
                : {})
            }
          : c
      )
    }
    setBoard(optimistic)

    try {
      await api(`/api/v1/workshop-board/cards/${card.healthCheckId}/move`, {
        method: 'POST',
        token: session.accessToken,
        body: { target, columnId }
      })
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

  const selectedCard = selectedCardId
    ? board?.cards.find(c => c.healthCheckId === selectedCardId) || null
    : null

  const dateOptions = [
    { label: 'Today', value: dateForOffset(0) },
    { label: 'Tomorrow', value: dateForOffset(1) },
    { label: dateForOffset(2).slice(5), value: dateForOffset(2) }
  ]

  return (
    <div
      ref={boardRef}
      className={`flex flex-col h-full ${tvMode ? 'bg-gray-900 p-4 overflow-auto' : ''}`}
      onDoubleClick={tvMode ? toggleTvMode : undefined}
    >
      {/* Header / toolbar */}
      {tvMode ? (
        <div className="flex items-center justify-between mb-4 text-white">
          <h1 className="text-2xl font-bold">{user?.site?.name || 'Workshop'} — Workshop Board</h1>
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
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Workshop Board</h1>
              <p className="text-sm text-gray-500">Live view of every job in the workshop</p>
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
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-2.5">
                <div className="text-xs text-gray-400">Workshop loading</div>
                <div className="text-lg font-bold text-gray-900">
                  {stats.allocated.toFixed(1)}<span className="text-sm font-normal text-gray-400"> / {stats.available.toFixed(1)} hrs</span>
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
                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                    date === opt.value ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
                  }`}
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

      {/* Board */}
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
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-3 overflow-x-auto pb-4 items-stretch min-h-0">
            {/* Due In */}
            <BoardColumn
              id={'due_in' as FixedColumnId}
              title="Due In"
              subtitle={date === dateForOffset(0) ? 'Expected today' : `Expected ${date}`}
              count={(cardsByColumn.get('due_in') || []).length}
              droppable={false}
              tvMode={tvMode}
            >
              {(cardsByColumn.get('due_in') || []).map(card => (
                <JobCard
                  key={card.healthCheckId}
                  card={card}
                  statuses={board.statuses}
                  now={now}
                  draggable={false}
                  tvMode={tvMode}
                  onClick={() => openCard(card.healthCheckId)}
                />
              ))}
            </BoardColumn>

            {/* Checked In */}
            <BoardColumn
              id={'checked_in' as FixedColumnId}
              title="Checked In"
              subtitle="Awaiting allocation"
              count={(cardsByColumn.get('checked_in') || []).length}
              droppable={canDrag}
              tvMode={tvMode}
            >
              {(cardsByColumn.get('checked_in') || []).map(card => (
                <JobCard
                  key={card.healthCheckId}
                  card={card}
                  statuses={board.statuses}
                  now={now}
                  draggable={canDrag}
                  tvMode={tvMode}
                  onClick={() => openCard(card.healthCheckId)}
                />
              ))}
            </BoardColumn>

            {/* Technician + queue columns */}
            {board.columns.filter(c => c.isVisible).map(column => {
              const columnCards = cardsByColumn.get(column.id) || []
              const isTech = column.columnType === 'technician'
              return (
                <BoardColumn
                  key={column.id}
                  id={column.id}
                  title={column.name}
                  accentColour={isTech ? null : column.colour}
                  capacity={
                    isTech
                      ? { allocated: cardsAllocatedHours(columnCards), available: column.availableHours }
                      : null
                  }
                  isClockedOn={isTech ? columnCards.some(c => c.isClockedOn) : undefined}
                  count={columnCards.length}
                  droppable={canDrag}
                  tvMode={tvMode}
                >
                  {columnCards.map(card => (
                    <JobCard
                      key={card.healthCheckId}
                      card={card}
                      statuses={board.statuses}
                      now={now}
                      draggable={canDrag}
                      tvMode={tvMode}
                      onClick={() => openCard(card.healthCheckId)}
                    />
                  ))}
                </BoardColumn>
              )
            })}

            {/* Work Complete */}
            <BoardColumn
              id={'work_complete' as FixedColumnId}
              title="Work Complete"
              subtitle={`Completed ${date === dateForOffset(0) ? 'today' : date}`}
              count={(cardsByColumn.get('work_complete') || []).length}
              droppable={canDrag}
              tvMode={tvMode}
            >
              {(cardsByColumn.get('work_complete') || []).map(card => (
                <JobCard
                  key={card.healthCheckId}
                  card={card}
                  statuses={board.statuses}
                  now={now}
                  draggable={canDrag}
                  tvMode={tvMode}
                  onClick={() => openCard(card.healthCheckId)}
                />
              ))}
            </BoardColumn>
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
      ) : null}

      {/* Slide-out detail */}
      {selectedCard && board && (
        <CardDetailPanel
          card={selectedCard}
          statuses={board.statuses}
          onClose={() => setSelectedCardId(null)}
          onChanged={() => refresh(true)}
        />
      )}

      {/* Add column */}
      {showAddColumn && board && (
        <AddColumnModal
          siteId={board.siteId}
          existingColumns={board.columns}
          onClose={() => setShowAddColumn(false)}
          onAdded={() => refresh(true)}
        />
      )}
    </div>
  )
}
