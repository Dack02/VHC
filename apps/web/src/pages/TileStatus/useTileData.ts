import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api } from '../../lib/api'
import type { Tile, TilesResponse } from './types'

const REFRESH_DEBOUNCE_MS = 600
const POLL_FALLBACK_MS = 60000

/**
 * Loads the Tile Status aggregate for the user's site and keeps it live: any
 * board mutation / status change / clock event triggers a debounced refetch,
 * with a slow polling fallback when sockets are quiet. Mirrors useBoardData.
 *
 * `advisorId` (optional) scopes every count to one advisor — the /tiles endpoint
 * accepts it natively; passing null/undefined means "all advisors". Changing it
 * refetches automatically.
 */
export function useTileData(advisorId?: string | null) {
  const { session, user } = useAuth()
  const { socket } = useSocket()
  const [tiles, setTiles] = useState<Tile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  const siteId = user?.site?.id

  const fetchTiles = useCallback(async (silent = false) => {
    if (!session?.accessToken) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (siteId) params.set('siteId', siteId)
      if (advisorId) params.set('advisorId', advisorId)
      const qs = params.toString()
      const data = await api<TilesResponse>(
        `/api/v1/workshop-board/tiles${qs ? `?${qs}` : ''}`,
        { token: session.accessToken }
      )
      setTiles(data.tiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tiles')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [session?.accessToken, siteId, advisorId])

  useEffect(() => {
    fetchTiles()
  }, [fetchTiles])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchTiles(true), REFRESH_DEBOUNCE_MS)
  }, [fetchTiles])

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

  useEffect(() => {
    const interval = setInterval(() => fetchTiles(true), POLL_FALLBACK_MS)
    return () => clearInterval(interval)
  }, [fetchTiles])

  return { tiles, loading, error, refresh: fetchTiles }
}
