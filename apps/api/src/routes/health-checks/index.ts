import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth.js'

// Import sub-routers
import crudRouter from './crud.js'
import statusRouter from './status.js'
import checkResultsRouter from './check-results.js'
import sendCustomerRouter from './send-customer.js'
import historyRouter from './history.js'
import timelineRouter from './timeline.js'
import pdfRouter from './pdf.js'
import repairItemsHCRouter from './repair-items-hc.js'
import deletionRouter from './deletion.js'
import workAuthoritySheetRouter from './work-authority-sheet.js'
import mriResultsRouter from './mri-results.js'
import customerActivityRouter from './customer-activity.js'

const healthChecks = new Hono()

// Apply auth middleware to all routes
healthChecks.use('*', authMiddleware)

// Mount sub-routers
// NOTE: Order matters for parameterized routes!
// PDF route must come before other /:id routes to avoid being caught by them
healthChecks.route('/', pdfRouter)                  // /:id/pdf
healthChecks.route('/', workAuthoritySheetRouter)   // /:id/work-authority-sheet
healthChecks.route('/', historyRouter)              // /:id/history
healthChecks.route('/', timelineRouter)             // /:id/timeline (unified timeline)
healthChecks.route('/', checkResultsRouter)         // /:id/results
healthChecks.route('/', repairItemsHCRouter)        // /:id/repair-items/*
healthChecks.route('/', mriResultsRouter)           // /:id/mri-results
healthChecks.route('/', customerActivityRouter)     // /:id/customer-activity
healthChecks.route('/', statusRouter)               // /:id/status, /:id/clock-in, /:id/clock-out, etc.
healthChecks.route('/', sendCustomerRouter)         // /:id/publish
healthChecks.route('/', deletionRouter)             // DELETE /:id, POST /:id/delete, /bulk-delete, /:id/restore
healthChecks.route('/', crudRouter)                 // GET /, POST /, GET /:id, PATCH /:id

export default healthChecks
