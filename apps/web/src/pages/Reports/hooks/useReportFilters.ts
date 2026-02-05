import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export type DatePreset = '7d' | '30d' | '90d' | 'ytd' | 'custom'
export type GroupBy = 'day' | 'week' | 'month'

export interface ReportFilters {
  datePreset: DatePreset
  dateFrom: string
  dateTo: string
  groupBy: GroupBy
  siteId: string | null
  technicianId: string | null
  advisorId: string | null
  customFrom: string
  customTo: string
}

function getPresetDateRange(preset: DatePreset): { from: Date; to: Date } {
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  let from: Date

  switch (preset) {
    case '7d':
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '90d':
      from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case 'ytd': {
      from = new Date(to.getFullYear(), 0, 1)
      break
    }
    default:
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  }

  from.setHours(0, 0, 0, 0)
  return { from, to }
}

export function useReportFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters: ReportFilters = useMemo(() => {
    const preset = (searchParams.get('period') || '30d') as DatePreset
    const groupBy = (searchParams.get('group_by') || 'day') as GroupBy
    const siteId = searchParams.get('site_id') || null
    const technicianId = searchParams.get('technician_id') || null
    const advisorId = searchParams.get('advisor_id') || null

    // Custom date values from URL (YYYY-MM-DD format)
    const customFrom = searchParams.get('from') || ''
    const customTo = searchParams.get('to') || ''

    let dateFrom: string
    let dateTo: string

    if (preset === 'custom') {
      if (customFrom && customTo) {
        dateFrom = new Date(customFrom).toISOString()
        dateTo = new Date(customTo).toISOString()
      } else {
        const range = getPresetDateRange('30d')
        dateFrom = range.from.toISOString()
        dateTo = range.to.toISOString()
      }
    } else {
      const range = getPresetDateRange(preset)
      dateFrom = range.from.toISOString()
      dateTo = range.to.toISOString()
    }

    return { datePreset: preset, dateFrom, dateTo, groupBy, siteId, technicianId, advisorId, customFrom, customTo }
  }, [searchParams])

  const setFilter = useCallback((key: string, value: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      return next
    })
  }, [setSearchParams])

  const setDatePreset = useCallback((preset: DatePreset) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('period', preset)
      next.delete('from')
      next.delete('to')
      return next
    })
  }, [setSearchParams])

  const setCustomDateRange = useCallback((from: string, to: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('period', 'custom')
      next.set('from', from)
      next.set('to', to)
      return next
    })
  }, [setSearchParams])

  const setGroupBy = useCallback((groupBy: GroupBy) => {
    setFilter('group_by', groupBy)
  }, [setFilter])

  const setSiteId = useCallback((siteId: string | null) => {
    setFilter('site_id', siteId)
  }, [setFilter])

  const setTechnicianId = useCallback((id: string | null) => {
    setFilter('technician_id', id)
  }, [setFilter])

  const setAdvisorId = useCallback((id: string | null) => {
    setFilter('advisor_id', id)
  }, [setFilter])

  // Build query string for API calls
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set('date_from', filters.dateFrom)
    params.set('date_to', filters.dateTo)
    params.set('group_by', filters.groupBy)
    if (filters.siteId) params.set('site_id', filters.siteId)
    if (filters.technicianId) params.set('technician_id', filters.technicianId)
    if (filters.advisorId) params.set('advisor_id', filters.advisorId)
    return params.toString()
  }, [filters])

  return {
    filters,
    queryString,
    setDatePreset,
    setCustomDateRange,
    setGroupBy,
    setSiteId,
    setTechnicianId,
    setAdvisorId,
  }
}
