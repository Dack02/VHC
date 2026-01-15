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
app.route('/api/v1/dms', dms)

const port = process.env.PORT ? parseInt(process.env.PORT) : 5180

console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port
})

export default app
