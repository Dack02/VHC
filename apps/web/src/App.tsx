import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { SuperAdminProvider } from './contexts/SuperAdminContext'
import { BrandingProvider } from './contexts/BrandingContext'
import { SocketProvider } from './contexts/SocketContext'
import { ToastProvider } from './contexts/ToastContext'
import { useModules } from './contexts/ModulesContext'
import { PageErrorBoundary } from './components/ErrorBoundary'
import ProtectedLayout from './layouts/ProtectedLayout'
import DashboardLayout from './layouts/DashboardLayout'
import AdminLayout from './layouts/AdminLayout'
import ImpersonationBanner from './components/admin/ImpersonationBanner'
import RequireModule from './components/RequireModule'
import SuspendedBanner from './components/SuspendedBanner'
import RecoveryRedirect from './components/RecoveryRedirect'

// Eager: Login (entry point for unauthenticated users)
import Login from './pages/Login'
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Signup = lazy(() => import('./pages/Signup'))
const AuthCallback = lazy(() => import('./pages/AuthCallback'))

// Lazy: All other page components
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Users = lazy(() => import('./pages/Users'))
const TemplateList = lazy(() => import('./pages/Templates/TemplateList'))
const TemplateBuilder = lazy(() => import('./pages/Templates/TemplateBuilder'))
const TemplatePrint = lazy(() => import('./pages/Templates/TemplatePrint'))
const CustomerList = lazy(() => import('./pages/Customers/CustomerList'))
const CustomerDetail = lazy(() => import('./pages/Customers/CustomerDetail'))
const HealthCheckList = lazy(() => import('./pages/HealthChecks/HealthCheckList'))
const HealthCheckDetail = lazy(() => import('./pages/HealthChecks/HealthCheckDetail'))
const NewHealthCheck = lazy(() => import('./pages/HealthChecks/NewHealthCheck'))
const JobsheetList = lazy(() => import('./pages/Jobsheets/JobsheetList'))
const NewJobsheet = lazy(() => import('./pages/Jobsheets/NewJobsheet'))
const JobsheetDetail = lazy(() => import('./pages/Jobsheets/JobsheetDetail'))
const EstimatesList = lazy(() => import('./pages/Estimates/EstimatesList'))
const NewEstimate = lazy(() => import('./pages/Estimates/NewEstimate'))
const EstimateDetail = lazy(() => import('./pages/Estimates/EstimateDetail'))
const EstimatePortal = lazy(() => import('./pages/EstimatePortal/EstimatePortal'))
const VehicleList = lazy(() => import('./pages/Vehicles/VehicleList'))
const VehicleDetail = lazy(() => import('./pages/Vehicles/VehicleDetail'))
const VehicleExpiryTypes = lazy(() => import('./pages/Settings/VehicleExpiryTypes'))
const VehicleReminderCampaigns = lazy(() => import('./pages/Settings/VehicleReminderCampaigns'))
const ArrivalsHub = lazy(() => import('./pages/Arrivals/ArrivalsHub'))
const BookingCodes = lazy(() => import('./pages/Settings/BookingCodes'))
const ServiceTypes = lazy(() => import('./pages/Settings/ServiceTypes'))
const RepairTypes = lazy(() => import('./pages/Settings/RepairTypes'))
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
const PartCategories = lazy(() => import('./pages/Settings/PartCategories'))
const StockLocations = lazy(() => import('./pages/Settings/StockLocations'))
const PricingSettings = lazy(() => import('./pages/Settings/PricingSettings'))
const DeclinedReasons = lazy(() => import('./pages/Settings/DeclinedReasons'))
const UnableToSendReasons = lazy(() => import('./pages/Settings/UnableToSendReasons'))
const DeletedReasons = lazy(() => import('./pages/Settings/DeletedReasons'))
const HcDeletionReasons = lazy(() => import('./pages/Settings/HcDeletionReasons'))
const WorkflowSettings = lazy(() => import('./pages/Settings/WorkflowSettings'))
const MriItemsSettings = lazy(() => import('./pages/Settings/MriItemsSettings'))
const MessageTemplates = lazy(() => import('./pages/Settings/MessageTemplates'))
const VehicleLocations = lazy(() => import('./pages/Settings/VehicleLocations'))
const SiteManagement = lazy(() => import('./pages/Settings/SiteManagement'))
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
const AdminStarterTemplates = lazy(() => import('./pages/Admin/AdminStarterTemplates'))
const AIConfiguration = lazy(() => import('./pages/Admin/AIConfiguration'))
const AIUsageDashboard = lazy(() => import('./pages/Admin/AIUsageDashboard'))
const AdminUsageDashboard = lazy(() => import('./pages/Admin/AdminUsageDashboard'))
const AdminCommunications = lazy(() => import('./pages/Admin/AdminCommunications'))
const AdminSuperAdmins = lazy(() => import('./pages/Admin/AdminSuperAdmins'))
const AdminSystemHealth = lazy(() => import('./pages/Admin/AdminSystemHealth'))
const AdminAlerts = lazy(() => import('./pages/Admin/AdminAlerts'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const TechnicianWorkload = lazy(() => import('./pages/Dashboard/TechnicianWorkload'))
const ReportsHub = lazy(() => import('./pages/Reports/ReportsHub'))
const FinancialReports = lazy(() => import('./pages/Reports/FinancialReports'))
const ItemPerformance = lazy(() => import('./pages/Reports/ItemPerformance'))
const RepairTypesReport = lazy(() => import('./pages/Reports/RepairTypes'))
const PartsGrossProfit = lazy(() => import('./pages/Reports/PartsGrossProfit'))
const StockValuation = lazy(() => import('./pages/Reports/StockValuation'))
const LowStock = lazy(() => import('./pages/Reports/LowStock'))
const StockMovements = lazy(() => import('./pages/Reports/StockMovements'))
const PartsOnOrder = lazy(() => import('./pages/Reports/PartsOnOrder'))
const NegativeStock = lazy(() => import('./pages/Reports/NegativeStock'))
const TechnicianPerformance = lazy(() => import('./pages/Reports/TechnicianPerformance'))
const AdvisorPerformance = lazy(() => import('./pages/Reports/AdvisorPerformance'))
const CustomerInsights = lazy(() => import('./pages/Reports/CustomerInsights'))
const OperationalEfficiency = lazy(() => import('./pages/Reports/OperationalEfficiency'))
const CapacityUtilisation = lazy(() => import('./pages/Reports/CapacityUtilisation'))
const QualityCompliance = lazy(() => import('./pages/Reports/QualityCompliance'))
const DeferredWork = lazy(() => import('./pages/Reports/DeferredWork'))
const FollowUpRecovery = lazy(() => import('./pages/Reports/FollowUpRecovery'))
const OutreachBookings = lazy(() => import('./pages/Reports/OutreachBookings'))
const MriPerformance = lazy(() => import('./pages/Reports/MriPerformance'))
const DailyOverview = lazy(() => import('./pages/Reports/DailyOverview'))
const DeletedHealthChecks = lazy(() => import('./pages/Reports/DeletedHealthChecks'))
const Today = lazy(() => import('./pages/Today'))
const PartsCatalog = lazy(() => import('./pages/Parts/PartsCatalog'))
const StockList = lazy(() => import('./pages/Parts/StockList'))
const PurchaseOrders = lazy(() => import('./pages/Parts/PurchaseOrders'))
const PurchaseOrderDetail = lazy(() => import('./pages/Parts/PurchaseOrderDetail'))
const Messages = lazy(() => import('./pages/Messages/Messages'))
const NotesPage = lazy(() => import('./pages/Notes/NotesPage'))
const ServicePackages = lazy(() => import('./pages/ServicePackages/ServicePackages'))
const DailySmsOverview = lazy(() => import('./pages/Settings/DailySmsOverview'))
const LibraryGapReport = lazy(() => import('./pages/Settings/LibraryGapReport'))
const WorkshopBoard = lazy(() => import('./pages/WorkshopBoard/WorkshopBoard'))
const WorkshopDaySheet = lazy(() => import('./pages/WorkshopBoard/PrintDaySheet'))
const TileStatus = lazy(() => import('./pages/TileStatus/TileStatusPage'))
const BookingDiary = lazy(() => import('./pages/BookingDiary/BookingDiaryPage'))
const WorkshopStatuses = lazy(() => import('./pages/Settings/WorkshopStatuses'))
const WorkshopBoardSettings = lazy(() => import('./pages/Settings/WorkshopBoardSettings'))
const ResourceManager = lazy(() => import('./pages/Settings/ResourceManager'))
const TechnicianSkills = lazy(() => import('./pages/Settings/TechnicianSkills'))
const TimeTrackingSettings = lazy(() => import('./pages/Settings/TimeTrackingSettings'))
const FollowUpList = lazy(() => import('./pages/FollowUps/FollowUpList'))
const FollowUpOutcomes = lazy(() => import('./pages/Settings/FollowUpOutcomes'))
const FollowUpDispositions = lazy(() => import('./pages/Settings/FollowUpDispositions'))
const FollowUpTimelines = lazy(() => import('./pages/Settings/FollowUpTimelines'))
const FollowUpSettings = lazy(() => import('./pages/Settings/FollowUpSettings'))
const EstimateSettings = lazy(() => import('./pages/Settings/EstimateSettings'))

// Page loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  )
}

// Landing: send advisors/managers to the Tile Status page (the role-centre
// overview) when the Workshop Board module is on; everyone else (and technicians)
// to the classic Dashboard. Waits for modules to resolve to avoid a flash.
function HomeLanding() {
  const { isEnabled, loading } = useModules()
  const { user } = useAuth()
  if (loading) return <PageLoader />
  const role = user?.role || ''
  const canSeeTiles =
    isEnabled('workshop_board') &&
    ['super_admin', 'org_admin', 'site_admin', 'service_advisor'].includes(role)
  return <Navigate to={canSeeTiles ? '/tiles' : '/dashboard'} replace />
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
                  <RecoveryRedirect />
                  <Suspense fallback={<PageLoader />}>
                  <Routes>
                    {/* Public routes */}
                    <Route path="/view/:token" element={<CustomerPortal />} />
                    <Route path="/estimate/:token" element={<EstimatePortal />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />

                    {/* Super Admin Portal routes */}
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="organizations" element={<AdminOrganizations />} />
                      <Route path="organizations/:id" element={<AdminOrganizationDetail />} />
                      <Route path="plans" element={<AdminPlans />} />
                      <Route path="activity" element={<AdminActivity />} />
                      <Route path="ai-usage" element={<AIUsageDashboard />} />
                      <Route path="usage" element={<AdminUsageDashboard />} />
                      <Route path="communications" element={<AdminCommunications />} />
                      <Route path="settings" element={<AdminSettings />} />
                      <Route path="super-admins" element={<AdminSuperAdmins />} />
                      <Route path="system" element={<AdminSystemHealth />} />
                      <Route path="alerts" element={<AdminAlerts />} />
                      <Route path="ai-configuration" element={<AIConfiguration />} />
                      <Route path="starter-template" element={<AdminStarterTemplate />} />
                      <Route path="starter-templates" element={<AdminStarterTemplates />} />
                      <Route path="reason-types" element={<ReasonTypes />} />
                    </Route>

                    {/* Onboarding route (protected but no dashboard layout) */}
                    <Route element={<ProtectedLayout />}>
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/templates/:id/print" element={<TemplatePrint />} />
                      <Route path="/workshop-board/print" element={<RequireModule module="workshop_board"><WorkshopDaySheet /></RequireModule>} />
                    </Route>

                    {/* Main app routes */}
                    <Route element={<ProtectedLayout />}>
                      <Route element={<DashboardLayout />}>
                        <Route path="/" element={<HomeLanding />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/tiles" element={<RequireModule module="workshop_board"><TileStatus /></RequireModule>} />
                        <Route path="/diary" element={<RequireModule module="booking_diary"><BookingDiary /></RequireModule>} />
                        <Route path="/dashboard/technicians" element={<TechnicianWorkload />} />
                        <Route path="/today" element={<Today />} />
                        {/* Upcoming is now a tab inside the Arrivals hub; keep the old URL working. */}
                        <Route path="/upcoming" element={<Navigate to="/arrivals?tab=upcoming" replace />} />
                        <Route path="/reports" element={<RequireModule module="reports"><ReportsHub /></RequireModule>} />
                        <Route path="/reports/financial" element={<FinancialReports />} />
                        <Route path="/reports/items" element={<ItemPerformance />} />
                        <Route path="/reports/repair-types" element={<RepairTypesReport />} />
                        <Route path="/reports/parts-gp" element={<PartsGrossProfit />} />
                        <Route path="/reports/stock-valuation" element={<StockValuation />} />
                        <Route path="/reports/low-stock" element={<LowStock />} />
                        <Route path="/reports/stock-movements" element={<StockMovements />} />
                        <Route path="/reports/parts-on-order" element={<PartsOnOrder />} />
                        <Route path="/reports/negative-stock" element={<NegativeStock />} />
                        <Route path="/reports/technicians" element={<TechnicianPerformance />} />
                        <Route path="/reports/advisors" element={<AdvisorPerformance />} />
                        <Route path="/reports/customers" element={<CustomerInsights />} />
                        <Route path="/reports/operations" element={<OperationalEfficiency />} />
                        <Route path="/reports/capacity-utilisation" element={<CapacityUtilisation />} />
                        <Route path="/reports/compliance" element={<QualityCompliance />} />
                        <Route path="/reports/deferred" element={<DeferredWork />} />
                        <Route path="/reports/follow-up-recovery" element={<FollowUpRecovery />} />
                        <Route path="/reports/outreach-bookings" element={<OutreachBookings />} />
                        <Route path="/reports/mri-performance" element={<MriPerformance />} />
                        <Route path="/reports/daily-overview" element={<DailyOverview />} />
                        <Route path="/reports/deleted-health-checks" element={<DeletedHealthChecks />} />
                        <Route path="/users" element={<Users />} />
                        <Route path="/workshop-board" element={<RequireModule module="workshop_board"><WorkshopBoard /></RequireModule>} />
                        <Route path="/health-checks" element={<HealthCheckList />} />
                        <Route path="/health-checks/new" element={<NewHealthCheck />} />
                        <Route path="/health-checks/:id" element={<HealthCheckDetail />} />
                        <Route path="/jobsheets" element={<RequireModule module="jobsheets"><JobsheetList /></RequireModule>} />
                        <Route path="/jobsheets/new" element={<RequireModule module="jobsheets"><NewJobsheet /></RequireModule>} />
                        <Route path="/jobsheets/:id" element={<RequireModule module="jobsheets"><JobsheetDetail /></RequireModule>} />
                        <Route path="/estimates" element={<RequireModule module="estimates"><EstimatesList /></RequireModule>} />
                        <Route path="/estimates/new" element={<RequireModule module="estimates"><NewEstimate /></RequireModule>} />
                        <Route path="/estimates/:id" element={<RequireModule module="estimates"><EstimateDetail /></RequireModule>} />
                        {/* Not module-gated at the route: the hub hosts the always-on Upcoming tab
                            and only mounts the jobsheets-only Arrivals queue when enabled. */}
                        <Route path="/arrivals" element={<ArrivalsHub />} />
                        <Route path="/customers" element={<CustomerList />} />
                        <Route path="/customers/:id" element={<CustomerDetail />} />
                        <Route path="/vehicles" element={<RequireModule module="vehicles"><VehicleList /></RequireModule>} />
                        <Route path="/vehicles/:id" element={<RequireModule module="vehicles"><VehicleDetail /></RequireModule>} />
                        <Route path="/messages" element={<RequireModule module="customer_comms"><Messages /></RequireModule>} />
                        <Route path="/follow-ups" element={<RequireModule module="follow_up"><FollowUpList /></RequireModule>} />
                        <Route path="/notes" element={<NotesPage />} />
                        <Route path="/parts" element={<PartsCatalog />} />
                        <Route path="/parts/stock" element={<RequireModule module="parts_stock"><StockList /></RequireModule>} />
                        <Route path="/parts/purchase-orders" element={<RequireModule module="parts_stock"><PurchaseOrders /></RequireModule>} />
                        <Route path="/parts/purchase-orders/:id" element={<RequireModule module="parts_stock"><PurchaseOrderDetail /></RequireModule>} />
                        <Route path="/templates" element={<TemplateList />} />
                        <Route path="/templates/:id" element={<TemplateBuilder />} />
                        <Route path="/service-packages" element={<ServicePackages />} />
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
                        <Route path="/settings/repair-types" element={<RepairTypes />} />
                        <Route path="/settings/suppliers" element={<Suppliers />} />
                        <Route path="/settings/supplier-types" element={<SupplierTypes />} />
                        <Route path="/settings/part-categories" element={<RequireModule module="parts_stock"><PartCategories /></RequireModule>} />
                        <Route path="/settings/stock-locations" element={<RequireModule module="parts_stock"><StockLocations /></RequireModule>} />
                        <Route path="/settings/pricing" element={<PricingSettings />} />
                        <Route path="/settings/declined-reasons" element={<DeclinedReasons />} />
                        <Route path="/settings/follow-up-settings" element={<FollowUpSettings />} />
                        <Route path="/settings/follow-up-outcomes" element={<FollowUpOutcomes />} />
                        <Route path="/settings/follow-up-dispositions" element={<FollowUpDispositions />} />
                        <Route path="/settings/follow-up-timelines" element={<FollowUpTimelines />} />
                        <Route path="/settings/unable-to-send-reasons" element={<UnableToSendReasons />} />
                        <Route path="/settings/deleted-reasons" element={<DeletedReasons />} />
                        <Route path="/settings/vhc-deletion-reasons" element={<HcDeletionReasons />} />
                        <Route path="/settings/vehicle-locations" element={<VehicleLocations />} />
                        <Route path="/settings/sites" element={<SiteManagement />} />
                        <Route path="/settings/workflow" element={<WorkflowSettings />} />
                        <Route path="/settings/mri-items" element={<MriItemsSettings />} />
                        <Route path="/settings/daily-sms-overview" element={<DailySmsOverview />} />
                        <Route path="/settings/library-gap-report" element={<LibraryGapReport />} />
                        <Route path="/settings/workshop-statuses" element={<WorkshopStatuses />} />
                        <Route path="/settings/booking-codes" element={<BookingCodes />} />
                        <Route path="/settings/service-types" element={<ServiceTypes />} />
                        <Route path="/settings/expiry-types" element={<RequireModule module="vehicles"><VehicleExpiryTypes /></RequireModule>} />
                        <Route path="/settings/reminder-campaigns" element={<RequireModule module="vehicle_reminders"><VehicleReminderCampaigns /></RequireModule>} />
                        <Route path="/settings/estimate-settings" element={<EstimateSettings />} />
                        <Route path="/settings/workshop-board" element={<WorkshopBoardSettings />} />
                        <Route path="/settings/resource-manager" element={<ResourceManager />} />
                        <Route path="/settings/technician-skills" element={<TechnicianSkills />} />
                        <Route path="/settings/time-tracking" element={<TimeTrackingSettings />} />
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
