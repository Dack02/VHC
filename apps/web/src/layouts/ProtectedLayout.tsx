import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ModulesProvider } from '../contexts/ModulesContext'

export default function ProtectedLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Org admins must finish (or explicitly skip) onboarding before using the app.
  // The onboarding wizard itself lives at /onboarding, so don't redirect there.
  if (
    user.isOrgAdmin &&
    user.organization?.onboardingCompleted === false &&
    location.pathname !== '/onboarding'
  ) {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <ModulesProvider>
      <Outlet />
    </ModulesProvider>
  )
}
