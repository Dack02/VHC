import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api } from '../../lib/api'
import type { BoardData } from './types'

const REFRESH_DEBOUNCE_MS = 600
const POLL_FALLBACK_MS = 60000

/**
 * Loads the workshop board and keeps it live: any board mutation, health
 * check status change or technician clock event triggers a debounced refetch,
 * with a slow polling fallback when sockets are quiet.
 */
export function useBoardData(date: string) {
  const { session, user } = useAuth()
  const { socket } = useSocket()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  const siteId = user?.site?.id

  const fetchBoard = useCallback(async (silent = false) => {
    if (!session?.accessToken) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ date })
      if (siteId) params.set('siteId', siteId)
      const data = await api<BoardData>(`/api/v1/workshop-board?${params}`, {
        token: session.accessToken
      })
      setBoard(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workshop board')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [session?.accessToken, siteId, date])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  // Debounced silent refresh for real-time events
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchBoard(true), REFRESH_DEBOUNCE_MS)
  }, [fetchBoard])

  useEffect(() => {
    if (!socket) return

    const events = [
      WS_EVENTS.WORKSHOP_BOARD_UPDATED,
      WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED,
      WS_EVENTS.TECHNICIAN_CLOCKED_IN,
      WS_EVENTS.TECHNICIAN_CLOCKED_OUT
    ]
    events.forEach(event => socket.on(event, scheduleRefresh))

    return () => {
      events.forEach(event => socket.off(event, scheduleRefresh))
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [socket, scheduleRefresh])

  // Polling fallback (covers missed socket events / reconnects)
  useEffect(() => {
    const interval = setInterval(() => fetchBoard(true), POLL_FALLBACK_MS)
    return () => clearInterval(interval)
  }, [fetchBoard])

  return { board, setBoard, loading, error, refresh: fetchBoard }
}

/** Ticks every `intervalMs` - drives promise-time countdowns */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(interval)
  }, [intervalMs])
  return now
}
