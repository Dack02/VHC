import { useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { dayCapacityMinutes, type WeekCard, type WeekColumn, type WeekData } from './types'
import { moveCard, setPlannedStart } from './boardActions'

interface WeekViewProps {
  week: WeekData
  days: string[] // 7 YYYY-MM-DD, Monday-first
  today: string
  canDrag: boolean
  onOpenCard: (healthCheckId: string) => void
  onPickDay?: (day: string) => void
  refresh: (silent?: boolean) => void
  onDragActive?: (active: boolean) => void
}

const TRAY_ID = 'week_tray'

function localDayOf(iso: string): string {
  // Match the planned date in local time (the grid columns are local dates).
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function fmtHours(h: number): string {
  return `${Math.round(h * 100) / 100}h`
}
function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

export default function WeekView({ week, days, today, canDrag, onOpenCard, onPickDay, refresh, onDragActive }: WeekViewProps) {
  const { session } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const recentDragRef = useRef(false)
  const [activeCard, setActiveCard] = useState<WeekCard | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const techColumns = useMemo(() => week.columns.filter(c => c.isVisible && c.technicianId), [week.columns])
  const columnByTech = useMemo(() => {
    const m = new Map<string, WeekColumn>()
    for (const c of techColumns) if (c.technicianId) m.set(c.technicianId, c)
    return m
  }, [techColumns])
  const daySet = useMemo(() => new Set(days), [days])

  // Bucket cards into (techId|day) cells; everything else is unscheduled (tray).
  const { cellCards, tray } = useMemo(() => {
    const cells = new Map<string, WeekCard[]>()
    const trayCards: WeekCard[] = []
    for (const card of week.cards) {
      const day = card.plannedStartAt ? localDayOf(card.plannedStartAt) : null
      if (day && card.technicianId && daySet.has(day) && columnByTech.has(card.technicianId)) {
        const key = `${card.technicianId}|${day}`
        const list = cells.get(key) || []
        list.push(card)
        cells.set(key, list)
      } else {
        trayCards.push(card)
      }
    }
    for (const list of cells.values()) {
      list.sort((a, b) => (a.plannedStartAt || '').localeCompare(b.plannedStartAt || ''))
    }
    const sortKey = (c: WeekCard) => c.promiseTime || c.dueDate || '9999'
    trayCards.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    return { cellCards: cells, tray: trayCards }
  }, [week.cards, daySet, columnByTech])

  const cellHours = (techId: string, day: string): number =>
    (cellCards.get(`${techId}|${day}`) || []).reduce((sum, c) => sum + (c.estimatedHours ?? 1), 0)

  // Available hours for a tech on a day, from their shift (minus lunch/absence),
  // falling back to the flat column hours when no shift is defined.
  const capacityHours = (col: WeekColumn, day: string): number => {
    if (!col.technicianId) return col.availableHours
    return dayCapacityMinutes({
      date: day,
      shifts: week.shiftsByTech[col.technicianId] || [],
      absences: week.absencesByTech[col.technicianId] || [],
      lunchStartTime: week.config.lunchStartTime,
      lunchEndTime: week.config.lunchEndTime,
      flatHours: col.availableHours,
      dayStartTime: week.config.dayStartTime,
    }) / 60
  }

  // Per-day totals across all techs (the forward loading forecast).
  const dayLoad = useMemo(() => {
    return days.map(day => {
      const booked = techColumns.reduce((s, c) => s + (c.technicianId ? cellHours(c.technicianId, day) : 0), 0)
      const available = techColumns.reduce((s, c) => s + capacityHours(c, day), 0)
      return { day, booked, available }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, techColumns, cellCards, week.shiftsByTech, week.absencesByTech])

  const patch = async (healthCheckId: string, plannedStartAt: string | null) => {
    if (!token) return false
    try { await setPlannedStart(token, healthCheckId, plannedStartAt); return true }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Update failed'); return false }
  }
  const moveToTech = async (healthCheckId: string, columnId: string) => {
    if (!token) return false
    try { await moveCard(token, healthCheckId, { target: 'technician', columnId }); return true }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not assign technician'); return false }
  }

  const handleDragStart = (e: DragStartEvent) => {
    recentDragRef.current = true
    onDragActive?.(true)
    setActiveCard(week.cards.find(c => c.healthCheckId === e.active.id) || null)
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null)
    setTimeout(() => { recentDragRef.current = false }, 150)
    try {
      const { active, over } = e
      if (!over || !canDrag) return
      const card = week.cards.find(c => c.healthCheckId === active.id)
      if (!card) return
      const overId = over.id as string

      if (overId === TRAY_ID) {
        if (card.plannedStartAt) { if (await patch(card.healthCheckId, null)) refresh(true) }
        return
      }
      const [techId, day] = overId.split('|')
      const col = columnByTech.get(techId)
      if (!techId || !day || !col) return
      // Default the dropped time to the start of the working day (week view is
      // about which day/tech; fine-tune the time on the day timeline).
      const plannedStartAt = new Date(`${day}T${week.config.dayStartTime}:00`).toISOString()
      if (card.technicianId !== techId) {
        if (!(await moveToTech(card.healthCheckId, col.id))) return
      }
      if (await patch(card.healthCheckId, plannedStartAt)) refresh(true)
    } finally {
      onDragActive?.(false)
    }
  }

  const openCard = (id: string) => { if (!recentDragRef.current) onOpenCard(id) }

  if (techColumns.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        No technician columns yet — use "+ Add column" to add your technicians, then plan their week here.
      </div>
    )
  }

  const gridCols = { gridTemplateColumns: `160px repeat(${days.length}, minmax(120px, 1fr))` }

  return (
    <DndContext sensors={sensors} autoScroll={{ threshold: { x: 0.2, y: 0.2 } }} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => { setActiveCard(null); onDragActive?.(false) }}>
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-auto">
        {/* Unscheduled tray */}
        <TrayStrip count={tray.length}>
          {tray.length === 0 ? (
            <span className="text-xs text-gray-300">Everything is scheduled 🎉</span>
          ) : (
            tray.map(card => <WeekChip key={card.healthCheckId} card={card} draggable={canDrag} onClick={() => openCard(card.healthCheckId)} />)
          )}
        </TrayStrip>

        {/* Grid */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid border-b border-gray-200 bg-gray-50" style={gridCols}>
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 border-r border-gray-200">Technician</div>
            {days.map(day => (
              <button
                key={day}
                onClick={() => onPickDay?.(day)}
                className={`text-left px-3 py-2 text-sm font-semibold border-r border-gray-100 last:border-r-0 hover:bg-gray-100 ${day === today ? 'text-primary' : 'text-gray-900'}`}
                title="Open this day on the timeline"
              >
                {dayLabel(day)}{day === today && ' · today'}
              </button>
            ))}
          </div>
          {/* Tech rows */}
          {techColumns.map(col => (
            <div key={col.id} className="grid border-b border-gray-100 last:border-b-0" style={gridCols}>
              <div className="px-3 py-2 border-r border-gray-200 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{col.name}</div>
                <div className="text-[11px] text-gray-400">{fmtHours(col.availableHours)}/day</div>
              </div>
              {days.map(day => (
                <WeekCell
                  key={day}
                  id={`${col.technicianId}|${day}`}
                  droppable={canDrag}
                  allocated={col.technicianId ? cellHours(col.technicianId, day) : 0}
                  available={capacityHours(col, day)}
                >
                  {(cellCards.get(`${col.technicianId}|${day}`) || []).map(card => (
                    <WeekChip key={card.healthCheckId} card={card} draggable={canDrag} compact onClick={() => openCard(card.healthCheckId)} />
                  ))}
                </WeekCell>
              ))}
            </div>
          ))}
          {/* Forecast footer */}
          <div className="grid border-t-2 border-gray-200 bg-gray-50" style={gridCols}>
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-200">Day load</div>
            {dayLoad.map(({ day, booked, available }) => {
              const pct = available > 0 ? Math.round((booked / available) * 100) : 0
              const colour = pct > 100 ? 'text-rag-red' : pct >= 80 ? 'text-amber-600' : 'text-gray-500'
              return (
                <div key={day} className="px-3 py-2 border-r border-gray-100 last:border-r-0">
                  <div className={`text-xs font-medium ${colour}`}>{fmtHours(booked)} / {fmtHours(available)}</div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
                    <div className={`h-full ${pct > 100 ? 'bg-rag-red' : pct >= 80 ? 'bg-rag-amber' : 'bg-rag-green'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <DragOverlay>
        {activeCard && (
          <div className="bg-white border-2 border-primary rounded-lg shadow-lg px-2.5 py-1.5 w-40 opacity-95 cursor-grabbing">
            <div className="text-sm font-bold text-gray-900 truncate">{activeCard.registration || 'No reg'}</div>
            <div className="text-[11px] text-gray-500">{fmtHours(activeCard.estimatedHours ?? 1)}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function TrayStrip({ count, children }: { count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY_ID })
  return (
    <div ref={setNodeRef} className={`rounded-xl border p-2 ${isOver ? 'border-primary bg-indigo-50/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-xs font-semibold text-gray-500 px-1 mb-1.5">To schedule — drag onto a day ({count})</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function WeekCell({ id, droppable, allocated, available, children }: {
  id: string
  droppable: boolean
  allocated: number
  available: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable })
  const off = available <= 0
  const over = allocated > available
  return (
    <div ref={setNodeRef} className={`px-1.5 py-1.5 border-r border-gray-100 last:border-r-0 min-h-[64px] space-y-1 ${isOver ? 'bg-indigo-50/60' : off ? 'bg-gray-100/70' : ''}`}>
      {off && allocated === 0 && (
        <div className="text-[10px] text-gray-300 text-center pt-2">off</div>
      )}
      {children}
      {allocated > 0 && (
        <div className={`text-[10px] text-right ${over ? 'text-rag-red font-semibold' : 'text-gray-400'}`}>
          {fmtHours(allocated)}{over && available > 0 ? ` / ${fmtHours(available)}` : ''}{off ? ' · off' : ''}
        </div>
      )}
    </div>
  )
}

function WeekChip({ card, draggable, compact, onClick }: {
  card: WeekCard
  draggable: boolean
  compact?: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.healthCheckId, disabled: !draggable })
  const notArrived = card.status === 'awaiting_arrival'
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`rounded-lg border bg-white shadow-sm px-2 py-1 ${compact ? 'w-full' : 'w-36'} ${notArrived ? 'border-dashed border-gray-300' : 'border-gray-200'} ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 min-w-0">
          {card.isClockedOn && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
          <span className="text-xs font-bold text-gray-900 truncate">{card.registration || 'No reg'}</span>
          {card.customerWaiting && <span className="text-[8px] font-bold text-white bg-rag-red rounded px-1 flex-shrink-0">W</span>}
        </span>
        <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtHours(card.estimatedHours ?? 1)}</span>
      </div>
      <div className="text-[10px] text-gray-500 truncate">
        {card.plannedStartAt ? fmtTime(card.plannedStartAt) : notArrived ? 'Due in' : 'No time'}
        {card.customerName ? ` · ${card.customerName}` : ''}
      </div>
    </div>
  )
}
