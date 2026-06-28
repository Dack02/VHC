/**
 * Vehicle data lookup (DVSA MOT History + optional DVLA spec merge).
 *
 * GET /api/v1/vehicle-lookup/:registration — live lookup of vehicle details +
 * MOT history by registration, used when creating a manual health check /
 * jobsheet / estimate. This is a read-only preview (no DB writes); the
 * vehicle/history is persisted when the advisor confirms and creates the vehicle
 * (POST /api/v1/vehicles with syncMotHistory + enrichVehicleDetails).
 *
 * When the org also has the (paid) 'vehicle_details' module enabled, this merges
 * the Vehicle Data Global VehicleDetails lookup into the same response: DVLA
 * identity fields win (make/model/colour/fuel/engine), extra spec is appended,
 * and the full mapped `details` object is returned so the create call can persist
 * it without paying for a second lookup.
 *
 * Gated by the 'vehicle_lookup' module (per-org) and service_advisor+ role.
 */

import { Hono } from 'hono'
import { authMiddleware, authorizeMinRole } from '../middleware/auth.js'
import { requireModule } from '../middleware/require-module.js'
import { getEffectiveModulesCached } from '../services/modules.js'
import { lookupVehicleByRegistration } from '../services/mot-history.js'
import { lookupVehicleDetailsByRegistration } from '../services/vehicle-details.js'

const vehicleLookup = new Hono()

vehicleLookup.use('*', authMiddleware)
vehicleLookup.use('*', requireModule('vehicle_lookup'))

vehicleLookup.get('/:registration', authorizeMinRole('service_advisor'), async (c) => {
  const auth = c.get('auth')
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

  // Merge the paid DVLA spec lookup when the org has the vehicle_details module
  // enabled. Best-effort — a failure here never breaks the (free) DVSA result.
  let details = null
  try {
    const mods = await getEffectiveModulesCached(c, auth.orgId)
    if (mods.vehicle_details) {
      const d = await lookupVehicleDetailsByRegistration(registration)
      if (d.success && d.found) details = d
    }
  } catch {
    // ignore — DVSA result still returned below
  }

  if (!details) {
    return c.json(result)
  }

  // DVLA wins on identity; append the extra spec. Fall back to the DVSA value
  // when DVLA didn't supply a field.
  const v = result.vehicle
  return c.json({
    ...result,
    found: true,
    vehicle: {
      registration: v?.registration || details.registration,
      make: details.make ?? v?.make ?? null,
      model: details.model ?? v?.model ?? null,
      primaryColour: details.color ?? v?.primaryColour ?? null,
      fuelType: details.fuelType ?? v?.fuelType ?? null,
      engineSize: details.engineSize ?? v?.engineSize ?? null,
      firstUsedDate: v?.firstUsedDate ?? null,
      manufactureDate: v?.manufactureDate ?? null,
      // DVLA-only extras (surfaced in the lookup preview)
      derivative: details.derivative,
      bodyType: details.bodyType,
      transmission: details.transmission,
      powertrainType: details.powertrainType,
      year: details.year
    },
    // Full mapped result — passed back to POST /vehicles so persistence reuses
    // this lookup instead of paying for a second call.
    details
  })
})

export default vehicleLookup
