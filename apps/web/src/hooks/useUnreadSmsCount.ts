/**
 * Hook: global unread SMS count for nav badge.
 * Polls every 30 seconds and listens to org-level WebSocket events.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'

export function useUnreadSmsCount() {
  const { session } = useAuth()
  const { on, off } = useSocket()
  const [count, setCount] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  const fetchCount = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ count: number }>('/api/v1/sms-messages/unread-count', {
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

  // Listen for real-time SMS events on org room
  useEffect(() => {
    const handleSmsReceived = () => {
      setCount(prev => prev + 1)
    }

    on(WS_EVENTS.SMS_RECEIVED, handleSmsReceived)
    return () => {
      off(WS_EVENTS.SMS_RECEIVED, handleSmsReceived as any)
    }
  }, [on, off])

  const decrement = useCallback((amount = 1) => {
    setCount(prev => Math.max(0, prev - amount))
  }, [])

  const refresh = useCallback(() => {
    fetchCount()
  }, [fetchCount])

  return { count, decrement, refresh }
}
