/**
 * Vehicle Details lookup (Vehicle Data Global — VehicleDetails package).
 *
 * GET /api/v1/vehicle-details/status            — { configured, enabled, source }
 * GET /api/v1/vehicle-details/:registration     — full DVLA spec/provenance preview
 *
 * Paid, per-lookup DVLA enrichment that complements the free DVSA MOT lookup.
 * Read-only preview (no DB writes); persistence happens on vehicle create
 * (POST /api/v1/vehicles with enrichVehicleDetails) or on-demand refresh
 * (POST /api/v1/vehicles/:id/vehicle-details-refresh).
 *
 * Gated by the 'vehicle_details' module (per-org) and service_advisor+ role; the
 * feature is also gated by config (NOT_CONFIGURED until a key is supplied).
 */

import { Hono } from 'hono'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { lookupVehicleDetailsByRegistration, getVehicleDetailsStatus } from '../services/vehicle-details.js'

const vehicleDetails = new Hono()

vehicleDetails.use('*', authMiddleware)

// Status is module-gated too, but returns a clean body so the UI can hide the
// action when the module is on but no key is configured.
vehicleDetails.get('/status', requireModule('vehicle_details'), authorizeMinRole('service_advisor'), async (c) => {
  const status = await getVehicleDetailsStatus()
  return c.json(status)
})

vehicleDetails.get('/:registration', requireModule('vehicle_details'), authorizeMinRole('service_advisor'), async (c) => {
  const registration = c.req.param('registration')

  if (!registration || registration.trim().length < 2) {
    return c.json({ error: 'A valid registration is required' }, 400)
  }

  const result = await lookupVehicleDetailsByRegistration(registration)

  // success === true covers both "found" and a clean "not found" — return those
  // at 200 so the UI can degrade gracefully. Everything else maps to an
  // appropriate upstream/config error.
  if (!result.success) {
    const status =
      result.errorCode === 'RATE_LIMITED' ? 429 :
      result.errorCode === 'AUTH_FAILED' || result.errorCode === 'API_ERROR' || result.errorCode === 'EXCEPTION' ? 502 :
      503 // NOT_CONFIGURED / DISABLED / INVALID
    return c.json({ error: result.error || 'Lookup failed', code: result.errorCode || 'NOT_CONFIGURED' }, status)
  }

  return c.json(result)
})

export default vehicleDetails
