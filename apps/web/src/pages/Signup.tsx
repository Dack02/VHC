import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import GoogleAuthButton from '../components/GoogleAuthButton'

interface SignupConfig {
  enabled: boolean
  platformName: string
  termsUrl: string | null
  privacyUrl: string | null
}

// Defined at module scope (not inside Signup) so it isn't recreated each render —
// otherwise the form would remount on every keystroke and inputs would lose focus.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <div className="text-center mb-8">
            <img src="/ollo-inspect-logo.png" alt="Ollo Inspect" className="h-24 mx-auto mb-4" />
            <p className="text-gray-600">Create your account</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function Signup() {
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [form, setForm] = useState({
    organizationName: '',
    adminFirstName: '',
    adminLastName: '',
    adminEmail: ''
  })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    api<SignupConfig>('/api/v1/auth/signup-config')
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, platformName: 'Vehicle Health Check', termsUrl: null, privacyUrl: null }))
      .finally(() => setLoadingConfig(false))
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!acceptTerms) {
      setError('Please accept the terms to continue')
      return
    }

    setLoading(true)
    try {
      await api('/api/v1/auth/signup', {
        method: 'POST',
        body: { ...form, acceptTerms }
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loadingConfig) {
    return <Card><div className="text-center text-gray-500 py-8">Loading...</div></Card>
  }

  if (!config?.enabled) {
    return (
      <Card>
        <div className="text-center space-y-4">
          <p className="text-gray-700">Self-service signups are currently closed.</p>
          <p className="text-sm text-gray-500">Please contact us to get your organisation set up.</p>
          <Link to="/login" className="inline-block text-primary hover:underline text-sm">
            Back to sign in
          </Link>
        </div>
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card>
        <div className="text-center space-y-4">
          <div className="mx-auto w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-700">
            Almost there! Check <strong>{form.adminEmail}</strong> for a link to set your password and finish setting up your account.
          </p>
          <Link to="/login" className="inline-block text-primary hover:underline text-sm">
            Back to sign in
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <GoogleAuthButton label="Sign up with Google" />

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="organizationName" className="block text-sm font-medium text-gray-700 mb-1">
            Business name
          </label>
          <input
            id="organizationName"
            name="organizationName"
            type="text"
            value={form.organizationName}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="ABC Motors Ltd"
            required
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="adminFirstName" className="block text-sm font-medium text-gray-700 mb-1">
              First name
            </label>
            <input
              id="adminFirstName"
              name="adminFirstName"
              type="text"
              value={form.adminFirstName}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              required
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="adminLastName" className="block text-sm font-medium text-gray-700 mb-1">
              Last name
            </label>
            <input
              id="adminLastName"
              name="adminLastName"
              type="text"
              value={form.adminLastName}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              required
              disabled={loading}
            />
          </div>
        </div>

        <div>
          <label htmlFor="adminEmail" className="block text-sm font-medium text-gray-700 mb-1">
            Work email
          </label>
          <input
            id="adminEmail"
            name="adminEmail"
            type="email"
            value={form.adminEmail}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="you@yourbusiness.com"
            required
            disabled={loading}
          />
        </div>

        <label className="flex items-start space-x-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
            disabled={loading}
          />
          <span>
            I agree to the
            {config.termsUrl ? (
              <> <a href={config.termsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms of Service</a></>
            ) : ' Terms of Service'}
            {config.privacyUrl && (
              <> and <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a></>
            )}
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Creating account...' : 'Create account'}
        </button>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </form>
    </Card>
  )
}
