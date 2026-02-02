import webpush from 'web-push'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'

const MAX_FAILURES = 3

// Configure VAPID
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@vhcapp.com'

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  logger.info('Web Push configured with VAPID keys')
} else {
  logger.warn('VAPID keys not set — web push notifications disabled')
}

export function isWebPushConfigured(): boolean {
  return !!(vapidPublicKey && vapidPrivateKey)
}

export function getVapidPublicKey(): string | undefined {
  return vapidPublicKey
}

interface PushSubscriptionData {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export async function savePushSubscription(
  userId: string,
  subscription: PushSubscriptionData,
  appType: 'web' | 'mobile' = 'web',
  userAgent?: string
) {
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        app_type: appType,
        is_active: true,
        failure_count: 0,
        user_agent: userAgent || null,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      { onConflict: 'endpoint' }
    )

  if (error) {
    logger.error('Failed to save push subscription', { error: error.message, userId })
    throw error
  }
}

export async function removePushSubscription(endpoint: string) {
  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)

  if (error) {
    logger.error('Failed to remove push subscription', { error: error.message })
    throw error
  }
}

interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  data?: Record<string, unknown>
}

export async function sendPushNotification(userId: string, payload: PushPayload) {
  if (!isWebPushConfigured()) return

  const { data: subscriptions, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
    .eq('is_active', true)

  if (error) {
    logger.error('Failed to fetch push subscriptions', { error: error.message, userId })
    return
  }

  if (!subscriptions || subscriptions.length === 0) return

  const jsonPayload = JSON.stringify(payload)

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          jsonPayload
        )

        // Reset failure count and update last_used_at on success
        await supabaseAdmin
          .from('push_subscriptions')
          .update({
            failure_count: 0,
            last_used_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', sub.id)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or unsubscribed — remove it
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id)
          logger.info('Removed expired push subscription', { subscriptionId: sub.id })
        } else {
          // Increment failure count, deactivate after MAX_FAILURES
          const { data: updated } = await supabaseAdmin
            .from('push_subscriptions')
            .update({
              failure_count: (sub as unknown as { failure_count: number }).failure_count + 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', sub.id)
            .select('failure_count')
            .single()

          if (updated && updated.failure_count >= MAX_FAILURES) {
            await supabaseAdmin
              .from('push_subscriptions')
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq('id', sub.id)
            logger.warn('Deactivated push subscription after repeated failures', { subscriptionId: sub.id })
          }

          logger.error('Push notification send failed', {
            subscriptionId: sub.id,
            statusCode,
            error: String(err)
          })
        }
      }
    })
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) {
    logger.warn('Push notification batch complete', { userId, succeeded, failed })
  }
}
