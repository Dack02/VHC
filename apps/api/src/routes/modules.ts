/**
 * GET /api/v1/modules — the current organisation's effective module set + the
 * registry metadata. Consumed by the web ModulesContext to gate nav/routes.
 */

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import { getEffectiveModulesCached } from '../services/modules.js'
import { MODULES } from '../lib/modules.js'

const modules = new Hono()

modules.use('*', authMiddleware)

modules.get('/', async (c) => {
  const auth = c.get('auth')
  const effective = await getEffectiveModulesCached(c, auth.orgId)
  return c.json({ modules: effective, registry: MODULES })
})

export default modules
