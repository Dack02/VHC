/**
 * Hook: unactioned advisor-attention workshop notes count for the nav badge.
 * Site-wide (not per-advisor) so a flagged note is never missed because one
 * advisor is off. Polls every 30 seconds and refreshes on workshop board
 * note events.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'

export function useAttentionNotesCount() {
  const { session } = useAuth()
  const { on, off } = useSocket()
  const [count, setCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const fetchCount = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ count: number }>('/api/v1/workshop-board/notes/attention-count', {
        token: session.accessToken
      })
      setCount(data.count)
    } catch {
      // Silently fail
    }
  }, [session?.accessToken])

  // Initial fetch + polling
  useEffect(() => {
    fetchCount()
    intervalRef.current = setInterval(fetchCount, 30000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchCount])

  // Live refresh when notes change anywhere on the site's board
  useEffect(() => {
    const handleBoardUpdated = (payload: { reason?: string }) => {
      if (payload?.reason?.startsWith('note_')) fetchCount()
    }

    on(WS_EVENTS.WORKSHOP_BOARD_UPDATED, handleBoardUpdated)
    return () => {
      off(WS_EVENTS.WORKSHOP_BOARD_UPDATED, handleBoardUpdated as any)
    }
  }, [on, off, fetchCount])

  const refresh = useCallback(() => {
    fetchCount()
  }, [fetchCount])

  return { count, refresh }
}
