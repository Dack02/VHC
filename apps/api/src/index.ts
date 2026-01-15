import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// Routes
import auth from './routes/auth.js'
import users from './routes/users.js'
import organizations from './routes/organizations.js'
import sites from './routes/sites.js'
import customers from './routes/customers.js'
import vehicles from './routes/vehicles.js'
import templates from './routes/templates.js'
import items from './routes/items.js'
import healthChecks from './routes/health-checks.js'
import results from './routes/results.js'
import repairItems from './routes/repair-items.js'
import media from './routes/media.js'
import dms from './routes/dms.js'
import tyres from './routes/tyres.js'
import publicRoutes from './routes/public.js'
import notifications from './routes/notifications.js'
import platformAdmin from './routes/admin/platform.js'
import adminOrganizations from './routes/admin/organizations.js'
import adminStats from './routes/admin/stats.js'
import orgNotificationSettings from './routes/organization-notification-settings.js'
import orgAdmin from './routes/org-admin.js'
import onboarding from './routes/onboarding.js'

// Services
import { initializeWebSocket } from './services/websocket.js'
import { checkRedisConnection } from './services/queue.js'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: [
    'http://localhost:5181',
    'http://localhost:5182',
    'http://localhost:5183',
    'http://localhost:5184',
    'http://127.0.0.1:5181',
    'http://127.0.0.1:5182',
    'http://127.0.0.1:5183',
    'http://127.0.0.1:5184'
  ],
  credentials: true
}))

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
app.route('/api/v1', results)
app.route('/api/v1', repairItems)
app.route('/api/v1', media)
app.route('/api/v1', tyres)
app.route('/api/v1/dms', dms)
app.route('/api/v1/notifications', notifications)

// Admin routes (Super Admin only)
app.route('/api/v1/admin/platform', platformAdmin)
app.route('/api/v1/admin/organizations', adminOrganizations)
app.route('/api/v1/admin', adminStats)

// Organization notification settings (extends organizations routes)
app.route('/api/v1/organizations', orgNotificationSettings)

// Org Admin routes (settings, sites with limits, users with limits, subscription view)
app.route('/api/v1/organizations', orgAdmin)

// Onboarding routes (for new organizations)
app.route('/api/v1/onboarding', onboarding)

// Public routes (no auth required)
app.route('/api/public', publicRoutes)

const port = process.env.PORT ? parseInt(process.env.PORT) : 5180

// Start server with WebSocket support
const server = serve({
  fetch: app.fetch,
  port
})

// Initialize WebSocket (cast to http.Server for Socket.io compatibility)
initializeWebSocket(server as unknown as import('http').Server)

// Check Redis connection (optional, for queue support)
checkRedisConnection().then((connected) => {
  if (connected) {
    console.log('Redis connected - queue workers available')
  } else {
    console.log('Redis not available - queue features disabled')
  }
})

console.log(`Server is running on http://localhost:${port}`)

export default app
