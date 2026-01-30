import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, setActiveOrgId } from '../lib/api'

interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isOrgAdmin?: boolean
  isSiteAdmin?: boolean
  organization: {
    id: string
    name: string
    slug: string
    status?: 'active' | 'pending' | 'suspended' | 'cancelled'
    onboardingCompleted?: boolean
    onboardingStep?: number
  }
  site: {
    id: string
    name: string
  } | null
}

export interface OrgMembership {
  id: string       // organization ID
  name: string
  slug: string
  role: string
  userId: string   // user record ID for this org
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
  organizations: OrgMembership[]
  activeOrgId: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  switchOrganization: (orgId: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const SESSION_KEY = 'vhc_session'
const USER_KEY = 'vhc_user'
const ORGS_KEY = 'vhc_organizations'
const ACTIVE_ORG_KEY = 'vhc_active_org_id'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(USER_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [session, setSession] = useState<Session | null>(() => {
    const stored = localStorage.getItem(SESSION_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [organizations, setOrganizations] = useState<OrgMembership[]>(() => {
    const stored = localStorage.getItem(ORGS_KEY)
    return stored ? JSON.parse(stored) : []
  })
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_ORG_KEY) || null
  })
  const [loading, setLoading] = useState(true)

  // Sync activeOrgId to api module on mount and changes
  useEffect(() => {
    setActiveOrgId(activeOrgId)
  }, [activeOrgId])

  useEffect(() => {
    // Check if session is still valid on mount
    const checkSession = async () => {
      // Restore activeOrgId to api module
      const storedOrgId = localStorage.getItem(ACTIVE_ORG_KEY)
      if (storedOrgId) {
        setActiveOrgId(storedOrgId)
      }

      if (session?.accessToken) {
        try {
          const userData = await api<User & { organizations?: OrgMembership[] }>('/api/v1/auth/me', {
            token: session.accessToken
          })
          const { organizations: orgs, ...userOnly } = userData
          setUser(userOnly)
          localStorage.setItem(USER_KEY, JSON.stringify(userOnly))

          if (orgs && orgs.length > 0) {
            setOrganizations(orgs)
            localStorage.setItem(ORGS_KEY, JSON.stringify(orgs))
          }
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
    setOrganizations([])
    setActiveOrgIdState(null)
    setActiveOrgId(null)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(ORGS_KEY)
    localStorage.removeItem(ACTIVE_ORG_KEY)
  }

  const login = async (email: string, password: string) => {
    const data = await api<{ user: User; session: Session; organizations?: OrgMembership[] }>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password }
    })

    setUser(data.user)
    setSession(data.session)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    localStorage.setItem(SESSION_KEY, JSON.stringify(data.session))

    // Store organizations list
    const orgs = data.organizations || []
    setOrganizations(orgs)
    localStorage.setItem(ORGS_KEY, JSON.stringify(orgs))

    // Set active org from the user's current org
    const orgId = data.user.organization?.id || null
    setActiveOrgIdState(orgId)
    setActiveOrgId(orgId)
    if (orgId) {
      localStorage.setItem(ACTIVE_ORG_KEY, orgId)
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
    const userData = await api<User & { organizations?: OrgMembership[] }>('/api/v1/auth/me', {
      token: data.session.accessToken
    })
    const { organizations: orgs, ...userOnly } = userData
    setUser(userOnly)
    localStorage.setItem(USER_KEY, JSON.stringify(userOnly))

    if (orgs && orgs.length > 0) {
      setOrganizations(orgs)
      localStorage.setItem(ORGS_KEY, JSON.stringify(orgs))
    }
  }

  const switchOrganization = async (orgId: string) => {
    if (!session?.accessToken) return

    // Call switch-org endpoint to update preferences and get new user data
    const data = await api<{ user: User }>('/api/v1/auth/switch-org', {
      method: 'POST',
      token: session.accessToken,
      body: { organizationId: orgId }
    })

    // Update state
    setUser(data.user)
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))

    setActiveOrgIdState(orgId)
    setActiveOrgId(orgId)
    localStorage.setItem(ACTIVE_ORG_KEY, orgId)

    // Full page reload for clean state (branding, socket, cached data)
    window.location.reload()
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      organizations,
      activeOrgId,
      login,
      logout,
      refreshSession,
      switchOrganization
    }}>
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
