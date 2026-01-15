/**
 * Notifications API routes
 * In-app notification management for staff
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { emitToUser, WS_EVENTS } from '../services/websocket.js'

const notificationRoutes = new Hono()

// Apply auth middleware to all routes
notificationRoutes.use('*', authMiddleware)

/**
 * GET /api/notifications
 * Get notifications for the current user
 */
notificationRoutes.get('/', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const unreadOnly = c.req.query('unread') === 'true'

  let query = supabaseAdmin
    .from('notifications')
    .select(`
      *,
      health_check:health_checks(
        id,
        vehicle:vehicles(registration)
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (unreadOnly) {
    query = query.eq('is_read', false)
  }

  const { data: notifications, error } = await query

  if (error) {
    console.error('Error fetching notifications:', error)
    return c.json({ error: 'Failed to fetch notifications' }, 500)
  }

  // Get unread count
  const { count: unreadCount } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  return c.json({
    notifications,
    unreadCount: unreadCount || 0,
    hasMore: notifications.length === limit
  })
})

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
notificationRoutes.get('/unread-count', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id

  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (error) {
    return c.json({ error: 'Failed to get count' }, 500)
  }

  return c.json({ count: count || 0 })
})

/**
 * PUT /api/notifications/:id/read
 * Mark notification as read
 */
notificationRoutes.put('/:id/read', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id
  const notificationId = c.req.param('id')

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', userId)

  if (error) {
    console.error('Error marking notification read:', error)
    return c.json({ error: 'Failed to update notification' }, 500)
  }

  return c.json({ success: true })
})

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read
 */
notificationRoutes.put('/read-all', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('is_read', false)

  if (error) {
    console.error('Error marking all notifications read:', error)
    return c.json({ error: 'Failed to update notifications' }, 500)
  }

  return c.json({ success: true })
})

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
notificationRoutes.delete('/:id', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id
  const notificationId = c.req.param('id')

  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('id', notificationId)
    .eq('user_id', userId)

  if (error) {
    console.error('Error deleting notification:', error)
    return c.json({ error: 'Failed to delete notification' }, 500)
  }

  return c.json({ success: true })
})

/**
 * DELETE /api/notifications
 * Delete all read notifications
 */
notificationRoutes.delete('/', async (c) => {
  const auth = c.get('auth')
  const userId = auth.user.id

  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .eq('user_id', userId)
    .eq('is_read', true)

  if (error) {
    console.error('Error deleting notifications:', error)
    return c.json({ error: 'Failed to delete notifications' }, 500)
  }

  return c.json({ success: true })
})

/**
 * Helper: Create notification for a user
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  options?: {
    healthCheckId?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    actionUrl?: string
    metadata?: Record<string, unknown>
  }
) {
  const { data: notification, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      health_check_id: options?.healthCheckId,
      priority: options?.priority || 'normal',
      action_url: options?.actionUrl,
      metadata: options?.metadata || {}
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating notification:', error)
    return null
  }

  // Send real-time notification via WebSocket
  emitToUser(userId, WS_EVENTS.NOTIFICATION, {
    id: notification.id,
    type,
    title,
    message,
    healthCheckId: options?.healthCheckId,
    priority: options?.priority || 'normal',
    actionUrl: options?.actionUrl,
    timestamp: notification.created_at
  })

  return notification
}

/**
 * Helper: Create notifications for all users at a site
 */
export async function createSiteNotifications(
  siteId: string,
  type: string,
  title: string,
  message: string,
  options?: {
    healthCheckId?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    actionUrl?: string
    metadata?: Record<string, unknown>
    excludeUserId?: string
  }
) {
  // Get all users at this site
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('site_id', siteId)
    .eq('is_active', true)

  if (!users || users.length === 0) return []

  const notifications = []
  for (const user of users) {
    if (options?.excludeUserId && user.id === options.excludeUserId) continue

    const notification = await createNotification(user.id, type, title, message, options)
    if (notification) {
      notifications.push(notification)
    }
  }

  return notifications
}

/**
 * Helper: Create notifications for users with specific roles at a site
 */
export async function createRoleNotifications(
  siteId: string,
  roles: string[],
  type: string,
  title: string,
  message: string,
  options?: {
    healthCheckId?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
    actionUrl?: string
    metadata?: Record<string, unknown>
  }
) {
  // Get users with specified roles at this site
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .in('role', roles)

  if (!users || users.length === 0) return []

  const notifications = []
  for (const user of users) {
    const notification = await createNotification(user.id, type, title, message, options)
    if (notification) {
      notifications.push(notification)
    }
  }

  return notifications
}

export default notificationRoutes
