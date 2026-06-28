import { Hono } from 'hono'
import { authMiddleware, authorize } from '../middleware/auth.js'
import {
  recognizeSimplePurchase,
  unrecognizeSimplePurchase,
} from '../services/parts-accounting-service.js'

/**
 * Parts accounting — Simple-mode "Mark purchased" action (GMS/PARTS.md §6).
 * Always available (Simple mode is the ungated baseline); no requireModule gate.
 */
const partsAccounting = new Hono()
partsAccounting.use('*', authMiddleware)

// POST /api/v1/parts-accounting/repair-parts/:id/mark-purchased
partsAccounting.post(
  '/repair-parts/:id/mark-purchased',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { id } = c.req.param()
      const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
      const result = await recognizeSimplePurchase(id, auth.orgId, auth.user.id, {
        purchasedAt: (body.purchasedAt as string) ?? null,
      })
      if (!result.ok) return c.json({ error: result.error ?? 'Failed to mark purchased' }, 400)
      return c.json(result)
    } catch (error) {
      console.error('Mark purchased error:', error)
      return c.json({ error: 'Failed to mark purchased' }, 500)
    }
  }
)

// POST /api/v1/parts-accounting/repair-parts/:id/unmark-purchased
partsAccounting.post(
  '/repair-parts/:id/unmark-purchased',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { id } = c.req.param()
      const result = await unrecognizeSimplePurchase(id, auth.orgId, auth.user.id)
      if (!result.ok) return c.json({ error: result.error ?? 'Failed to unmark purchased' }, 400)
      return c.json(result)
    } catch (error) {
      console.error('Unmark purchased error:', error)
      return c.json({ error: 'Failed to unmark purchased' }, 500)
    }
  }
)

export default partsAccounting
