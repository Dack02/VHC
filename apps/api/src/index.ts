import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'

// Custom middleware
import { requestContext, errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { RateLimiters } from './middleware/rate-limit.js'
import { logger } from './lib/logger.js'

// Routes
import auth from './routes/auth.js'
import users from './routes/users.js'
import organizations from './routes/organizations.js'
import sites from './routes/sites.js'
import customers from './routes/customers.js'
import vehicles from './routes/vehicles.js'
import templates from './routes/templates.js'
import items from './routes/items.js'
import healthChecks from './routes/health-checks/index.js'
import results from './routes/results.js'
import repairItems from './routes/repair-items/index.js'
import media from './routes/media.js'
import dms from './routes/dms.js'
import dmsSettings from './routes/dms-settings.js'
import tyres from './routes/tyres.js'
import publicRoutes from './routes/public.js'
import notifications from './routes/notifications.js'
import platformAdmin from './routes/admin/platform.js'
import adminOrganizations from './routes/admin/organizations.js'
import adminStats from './routes/admin/stats.js'
import starterReasons from './routes/admin/starter-reasons.js'
import starterTemplates from './routes/admin/starter-templates.js'
import aiSettings from './routes/admin/ai-settings.js'
import aiUsage from './routes/admin/ai-usage.js'
import adminUsageRoutes from './routes/admin/usage.js'
import adminSuperAdmins from './routes/admin/super-admins.js'
import adminSystem from './routes/admin/system.js'
import adminAudit from './routes/admin/audit.js'
import adminAlerts from './routes/admin/alerts.js'
import adminReasonTypes from './routes/admin/reason-types.js'
import orgNotificationSettings from './routes/organization-notification-settings.js'
import orgAdmin from './routes/org-admin.js'
import onboarding from './routes/onboarding.js'
import dashboard from './routes/dashboard.js'
import dashboardToday from './routes/dashboard-today.js'
import dashboardUpcoming from './routes/dashboard-upcoming.js'
import reports from './routes/reports.js'
import reasons from './routes/reasons/index.js'
import labourCodes from './routes/labour-codes.js'
import suppliers from './routes/suppliers.js'
import pricing from './routes/pricing.js'
import declinedReasons from './routes/declined-reasons.js'
import unableToSendReasons from './routes/unable-to-send-reasons.js'
import deletedReasons from './routes/deleted-reasons.js'
import hcDeletionReasons from './routes/hc-deletion-reasons.js'
import supplierTypes from './routes/supplier-types.js'
import checkinSettings from './routes/checkin-settings.js'
import timeTrackingSettings from './routes/time-tracking-settings.js'
import timeEntriesRoutes from './routes/time-entries.js'
import messageTemplates from './routes/message-templates.js'
import vehicleLocations from './routes/vehicle-locations.js'
import pushSubscriptions from './routes/push-subscriptions.js'
import partsCatalog from './routes/parts-catalog.js'
import servicePackages from './routes/service-packages.js'
import twilioWebhookRoutes from './routes/webhooks/twilio.js'
import smsConversations from './routes/sms-conversations.js'
import messages from './routes/messages.js'
import dailySmsOverview from './routes/daily-sms-overview.js'
import libraryGapReport from './routes/library-gap-report.js'
import workshopBoard from './routes/workshop-board.js'
import bookingDiary from './routes/booking-diary.js'
import resourceManager from './routes/resource-manager.js'
import followUps from './routes/follow-ups.js'
import followUpOutcomes from './routes/follow-up-outcomes.js'
import followUpDispositions from './routes/follow-up-dispositions.js'
import followUpTimelines from './routes/follow-up-timelines.js'
import followUpSettings from './routes/follow-up-settings.js'
import modulesRoute from './routes/modules.js'
import vehicleLookup from './routes/vehicle-lookup.js'
import vehicleDetails from './routes/vehicle-details.js'
import postcodeLookup from './routes/postcode-lookup.js'
import jobsheetsRoute from './routes/jobsheets.js'
import partsAccountingRoute from './routes/parts-accounting.js'
import partsStockRoute from './routes/parts-stock.js'
import purchaseOrdersRoute from './routes/purchase-orders.js'
import supplierReturnsRoute from './routes/supplier-returns.js'
import estimatesRoute from './routes/estimates.js'
import estimateSettings from './routes/estimate-settings.js'
import publicEstimateRoutes from './routes/public-estimate.js'
import arrivalsRoute from './routes/arrivals.js'
import bookingCodes from './routes/booking-codes.js'
import serviceTypes from './routes/service-types.js'
import repairTypes from './routes/repair-types.js'
import expiryTypes from './routes/expiry-types.js'
import expiryCampaigns from './routes/expiry-campaigns.js'
import feedback from './routes/feedback.js'
import olloDevWebhookRoutes from './routes/webhooks/ollo-dev.js'

// Services
import { initializeWebSocket } from './services/websocket.js'
import { checkRedisConnection, updateRedisStatus } from './services/queue.js'
import { startScheduledCleanupTasks, initializeDailySmsOverviewSchedules, initializeAutoCloseSchedules, initializeDmsImportSchedules, startFollowUpSweepSchedule, startLibraryGapReportSchedule, startFeedbackSyncRetrySchedule } from './services/scheduler.js'

const app = new Hono()

// Get allowed origins from environment or use defaults
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      'http://localhost:5181',
      'http://localhost:5182',
      'http://localhost:5183',
      'http://localhost:5184',
      'http://127.0.0.1:5181',
      'http://127.0.0.1:5182',
      'http://127.0.0.1:5183',
      'http://127.0.0.1:5184'
    ]

// Middleware
app.use('*', requestContext)  // Add request ID and timing
app.use('*', errorHandler)    // Global error handler
app.use('*', cors({
  origin: allowedOrigins,
  credentials: true
}))

// Rate limiting for API routes
// Note: More specific routes must come BEFORE less specific ones
// Auth routes (stricter, only counts failed attempts)
// Stricter limiter for public self-service signup (must run before the broad auth limiter)
app.use('/api/v1/auth/signup', RateLimiters.signup())
app.use('/api/v1/auth/*', RateLimiters.auth())
// Standard authenticated API routes
app.use('/api/v1/*', RateLimiters.standard())

// Public routes - apply rate limiting in order of specificity
// Critical customer actions get very high limits (200/min per endpoint, 2000 in dev)
app.use('/api/public/vhc/:token/authorize', RateLimiters.customerAction())
app.use('/api/public/vhc/:token/decline', RateLimiters.customerAction())
app.use('/api/public/vhc/:token/signature', RateLimiters.customerAction())
// Other public endpoints get standard public limits (60/min per endpoint, 600 in dev)
app.use('/api/public/*', RateLimiters.public())

// Health endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'vhc-api'
  })
})

// API v1 routes
app.get('/api/v1', (c) => {
  return c.json({
    message: 'VHC API v1',
    version: '1.0.0'
  })
})

// Mount routes
app.route('/api/v1/auth', auth)
app.route('/api/v1/users', users)
app.route('/api/v1/organizations', organizations)
app.route('/api/v1/sites', sites)
app.route('/api/v1/customers', customers)
app.route('/api/v1/vehicles', vehicles)
app.route('/api/v1/templates', templates)
app.route('/api/v1', items)
app.route('/api/v1/health-checks', healthChecks)
app.route('/api/v1', smsConversations)
app.route('/api/v1/messages', messages)
app.route('/api/v1/workshop-board', workshopBoard)
app.route('/api/v1/booking-diary', bookingDiary)
app.route('/api/v1/resource-manager', resourceManager)
app.route('/api/v1', results)
app.route('/api/v1', repairItems)
app.route('/api/v1', media)
app.route('/api/v1', tyres)
app.route('/api/v1/dms', dms)
app.route('/api/v1/dms-settings', dmsSettings)
app.route('/api/v1/notifications', notifications)
app.route('/api/v1/push', pushSubscriptions)

// Follow-up module (deferred-work recovery)
app.route('/api/v1/follow-ups', followUps)

// Effective module set for the current organisation (frontend gating)
app.route('/api/v1/modules', modulesRoute)

// Vehicle data lookup (DVSA MOT History) — registration -> vehicle details + MOT
app.route('/api/v1/vehicle-lookup', vehicleLookup)
app.route('/api/v1/vehicle-details', vehicleDetails)

// Postcode -> address lookup (provider-agnostic) — powers the customer modal
app.route('/api/v1/postcode-lookup', postcodeLookup)

// Jobsheets (GMS) — top-level booking document + booking-code / service-type lookups
app.route('/api/v1/jobsheets', jobsheetsRoute)
// Parts accounting — Simple-mode "Mark purchased" (parts -> P&L cost)
app.route('/api/v1/parts-accounting', partsAccountingRoute)
// Parts & Stock — Full-mode stock management (gated by parts_stock module)
app.route('/api/v1/parts-stock', partsStockRoute)
// Purchase Orders + goods-in/GRN — Full-mode order-in (gated by parts_stock module)
app.route('/api/v1/purchase-orders', purchaseOrdersRoute)
// Supplier returns / credit loop — Full-mode (gated by parts_stock module)
app.route('/api/v1/supplier-returns', supplierReturnsRoute)
app.route('/api/v1/estimates', estimatesRoute)
app.route('/api/v1/booking-codes', bookingCodes)
// Unified arrivals queue (DMS + jobsheet bookings) — feeds the Arrivals hub + dashboard widget
app.route('/api/v1/arrivals', arrivalsRoute)
app.route('/api/v1/service-types', serviceTypes)
app.route('/api/v1/repair-types', repairTypes)

// Vehicles module — typed expiry config + expiry reminder campaigns
app.route('/api/v1/expiry-types', expiryTypes)
app.route('/api/v1/expiry-campaigns', expiryCampaigns)

// In-app feedback / bug reporting (pushed to Ollo Dev)
app.route('/api/v1/feedback', feedback)

// Admin routes (Super Admin only)
app.route('/api/v1/admin/platform', platformAdmin)
app.route('/api/v1/admin/organizations', adminOrganizations)
app.route('/api/v1/admin', adminStats)
app.route('/api/v1/admin/starter-reasons', starterReasons)
app.route('/api/v1/admin/starter-templates', starterTemplates)
app.route('/api/v1/admin/ai-settings', aiSettings)
app.route('/api/v1/admin/ai-usage', aiUsage)
app.route('/api/v1/admin', adminUsageRoutes) // /usage/* and /communications/* (no path collision with adminStats)
app.route('/api/v1/admin/super-admins', adminSuperAdmins)
app.route('/api/v1/admin/system', adminSystem)
app.route('/api/v1/admin/audit', adminAudit)
app.route('/api/v1/admin/alerts', adminAlerts)
app.route('/api/v1/admin/reason-types', adminReasonTypes)

// Organization notification settings (extends organizations routes)
app.route('/api/v1/organizations', orgNotificationSettings)

// Message templates (extends organizations routes)
app.route('/api/v1/organizations', messageTemplates)

// Org Admin routes (settings, sites with limits, users with limits, subscription view)
app.route('/api/v1/organizations', orgAdmin)

// Onboarding routes (for new organizations)
app.route('/api/v1/onboarding', onboarding)

// Dashboard routes (today/upcoming must be mounted before general dashboard to avoid path conflicts)
app.route('/api/v1/dashboard/today', dashboardToday)
app.route('/api/v1/dashboard/upcoming', dashboardUpcoming)
app.route('/api/v1/dashboard', dashboard)

// Reporting routes
app.route('/api/v1/reports', reports)

// Reasons routes (VHC reasons system)
app.route('/api/v1', reasons)

// Labour codes routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/labour-codes', labourCodes)

// Suppliers routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/suppliers', suppliers)

// Declined reasons routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/declined-reasons', declinedReasons)

// Follow-up settings routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/follow-up-outcomes', followUpOutcomes)
app.route('/api/v1/organizations/:orgId/follow-up-dispositions', followUpDispositions)
app.route('/api/v1/organizations/:orgId/follow-up-timelines', followUpTimelines)
app.route('/api/v1/organizations/:orgId/follow-up-settings', followUpSettings)
app.route('/api/v1/organizations/:orgId/estimate-settings', estimateSettings)

// Unable to send reasons routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/unable-to-send-reasons', unableToSendReasons)

// Deleted reasons routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/deleted-reasons', deletedReasons)

// HC deletion reasons routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/hc-deletion-reasons', hcDeletionReasons)

// Supplier types routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/supplier-types', supplierTypes)

// Vehicle locations routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/vehicle-locations', vehicleLocations)

// Parts catalog routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/parts-catalog', partsCatalog)

// Service packages routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/service-packages', servicePackages)

// Daily SMS overview routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/daily-sms-overview', dailySmsOverview)

// Library Gap Report routes (nested under organizations)
app.route('/api/v1/organizations/:orgId/library-gap-report', libraryGapReport)

// Check-in settings and MRI items routes (nested under organizations)
app.route('/api/v1/organizations', checkinSettings)
app.route('/api/v1/organizations', timeTrackingSettings)
app.route('/api/v1/time-entries', timeEntriesRoutes)

// Pricing calculator routes
app.route('/api/v1/pricing', pricing)

// Public routes (no auth required)
app.route('/api/public', publicRoutes)
app.route('/api/public', publicEstimateRoutes)

// Webhook routes (unauthenticated, validated by provider signature)
app.use('/api/webhooks/*', RateLimiters.webhook())
app.route('/api/webhooks/twilio', twilioWebhookRoutes)
app.route('/api/webhooks/ollo-dev', olloDevWebhookRoutes)

// 404 handler for unmatched routes
app.notFound(notFoundHandler)

const port = process.env.PORT ? parseInt(process.env.PORT) : 5180

// Start server with WebSocket support
const server = serve({
  fetch: app.fetch,
  port
})

// Initialize WebSocket (cast to http.Server for Socket.io compatibility)
initializeWebSocket(server as unknown as import('http').Server)

// Check Redis connection and start in-process workers if available
checkRedisConnection().then(async (connected) => {
  updateRedisStatus(connected)
  if (connected) {
    logger.info('Redis connected - starting in-process queue workers')
    try {
      await import('./services/worker.js')
      logger.info('Queue workers started in-process')
      // Initialize daily SMS overview schedules
      initializeDailySmsOverviewSchedules().catch(err => {
        logger.error('Failed to initialize daily SMS overview schedules', { error: String(err) })
      })
      initializeAutoCloseSchedules().catch(err => {
        logger.error('Failed to initialize auto-close schedules', { error: String(err) })
      })
      // Re-register DMS auto-import schedules (BullMQ repeatable jobs are lost on
      // Redis restart; without this, scheduled imports silently stop firing).
      initializeDmsImportSchedules().catch(err => {
        logger.error('Failed to initialize DMS import schedules', { error: String(err) })
      })
    } catch (err) {
      logger.error('Failed to start queue workers', { error: String(err) })
    }
  } else {
    logger.info('Redis not available - processing notifications directly')
  }
})

// Start daily cleanup tasks (activity log retention, etc.)
startScheduledCleanupTasks()

// Start the daily Follow-Up sweep (deferred-work recovery)
startFollowUpSweepSchedule()

// Start the Library Gap Report scheduler (daily digest of manually-typed notes)
startLibraryGapReportSchedule()

// Start the feedback sync retry sweep (re-push unsynced feedback to Ollo Dev)
startFeedbackSyncRetrySchedule()

logger.info(`Server started`, { port, environment: process.env.NODE_ENV || 'development' })

export default app
