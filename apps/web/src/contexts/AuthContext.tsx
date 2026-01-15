import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api } from '../lib/api'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  organization: {
    id: string
    name: string
    slug: string
  }
  site: {
    id: string
    name: string
  } | null
}

interface Session {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const SESSION_KEY = 'vhc_session'
const USER_KEY = 'vhc_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(USER_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [session, setSession] = useState<Session | null>(() => {
    const stored = localStorage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if session is still valid on mount
    const checkSession = async () => {
      if (session?.accessToken) {
        try {
          const userData = await api<User>('/api/v1/auth/me', {
            token: session.accessToken
          })
          setUser(userData)
          localStorage.setItem(USER_KEY, JSON.stringify(userData))
        } catch {
          // Session expired, try refresh
          if (session.refreshToken) {
            try {
              await refreshSession()
            } catch {
              // Refresh failed, clear session
              clearSession()
            }
          } else {
            clearSession()
          }
        }
      }
      setLoading(false)
    }

    checkSession()
  }, [])

  const clearSession = () => {
    setUser(null)
    setSession(null)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(USER_KEY)
  }

  const login = async (email: string, password: string) => {
    const data = await api<{ user: User; session: Session }>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password }
    })

    setUser(data.user)
    setSession(data.session)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    localStorage.setItem(SESSION_KEY, JSON.stringify(data.session))
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

  const refreshSession = async () => {
    if (!session?.refreshToken) {
      throw new Error('No refresh token')
    }

    const data = await api<{ session: Session }>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: session.refreshToken }
    })

    setSession(data.session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(data.session))

    // Fetch updated user data
    const userData = await api<User>('/api/v1/auth/me', {
      token: data.session.accessToken
    })
    setUser(userData)
    localStorage.setItem(USER_KEY, JSON.stringify(userData))
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, login, logout, refreshSession }}>
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
