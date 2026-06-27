import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api } from '../../lib/api'
import type { DiaryDay, DiaryBooking, DiarySummaryResponse, DiaryDayDetail, DiaryRangeResponse } from './types'

const REFRESH_DEBOUNCE_MS = 600
const POLL_FALLBACK_MS = 60000

const LIVE_EVENTS = [
  WS_EVENTS.WORKSHOP_BOARD_UPDATED,
  WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED
]

/**
 * Per-day diary summary for a date range (the week strip). Kept live by the same
 * board/status socket events that drive the Workshop Board, with a slow polling
 * fallback. Mirrors useTileData.
 */
export function useDiarySummary(from: string, to: string) {
  const { session, user } = useAuth()
  const { socket } = useSocket()
  const [days, setDays] = useState<DiaryDay[] | null>(null)
  const [operatingDays, setOperatingDays] = useState<number[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  const siteId = user?.site?.id

  const fetchSummary = useCallback(async (silent = false) => {
    if (!session?.accessToken) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (siteId) params.set('siteId', siteId)
      const data = await api<DiarySummaryResponse>(
        `/api/v1/booking-diary/summary?${params}`,
        { token: session.accessToken }
      )
      setDays(data.days)
      setOperatingDays(data.operatingDays)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diary')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [session?.accessToken, siteId, from, to])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSummary(true), REFRESH_DEBOUNCE_MS)
  }, [fetchSummary])

  useEffect(() => {
    if (!socket) return
    LIVE_EVENTS.forEach(event => socket.on(event, scheduleRefresh))
    return () => {
      LIVE_EVENTS.forEach(event => socket.off(event, scheduleRefresh))
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [socket, scheduleRefresh])

  useEffect(() => {
    const interval = setInterval(() => fetchSummary(true), POLL_FALLBACK_MS)
    return () => clearInterval(interval)
  }, [fetchSummary])

  return { days, operatingDays, loading, error, refresh: fetchSummary }
}

/**
 * Per-day headers PLUS every booking across a date window, in one round-trip.
 * Powers the Agenda (stacked days) and Table (flat range) list views, which
 * group/segment the bookings client-side. Same live-refresh + polling as the
 * summary hook. Aggregation is server-side (RPC), so it's safe from the
 * PostgREST 1000-row cap.
 */
export function useDiaryRange(from: string, to: string) {
  const { session, user } = useAuth()
  const { socket } = useSocket()
  const [days, setDays] = useState<DiaryDay[] | null>(null)
  const [bookings, setBookings] = useState<DiaryBooking[] | null>(null)
  const [operatingDays, setOperatingDays] = useState<number[] | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  const siteId = user?.site?.id

  const fetchRange = useCallback(async (silent = false) => {
    if (!session?.accessToken) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (siteId) params.set('siteId', siteId)
      const data = await api<DiaryRangeResponse>(
        `/api/v1/booking-diary/range?${params}`,
        { token: session.accessToken }
      )
      setDays(data.days)
      setBookings(data.bookings)
      setOperatingDays(data.operatingDays)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diary')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [session?.accessToken, siteId, from, to])

  useEffect(() => { fetchRange() }, [fetchRange])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchRange(true), REFRESH_DEBOUNCE_MS)
  }, [fetchRange])

  useEffect(() => {
    if (!socket) return
    LIVE_EVENTS.forEach(event => socket.on(event, scheduleRefresh))
    return () => {
      LIVE_EVENTS.forEach(event => socket.off(event, scheduleRefresh))
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [socket, scheduleRefresh])

  useEffect(() => {
    const interval = setInterval(() => fetchRange(true), POLL_FALLBACK_MS)
    return () => clearInterval(interval)
  }, [fetchRange])

  return { days, bookings, operatingDays, loading, error, refresh: fetchRange }
}

/**
 * All bookings + capacity for a single day (the drill-in). Fetches when `date`
 * is set; clears when null.
 */
export function useDiaryDay(date: string | null) {
  const { session, user } = useAuth()
  const { socket } = useSocket()
  const [detail, setDetail] = useState<DiaryDayDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef = useRef(false)

  const siteId = user?.site?.id

  const fetchDay = useCallback(async (silent = false) => {
    if (!date || !session?.accessToken) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ date })
      if (siteId) params.set('siteId', siteId)
      const data = await api<DiaryDayDetail>(
        `/api/v1/booking-diary/day?${params}`,
        { token: session.accessToken }
      )
      setDetail(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load day')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [session?.accessToken, siteId, date])

  useEffect(() => {
    if (date) fetchDay()
    else setDetail(null)
  }, [date, fetchDay])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchDay(true), REFRESH_DEBOUNCE_MS)
  }, [fetchDay])

  useEffect(() => {
    if (!socket || !date) return
    LIVE_EVENTS.forEach(event => socket.on(event, scheduleRefresh))
    return () => {
      LIVE_EVENTS.forEach(event => socket.off(event, scheduleRefresh))
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [socket, date, scheduleRefresh])

  return { detail, loading, error, refresh: fetchDay }
}
