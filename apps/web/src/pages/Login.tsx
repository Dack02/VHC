import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // First try to login
      await login(email, password)

      // Get the session from localStorage to check if super admin
      const sessionStr = localStorage.getItem('vhc_session')
      if (sessionStr) {
        const session = JSON.parse(sessionStr)

        // Check if user is a super admin
        try {
          await api('/api/v1/admin/stats', {
            token: session.accessToken
          })

          // User is a super admin - store super admin session and redirect
          localStorage.setItem('vhc_super_admin_session', sessionStr)
          const userStr = localStorage.getItem('vhc_user')
          if (userStr) {
            const user = JSON.parse(userStr)
            localStorage.setItem('vhc_super_admin', JSON.stringify({
              id: user.id,
              email: user.email,
              name: `${user.firstName} ${user.lastName}`,
              isActive: true
            }))
          }
          navigate('/')
          return
        } catch {
          // Not a super admin, continue to regular dashboard
        }

        // Check if org admin needs to complete onboarding
        const userStr = localStorage.getItem('vhc_user')
        if (userStr) {
          const user = JSON.parse(userStr)
          if (user.isOrgAdmin && user.organization?.onboardingCompleted === false) {
            navigate('/onboarding')
            return
          }
        }
      }

      // Regular user - redirect to dashboard
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-200 shadow-sm p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Vehicle Health Check</h1>
            <p className="text-gray-600 mt-2">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-3 font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
