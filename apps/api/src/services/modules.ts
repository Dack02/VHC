/**
 * Module resolution service. Resolves an organisation's *effective* module set
 * from plan defaults (subscription_plans.features) + per-org overrides
 * (organization_settings.module_overrides), per the registry in lib/modules.ts.
 */

import type { Context } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { MODULE_KEYS, MODULE_MAP, type ModuleKey } from '../lib/modules.js'

export type EffectiveModules = Record<ModuleKey, boolean>

type JsonMap = Record<string, unknown> | null | undefined

function resolve(planFeatures: JsonMap, overrides: JsonMap): EffectiveModules {
  const plan = planFeatures || {}
  const ovr = overrides || {}
  const out = {} as EffectiveModules
  for (const key of MODULE_KEYS) {
    if (MODULE_MAP[key].core) { out[key] = true; continue }          // core: always on
    if (key in ovr) { out[key] = ovr[key] !== false; continue }       // per-org override
    if (key in plan) { out[key] = plan[key] !== false; continue }     // plan default
    out[key] = MODULE_MAP[key].defaultOn                              // registry fallback
  }
  return out
}

/** Resolve the effective module set for an organisation (one round-trip pair). */
export async function getEffectiveModules(orgId: string): Promise<EffectiveModules> {
  const [{ data: settings }, { data: sub }] = await Promise.all([
    supabaseAdmin
      .from('organization_settings')
      .select('module_overrides')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('organization_subscriptions')
      .select('plan:subscription_plans(features)')
      .eq('organization_id', orgId)
      .maybeSingle()
  ])

  // The embedded plan can come back as an object or a single-element array.
  const planRel = (sub as { plan?: unknown } | null)?.plan
  const planRow = Array.isArray(planRel) ? planRel[0] : planRel
  const planFeatures = (planRow as { features?: JsonMap } | null)?.features
  const overrides = (settings as { module_overrides?: JsonMap } | null)?.module_overrides

  return resolve(planFeatures, overrides)
}

/** Per-request memoised variant — multiple requireModule checks hit the DB once. */
export async function getEffectiveModulesCached(c: Context, orgId: string): Promise<EffectiveModules> {
  const cached = c.get('effectiveModules')
  if (cached) return cached
  const mods = await getEffectiveModules(orgId)
  c.set('effectiveModules', mods)
  return mods
}

/**
 * Detailed per-module view for the admin UI: effective state, the raw override
 * (true/false/null=inherit) and the plan default.
 */
export async function getOrgModuleDetail(orgId: string): Promise<Array<{
  key: ModuleKey
  effective: boolean
  override: boolean | null
  planDefault: boolean
  core: boolean
}>> {
  const [{ data: settings }, { data: sub }] = await Promise.all([
    supabaseAdmin.from('organization_settings').select('module_overrides').eq('organization_id', orgId).maybeSingle(),
    supabaseAdmin.from('organization_subscriptions').select('plan:subscription_plans(features)').eq('organization_id', orgId).maybeSingle()
  ])
  const planRel = (sub as { plan?: unknown } | null)?.plan
  const planRow = Array.isArray(planRel) ? planRel[0] : planRel
  const planFeatures = ((planRow as { features?: JsonMap } | null)?.features || {}) as Record<string, unknown>
  const overrides = ((settings as { module_overrides?: JsonMap } | null)?.module_overrides || {}) as Record<string, unknown>
  const effective = resolve(planFeatures, overrides)

  return MODULE_KEYS.map((key) => {
    const def = MODULE_MAP[key]
    const planDefault = key in planFeatures ? planFeatures[key] !== false : def.defaultOn
    const override = def.core ? null : (key in overrides ? overrides[key] !== false : null)
    return { key, effective: effective[key], override, planDefault, core: !!def.core }
  })
}
