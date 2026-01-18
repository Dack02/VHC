import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
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
          // Not a super admin or session expired
          clearSession()
        }
      }
      setLoading(false)
    }

    checkSession()
  }, [])

  const clearSession = () => {
    setSuperAdmin(null)
    setSession(null)
    localStorage.removeItem(SUPER_ADMIN_SESSION_KEY)
    localStorage.removeItem(SUPER_ADMIN_KEY)
  }

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
