import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { api, User, setActiveOrgId, setTokenRefreshCallback } from '../lib/api'

interface AuthContextType {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRefreshingRef = useRef(false)

  const clearAuth = useCallback(() => {
    setSession(null)
    setUser(null)
    setActiveOrgId(null)
  }, [])

  const refreshSupabaseSession = useCallback(async (): Promise<Session | null> => {
    if (isRefreshingRef.current) return null
    isRefreshingRef.current = true

    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data.session) {
        console.warn('[Auth] Session refresh failed:', error?.message)
        return null
      }
      console.log('[Auth] Session refreshed successfully')
      return data.session
    } finally {
      isRefreshingRef.current = false
    }
  }, [])

  const fetchUser = useCallback(async (token: string): Promise<boolean> => {
    try {
      const data = await api<any>('/api/v1/auth/me', { token })
      const orgId = data.organization?.id || data.organizationId
      if (orgId) {
        setActiveOrgId(orgId)
      }
      setUser(data)
      return true
    } catch (error) {
      console.error('[Auth] Failed to fetch user:', error)
      setUser(null)
      return false
    }
  }, [])

  // Initial session restore with refresh fallback
  useEffect(() => {
    const initSession = async () => {
      const { data: { session: initialSession } } = await supabase.auth.getSession()

      if (initialSession) {
        setSession(initialSession)
        const success = await fetchUser(initialSession.access_token)

        if (!success) {
          // Token may be expired — try refreshing
          console.log('[Auth] Initial token failed, attempting refresh...')
          const refreshed = await refreshSupabaseSession()
          if (refreshed) {
            setSession(refreshed)
            const retrySuccess = await fetchUser(refreshed.access_token)
            if (!retrySuccess) {
              console.warn('[Auth] Refresh succeeded but user fetch still failed, clearing session')
              clearAuth()
            }
          } else {
            console.warn('[Auth] Session refresh failed on init, clearing')
            clearAuth()
          }
        }
      }

      setLoading(false)
    }

    initSession()

    // Listen for auth changes (sign in, sign out, token refresh from SDK)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession)
        if (newSession) {
          await fetchUser(newSession.access_token)
        } else {
          setUser(null)
          setActiveOrgId(null)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [fetchUser, refreshSupabaseSession, clearAuth])

  // Proactive refresh timer: refresh 5 minutes before token expiry
  useEffect(() => {
    if (!session?.expires_at) return

    const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes
    const now = Date.now()
    const expiresAtMs = session.expires_at * 1000
    const delay = Math.max(expiresAtMs - now - REFRESH_BUFFER_MS, 0)

    console.log(`[Auth] Token refresh scheduled in ${Math.round(delay / 1000)}s (expires at ${new Date(expiresAtMs).toLocaleTimeString()})`)

    refreshTimerRef.current = setTimeout(async () => {
      const refreshed = await refreshSupabaseSession()
      if (refreshed) {
        setSession(refreshed)
      } else {
        console.warn('[Auth] Proactive refresh failed, clearing session')
        clearAuth()
      }
    }, delay)

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [session?.expires_at, refreshSupabaseSession, clearAuth])

  // Visibility change listener: refresh when app/tab comes back to foreground
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return

      const { data: { session: currentSession } } = await supabase.auth.getSession()
      if (!currentSession?.expires_at) return

      const REFRESH_BUFFER_MS = 5 * 60 * 1000
      const now = Date.now()
      const expiresAtMs = currentSession.expires_at * 1000

      if (now >= expiresAtMs - REFRESH_BUFFER_MS) {
        console.log('[Auth] App became visible, token expired or near expiry — refreshing')
        const refreshed = await refreshSupabaseSession()
        if (refreshed) {
          setSession(refreshed)
          await fetchUser(refreshed.access_token)
        } else {
          console.warn('[Auth] Visibility refresh failed, clearing session')
          clearAuth()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshSupabaseSession, fetchUser, clearAuth])

  // Register token refresh callback for the API client (401 auto-refresh)
  useEffect(() => {
    setTokenRefreshCallback(async () => {
      const refreshed = await refreshSupabaseSession()
      return refreshed?.access_token ?? null
    })
    return () => setTokenRefreshCallback(null)
  }, [refreshSupabaseSession])

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        return { error: error.message }
      }

      if (data.session) {
        setSession(data.session)
        await fetchUser(data.session.access_token)
      }

      return {}
    } catch (error) {
      return { error: 'An unexpected error occurred' }
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    clearAuth()
  }

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
