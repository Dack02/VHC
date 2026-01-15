import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedLayout from './layouts/ProtectedLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import TemplateList from './pages/Templates/TemplateList'
import TemplateBuilder from './pages/Templates/TemplateBuilder'
import Customers from './pages/Customers'
import HealthCheckList from './pages/HealthChecks/HealthCheckList'
import HealthCheckDetail from './pages/HealthChecks/HealthCheckDetail'
import NewHealthCheck from './pages/HealthChecks/NewHealthCheck'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedLayout />}>
            <Route element={<DashboardLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/health-checks" element={<HealthCheckList />} />
              <Route path="/health-checks/new" element={<NewHealthCheck />} />
              <Route path="/health-checks/:id" element={<HealthCheckDetail />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/templates" element={<TemplateList />} />
              <Route path="/templates/:id" element={<TemplateBuilder />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
