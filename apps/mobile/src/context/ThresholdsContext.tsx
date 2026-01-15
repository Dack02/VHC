import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api, InspectionThresholds, DEFAULT_THRESHOLDS } from '../lib/api'

interface ThresholdsContextType {
  thresholds: InspectionThresholds
  loading: boolean
  error: string | null
  refetch: () => void
}

const ThresholdsContext = createContext<ThresholdsContextType | null>(null)

export function ThresholdsProvider({ children }: { children: ReactNode }) {
  const { session, user } = useAuth()
  const [thresholds, setThresholds] = useState<InspectionThresholds>(DEFAULT_THRESHOLDS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchThresholds = async () => {
    if (!session || !user?.organizationId) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const data = await api<InspectionThresholds>(
        `/api/v1/organizations/${user.organizationId}/thresholds`,
        { token: session.access_token }
      )

      setThresholds(data)
    } catch (err) {
      console.error('Failed to fetch thresholds:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch thresholds')
      // Keep using defaults on error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchThresholds()
  }, [session, user?.organizationId])

  return (
    <ThresholdsContext.Provider
      value={{
        thresholds,
        loading,
        error,
        refetch: fetchThresholds
      }}
    >
      {children}
    </ThresholdsContext.Provider>
  )
}

export function useThresholds() {
  const context = useContext(ThresholdsContext)
  if (!context) {
    throw new Error('useThresholds must be used within a ThresholdsProvider')
  }
  return context
}
