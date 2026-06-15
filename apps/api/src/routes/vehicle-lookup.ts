/**
 * Vehicle data lookup (DVSA MOT History API).
 *
 * GET /api/v1/vehicle-lookup/:registration — live lookup of vehicle details +
 * MOT history by registration, used when creating a manual health check. This
 * is a read-only preview (no DB writes); the vehicle/history is persisted when
 * the advisor confirms and creates the vehicle (POST /api/v1/vehicles with
 * syncMotHistory).
 *
 * Gated by the 'vehicle_lookup' module (per-org) and service_advisor+ role.
 */

import { Hono } from 'hono'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { lookupVehicleByRegistration } from '../services/mot-history.js'

const vehicleLookup = new Hono()

vehicleLookup.use('*', authMiddleware)
vehicleLookup.use('*', requireModule('vehicle_lookup'))

vehicleLookup.get('/:registration', authorizeMinRole('service_advisor'), async (c) => {
  const registration = c.req.param('registration')

  if (!registration || registration.trim().length < 2) {
    return c.json({ error: 'A valid registration is required' }, 400)
  }

  const result = await lookupVehicleByRegistration(registration)

  // success === true covers both "found" and a clean "not found" (404 from
  // DVSA) — return those at 200 so the UI can offer manual entry. Everything
  // else maps to an appropriate upstream/config error.
  if (!result.success) {
    const status =
      result.errorCode === 'RATE_LIMITED' ? 429 :
      result.errorCode === 'AUTH_FAILED' || result.errorCode === 'API_ERROR' || result.errorCode === 'EXCEPTION' ? 502 :
      503 // NOT_CONFIGURED / DISABLED
    return c.json({ error: result.error || 'Lookup failed', code: result.errorCode || 'NOT_CONFIGURED' }, status)
  }

  return c.json(result)
})

export default vehicleLookup
