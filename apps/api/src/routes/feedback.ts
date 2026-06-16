/**
 * In-app feedback / bug reporting routes.
 *
 * Users report bugs / feature requests / questions with screenshots; the report
 * is saved locally (feedback_tickets) and pushed to Ollo Dev. Status changes and
 * dev replies arrive back via routes/webhooks/ollo-dev.ts. All routes are
 * org-scoped and per-user (a reporter only sees their own feedback).
 *
 * Mounted at /api/v1/feedback (see index.ts).
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { authMiddleware, authorize } from '../middleware/auth.js'
import { createOlloDevTicket, appendOlloDevComment } from '../services/ollo-dev.js'

const feedback = new Hono()

feedback.use('*', authMiddleware)

const ALL_ROLES = ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician'] as const
const BUCKET_NAME = 'ollo-feedback'
const MAX_FILES = 10
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5MB (matches bucket limit)
const FEEDBACK_TYPES = ['bug', 'feature', 'question']
const FEEDBACK_PRIORITIES = ['low', 'normal', 'high', 'urgent']

function publicUrlFor(path: string): string {
  return supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(path).data.publicUrl
}

function parseDiagnostics(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown> } catch { return {} }
  }
  return {}
}

interface TicketRow {
  id: string
  type: string
  subject: string
  description: string
  priority: string
  status: string
  sync_state: string
  ollo_dev_ticket_id: string | null
  source_app: string
  created_at: string
  updated_at: string
}

function mapTicket(row: TicketRow) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    description: row.description,
    priority: row.priority,
    status: row.status,
    syncState: row.sync_state,
    olloDevTicketId: row.ollo_dev_ticket_id,
    sourceApp: row.source_app,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapComment(row: {
  id: string; author_type: string; author_name: string | null; body: string; origin: string; created_at: string
}) {
  return {
    id: row.id,
    authorType: row.author_type,
    authorName: row.author_name,
    body: row.body,
    origin: row.origin,
    createdAt: row.created_at,
  }
}

function mapAttachment(row: {
  id: string; public_url: string; content_type: string; width: number | null; height: number | null
}) {
  return {
    id: row.id,
    url: row.public_url,
    contentType: row.content_type,
    width: row.width,
    height: row.height,
  }
}

// ============================================================
// POST /api/v1/feedback — create a report (multipart or JSON)
// ============================================================
feedback.post('/', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')

    let type = 'bug'
    let subject = ''
    let description = ''
    let priority = 'normal'
    let sourceApp = 'web'
    let diagnostics: Record<string, unknown> = {}
    let files: File[] = []

    const contentType = c.req.header('content-type') || ''
    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData()
      type = (form.get('type') as string) || 'bug'
      subject = (form.get('subject') as string) || ''
      description = (form.get('description') as string) || ''
      priority = (form.get('priority') as string) || 'normal'
      sourceApp = (form.get('sourceApp') as string) || 'web'
      diagnostics = parseDiagnostics(form.get('diagnostics'))
      files = [...form.getAll('files'), form.get('file')].filter((f): f is File => f instanceof File)
    } else {
      const body = await c.req.json().catch(() => ({}))
      type = body.type || 'bug'
      subject = body.subject || ''
      description = body.description || ''
      priority = body.priority || 'normal'
      sourceApp = body.sourceApp || 'web'
      diagnostics = parseDiagnostics(body.diagnostics)
    }

    subject = subject.trim()
    if (!subject) return c.json({ error: 'Subject is required' }, 400)
    if (!FEEDBACK_TYPES.includes(type)) type = 'bug'
    if (!FEEDBACK_PRIORITIES.includes(priority)) priority = 'normal'
    if (sourceApp !== 'mobile') sourceApp = 'web'

    if (files.length > MAX_FILES) {
      return c.json({ error: `At most ${MAX_FILES} screenshots are allowed` }, 400)
    }
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return c.json({ error: 'Each screenshot must be 5MB or smaller' }, 400)
      }
    }

    // Reporter org name snapshot (best-effort).
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', auth.orgId)
      .maybeSingle()

    const reporterName = `${auth.user.firstName} ${auth.user.lastName}`.trim() || auth.user.email

    // 1. Create the local row first (pending) so attachments scope to its id.
    const { data: ticket, error: insertError } = await supabaseAdmin
      .from('feedback_tickets')
      .insert({
        organization_id: auth.orgId,
        site_id: auth.user.siteId,
        user_id: auth.user.id,
        reporter_name: reporterName,
        reporter_email: auth.user.email,
        reporter_role: auth.user.role,
        reporter_org_name: org?.name ?? null,
        type,
        subject,
        description,
        priority,
        status: 'open',
        sync_state: 'pending',
        diagnostics,
        source_app: sourceApp,
      })
      .select()
      .single()

    if (insertError || !ticket) {
      logger.error('Failed to create feedback ticket', { orgId: auth.orgId }, insertError ? new Error(insertError.message) : undefined)
      return c.json({ error: 'Failed to create feedback' }, 500)
    }

    // 2. Upload screenshots → ollo-feedback bucket → feedback_attachments.
    const attachmentPayload: Array<{ url: string; name: string; type: string; size: number }> = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${auth.orgId}/${auth.user.id}/${ticket.id}/${Date.now()}-${i}.${ext}`
      const buffer = await file.arrayBuffer()
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(path, buffer, { contentType: file.type || 'image/jpeg', upsert: false })

      if (uploadError) {
        logger.error('Feedback screenshot upload failed', { ticketId: ticket.id }, new Error(uploadError.message))
        continue // a failed screenshot shouldn't block the report
      }

      const url = publicUrlFor(path)
      await supabaseAdmin.from('feedback_attachments').insert({
        feedback_ticket_id: ticket.id,
        storage_path: path,
        public_url: url,
        content_type: file.type || 'image/jpeg',
        byte_size: file.size,
      })
      attachmentPayload.push({ url, name: file.name || `screenshot-${i + 1}.${ext}`, type: file.type || 'image/jpeg', size: file.size })
    }

    // 3. Push to Ollo Dev. The report is already saved, so a failure here is
    //    non-fatal — the retry sweep will re-send later.
    const push = await createOlloDevTicket({
      externalRef: ticket.id,
      type: type as 'bug' | 'feature' | 'question',
      subject,
      description,
      priority: priority as 'low' | 'normal' | 'high' | 'urgent',
      reporter: { email: auth.user.email, name: reporterName, role: auth.user.role, org: org?.name ?? undefined },
      attachments: attachmentPayload,
      diagnostics,
    })

    const update = push.success
      ? { ollo_dev_ticket_id: push.olloDevTicketId, sync_state: 'synced', sync_error: null, sync_attempts: 1, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { sync_state: 'failed', sync_error: push.error ?? 'Sync failed', sync_attempts: 1, updated_at: new Date().toISOString() }

    const { data: finalTicket } = await supabaseAdmin
      .from('feedback_tickets')
      .update(update)
      .eq('id', ticket.id)
      .select()
      .single()

    return c.json({ ticket: mapTicket((finalTicket ?? { ...ticket, ...update }) as TicketRow) }, 201)
  } catch (error) {
    logger.error('Create feedback error', {}, error as Error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create feedback' }, 500)
  }
})

// ============================================================
// GET /api/v1/feedback — list the current user's reports
// ============================================================
feedback.get('/', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100)

    const { data, error } = await supabaseAdmin
      .from('feedback_tickets')
      .select('id, type, subject, description, priority, status, sync_state, ollo_dev_ticket_id, source_app, created_at, updated_at')
      .eq('organization_id', auth.orgId)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ tickets: (data ?? []).map((r) => mapTicket(r as TicketRow)) })
  } catch (error) {
    logger.error('List feedback error', {}, error as Error)
    return c.json({ error: 'Failed to list feedback' }, 500)
  }
})

// ============================================================
// GET /api/v1/feedback/:id — one report + thread + screenshots
// ============================================================
feedback.get('/:id', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    const { data: ticket } = await supabaseAdmin
      .from('feedback_tickets')
      .select('id, type, subject, description, priority, status, sync_state, ollo_dev_ticket_id, source_app, created_at, updated_at, user_id, organization_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!ticket || ticket.user_id !== auth.user.id) {
      return c.json({ error: 'Feedback not found' }, 404)
    }

    const [{ data: comments }, { data: attachments }] = await Promise.all([
      supabaseAdmin
        .from('feedback_comments')
        .select('id, author_type, author_name, body, origin, created_at')
        .eq('feedback_ticket_id', id)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('feedback_attachments')
        .select('id, public_url, content_type, width, height')
        .eq('feedback_ticket_id', id)
        .order('created_at', { ascending: true }),
    ])

    return c.json({
      ticket: {
        ...mapTicket(ticket as TicketRow),
        comments: (comments ?? []).map(mapComment),
        attachments: (attachments ?? []).map(mapAttachment),
      },
    })
  } catch (error) {
    logger.error('Get feedback error', {}, error as Error)
    return c.json({ error: 'Failed to load feedback' }, 500)
  }
})

// ============================================================
// POST /api/v1/feedback/:id/comments — user reply (synced up)
// ============================================================
feedback.post('/:id/comments', authorize([...ALL_ROLES]), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json().catch(() => ({}))
    const text = (body.body || '').toString().trim()

    if (!text) return c.json({ error: 'Comment body is required' }, 400)

    const { data: ticket } = await supabaseAdmin
      .from('feedback_tickets')
      .select('id, user_id, ollo_dev_ticket_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!ticket || ticket.user_id !== auth.user.id) {
      return c.json({ error: 'Feedback not found' }, 404)
    }

    const reporterName = `${auth.user.firstName} ${auth.user.lastName}`.trim() || auth.user.email

    const { data: comment, error } = await supabaseAdmin
      .from('feedback_comments')
      .insert({
        feedback_ticket_id: id,
        author_type: 'user',
        author_name: reporterName,
        body: text,
        origin: 'inspect',
        author_user_id: auth.user.id,
      })
      .select('id, author_type, author_name, body, origin, created_at')
      .single()

    if (error || !comment) return c.json({ error: 'Failed to add comment' }, 500)

    // Push to Ollo Dev (best-effort; the local comment is already saved).
    if (ticket.ollo_dev_ticket_id) {
      appendOlloDevComment(ticket.ollo_dev_ticket_id, {
        externalRef: comment.id,
        body: text,
        author: { name: reporterName, email: auth.user.email },
      }).catch((err) => logger.error('Failed to push feedback comment to Ollo Dev', { ticketId: id }, err as Error))
    }

    return c.json({ comment: mapComment(comment) }, 201)
  } catch (error) {
    logger.error('Add feedback comment error', {}, error as Error)
    return c.json({ error: 'Failed to add comment' }, 500)
  }
})

export default feedback
