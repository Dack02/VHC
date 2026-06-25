/**
 * Module enforcement middleware. Blocks requests to a module's routes when that
 * module is not enabled for the caller's organisation. MUST run after
 * authMiddleware (needs auth.orgId).
 *
 * Returns a structured 403 with code MODULE_DISABLED so the frontend can show a
 * tailored "module not enabled" state rather than a generic forbidden error.
 */

import type { Context, Next } from 'hono'
import { getEffectiveModulesCached } from '../services/modules.js'
import type { ModuleKey } from '../lib/modules.js'

export function requireModule(moduleKey: ModuleKey) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth')
    if (!auth) {
      return c.json({ error: 'Not authenticated' }, 401)
    }

    const mods = await getEffectiveModulesCached(c, auth.orgId)
    if (!mods[moduleKey]) {
      return c.json(
        {
          error: `The "${moduleKey}" module is not enabled for this organisation`,
          code: 'MODULE_DISABLED',
          module: moduleKey
        },
        403
      )
    }

    await next()
  }
}
