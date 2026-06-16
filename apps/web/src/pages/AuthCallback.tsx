import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

interface SignupConfig {
  enabled: boolean
  platformName: string
  termsUrl: string | null
  privacyUrl: string | null
}

interface AuthenticatedPayload {
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    isSuperAdmin?: boolean
    isOrgAdmin?: boolean
    organization?: { id: string; onboardingCompleted?: boolean } | null
  }
  session: { accessToken: string; refreshToken: string; expiresAt: number }
  organizations?: { id: string; name: string; slug: string; role: string; userId: string }[]
}

type ExchangeResult =
  | AuthenticatedPayload
  | { status: 'needs_signup'; email: string; firstName: string; lastName: string }
  | { status: 'signup_disabled' }

type Tokens = { accessToken: string; refreshToken: string; expiresAt: number | undefined }

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <div className="text-center mb-8">
            <img src="/ollo-inspect-logo.png" alt="Ollo Inspect" className="h-24 mx-auto mb-4" />
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const { loginWithSessionData } = useAuth()

  const [phase, setPhase] = useState<'working' | 'needs_signup' | 'disabled' | 'error'>('working')
  const [error, setError] = useState('')
  const [identity, setIdentity] = useState<{ email: string; firstName: string } | null>(null)
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [orgName, setOrgName] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const tokensRef = useRef<Tokens | null>(null)
  const ranRef = useRef(false)

  // Store the app session and route exactly like the password login page does.
  const finishAuthenticated = (data: AuthenticatedPayload) => {
    loginWithSessionData(data as Parameters<typeof loginWithSessionData>[0])
    // Drop the transient Supabase session (local only — must NOT revoke the refresh
    // token, which our API still uses to refresh the app session).
    supabase.auth.signOut({ scope: 'local' }).catch(() => {})

    const user = data.user
    if (user?.isSuperAdmin) {
      const sessionStr = localStorage.getItem('vhc_session')
      if (sessionStr) {
        localStorage.setItem('vhc_super_admin_session', sessionStr)
        localStorage.setItem(
          'vhc_super_admin',
          JSON.stringify({
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            isActive: true,
          })
        )
      }
      navigate('/', { replace: true })
      return
    }
    if (user?.isOrgAdmin && user.organization?.onboardingCompleted === false) {
      navigate('/onboarding', { replace: true })
      return
    }
    navigate('/', { replace: true })
  }

  const runExchange = async (extra?: { organizationName: string; acceptTerms: boolean }) => {
    const tokens = tokensRef.current
    if (!tokens) return
    const result = await api<ExchangeResult>('/api/v1/auth/oauth/exchange', {
      method: 'POST',
      body: { ...tokens, ...(extra || {}) },
    })

    if ('user' in result && result.user) {
      finishAuthenticated(result)
      return
    }
    if ('status' in result && result.status === 'needs_signup') {
      setIdentity({ email: result.email, firstName: result.firstName })
      api<SignupConfig>('/api/v1/auth/signup-config').then(setConfig).catch(() => {})
      setPhase('needs_signup')
      return
    }
    if ('status' in result && result.status === 'signup_disabled') {
      setPhase('disabled')
      return
    }
    setError('Unexpected response from the server. Please try again.')
    setPhase('error')
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    // Google sent us back with an error (e.g. the user declined consent).
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      setError(params.get('error_description')?.replace(/\+/g, ' ') || 'Google sign-in was cancelled.')
      setPhase('error')
      return
    }

    let unsub: (() => void) | undefined
    const timeout = setTimeout(() => {
      if (unsub) unsub()
      setError('Timed out waiting for Google. Please try signing in again.')
      setPhase('error')
    }, 15000)

    const proceed = async (session: Session) => {
      clearTimeout(timeout)
      if (unsub) unsub()
      tokensRef.current = {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
      }
      try {
        await runExchange()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.')
        setPhase('error')
      }
    }

    // The Supabase client exchanges the ?code in the URL on init (detectSessionInUrl).
    // It may already be ready, or we wait for the auth-state change it fires.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        proceed(data.session)
        return
      }
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) proceed(session)
      })
      unsub = () => sub.subscription.unsubscribe()
    })

    return () => {
      clearTimeout(timeout)
      if (unsub) unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!orgName.trim()) {
      setError('Please enter your business name')
      return
    }
    if (!acceptTerms) {
      setError('Please accept the terms to continue')
      return
    }
    setSubmitting(true)
    try {
      await runExchange({ organizationName: orgName.trim(), acceptTerms: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish sign-up. Please try again.')
      setSubmitting(false)
    }
  }

  if (phase === 'working') {
    return (
      <Card>
        <div className="text-center space-y-4 py-4">
          <div className="mx-auto animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-gray-600">Signing you in…</p>
        </div>
      </Card>
    )
  }

  if (phase === 'disabled') {
    return (
      <Card>
        <div className="text-center space-y-4">
          <p className="text-gray-700">Self-service signups are currently closed.</p>
          <p className="text-sm text-gray-500">
            If you already have an account, please sign in with the email you were invited with.
          </p>
          <Link to="/login" className="inline-block text-primary hover:underline text-sm">
            Back to sign in
          </Link>
        </div>
      </Card>
    )
  }

  if (phase === 'error') {
    return (
      <Card>
        <div className="text-center space-y-4">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
          <Link to="/login" className="inline-block text-primary hover:underline text-sm">
            Back to sign in
          </Link>
        </div>
      </Card>
    )
  }

  // phase === 'needs_signup'
  return (
    <Card>
      <form onSubmit={handleSignupSubmit} className="space-y-5">
        <div className="text-center -mt-2">
          <p className="text-gray-700">
            Welcome{identity?.firstName ? `, ${identity.firstName}` : ''}! Just one more thing to set up your account.
          </p>
          {identity?.email && <p className="text-sm text-gray-500 mt-1">{identity.email}</p>}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>
        )}

        <div>
          <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 mb-1">
            Business name
          </label>
          <input
            id="organizationName"
            name="organizationName"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="ABC Motors Ltd"
            required
            autoFocus
            disabled={submitting}
          />
        </div>

        <label className="flex items-start space-x-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            disabled={submitting}
          />
          <span>
            I agree to the
            {config?.termsUrl ? (
              <>
                {' '}
                <a href={config.termsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Terms of Service
                </a>
              </>
            ) : (
              ' Terms of Service'
            )}
            {config?.privacyUrl && (
              <>
                {' '}
                and{' '}
                <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Privacy Policy
                </a>
              </>
            )}
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </Card>
  )
}
