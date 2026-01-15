import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Login } from './pages/Login'
import { JobList } from './pages/JobList'
import { PreCheck } from './pages/PreCheck'
import { Inspection } from './pages/Inspection'
import { Summary } from './pages/Summary'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

function AppRoutes() {
  const { session, user, loading } = useAuth()

  console.log('AppRoutes render:', { session: !!session, user: !!user, loading })

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
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
  )
}

export default App
