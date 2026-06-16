/**
 * Ollo Dev inbound webhook.
 *
 * Receives ticket status changes and developer replies from Ollo Dev and
 * mirrors them onto the local feedback_tickets / feedback_comments so the
 * reporter sees live updates in the "My Feedback" tracker. Unauthenticated at
 * the route level — verified by an HMAC-SHA256 signature over the raw body
 * using the shared secret (resolved from the Ollo Dev integration credentials).
 *
 * Mounted at /api/webhooks/ollo-dev (see index.ts).
 */

import { Hono } from 'hono'
import crypto from 'crypto'
import { supabaseAdmin } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import { getOlloDevWebhookSecret } from '../../services/ollo-dev.js'
import { emitToUser, WS_EVENTS } from '../../services/websocket.js'

const olloDevWebhookRoutes = new Hono()

function verifySignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

interface OlloDevWebhookPayload {
  event?: string
  ticket?: { id?: string; external_ref?: string; source_app?: string; status?: string }
  change?: { from?: string; to?: string }
  comment?: { id?: string; author?: { name?: string; type?: string }; body?: string; createdAt?: string }
}

/**
 * POST /api/webhooks/ollo-dev
 * Always returns 200 for recognised-but-unmappable events so Ollo Dev's
 * delivery worker doesn't retry-storm on orphaned references.
 */
olloDevWebhookRoutes.post('/', async (c) => {
  try {
    const rawBody = await c.req.text()

    const secret = await getOlloDevWebhookSecret()
    if (!secret) {
      logger.error('Ollo Dev webhook received but no webhook secret is configured')
      return c.json({ error: 'Webhook not configured' }, 500)
    }

    if (!verifySignature(secret, rawBody, c.req.header('X-Ollo-Signature'))) {
      logger.warn('Ollo Dev webhook: invalid signature')
      return c.json({ error: 'Invalid signature' }, 401)
    }

    let payload: OlloDevWebhookPayload
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const externalRef = payload.ticket?.external_ref
    if (!externalRef) return c.json({ ok: true })

    // Resolve the local ticket by its external ref (the local feedback id).
    const { data: ticket } = await supabaseAdmin
      .from('feedback_tickets')
      .select('id, user_id, ollo_dev_ticket_id')
      .eq('id', externalRef)
      .maybeSingle()

    if (!ticket) {
      logger.warn('Ollo Dev webhook: unknown external_ref', { externalRef })
      return c.json({ ok: true })
    }

    if (payload.event === 'ticket.status_changed') {
      const status = payload.ticket?.status
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      }
      if (status) update.status = status
      // Backfill the Ollo Dev id if the create response was lost.
      if (!ticket.ollo_dev_ticket_id && payload.ticket?.id) update.ollo_dev_ticket_id = payload.ticket.id

      await supabaseAdmin.from('feedback_tickets').update(update).eq('id', ticket.id)
      emitToUser(ticket.user_id, WS_EVENTS.FEEDBACK_UPDATED, { feedbackId: ticket.id, status, event: payload.event })
    } else if (payload.event === 'ticket.comment_created') {
      const cm = payload.comment
      if (cm?.id && cm?.body) {
        // Idempotent insert: skip if this Ollo Dev comment id is already mirrored
        // (also guards against echoing back replies that originated here).
        const { data: existing } = await supabaseAdmin
          .from('feedback_comments')
          .select('id')
          .eq('feedback_ticket_id', ticket.id)
          .eq('external_comment_id', cm.id)
          .maybeSingle()

        if (!existing) {
          const { error: insertError } = await supabaseAdmin.from('feedback_comments').insert({
            feedback_ticket_id: ticket.id,
            author_type: 'dev',
            author_name: cm.author?.name ?? null,
            body: cm.body,
            origin: 'ollo_dev',
            external_comment_id: cm.id,
            created_at: cm.createdAt ?? new Date().toISOString(),
          })
          // 23505 = unique violation from a concurrent duplicate delivery — ignore.
          if (insertError && insertError.code !== '23505') {
            logger.error('Ollo Dev webhook: failed to insert comment', { ticketId: ticket.id }, new Error(insertError.message))
          } else if (!insertError) {
            await supabaseAdmin.from('feedback_tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticket.id)
            emitToUser(ticket.user_id, WS_EVENTS.FEEDBACK_UPDATED, { feedbackId: ticket.id, event: payload.event })
          }
        }
      }
    }

    return c.json({ ok: true })
  } catch (err) {
    logger.error('Ollo Dev webhook error', {}, err as Error)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

export default olloDevWebhookRoutes
