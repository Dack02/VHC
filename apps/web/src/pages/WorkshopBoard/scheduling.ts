// Pure scheduling / interval logic for the workshop day planner.
//
// Kept free of React and of the dnd-kit/DOM layer so the timeline can reuse the
// same primitives for collision-aware drops, the idle-technician readout and
// "auto-arrange". All times are minutes-since-midnight in the board's local zone.
import type { BoardCard, BoardConfig } from './types'
import {
  timeToMinutes,
  isClockStale,
  sortCards,
  DEFAULT_STALE_CLOCK_MIN
} from './types'

export const SNAP_MIN = 15
export const DEFAULT_EST_HOURS = 1

export interface Interval {
  startMin: number
  endMin: number
}

/** Block length in minutes for a card (estimate, defaulting to 1h, floored to a slot). */
export function durationMinFor(card: BoardCard): number {
  return Math.max((card.estimatedHours ?? DEFAULT_EST_HOURS) * 60, SNAP_MIN)
}

/**
 * The customer deadline (minutes since midnight) for a card on `date`, or null
 * when there's no real intra-day deadline: a different day, or a date-only /
 * midnight DMS value (which encodes "this day", not a time). Mirrors the
 * date-only rule in JobCard.promiseCountdown.
 */
export function promiseDeadlineMin(card: BoardCard, date: string, dayEndMin: number): number | null {
  const iso = card.promiseTime || card.dueDate
  if (!iso) return null
  const d = new Date(iso)
  if (d.toDateString() !== new Date(`${date}T12:00:00`).toDateString()) return null
  const min = d.getHours() * 60 + d.getMinutes()
  if (min === 0) return null // midnight = date-only, not a deadline
  return Math.min(min, dayEndMin)
}

/** Existing blocks → sorted busy intervals. */
export function busyIntervals(blocks: { startMin: number; durationMin: number }[]): Interval[] {
  return blocks
    .map(b => ({ startMin: b.startMin, endMin: b.startMin + b.durationMin }))
    .sort((a, b) => a.startMin - b.startMin)
}

/** The lunch band as an interval, or null when no lunch is configured. */
export function lunchInterval(config: BoardConfig): Interval | null {
  if (!config.lunchStartTime || !config.lunchEndTime) return null
  return { startMin: timeToMinutes(config.lunchStartTime), endMin: timeToMinutes(config.lunchEndTime) }
}

const overlaps = (startMin: number, endMin: number, b: Interval): boolean =>
  startMin < b.endMin && endMin > b.startMin

/**
 * Earliest snapped start (>= fromMin) for a block of `durationMin` that doesn't
 * collide with any blocker (busy + optional lunch) and still fits before
 * dayEndMin. Returns null when it can't fit before close. Deterministic, O(n).
 */
export function firstFreeSlot(
  durationMin: number,
  busy: Interval[],
  opts: { fromMin: number; dayStartMin: number; dayEndMin: number; lunch?: Interval | null; snapMin?: number }
): number | null {
  const snap = opts.snapMin ?? SNAP_MIN
  const snapUp = (x: number) => Math.ceil(x / snap) * snap
  const blockers = [...busy, ...(opts.lunch ? [opts.lunch] : [])].sort((a, b) => a.startMin - b.startMin)
  let candidate = snapUp(Math.max(opts.fromMin, opts.dayStartMin))
  for (const b of blockers) {
    if (candidate + durationMin <= b.startMin) break // fits in the gap before this blocker
    if (overlaps(candidate, candidate + durationMin, b)) candidate = snapUp(b.endMin)
  }
  if (candidate + durationMin > opts.dayEndMin) return null
  return candidate
}

export interface TechAvailability {
  isFreeNow: boolean
  nextFreeMin: number
  freeMinutesRemaining: number
  isClockedOn: boolean
}

/**
 * Whether a technician is free right now and how much of the rest of the day is
 * uncommitted. A non-stale open clock counts as busy; a stale clock (forgotten
 * clock-off) does not.
 */
export function techAvailability(
  blocks: { card: BoardCard; startMin: number; durationMin: number }[],
  nowMin: number,
  dayEndMin: number,
  now: Date,
  staleMin = DEFAULT_STALE_CLOCK_MIN
): TechAvailability {
  const isClockedOn = blocks.some(b => b.card.isClockedOn && !isClockStale(b.card, now, staleMin))
  const covering = blocks.find(b => b.startMin <= nowMin && nowMin < b.startMin + b.durationMin)
  const busyNow = !!covering || isClockedOn
  const nextFreeMin = covering ? Math.max(nowMin, covering.startMin + covering.durationMin) : nowMin
  let covered = 0
  for (const b of blocks) {
    const s = Math.max(b.startMin, nowMin)
    const e = Math.min(b.startMin + b.durationMin, dayEndMin)
    if (e > s) covered += e - s
  }
  return {
    isFreeNow: !busyNow && nowMin < dayEndMin,
    nextFreeMin,
    freeMinutesRemaining: Math.max(0, dayEndMin - nowMin - covered),
    isClockedOn
  }
}

export interface AutoPlanEntry {
  card: BoardCard
  technicianId: string
  columnId: string
  startMin: number
}
export interface AutoPlanResult {
  plan: AutoPlanEntry[]
  unplaced: BoardCard[]
}

/**
 * First-fit plan: place each tray job onto the earliest free slot, preferring
 * slots that meet the customer deadline, then the job's existing technician,
 * then the least-loaded technician. Pure — returns the plan; the caller commits
 * it via the existing move/patch endpoints. Locked (in-progress / clocked-on)
 * jobs are skipped. Job order follows sortCards (waiters → priority → promise → age).
 */
export function autoArrangePlan(
  jobs: BoardCard[],
  techs: { columnId: string; technicianId: string }[],
  lanesBusy: Map<string, Interval[]>,
  opts: { date: string; dayStartMin: number; dayEndMin: number; lunch?: Interval | null; nowMin: number; isToday: boolean }
): AutoPlanResult {
  const working = new Map<string, Interval[]>()
  for (const t of techs) working.set(t.technicianId, [...(lanesBusy.get(t.technicianId) || [])])
  const plan: AutoPlanEntry[] = []
  const unplaced: BoardCard[] = []
  const earliest = opts.isToday ? Math.max(opts.dayStartMin, opts.nowMin) : opts.dayStartMin

  for (const card of sortCards(jobs)) {
    if (card.isClockedOn || card.status === 'in_progress') continue
    const dur = durationMinFor(card)
    const deadline = promiseDeadlineMin(card, opts.date, opts.dayEndMin)

    const candidates = techs
      .map(t => {
        const slot = firstFreeSlot(dur, working.get(t.technicianId)!, {
          fromMin: earliest,
          dayStartMin: opts.dayStartMin,
          dayEndMin: opts.dayEndMin,
          lunch: opts.lunch
        })
        if (slot == null) return null
        const load = (working.get(t.technicianId) || []).reduce((sum, i) => sum + (i.endMin - i.startMin), 0)
        return { ...t, slot, load }
      })
      .filter((c): c is { columnId: string; technicianId: string; slot: number; load: number } => c != null)

    if (!candidates.length) { unplaced.push(card); continue }

    const meeting = deadline != null ? candidates.filter(c => c.slot + dur <= deadline) : candidates
    const pool = meeting.length ? meeting : candidates
    pool.sort((a, b) => {
      const aCur = a.technicianId === card.technician?.id ? 0 : 1
      const bCur = b.technicianId === card.technician?.id ? 0 : 1
      if (aCur !== bCur) return aCur - bCur
      return a.slot - b.slot || a.load - b.load
    })
    const pick = pool[0]
    const list = working.get(pick.technicianId)!
    list.push({ startMin: pick.slot, endMin: pick.slot + dur })
    list.sort((a, b) => a.startMin - b.startMin)
    plan.push({ card, technicianId: pick.technicianId, columnId: pick.columnId, startMin: pick.slot })
  }
  return { plan, unplaced }
}
