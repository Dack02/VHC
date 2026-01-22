import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth.js'

// Import sub-routers
import repairItemsRouter from './repair-items.js'
import optionsRouter from './options.js'
import labourRouter from './labour.js'
import partsRouter from './parts.js'
import workflowRouter from './workflow.js'
import outcomesRouter from './outcomes.js'

const repairItems = new Hono()

// Debug: log all requests to this router
repairItems.use('*', async (c, next) => {
  console.log(`[repair-items] ${c.req.method} ${c.req.path}`)
  await next()
})

repairItems.use('*', authMiddleware)

// Mount all sub-routers at root level (they define their own paths)
repairItems.route('/', repairItemsRouter)
repairItems.route('/', optionsRouter)
repairItems.route('/', labourRouter)
repairItems.route('/', partsRouter)
repairItems.route('/', workflowRouter)
repairItems.route('/', outcomesRouter)

export default repairItems
