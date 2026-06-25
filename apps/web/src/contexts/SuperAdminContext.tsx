import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { api } from '../lib/api'

interface SuperAdmin {
  id: string
  email: string
  name: string
  isActive: boolean
}

interface SuperAdminSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface SuperAdminContextType {
  superAdmin: SuperAdmin | null
  session: SuperAdminSession | null
  loading: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  isSuperAdmin: boolean
}

const SuperAdminContext = createContext<SuperAdminContextType | undefined>(undefined)

const SUPER_ADMIN_SESSION_KEY = 'vhc_super_admin_session'
const SUPER_ADMIN_KEY = 'vhc_super_admin'

export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const [superAdmin, setSuperAdmin] = useState<SuperAdmin | null>(() => {
    const stored = localStorage.getItem(SUPER_ADMIN_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [session, setSession] = useState<SuperAdminSession | null>(() => {
    const stored = localStorage.getItem(SUPER_ADMIN_SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(true)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRefreshingRef = useRef(false)

  const clearSession = () => {
    setSuperAdmin(null)
    setSession(null)
    localStorage.removeItem(SUPER_ADMIN_SESSION_KEY)
    localStorage.removeItem(SUPER_ADMIN_KEY)
  }

  // Refresh the super-admin access token using the stored refresh token.
  // Reads the session from localStorage (not React state) to avoid a stale
  // closure when invoked from the background timer or visibility listener.
  // Throws if the refresh fails or the refreshed token no longer maps to an
  // active super admin, so callers can clear the session.
  const refreshSession = useCallback(async (): Promise<void> => {
    const stored = localStorage.getItem(SUPER_ADMIN_SESSION_KEY)
    const currentSession: SuperAdminSession | null = stored ? JSON.parse(stored) : null

    if (!currentSession?.refreshToken) {
      throw new Error('No refresh token')
    }

    if (isRefreshingRef.current) return
    isRefreshingRef.current = true

    try {
      const data = await api<{ session: SuperAdminSession }>('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: currentSession.refreshToken }
      })

      const newSession = data.session
      setSession(newSession)
      localStorage.setItem(SUPER_ADMIN_SESSION_KEY, JSON.stringify(newSession))

      // Confirm the refreshed token still maps to an active super admin —
      // /auth/refresh renews the Supabase token regardless of super-admin status.
      await api('/api/v1/admin/stats', {
        token: newSession.accessToken
      })
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  // Verify the stored session on mount; refresh once if the token has expired.
  useEffect(() => {
    const checkSession = async () => {
      if (session?.accessToken) {
        try {
          // Verify super admin access by trying to access admin stats
          await api('/api/v1/admin/stats', {
            token: session.accessToken
          })
          // If successful, session is valid
        } catch {
          // Token may be expired — try refreshing before giving up
          try {
            await refreshSession()
          } catch {
            clearSession()
          }
        }
      }
      setLoading(false)
    }

    checkSession()
  }, [])

  // Background refresh timer: refresh 5 minutes before token expiry so the
  // admin session never goes stale while the tab is open. Without this the
  // super-admin JWT silently expires (~1h) and every admin call returns 401.
  useEffect(() => {
    if (!session?.expiresAt) return

    const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes
    const now = Date.now()
    const expiresAtMs = session.expiresAt * 1000
    const timeUntilRefresh = expiresAtMs - now - REFRESH_BUFFER_MS

    // Refresh immediately if already within the buffer, otherwise at the right time.
    const delay = Math.max(timeUntilRefresh, 0)
    console.log(`[SuperAdmin] Token refresh scheduled in ${Math.round(delay / 1000)}s (expires at ${new Date(expiresAtMs).toLocaleTimeString()})`)

    refreshTimerRef.current = setTimeout(async () => {
      try {
        await refreshSession()
      } catch {
        console.warn('[SuperAdmin] Background token refresh failed, clearing session')
        clearSession()
      }
    }, delay)

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [session?.expiresAt, refreshSession])

  // Visibility change listener: refresh when the user returns to the tab if the
  // token has expired or is near expiry (covers laptop sleep / long idle, where
  // the setTimeout above may have been throttled or not fired).
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return

      const stored = localStorage.getItem(SUPER_ADMIN_SESSION_KEY)
      if (!stored) return
      const currentSession: SuperAdminSession = JSON.parse(stored)
      if (!currentSession?.expiresAt) return

      const REFRESH_BUFFER_MS = 5 * 60 * 1000
      const now = Date.now()
      const expiresAtMs = currentSession.expiresAt * 1000

      if (now >= expiresAtMs - REFRESH_BUFFER_MS) {
        console.log('[SuperAdmin] Tab became visible, token expired or near expiry — refreshing')
        try {
          await refreshSession()
        } catch {
          console.warn('[SuperAdmin] Visibility refresh failed, clearing session')
          clearSession()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshSession])

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      // First, login normally via Supabase
      const data = await api<{ user: { id: string; email: string; firstName: string; lastName: string }; session: SuperAdminSession }>('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password }
      })

      // Then verify super admin access
      try {
        await api('/api/v1/admin/stats', {
          token: data.session.accessToken
        })

        // Success - user is a super admin
        const superAdminData: SuperAdmin = {
          id: data.user.id,
          email: data.user.email,
          name: `${data.user.firstName} ${data.user.lastName}`,
          isActive: true
        }

        setSuperAdmin(superAdminData)
        setSession(data.session)
        localStorage.setItem(SUPER_ADMIN_KEY, JSON.stringify(superAdminData))
        localStorage.setItem(SUPER_ADMIN_SESSION_KEY, JSON.stringify(data.session))
        return true
      } catch {
        // Not a super admin
        return false
      }
    } catch {
      return false
    }
  }

  const logout = async () => {
    if (session?.accessToken) {
      try {
        await api('/api/v1/auth/logout', {
          method: 'POST',
          token: session.accessToken
        })
      } catch {
        // Ignore logout errors
      }
    }
    clearSession()
  }

  return (
    <SuperAdminContext.Provider value={{
      superAdmin,
      session,
      loading,
      login,
      logout,
      isSuperAdmin: !!superAdmin
    }}>
      {children}
    </SuperAdminContext.Provider>
  )
}

export function useSuperAdmin() {
  const context = useContext(SuperAdminContext)
  if (context === undefined) {
    throw new Error('useSuperAdmin must be used within a SuperAdminProvider')
  }
  return context
}

// Safe version that can be used outside the provider - returns default values if not in admin context
export function useSuperAdminSafe() {
  const context = useContext(SuperAdminContext)
  if (context === undefined) {
    return {
      superAdmin: null,
      session: null,
      loading: false,
      isSuperAdmin: false,
      login: async () => {},
      logout: async () => {},
      refreshSession: async () => {}
    }
  }
  return context
}
