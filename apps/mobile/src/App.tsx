import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThresholdsProvider } from './context/ThresholdsContext'
import { ToastProvider } from './context/ToastContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Login } from './pages/Login'
import { JobList } from './pages/JobList'

const PreCheck = lazy(() => import('./pages/PreCheck').then(m => ({ default: m.PreCheck })))
const Inspection = lazy(() => import('./pages/Inspection').then(m => ({ default: m.Inspection })))
const Summary = lazy(() => import('./pages/Summary').then(m => ({ default: m.Summary })))

const PageSpinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-100">
    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
  </div>
)

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <ThresholdsProvider>
              <AppRoutes />
            </ThresholdsProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  )
}

function AppRoutes() {
  const { session, user, loading } = useAuth()

  console.log('AppRoutes render:', { session: !!session, user: !!user, loading })

  if (loading) {
    return <PageSpinner />
  }

  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            session && user ? <JobList /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/job/:id/pre-check"
          element={
            session && user ? <PreCheck /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/job/:id/inspection"
          element={
            session && user ? <Inspection /> : <Navigate to="/login" replace />
          }
        />
        <Route
          path="/job/:id/summary"
          element={
            session && user ? <Summary /> : <Navigate to="/login" replace />
          }
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
