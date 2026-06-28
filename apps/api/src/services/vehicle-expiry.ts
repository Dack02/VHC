/**
 * Vehicle expiry projection + activity stamping.
 *
 * `vehicle_expiry_dates` is the single queryable surface that powers expiry
 * reminder campaigns (MOT / Service / Road Tax / tenant-custom). This service is
 * the ONLY writer of the derived rows: it projects the DVSA MOT expiry
 * (vehicles.mot_expiry_date) into the fact table on every MOT sync. Service,
 * Road Tax and custom expiry types are user-managed (manual entry) in v1 — there
 * is no reliable derivation source for them yet (no service-event history).
 *
 * See also: services/mot-history.ts (calls recompute after persisting MOT),
 * routes/vehicles.ts (per-vehicle expiry CRUD), routes/expiry-types.ts,
 * routes/expiry-campaigns.ts. Design: docs/vehicles-module-plan.md §3, §6.
 */

import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

/** Ensure the system expiry types (MOT/Service/Road Tax) exist for an org. Lazy + idempotent. */
export async function ensureExpiryTypesSeeded(orgId: string): Promise<void> {
  try {
    await supabaseAdmin.rpc('seed_expiry_types_for_org', { p_org: orgId })
  } catch (err) {
    logger.error('Failed to seed expiry types', { orgId }, err as Error)
  }
}

/**
 * Recompute the DERIVED expiry rows for a vehicle. Currently projects the DVSA
 * MOT expiry into vehicle_expiry_dates so every campaign queries one indexed
 * surface. Preserves a per-vehicle dismiss (is_active=false) — it only refreshes
 * the due date/source on an existing MOT row, never re-activates it.
 * Best-effort — logs and continues on error.
 */
export async function recomputeVehicleExpiries(orgId: string, vehicleId: string): Promise<void> {
  try {
    const { data: vehicle } = await supabaseAdmin
      .from('vehicles')
      .select('mot_expiry_date')
      .eq('id', vehicleId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!vehicle || !vehicle.mot_expiry_date) return

    const { data: motType } = await supabaseAdmin
      .from('expiry_types')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', 'mot')
      .maybeSingle()

    const now = new Date().toISOString()
    const { data: existing } = await supabaseAdmin
      .from('vehicle_expiry_dates')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('type_code', 'mot')
      .maybeSingle()

    if (existing) {
      await supabaseAdmin
        .from('vehicle_expiry_dates')
        .update({ due_date: vehicle.mot_expiry_date, source: 'dvsa', expiry_type_id: motType?.id ?? null, computed_at: now })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin
        .from('vehicle_expiry_dates')
        .insert({
          organization_id: orgId,
          vehicle_id: vehicleId,
          type_code: 'mot',
          expiry_type_id: motType?.id ?? null,
          due_date: vehicle.mot_expiry_date,
          source: 'dvsa',
          is_active: true,
          computed_at: now
        })
    }
  } catch (err) {
    logger.error('Failed to recompute vehicle expiries', { vehicleId }, err as Error)
  }
}

/**
 * Stamp vehicles.last_activity_at = now. Drives the recency suppression gate for
 * expiry campaigns (a vehicle with no activity for N years is excluded).
 * Call on HC create, jobsheet close, and MOT sync. Best-effort.
 */
export async function stampVehicleActivity(orgId: string, vehicleId: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('vehicles')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', vehicleId)
      .eq('organization_id', orgId)
  } catch (err) {
    logger.error('Failed to stamp vehicle activity', { vehicleId }, err as Error)
  }
}

/**
 * Record a mileage reading for a vehicle (feeds future service-due prediction).
 * Best-effort; de-dupes nothing (history is append-only).
 */
export async function recordMileageReading(
  orgId: string,
  vehicleId: string,
  mileage: number,
  source: 'health_check' | 'mot' | 'dms' | 'manual' = 'health_check'
): Promise<void> {
  if (!Number.isFinite(mileage) || mileage <= 0) return
  try {
    await supabaseAdmin.from('vehicle_mileage_readings').insert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      reading_date: new Date().toISOString().slice(0, 10),
      mileage: Math.round(mileage),
      source
    })
  } catch (err) {
    logger.error('Failed to record mileage reading', { vehicleId }, err as Error)
  }
}
