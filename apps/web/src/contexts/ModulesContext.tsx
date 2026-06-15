import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../lib/api'
import type { ModuleKey } from '../lib/modules'

interface ModulesContextType {
  modules: Record<string, boolean>
  isEnabled: (key: ModuleKey) => boolean
  loading: boolean
}

const ModulesContext = createContext<ModulesContextType | undefined>(undefined)

/**
 * Provides the current organisation's effective module set (GET /api/v1/modules)
 * for gating nav/routes. Optimistic-on: while loading or on fetch error, modules
 * read as enabled — the API's requireModule middleware is the real guard, so this
 * only affects discoverability/UX, never security.
 */
export function ModulesProvider({ children }: { children: ReactNode }) {
  const { session, activeOrgId } = useAuth()
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.accessToken) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api<{ modules: Record<string, boolean> }>('/api/v1/modules', { token: session.accessToken })
      .then((d) => { if (!cancelled) setModules(d.modules || {}) })
      .catch(() => { /* optimistic-on: leave modules unset -> isEnabled returns true */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session?.accessToken, activeOrgId])

  const isEnabled = (key: ModuleKey) => modules[key] !== false

  return (
    <ModulesContext.Provider value={{ modules, isEnabled, loading }}>
      {children}
    </ModulesContext.Provider>
  )
}

export function useModules(): ModulesContextType {
  const ctx = useContext(ModulesContext)
  // Fallback when used outside a provider: treat everything as enabled.
  if (!ctx) return { modules: {}, isEnabled: () => true, loading: false }
  return ctx
}
