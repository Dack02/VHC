import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.js'
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
  isWebPushConfigured
} from '../services/web-push.js'

const pushRoutes = new Hono()

/**
 * GET /api/v1/push/vapid-public-key
 * Returns the VAPID public key for client-side push subscription.
 * No auth required — the key is public.
 */
pushRoutes.get('/vapid-public-key', (c) => {
  const key = getVapidPublicKey()
  if (!key) {
    return c.json({ error: 'Push notifications not configured' }, 503)
  }
  return c.json({ publicKey: key })
})

// All other routes require auth
pushRoutes.use('*', authMiddleware)

/**
 * POST /api/v1/push/subscribe
 * Save a push subscription for the authenticated user.
 */
pushRoutes.post('/subscribe', async (c) => {
  if (!isWebPushConfigured()) {
    return c.json({ error: 'Push notifications not configured' }, 503)
  }

  const auth = c.get('auth')
  const body = await c.req.json<{
    subscription: {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }
    appType?: 'web' | 'mobile'
  }>()

  if (!body.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) {
    return c.json({ error: 'Invalid subscription data' }, 400)
  }

  const userAgent = c.req.header('User-Agent')

  await savePushSubscription(
    auth.user.id,
    body.subscription,
    body.appType || 'web',
    userAgent
  )

  return c.json({ success: true })
})

/**
 * POST /api/v1/push/unsubscribe
 * Remove a push subscription.
 */
pushRoutes.post('/unsubscribe', async (c) => {
  const body = await c.req.json<{ endpoint: string }>()

  if (!body.endpoint) {
    return c.json({ error: 'Endpoint required' }, 400)
  }

  await removePushSubscription(body.endpoint)

  return c.json({ success: true })
})

export default pushRoutes
