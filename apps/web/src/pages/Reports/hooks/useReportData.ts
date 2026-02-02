import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface UseReportDataOptions {
  endpoint: string
  queryString: string
  enabled?: boolean
}

interface UseReportDataResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useReportData<T>({ endpoint, queryString, enabled = true }: UseReportDataOptions): UseReportDataResult<T> {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!token || !enabled) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const result = await api<T>(`${endpoint}?${queryString}`, { token })
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [endpoint, queryString, token, enabled])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}
