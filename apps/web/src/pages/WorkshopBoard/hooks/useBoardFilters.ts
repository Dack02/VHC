import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BoardCard } from './useBoardData'

export interface BoardFilters {
  advisorId: string | null
  statusIds: string[]
  serviceTypes: string[]
  customerWaiting: boolean
  loanCar: boolean
  overdue: boolean
  highPriority: boolean
  search: string
}

export function useBoardFilters() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [filters, setFilters] = useState<BoardFilters>({
    advisorId: searchParams.get('advisor') || null,
    statusIds: searchParams.getAll('status'),
    serviceTypes: searchParams.getAll('type'),
    customerWaiting: searchParams.get('wyw') === 'true',
    loanCar: searchParams.get('loan') === 'true',
    overdue: searchParams.get('overdue') === 'true',
    highPriority: searchParams.get('priority') === 'true',
    search: searchParams.get('q') || '',
  })

  const updateFilters = (partial: Partial<BoardFilters>) => {
    const next = { ...filters, ...partial }
    setFilters(next)

    // Sync to URL params
    const params = new URLSearchParams()
    if (next.advisorId) params.set('advisor', next.advisorId)
    next.statusIds.forEach(id => params.append('status', id))
    next.serviceTypes.forEach(t => params.append('type', t))
    if (next.customerWaiting) params.set('wyw', 'true')
    if (next.loanCar) params.set('loan', 'true')
    if (next.overdue) params.set('overdue', 'true')
    if (next.highPriority) params.set('priority', 'true')
    if (next.search) params.set('q', next.search)
    setSearchParams(params, { replace: true })
  }

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.advisorId ||
      filters.statusIds.length ||
      filters.serviceTypes.length ||
      filters.customerWaiting ||
      filters.loanCar ||
      filters.overdue ||
      filters.highPriority ||
      filters.search
    )
  }, [filters])

  const clearFilters = () => {
    setFilters({
      advisorId: null,
      statusIds: [],
      serviceTypes: [],
      customerWaiting: false,
      loanCar: false,
      overdue: false,
      highPriority: false,
      search: '',
    })
    setSearchParams({}, { replace: true })
  }

  const filterCard = (card: BoardCard): boolean => {
    if (filters.advisorId && card.advisor?.id !== filters.advisorId) return false
    if (filters.statusIds.length && card.tcardStatusId && !filters.statusIds.includes(card.tcardStatusId)) return false
    if (filters.customerWaiting && !card.customerWaiting) return false
    if (filters.loanCar && !card.loanCarRequired) return false
    if (filters.highPriority && card.priority === 'normal') return false
    if (filters.overdue && card.promiseTime) {
      const now = new Date()
      const promise = new Date(card.promiseTime)
      if (promise >= now) return false
    }
    if (filters.search) {
      const q = filters.search.toLowerCase()
      const reg = card.vehicle?.registration?.toLowerCase() || ''
      const name = `${card.customer?.firstName || ''} ${card.customer?.lastName || ''}`.toLowerCase()
      const job = card.jobsheetNumber?.toLowerCase() || ''
      if (!reg.includes(q) && !name.includes(q) && !job.includes(q)) return false
    }
    return true
  }

  return { filters, updateFilters, clearFilters, hasActiveFilters, filterCard }
}
