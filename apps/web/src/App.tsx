import { lazy, Suspense } from 'react'
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
import ImpersonationBanner from './components/admin/ImpersonationBanner'
import SuspendedBanner from './components/SuspendedBanner'

// Eager: Login (entry point for unauthenticated users)
import Login from './pages/Login'

// Lazy: All other page components
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Users = lazy(() => import('./pages/Users'))
const TemplateList = lazy(() => import('./pages/Templates/TemplateList'))
const TemplateBuilder = lazy(() => import('./pages/Templates/TemplateBuilder'))
const CustomerList = lazy(() => import('./pages/Customers/CustomerList'))
const CustomerDetail = lazy(() => import('./pages/Customers/CustomerDetail'))
const HealthCheckList = lazy(() => import('./pages/HealthChecks/HealthCheckList'))
const HealthCheckDetail = lazy(() => import('./pages/HealthChecks/HealthCheckDetail'))
const NewHealthCheck = lazy(() => import('./pages/HealthChecks/NewHealthCheck'))
const TyreManufacturers = lazy(() => import('./pages/Admin/TyreManufacturers'))
const TyreSizes = lazy(() => import('./pages/Admin/TyreSizes'))
const InspectionThresholds = lazy(() => import('./pages/Admin/InspectionThresholds'))
const DMSIntegration = lazy(() => import('./pages/Settings/DMSIntegration'))
const NotificationSettings = lazy(() => import('./pages/Settings/NotificationSettings'))
const OrganizationSettings = lazy(() => import('./pages/Settings/OrganizationSettings'))
const Subscription = lazy(() => import('./pages/Settings/Subscription'))
const ReasonLibrary = lazy(() => import('./pages/Settings/ReasonLibrary'))
const ReasonTypes = lazy(() => import('./pages/Settings/ReasonTypes'))
const EditReasons = lazy(() => import('./pages/Settings/EditReasons'))
const ReasonSubmissions = lazy(() => import('./pages/Settings/ReasonSubmissions'))
const ReasonAnalytics = lazy(() => import('./pages/Settings/ReasonAnalytics'))
const AIUsage = lazy(() => import('./pages/Settings/AIUsage'))
const AIUsageHistory = lazy(() => import('./pages/Settings/AIUsageHistory'))
const LabourCodes = lazy(() => import('./pages/Settings/LabourCodes'))
const Suppliers = lazy(() => import('./pages/Settings/Suppliers'))
const SupplierTypes = lazy(() => import('./pages/Settings/SupplierTypes'))
const PricingSettings = lazy(() => import('./pages/Settings/PricingSettings'))
const DeclinedReasons = lazy(() => import('./pages/Settings/DeclinedReasons'))
const DeletedReasons = lazy(() => import('./pages/Settings/DeletedReasons'))
const HcDeletionReasons = lazy(() => import('./pages/Settings/HcDeletionReasons'))
const WorkflowSettings = lazy(() => import('./pages/Settings/WorkflowSettings'))
const MriItemsSettings = lazy(() => import('./pages/Settings/MriItemsSettings'))
const MessageTemplates = lazy(() => import('./pages/Settings/MessageTemplates'))
const SettingsHub = lazy(() => import('./pages/Settings/SettingsHub'))
const CustomerPortal = lazy(() => import('./pages/CustomerPortal/CustomerPortal'))
const AdminLogin = lazy(() => import('./pages/Admin/AdminLogin'))
const AdminDashboard = lazy(() => import('./pages/Admin/AdminDashboard'))
const AdminOrganizations = lazy(() => import('./pages/Admin/AdminOrganizations'))
const AdminOrganizationDetail = lazy(() => import('./pages/Admin/AdminOrganizationDetail'))
const AdminPlans = lazy(() => import('./pages/Admin/AdminPlans'))
const AdminActivity = lazy(() => import('./pages/Admin/AdminActivity'))
const AdminSettings = lazy(() => import('./pages/Admin/AdminSettings'))
const AdminStarterTemplate = lazy(() => import('./pages/Admin/AdminStarterTemplate'))
const AIConfiguration = lazy(() => import('./pages/Admin/AIConfiguration'))
const AIUsageDashboard = lazy(() => import('./pages/Admin/AIUsageDashboard'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const TechnicianWorkload = lazy(() => import('./pages/Dashboard/TechnicianWorkload'))
const Reports = lazy(() => import('./pages/Reports'))

// Page loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

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
                  <Suspense fallback={<PageLoader />}>
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
                        <Route path="/dashboard/technicians" element={<TechnicianWorkload />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route path="/users" element={<Users />} />
                        <Route path="/health-checks" element={<HealthCheckList />} />
                        <Route path="/health-checks/new" element={<NewHealthCheck />} />
                        <Route path="/health-checks/:id" element={<HealthCheckDetail />} />
                        <Route path="/customers" element={<CustomerList />} />
                        <Route path="/customers/:id" element={<CustomerDetail />} />
                        <Route path="/templates" element={<TemplateList />} />
                        <Route path="/templates/:id" element={<TemplateBuilder />} />
                        <Route path="/settings" element={<SettingsHub />} />
                        <Route path="/settings/tyre-manufacturers" element={<TyreManufacturers />} />
                        <Route path="/settings/tyre-sizes" element={<TyreSizes />} />
                        <Route path="/settings/thresholds" element={<InspectionThresholds />} />
                        <Route path="/settings/integrations" element={<DMSIntegration />} />
                        <Route path="/settings/notifications" element={<NotificationSettings />} />
                        <Route path="/settings/message-templates" element={<MessageTemplates />} />
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
                        <Route path="/settings/labour-codes" element={<LabourCodes />} />
                        <Route path="/settings/suppliers" element={<Suppliers />} />
                        <Route path="/settings/supplier-types" element={<SupplierTypes />} />
                        <Route path="/settings/pricing" element={<PricingSettings />} />
                        <Route path="/settings/declined-reasons" element={<DeclinedReasons />} />
                        <Route path="/settings/deleted-reasons" element={<DeletedReasons />} />
                        <Route path="/settings/vhc-deletion-reasons" element={<HcDeletionReasons />} />
                        <Route path="/settings/workflow" element={<WorkflowSettings />} />
                        <Route path="/settings/mri-items" element={<MriItemsSettings />} />
                      </Route>
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                  </Suspense>
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
