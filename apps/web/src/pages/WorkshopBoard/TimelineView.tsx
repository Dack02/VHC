import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import type { BoardCard, BoardData } from './types'
import { timeToMinutes, actualWorkedMinutes } from './types'
import { promiseCountdown } from './JobCard'

const PX_PER_MIN = 88 / 60 // 88px per hour
const SNAP_MIN = 15
const MIN_BLOCK_PX = 44

interface TimelineViewProps {
  board: BoardData
  cards: BoardCard[] // pre-filtered by the toolbar
  date: string
  now: Date
  canDrag: boolean
  onOpenCard: (healthCheckId: string) => void
  refresh: (silent?: boolean) => void
}

interface PlacedBlock {
  card: BoardCard
  startMin: number // minutes since midnight
  durationMin: number
  hasEstimate: boolean
  subCol: number
  subColCount: number
}

function minutesOf(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function fmtMin(totalMin: number): string {
  const h = Math.floor(totalMin / 60) % 24
  const m = Math.round(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fmtHours(hours: number): string {
  return `${Math.round(hours * 100) / 100}h`
}

// Greedy interval sub-column assignment so overlapping blocks sit side by side
function layoutLane(blocks: Omit<PlacedBlock, 'subCol' | 'subColCount'>[]): PlacedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin)
  const colEnds: number[] = []
  const placed: PlacedBlock[] = sorted.map(b => {
    let col = colEnds.findIndex(end => end <= b.startMin)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(0)
    }
    colEnds[col] = b.startMin + b.durationMin
    return { ...b, subCol: col, subColCount: 1 }
  })
  const count = Math.max(1, colEnds.length)
  return placed.map(b => ({ ...b, subColCount: count }))
}

export default function TimelineView({ board, cards, date, now, canDrag, onOpenCard, refresh }: TimelineViewProps) {
  const { session } = useAuth()
  const toast = useToast()
  const token = session?.accessToken

  const scrollRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const recentDragRef = useRef(false)
  const [activeDragCard, setActiveDragCard] = useState<BoardCard | null>(null)
  const [resizing, setResizing] = useState<{ id: string; hours: number } | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const dayStartMin = timeToMinutes(board.config.dayStartTime)
  const dayEndMin = timeToMinutes(board.config.dayEndTime)
  const gridHeight = Math.max(60, (dayEndMin - dayStartMin) * PX_PER_MIN)
  const isToday = date === new Date().toISOString().split('T')[0]
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMin - dayStartMin) * PX_PER_MIN

  const techColumns = board.columns.filter(c => c.columnType === 'technician' && c.isVisible)
  const queueNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const col of board.columns) if (col.columnType === 'queue') map.set(col.id, col.name)
    return map
  }, [board.columns])

  // Planned blocks per technician for the selected date
  const lanes = useMemo(() => {
    const byTech = new Map<string, Omit<PlacedBlock, 'subCol' | 'subColCount'>[]>()
    for (const card of cards) {
      if (!card.plannedStartAt || !card.technician) continue
      const planned = new Date(card.plannedStartAt)
      if (planned.toISOString().split('T')[0] !== date && planned.toDateString() !== new Date(`${date}T12:00:00`).toDateString()) continue
      const estH = card.estimatedHours ?? 1
      const block = {
        card,
        startMin: minutesOf(card.plannedStartAt),
        durationMin: Math.max(estH * 60, SNAP_MIN),
        hasEstimate: card.estimatedHours != null
      }
      const list = byTech.get(card.technician.id) || []
      list.push(block)
      byTech.set(card.technician.id, list)
    }
    const result = new Map<string, PlacedBlock[]>()
    for (const [techId, blocks] of byTech) result.set(techId, layoutLane(blocks))
    return result
  }, [cards, date])

  // Unscheduled tray: active jobs with no planned slot on this date
  const tray = useMemo(() => {
    const items = cards.filter(card => {
      if (card.position === 'work_complete' || card.status === 'completed') return false
      if (card.plannedStartAt) {
        const sameDay = new Date(card.plannedStartAt).toDateString() === new Date(`${date}T12:00:00`).toDateString()
        if (sameDay) return false // already on the grid
      }
      return true
    })
    const sortKey = (c: BoardCard) => c.promiseTime || c.dueDate || '9999'
    return {
      unassigned: items.filter(c => !c.technician).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      assigned: items.filter(c => !!c.technician).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    }
  }, [cards, date])

  // Auto-scroll so the now line sits in the upper third (today only)
  useEffect(() => {
    if (isToday && scrollRef.current && nowTop > 0) {
      scrollRef.current.scrollTop = Math.max(0, nowTop - scrollRef.current.clientHeight / 3)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, date])

  const patchCard = useCallback(async (healthCheckId: string, body: Record<string, unknown>) => {
    if (!token) return false
    try {
      await api(`/api/v1/workshop-board/cards/${healthCheckId}`, { method: 'PATCH', token, body })
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
      return false
    }
  }, [token, toast])

  const moveToTech = useCallback(async (healthCheckId: string, columnId: string) => {
    if (!token) return false
    try {
      await api(`/api/v1/workshop-board/cards/${healthCheckId}/move`, {
        method: 'POST',
        token,
        body: { target: 'technician', columnId }
      })
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign technician')
      return false
    }
  }, [token, toast])

  const handleDragStart = (event: DragStartEvent) => {
    recentDragRef.current = true
    const card = cards.find(c => c.healthCheckId === event.active.id)
    setActiveDragCard(card || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragCard(null)
    setTimeout(() => { recentDragRef.current = false }, 100)
    const { active, over } = event
    if (!over || !canDrag) return

    const card = cards.find(c => c.healthCheckId === active.id)
    if (!card) return

    const overId = over.id as string

    // Drop back on the tray = unschedule
    if (overId === 'timeline_tray') {
      if (card.plannedStartAt) {
        const ok = await patchCard(card.healthCheckId, { plannedStartAt: null })
        if (ok) refresh(true)
      }
      return
    }

    const lane = techColumns.find(c => c.id === overId)
    if (!lane?.technicianId) return

    // Compute the snapped drop time from the dragged element's top edge
    const laneEl = laneRefs.current[lane.id]
    const translatedTop = active.rect.current.translated?.top
    if (!laneEl || translatedTop == null) return
    const laneTop = laneEl.getBoundingClientRect().top
    const offsetPx = translatedTop - laneTop
    let startMin = dayStartMin + offsetPx / PX_PER_MIN
    startMin = Math.round(startMin / SNAP_MIN) * SNAP_MIN
    startMin = Math.min(Math.max(startMin, dayStartMin), dayEndMin - SNAP_MIN)

    const plannedStartAt = new Date(`${date}T${fmtMin(startMin)}:00`).toISOString()

    // Reassign first if dropped on a different technician's lane
    if (card.technician?.id !== lane.technicianId) {
      const moved = await moveToTech(card.healthCheckId, lane.id)
      if (!moved) return
    }
    const ok = await patchCard(card.healthCheckId, { plannedStartAt })
    if (ok) refresh(true)
  }

  // ---- Block resize (bottom edge = re-estimate) ---------------------------
  const startResize = (card: BoardCard, e: React.PointerEvent) => {
    if (!canDrag) return
    e.stopPropagation()
    e.preventDefault()
    const startY = e.clientY
    const startHours = card.estimatedHours ?? 1
    setResizing({ id: card.healthCheckId, hours: startHours })

    const onMove = (ev: PointerEvent) => {
      const deltaHours = (ev.clientY - startY) / (PX_PER_MIN * 60)
      const hours = Math.max(0.25, Math.round((startHours + deltaHours) * 4) / 4)
      setResizing({ id: card.healthCheckId, hours })
    }
    const onUp = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const deltaHours = (ev.clientY - startY) / (PX_PER_MIN * 60)
      const hours = Math.max(0.25, Math.round((startHours + deltaHours) * 4) / 4)
      setResizing(null)
      if (hours !== startHours) {
        const ok = await patchCard(card.healthCheckId, { estimatedHours: hours })
        if (ok) refresh(true)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const openCard = (id: string) => {
    if (recentDragRef.current || resizing) return
    onOpenCard(id)
  }

  // Lunch band geometry
  const lunch = board.config.lunchStartTime && board.config.lunchEndTime
    ? {
        top: (timeToMinutes(board.config.lunchStartTime) - dayStartMin) * PX_PER_MIN,
        height: (timeToMinutes(board.config.lunchEndTime) - timeToMinutes(board.config.lunchStartTime)) * PX_PER_MIN
      }
    : null

  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let m = Math.ceil(dayStartMin / 60) * 60; m <= dayEndMin; m += 60) marks.push(m)
    return marks
  }, [dayStartMin, dayEndMin])

  if (techColumns.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        No technician columns yet — use "+ Add column" to add your technicians, then plan their day here.
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Unscheduled tray */}
        <TrayDropZone>
          {tray.unassigned.length === 0 && tray.assigned.length === 0 && (
            <p className="text-xs text-gray-300 text-center py-4">Everything is scheduled 🎉</p>
          )}
          {tray.unassigned.length > 0 && (
            <>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1">Unassigned</p>
              {tray.unassigned.map(card => (
                <TrayCard key={card.healthCheckId} card={card} now={now} draggable={canDrag} onClick={() => openCard(card.healthCheckId)} />
              ))}
            </>
          )}
          {tray.assigned.length > 0 && (
            <>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1 mt-2">Assigned · no time</p>
              {tray.assigned.map(card => (
                <TrayCard key={card.healthCheckId} card={card} now={now} draggable={canDrag} showTech onClick={() => openCard(card.healthCheckId)} />
              ))}
            </>
          )}
        </TrayDropZone>

        {/* Time grid */}
        <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col min-w-0">
          {/* Tech headers */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-20">
            <div className="w-14 flex-shrink-0 border-r border-gray-200" />
            {techColumns.map(col => {
              const blocks = lanes.get(col.technicianId!) || []
              const allocated = blocks.reduce((sum, b) => sum + b.durationMin / 60, 0)
              const overCapacity = allocated > col.availableHours
              const anyOverrun = blocks.some(b => {
                const actual = actualWorkedMinutes(b.card, now)
                return actual > b.durationMin
              })
              return (
                <div key={col.id} className="flex-1 min-w-[140px] px-3 py-2 border-r border-gray-100 last:border-r-0">
                  <div className="flex items-center gap-1.5">
                    {blocks.some(b => b.card.isClockedOn) && (
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-gray-900 truncate">{col.name}</span>
                  </div>
                  <div className={`text-xs mt-0.5 ${overCapacity ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    {fmtHours(allocated)} / {fmtHours(col.availableHours)}
                    {anyOverrun && <span className="ml-1.5 text-red-600 font-semibold">⚠ overrun</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Scrollable grid */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
            <div className="flex relative" style={{ height: gridHeight }}>
              {/* Hour gutter */}
              <div className="w-14 flex-shrink-0 border-r border-gray-200 relative bg-gray-50/50">
                {hourMarks.map(m => (
                  <span
                    key={m}
                    className="absolute right-1.5 text-[11px] text-gray-400 -translate-y-1/2"
                    style={{ top: (m - dayStartMin) * PX_PER_MIN }}
                  >
                    {fmtMin(m)}
                  </span>
                ))}
              </div>

              {/* Lanes */}
              {techColumns.map(col => (
                <TimelineLane
                  key={col.id}
                  laneId={col.id}
                  refCb={el => { laneRefs.current[col.id] = el }}
                  droppable={canDrag}
                >
                  {/* Hour gridlines */}
                  {hourMarks.map(m => (
                    <div
                      key={m}
                      className="absolute left-0 right-0 border-t border-gray-100 pointer-events-none"
                      style={{ top: (m - dayStartMin) * PX_PER_MIN }}
                    />
                  ))}

                  {/* Lunch band */}
                  {lunch && lunch.height > 0 && (
                    <div
                      className="absolute left-0 right-0 bg-gray-100/80 pointer-events-none flex items-center justify-center"
                      style={{ top: lunch.top, height: lunch.height }}
                    >
                      <span className="text-[10px] text-gray-400 font-medium">LUNCH</span>
                    </div>
                  )}

                  {/* Blocks */}
                  {(lanes.get(col.technicianId!) || []).map(block => (
                    <TimelineBlock
                      key={block.card.healthCheckId}
                      block={block}
                      board={board}
                      now={now}
                      dayStartMin={dayStartMin}
                      dayEndMin={dayEndMin}
                      canDrag={canDrag}
                      resizingHours={resizing?.id === block.card.healthCheckId ? resizing.hours : null}
                      queueNameById={queueNameById}
                      onResizeStart={startResize}
                      onClick={() => openCard(block.card.healthCheckId)}
                    />
                  ))}
                </TimelineLane>
              ))}

              {/* Now line */}
              {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: nowTop }}>
                  <div className="border-t-2 border-red-500 relative">
                    <span className="absolute -top-2.5 left-0.5 bg-red-500 text-white text-[10px] font-bold px-1 rounded">
                      {fmtMin(nowMin)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeDragCard && (
          <div className="bg-white border-2 border-primary rounded-lg shadow-lg px-3 py-2 w-48 opacity-95">
            <div className="text-sm font-bold text-gray-900">{activeDragCard.vehicle?.registration}</div>
            <div className="text-xs text-gray-500">
              {fmtHours(activeDragCard.estimatedHours ?? 1)}
              {activeDragCard.customerWaiting && <span className="ml-1.5 text-red-600 font-bold">WAITING</span>}
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// ---------------------------------------------------------------------------

function TrayDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'timeline_tray' })
  return (
    <div
      ref={setNodeRef}
      className={`w-60 flex-shrink-0 rounded-xl border p-2 space-y-1.5 overflow-y-auto ${
        isOver ? 'border-primary bg-indigo-50/60' : 'border-gray-200 bg-gray-50'
      }`}
    >
      <p className="text-xs font-semibold text-gray-500 px-1 pt-1">To schedule — drag onto the day</p>
      {children}
    </div>
  )
}

function TrayCard({ card, now, draggable, showTech, onClick }: {
  card: BoardCard
  now: Date
  draggable: boolean
  showTech?: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.healthCheckId,
    disabled: !draggable
  })
  const countdown = promiseCountdown(card, now)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-bold text-gray-900 truncate">{card.vehicle?.registration || 'No reg'}</span>
        <span className="text-xs text-gray-400 flex-shrink-0">{fmtHours(card.estimatedHours ?? 1)}</span>
      </div>
      <div className="flex items-center justify-between gap-1 text-[11px] text-gray-500">
        <span className="truncate">
          {card.customerWaiting && <span className="text-red-600 font-bold mr-1">WYW</span>}
          {showTech && card.technician ? `${card.technician.first_name} ${card.technician.last_name.charAt(0)}` : card.customer ? `${card.customer.first_name} ${card.customer.last_name}` : ''}
        </span>
        {countdown && (
          <span className={`flex-shrink-0 ${countdown.tone === 'overdue' ? 'text-red-600' : countdown.tone === 'warning' ? 'text-amber-600' : 'text-gray-400'}`}>
            {countdown.label}
          </span>
        )}
      </div>
    </div>
  )
}

function TimelineLane({ laneId, droppable, refCb, children }: {
  laneId: string
  droppable: boolean
  refCb: (el: HTMLDivElement | null) => void
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId, disabled: !droppable })
  return (
    <div
      ref={el => { setNodeRef(el); refCb(el) }}
      className={`flex-1 min-w-[140px] relative border-r border-gray-100 last:border-r-0 ${isOver ? 'bg-indigo-50/50' : ''}`}
    >
      {children}
    </div>
  )
}

function TimelineBlock({ block, board, now, dayStartMin, dayEndMin, canDrag, resizingHours, queueNameById, onResizeStart, onClick }: {
  block: PlacedBlock
  board: BoardData
  now: Date
  dayStartMin: number
  dayEndMin: number
  canDrag: boolean
  resizingHours: number | null
  queueNameById: Map<string, string>
  onResizeStart: (card: BoardCard, e: React.PointerEvent) => void
  onClick: () => void
}) {
  const { card } = block
  const locked = card.isClockedOn || card.status === 'in_progress'
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.healthCheckId,
    disabled: !canDrag || locked
  })

  const durationMin = resizingHours != null ? resizingHours * 60 : block.durationMin
  const top = (block.startMin - dayStartMin) * PX_PER_MIN
  const height = Math.max(durationMin * PX_PER_MIN, MIN_BLOCK_PX)
  const widthPct = 100 / block.subColCount
  const leftPct = block.subCol * widthPct

  const workshopStatus = card.workshopStatusId ? board.statuses.find(s => s.id === card.workshopStatusId) : null
  const queueName = card.position === 'column' && card.columnId ? queueNameById.get(card.columnId) : null

  // Actual time vs estimate (Garage Hive model)
  const actualMin = actualWorkedMinutes(card, now)
  const isDone = card.position === 'work_complete' || card.status === 'completed' || !!card.techCompletedAt
  const overrunMin = !isDone && actualMin > durationMin ? actualMin - durationMin : 0
  const progressPct = card.isClockedOn || actualMin > 0 ? Math.min(100, (actualMin / durationMin) * 100) : 0
  const pastClose = block.startMin + durationMin > dayEndMin
  const notArrived = card.status === 'awaiting_arrival'

  const borderColour = overrunMin > 0 ? '#DC2626' : workshopStatus?.colour || (card.isClockedOn ? '#16A34A' : '#94A3B8')
  const compact = height < 64

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`absolute rounded-lg border bg-white shadow-sm overflow-visible select-none z-10 ${
        canDrag && !locked ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${notArrived ? 'border-dashed' : ''} ${isDragging ? 'opacity-40' : ''} ${
        overrunMin > 0 ? 'ring-1 ring-red-400' : ''
      }`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
        borderLeftWidth: 4,
        borderLeftColor: borderColour,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        ...(isDone ? { opacity: 0.55 } : {})
      }}
      title={`${card.vehicle?.registration || ''} · ${fmtMin(block.startMin)}–${fmtMin(block.startMin + durationMin)} · ${fmtHours(durationMin / 60)}${locked ? ' · in progress (locked)' : ''}`}
    >
      {/* Actual-time progress fill */}
      {progressPct > 0 && (
        <div
          className={`absolute inset-x-0 top-0 rounded-t-lg pointer-events-none ${overrunMin > 0 ? 'bg-red-50' : 'bg-green-50'}`}
          style={{ height: `${progressPct}%` }}
        />
      )}

      <div className="relative px-2 py-1 h-full overflow-hidden">
        <div className="flex items-center justify-between gap-1">
          <span className="flex items-center gap-1 min-w-0">
            {card.isClockedOn && (
              <span className="relative flex h-2 w-2 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            <span className="text-xs font-bold text-gray-900 truncate">{card.vehicle?.registration || 'No reg'}</span>
            {card.customerWaiting && <span className="text-[9px] font-bold text-white bg-rag-red rounded px-1 flex-shrink-0">W</span>}
          </span>
          <span className="text-[10px] text-gray-400 flex-shrink-0">
            {resizingHours != null ? fmtHours(resizingHours) : fmtHours(durationMin / 60)}{!block.hasEstimate && resizingHours == null ? '?' : ''}
          </span>
        </div>
        {!compact && (
          <>
            <div className="text-[11px] text-gray-500 truncate">
              {fmtMin(block.startMin)}–{fmtMin(block.startMin + durationMin)}
              {card.customer ? ` · ${card.customer.first_name} ${card.customer.last_name}` : ''}
            </div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {notArrived && <span className="text-[9px] font-medium text-gray-500 bg-gray-100 rounded-full px-1.5 py-px">DUE IN</span>}
              {workshopStatus && (
                <span className="text-[9px] font-medium text-white rounded-full px-1.5 py-px" style={{ backgroundColor: workshopStatus.colour }}>
                  {workshopStatus.name}
                </span>
              )}
              {queueName && <span className="text-[9px] font-medium text-gray-600 bg-gray-100 rounded-full px-1.5 py-px">In: {queueName}</span>}
              {isDone && <span className="text-[9px] font-bold text-white bg-rag-green rounded-full px-1.5 py-px">DONE</span>}
            </div>
          </>
        )}
        {pastClose && (
          <div className="absolute bottom-0 inset-x-0 text-center text-[9px] font-semibold text-amber-700 bg-amber-50 border-t border-dashed border-amber-300">
            past close
          </div>
        )}
      </div>

      {/* Overrun extension (actual beyond estimate) */}
      {overrunMin > 0 && (
        <div
          className="absolute inset-x-0 rounded-b border border-t-0 border-red-300 pointer-events-none"
          style={{
            top: height,
            height: Math.min(overrunMin * PX_PER_MIN, 240),
            background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.18), rgba(239,68,68,0.18) 6px, rgba(239,68,68,0.05) 6px, rgba(239,68,68,0.05) 12px)'
          }}
        >
          <span className="absolute top-0.5 left-1 text-[9px] font-bold text-red-600">
            +{fmtHours(overrunMin / 60)} over
          </span>
        </div>
      )}

      {/* Resize handle */}
      {canDrag && !locked && !isDone && (
        <div
          onPointerDown={e => onResizeStart(card, e)}
          className="absolute -bottom-1 inset-x-0 h-2.5 cursor-ns-resize flex items-center justify-center group"
        >
          <div className="w-8 h-1 rounded-full bg-gray-300 group-hover:bg-primary" />
        </div>
      )}
    </div>
  )
}
