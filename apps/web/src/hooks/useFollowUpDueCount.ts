/**
 * Hook: count of follow-up cases needing attention (for the nav badge).
 * Overdue + call list + bookings to confirm + customer replies. Polls every 60s.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface FollowUpSummary {
  open: number
  manual: number
  overdue: number
  dueToday: number
  bookingFound: number
  engaged: number
}

export function useFollowUpDueCount() {
  const { session } = useAuth()
  const [count, setCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const fetchCount = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const d = await api<FollowUpSummary>('/api/v1/follow-ups/summary', { token: session.accessToken })
      setCount((d.overdue || 0) + (d.manual || 0) + (d.bookingFound || 0) + (d.engaged || 0))
    } catch {
      // Silently fail
    }
  }, [session?.accessToken])

  useEffect(() => {
    fetchCount()
    intervalRef.current = setInterval(fetchCount, 60000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchCount])

  return { count, refresh: fetchCount }
}
