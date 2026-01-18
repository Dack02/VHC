import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SuperAdminProvider } from './contexts/SuperAdminContext'
import { BrandingProvider } from './contexts/BrandingContext'
import { SocketProvider } from './contexts/SocketContext'
import { ToastProvider } from './contexts/ToastContext'
import { PageErrorBoundary } from './components/ErrorBoundary'
import ProtectedLayout from './layouts/ProtectedLayout'
import DashboardLayout from './layouts/DashboardLayout'
import AdminLayout from './layouts/AdminLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import TemplateList from './pages/Templates/TemplateList'
import TemplateBuilder from './pages/Templates/TemplateBuilder'
import Customers from './pages/Customers'
import HealthCheckList from './pages/HealthChecks/HealthCheckList'
import HealthCheckDetail from './pages/HealthChecks/HealthCheckDetail'
import NewHealthCheck from './pages/HealthChecks/NewHealthCheck'
import TyreManufacturers from './pages/Admin/TyreManufacturers'
import TyreSizes from './pages/Admin/TyreSizes'
import InspectionThresholds from './pages/Admin/InspectionThresholds'
import DMSIntegration from './pages/Settings/DMSIntegration'
import NotificationSettings from './pages/Settings/NotificationSettings'
import OrganizationSettings from './pages/Settings/OrganizationSettings'
import Subscription from './pages/Settings/Subscription'
import ReasonLibrary from './pages/Settings/ReasonLibrary'
import ReasonTypes from './pages/Settings/ReasonTypes'
import EditReasons from './pages/Settings/EditReasons'
import ReasonSubmissions from './pages/Settings/ReasonSubmissions'
import ReasonAnalytics from './pages/Settings/ReasonAnalytics'
import AIUsage from './pages/Settings/AIUsage'
import AIUsageHistory from './pages/Settings/AIUsageHistory'
import CustomerPortal from './pages/CustomerPortal/CustomerPortal'
import AdminLogin from './pages/Admin/AdminLogin'
import AdminDashboard from './pages/Admin/AdminDashboard'
import AdminOrganizations from './pages/Admin/AdminOrganizations'
import AdminOrganizationDetail from './pages/Admin/AdminOrganizationDetail'
import AdminPlans from './pages/Admin/AdminPlans'
import AdminActivity from './pages/Admin/AdminActivity'
import AdminSettings from './pages/Admin/AdminSettings'
import AdminStarterTemplate from './pages/Admin/AdminStarterTemplate'
import AIConfiguration from './pages/Admin/AIConfiguration'
import AIUsageDashboard from './pages/Admin/AIUsageDashboard'
import ImpersonationBanner from './components/admin/ImpersonationBanner'
import SuspendedBanner from './components/SuspendedBanner'
import Onboarding from './pages/Onboarding'
import KanbanBoard from './pages/Dashboard/KanbanBoard'
import TechnicianWorkload from './pages/Dashboard/TechnicianWorkload'
import Reports from './pages/Reports'

function App() {
  return (
    <PageErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <SuperAdminProvider>
              <BrandingProvider>
                <BrowserRouter>
                  <ImpersonationBanner />
                  <SuspendedBanner />
                  <Routes>
                    {/* Public routes */}
                    <Route path="/view/:token" element={<CustomerPortal />} />
                    <Route path="/login" element={<Login />} />

                    {/* Super Admin Portal routes */}
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="organizations" element={<AdminOrganizations />} />
                      <Route path="organizations/:id" element={<AdminOrganizationDetail />} />
                      <Route path="plans" element={<AdminPlans />} />
                      <Route path="activity" element={<AdminActivity />} />
                      <Route path="ai-usage" element={<AIUsageDashboard />} />
                      <Route path="settings" element={<AdminSettings />} />
                      <Route path="ai-configuration" element={<AIConfiguration />} />
                      <Route path="starter-template" element={<AdminStarterTemplate />} />
                      <Route path="reason-types" element={<ReasonTypes />} />
                    </Route>

                    {/* Onboarding route (protected but no dashboard layout) */}
                    <Route element={<ProtectedLayout />}>
                      <Route path="/onboarding" element={<Onboarding />} />
                    </Route>

                    {/* Main app routes */}
                    <Route element={<ProtectedLayout />}>
                      <Route element={<DashboardLayout />}>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/dashboard/board" element={<KanbanBoard />} />
                        <Route path="/dashboard/technicians" element={<TechnicianWorkload />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/users" element={<Users />} />
                        <Route path="/health-checks" element={<HealthCheckList />} />
                        <Route path="/health-checks/new" element={<NewHealthCheck />} />
                        <Route path="/health-checks/:id" element={<HealthCheckDetail />} />
                        <Route path="/customers" element={<Customers />} />
                        <Route path="/templates" element={<TemplateList />} />
                        <Route path="/templates/:id" element={<TemplateBuilder />} />
                        <Route path="/admin/tyre-manufacturers" element={<TyreManufacturers />} />
                        <Route path="/admin/tyre-sizes" element={<TyreSizes />} />
                        <Route path="/settings/thresholds" element={<InspectionThresholds />} />
                        <Route path="/settings/integrations" element={<DMSIntegration />} />
                        <Route path="/settings/notifications" element={<NotificationSettings />} />
                        <Route path="/settings/organization" element={<OrganizationSettings />} />
                        <Route path="/settings/subscription" element={<Subscription />} />
                        <Route path="/settings/reasons" element={<ReasonLibrary />} />
                        <Route path="/settings/reason-types" element={<ReasonTypes />} />
                        <Route path="/settings/reasons/type/:type" element={<EditReasons />} />
                        <Route path="/settings/reasons/item/:itemId" element={<EditReasons />} />
                        <Route path="/settings/reason-submissions" element={<ReasonSubmissions />} />
                        <Route path="/settings/reason-analytics" element={<ReasonAnalytics />} />
                        <Route path="/settings/ai-usage" element={<AIUsage />} />
                        <Route path="/settings/ai-usage/history" element={<AIUsageHistory />} />
                      </Route>
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </BrowserRouter>
              </BrandingProvider>
            </SuperAdminProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </PageErrorBoundary>
  )
}

export default App
