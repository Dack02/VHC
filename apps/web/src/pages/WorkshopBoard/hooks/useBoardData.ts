import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSocket } from '../../../contexts/SocketContext'
import { api } from '../../../lib/api'

export interface BoardCard {
  healthCheckId: string
  status: string
  jobsheetNumber?: string
  promiseTime?: string
  arrivedAt?: string
  dueDate?: string
  customerWaiting?: boolean
  loanCarRequired?: boolean
  isInternal?: boolean
  bookedRepairs?: unknown[]
  checkedInAt?: string
  vehicle: {
    id: string
    registration: string
    make?: string
    model?: string
    year?: number
  } | null
  customer: {
    id: string
    firstName: string
    lastName: string
  } | null
  technician: {
    id: string
    firstName: string
    lastName: string
  } | null
  advisor: {
    id: string
    firstName: string
    lastName: string
  } | null
  columnType: string
  assignedTechnicianId: string | null
  sortPosition: number
  tcardStatusId: string | null
  tcardStatus: {
    id: string
    name: string
    colour: string
    icon?: string
  } | null
  priority: string
}

export interface BoardColumn {
  id: string
  technicianId: string
  technician: {
    id: string
    firstName: string
    lastName: string
  } | null
  sortOrder: number
  availableHours: number
  allocatedHours: number
  cards: BoardCard[]
}

export interface BoardStatus {
  id: string
  name: string
  colour: string
  icon?: string
  sortOrder: number
}

export interface BoardData {
  date: string
  siteId: string
  columns: BoardColumn[]
  dueIn: BoardCard[]
  completed: BoardCard[]
  statuses: BoardStatus[]
}

export function useBoardData(siteId: string | null, date: string) {
  const { session } = useAuth()
  const { on, off } = useSocket()
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBoard = useCallback(async () => {
    if (!siteId || !session?.accessToken) return

    try {
      setLoading(true)
      setError(null)
      const result = await api<BoardData>(`/api/v1/tcard/board?siteId=${siteId}&date=${date}`, {
        token: session.accessToken,
      })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load board')
    } finally {
      setLoading(false)
    }
  }, [siteId, date, session?.accessToken])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  // Listen for real-time updates
  useEffect(() => {
    const handleCardMoved = () => fetchBoard()
    const handleStatusChanged = () => fetchBoard()
    const handleNoteAdded = () => fetchBoard()
    const handleColumnUpdated = () => fetchBoard()
    const handleCardUpdated = () => fetchBoard()

    on('tcard:card_moved', handleCardMoved)
    on('tcard:status_changed', handleStatusChanged)
    on('tcard:note_added', handleNoteAdded)
    on('tcard:column_updated', handleColumnUpdated)
    on('tcard:card_updated', handleCardUpdated)

    return () => {
      off('tcard:card_moved', handleCardMoved as any)
      off('tcard:status_changed', handleStatusChanged as any)
      off('tcard:note_added', handleNoteAdded as any)
      off('tcard:column_updated', handleColumnUpdated as any)
      off('tcard:card_updated', handleCardUpdated as any)
    }
  }, [on, off, fetchBoard])

  return { data, loading, error, refresh: fetchBoard }
}
