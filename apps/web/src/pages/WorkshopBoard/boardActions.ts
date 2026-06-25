// Shared workshop-board mutations, used by both the kanban (WorkshopBoard) and
// the day planner (TimelineView) so the two surfaces move jobs identically and
// share the same error handling.
import { api } from '../../lib/api'

export type MoveTarget = 'checked_in' | 'technician' | 'queue' | 'work_complete' | 'workshop'
export interface SortPositionUpdate {
  healthCheckId: string
  sortPosition: number
}

interface MoveBody {
  target: MoveTarget
  columnId?: string
  sortPosition?: number
}

/** Move a card to a different board placement (column / technician / work complete). */
export function moveCard(token: string, healthCheckId: string, body: MoveBody): Promise<unknown> {
  return api(`/api/v1/workshop-board/cards/${healthCheckId}/move`, { method: 'POST', token, body })
}

/** Persist the top-to-bottom work order for a set of cards. */
export function reorderCards(token: string, positions: SortPositionUpdate[]): Promise<unknown> {
  return api('/api/v1/workshop-board/cards/reorder', { method: 'POST', token, body: { positions } })
}

/** Patch card metadata (planned start, estimated hours, priority, workshop status…). */
export function patchCard(token: string, healthCheckId: string, body: Record<string, unknown>): Promise<unknown> {
  return api(`/api/v1/workshop-board/cards/${healthCheckId}`, { method: 'PATCH', token, body })
}

/** Schedule (or clear, with null) a card's planned start on the timeline. */
export function setPlannedStart(token: string, healthCheckId: string, plannedStartAt: string | null): Promise<unknown> {
  return patchCard(token, healthCheckId, { plannedStartAt })
}
