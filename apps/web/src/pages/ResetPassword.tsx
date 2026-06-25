import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Prefetch-safe recovery flow: the email links here with ?token_hash=…&type=recovery.
  // We hold that token and only exchange it on submit (see handleSubmit), so mail
  // scanners / browser link preloaders that merely GET this page never consume it.
  const params = new URLSearchParams(window.location.search)
  const tokenHash = params.get('token_hash')
  const otpType = (params.get('type') as EmailOtpType) || 'recovery'

  // A valid recovery link establishes a Supabase session (parsed from the URL hash
  // by supabase-js). We wait for that session before allowing a password change.
  useEffect(() => {
    // token_hash flow: present the form immediately; verification happens on submit.
    if (tokenHash) {
      setReady(true)
      setChecking(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) {
        setReady(true)
        setChecking(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session) {
        setReady(true)
        setChecking(false)
      }
    })

    // If no recovery session appears, stop waiting and show the invalid-link state.
    const timeout = setTimeout(() => {
      if (active) setChecking(false)
    }, 4000)

    return () => {
      active = false
      sub.subscription.unsubscribe()
      clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      // Prefetch-safe flow: exchange the one-time token now — on a real user action,
      // not on page load — so automated link fetches can't burn it first.
      if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          type: otpType,
          token_hash: tokenHash,
        })
        if (verifyError) {
          // Token is spent, expired, or invalid — drop to the "request a new link" state.
          setReady(false)
          return
        }
      }

      const { data: updateData, error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      // The recovery link proved control of the inbox and the user just chose this
      // password, so log them straight in rather than bouncing to /login to re-type it.
      // (Mirrors the Google flow, which also adopts its session — see AuthCallback.)
      // We sign the temporary recovery session out FIRST, then re-authenticate through
      // the normal login path — that mints a fresh app session, so the sign-out can't
      // revoke the one we're about to depend on.
      const email = updateData.user?.email
      await supabase.auth.signOut()

      if (email) {
        try {
          await login(email, password)

          const userStr = localStorage.getItem('vhc_user')
          const sessionStr = localStorage.getItem('vhc_session')
          const user = userStr ? JSON.parse(userStr) : null

          // Super admins setting a password via the main app: bridge a session for the
          // /admin portal, exactly as the login screen does.
          if (user?.isSuperAdmin && sessionStr) {
            localStorage.setItem('vhc_super_admin_session', sessionStr)
            localStorage.setItem('vhc_super_admin', JSON.stringify({
              id: user.id,
              email: user.email,
              name: `${user.firstName} ${user.lastName}`,
              isActive: true,
            }))
          }

          // New org admins land in the onboarding wizard; everyone else in the app. A
          // full-page load (not client navigate) re-boots every provider cleanly with the
          // freshly persisted session — same reasoning as the OAuth callback.
          const dest =
            user?.isOrgAdmin && user.organization?.onboardingCompleted === false
              ? '/onboarding'
              : '/'
          window.location.replace(dest)
          return
        } catch {
          // Auto sign-in failed for some reason — fall back to the manual login screen
          // below. The password itself was updated successfully.
        }
      }

      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <div className="text-center mb-8">
            <img src="/ollo-inspect-logo.png" alt="Ollo Inspect" className="h-24 mx-auto mb-4" />
            <p className="text-gray-600">Set a new password</p>
          </div>

          {checking ? (
            <div className="text-center text-gray-500 py-8">Verifying your link...</div>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-700">Your password has been updated. Redirecting you to sign in...</p>
            </div>
          ) : !ready ? (
            <div className="text-center space-y-4">
              <p className="text-gray-700">
                This password reset link is invalid or has expired.
              </p>
              <Link to="/forgot-password" className="inline-block text-primary hover:underline text-sm">
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="At least 8 characters"
                  required
                  disabled={saving}
                />
              </div>

              <div>
                <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Re-enter your new password"
                  required
                  disabled={saving}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Updating...' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
