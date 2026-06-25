/**
 * Customer insights — the data behind the shared "smart banner" shown on the Estimate,
 * Jobsheet and VHC detail pages. Computes a small set of high-signal, staff-facing cues
 * from data we already hold: visit recency (new / lapsed / at-risk), outstanding advised
 * (deferred) work, and MOT status.
 *
 * Lapsed thresholds follow the auto-trade norm (9 / 12 / 18 months); kept as constants
 * here so they're trivial to make org-configurable later.
 */
import { supabaseAdmin } from '../lib/supabase.js'

const LAPSED_SOFT_MONTHS = 9   // amber — gentle nudge
const LAPSED_MONTHS = 12       // red — "lost list"
const LAPSED_LONG_MONTHS = 18  // red — escalated
const MOT_DUE_DAYS = 30
const REGULAR_VISITS = 3       // ≥ this many prior visits ⇒ a "regular" going quiet is at-risk

export type LapsedTier = 'none' | 'soft' | 'lapsed' | 'long'
export type MotTier = 'expired' | 'due' | 'ok' | 'unknown'

export interface CustomerInsights {
  customer: {
    isNew: boolean
    totalVisits: number
    lastVisitAt: string | null
    monthsSinceLastVisit: number | null
    lapsedTier: LapsedTier
    wasRegular: boolean
  }
  deferred: { count: number; totalValue: number; caseId: string | null }
  mot: { status: string | null; expiryDate: string | null; daysToExpiry: number | null; tier: MotTier } | null
}

const MS_PER_DAY = 86400000
const DAYS_PER_MONTH = 30.4

export async function getCustomerInsights(
  orgId: string,
  customerId: string,
  opts: { vehicleId?: string | null; excludeHealthCheckId?: string | null } = {}
): Promise<CustomerInsights> {
  const { vehicleId = null, excludeHealthCheckId = null } = opts

  // Deferred-work query: outstanding advised work for the vehicle (precise) or, without a
  // vehicle, across the customer's vehicles. Top-level items only (mirrors loadJobsheetExtras).
  let deferredQuery = supabaseAdmin
    .from('repair_items')
    .select('id, price_override, total_inc_vat, health_check:health_checks!inner(customer_id, vehicle_id, organization_id)')
    .eq('outcome_status', 'deferred')
    .is('deleted_at', null)
    .is('parent_repair_item_id', null)
    .eq('health_check.organization_id', orgId)
  deferredQuery = vehicleId
    ? deferredQuery.eq('health_check.vehicle_id', vehicleId)
    : deferredQuery.eq('health_check.customer_id', customerId)

  // Follow-up cases (for deep-linking the deferred badge): by vehicle if known, else customer.
  let followUpQuery = supabaseAdmin
    .from('follow_up_cases')
    .select('id, status, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20)
  followUpQuery = vehicleId ? followUpQuery.eq('vehicle_id', vehicleId) : followUpQuery.eq('customer_id', customerId)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [visitsRes, deferredRes, followUpRes, vehicleRes] = await Promise.all([
    // Real visits for this customer (inspections), most recent first.
    supabaseAdmin
      .from('health_checks')
      .select('id, created_at, completed_at')
      .eq('organization_id', orgId)
      .eq('customer_id', customerId)
      .eq('inspection_required', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    deferredQuery,
    followUpQuery,
    vehicleId
      ? supabaseAdmin.from('vehicles').select('mot_status, mot_expiry_date').eq('id', vehicleId).eq('organization_id', orgId).maybeSingle()
      : Promise.resolve({ data: null })
  ])

  const visits = ((visitsRes.data || []) as any[]).filter(v => v.id !== excludeHealthCheckId)
  const totalVisits = visits.length
  const last = visits[0] || null
  const lastVisitAt: string | null = last ? (last.completed_at || last.created_at) : null

  let monthsSinceLastVisit: number | null = null
  let lapsedTier: LapsedTier = 'none'
  if (lastVisitAt) {
    const days = (Date.now() - new Date(lastVisitAt).getTime()) / MS_PER_DAY
    monthsSinceLastVisit = Math.floor(days / DAYS_PER_MONTH)
    if (monthsSinceLastVisit >= LAPSED_LONG_MONTHS) lapsedTier = 'long'
    else if (monthsSinceLastVisit >= LAPSED_MONTHS) lapsedTier = 'lapsed'
    else if (monthsSinceLastVisit >= LAPSED_SOFT_MONTHS) lapsedTier = 'soft'
  }

  const deferredItems = (deferredRes.data || []) as any[]
  const deferredValue = deferredItems.reduce((s, ri) => s + Number(ri.price_override ?? ri.total_inc_vat ?? 0), 0)

  const followUpCases = (followUpRes.data || []) as any[]
  const OPEN = ['active', 'booking_found', 'engaged', 'manual']
  const caseId = (followUpCases.find(c => OPEN.includes(c.status))?.id ?? followUpCases[0]?.id) || null

  const vehicle = (vehicleRes as any).data as { mot_status: string | null; mot_expiry_date: string | null } | null
  let mot: CustomerInsights['mot'] = null
  if (vehicleId) {
    let daysToExpiry: number | null = null
    let tier: MotTier = 'unknown'
    if (vehicle?.mot_expiry_date) {
      daysToExpiry = Math.round((new Date(`${vehicle.mot_expiry_date}T00:00:00`).getTime() - Date.now()) / MS_PER_DAY)
      if (vehicle.mot_status === 'Expired' || daysToExpiry < 0) tier = 'expired'
      else if (daysToExpiry <= MOT_DUE_DAYS) tier = 'due'
      else tier = 'ok'
    } else if (vehicle?.mot_status === 'Expired') {
      tier = 'expired'
    }
    mot = { status: vehicle?.mot_status ?? null, expiryDate: vehicle?.mot_expiry_date ?? null, daysToExpiry, tier }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    customer: {
      isNew: totalVisits === 0,
      totalVisits,
      lastVisitAt,
      monthsSinceLastVisit,
      lapsedTier,
      wasRegular: totalVisits >= REGULAR_VISITS
    },
    deferred: { count: deferredItems.length, totalValue: deferredValue, caseId },
    mot
  }
}
