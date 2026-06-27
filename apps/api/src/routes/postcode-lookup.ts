/**
 * UK postcode → address lookup.
 *
 * GET /api/v1/postcode-lookup/status        — { configured, enabled, provider }
 * GET /api/v1/postcode-lookup/:postcode     — { success, addresses[], errorCode? }
 *
 * Powers the "Find address" feature in the shared customer modal. Read-only,
 * no DB writes. Gated by service_advisor+; the feature itself is gated by
 * config (returns NOT_CONFIGURED until a provider key is supplied, so the UI
 * falls back to manual entry). Always responds 200 with a result body so the
 * client can degrade gracefully rather than treating "not configured" as a
 * thrown error.
 */

import { Hono } from 'hono'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { lookupAddressesByPostcode, getPostcodeLookupStatus } from '../services/postcode-lookup.js'

const postcodeLookup = new Hono()

postcodeLookup.use('*', authMiddleware)

postcodeLookup.get('/status', authorizeMinRole('service_advisor'), async (c) => {
  const status = await getPostcodeLookupStatus()
  return c.json(status)
})

postcodeLookup.get('/:postcode', authorizeMinRole('service_advisor'), async (c) => {
  const postcode = c.req.param('postcode')
  const result = await lookupAddressesByPostcode(postcode)
  return c.json(result)
})

export default postcodeLookup
