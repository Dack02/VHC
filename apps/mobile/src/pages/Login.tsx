import { useState, FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { usePWA } from '../hooks/usePWA'

export function Login() {
  const { session, user, loading, signIn } = useAuth()
  const { canInstall, promptInstall, isOnline } = usePWA()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  // Only redirect if we have BOTH session AND user
  if (session && user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)

    const result = await signIn(email, password)

    if (result.error) {
      setError(result.error)
    }

    setIsSubmitting(false)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* Offline indicator */}
      {!isOnline && (
        <div className="bg-rag-amber text-white text-center py-2 text-sm">
          You are offline. Some features may be unavailable.
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center px-6 py-12">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <div className="bg-primary w-16 h-16 mx-auto flex items-center justify-center">
            <span className="text-white text-2xl font-bold">VHC</span>
          </div>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            Technician Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Vehicle Health Check System
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-sm">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="email"
              required
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />

            {error && (
              <div className="bg-rag-red-bg text-rag-red p-3 text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={isSubmitting}
              disabled={!isOnline}
            >
              Sign In
            </Button>
          </form>

          {canInstall && (
            <div className="mt-6 text-center">
              <p className="text-sm text-gray-500 mb-2">
                Install this app for the best experience
              </p>
              <Button
                variant="secondary"
                onClick={promptInstall}
                fullWidth
              >
                Install App
              </Button>
            </div>
          )}
        </div>
      </div>

      <footer className="py-4 text-center text-sm text-gray-500">
        VHC Technician v1.0
      </footer>
    </div>
  )
}
