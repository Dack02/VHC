/**
 * WebSocket Service - Real-time notifications using Socket.io
 */

import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { supabaseAdmin } from '../lib/supabase.js'
import { getSubClient, PUBSUB_CHANNELS, type WebSocketPubSubEvent } from './queue.js'

let io: Server | null = null

// Event types
export const WS_EVENTS = {
  // Server -> Client
  HEALTH_CHECK_STATUS_CHANGED: 'health_check:status_changed',
  TECHNICIAN_CLOCKED_IN: 'technician:clocked_in',
  TECHNICIAN_CLOCKED_OUT: 'technician:clocked_out',
  TECHNICIAN_PROGRESS: 'technician:progress_updated',
  CUSTOMER_VIEWING: 'customer:viewing',
  CUSTOMER_ACTION: 'customer:action',
  CUSTOMER_AUTHORIZED: 'customer:authorized',
  CUSTOMER_DECLINED: 'customer:declined',
  CUSTOMER_SIGNED: 'customer:signed',
  NOTIFICATION: 'notification',
  ALERT: 'alert:sla_warning',
  LINK_EXPIRING: 'alert:link_expiring',
  LINK_EXPIRED: 'alert:link_expired',

  // Client -> Server
  JOIN_SITE: 'join_site',
  LEAVE_SITE: 'leave_site',
  JOIN_HEALTH_CHECK: 'join_health_check',
  LEAVE_HEALTH_CHECK: 'leave_health_check',
  SUBSCRIBE_USER: 'subscribe_user'
} as const

// Room naming conventions
const getRoomName = {
  site: (siteId: string) => `site:${siteId}`,
  healthCheck: (healthCheckId: string) => `hc:${healthCheckId}`,
  user: (userId: string) => `user:${userId}`,
  organization: (orgId: string) => `org:${orgId}`
}

/**
 * Initialize WebSocket server
 */
export function initializeWebSocket(httpServer: HttpServer): Server {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:5181',
        'http://localhost:5182',
        'http://localhost:5183',
        'http://localhost:5184',
        'http://127.0.0.1:5181',
        'http://127.0.0.1:5182',
        'http://127.0.0.1:5183',
        'http://127.0.0.1:5184'
      ]

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  })

  io.on('connection', handleConnection)

  // Subscribe to Redis pub/sub for cross-process WebSocket events
  // This allows the worker to emit events via the API server's WebSocket
  subscribeToWebSocketEvents()

  console.log('WebSocket server initialized')
  return io
}

/**
 * Subscribe to Redis pub/sub for WebSocket events from worker
 */
async function subscribeToWebSocketEvents() {
  try {
    const sub = getSubClient()

    sub.subscribe(PUBSUB_CHANNELS.WEBSOCKET_EVENT, (err) => {
      if (err) {
        console.error('Failed to subscribe to WebSocket events channel:', err)
        return
      }
      console.log('Subscribed to Redis pub/sub for WebSocket events')
    })

    sub.on('message', (channel, message) => {
      if (channel === PUBSUB_CHANNELS.WEBSOCKET_EVENT) {
        try {
          const event: WebSocketPubSubEvent = JSON.parse(message)
          handlePubSubEvent(event)
        } catch (err) {
          console.error('Error parsing pub/sub message:', err)
        }
      }
    })
  } catch (error) {
    console.error('Error setting up WebSocket pub/sub:', error)
  }
}

/**
 * Handle pub/sub event and emit via WebSocket
 */
function handlePubSubEvent(event: WebSocketPubSubEvent) {
  if (!io) return

  switch (event.type) {
    case 'emit_to_site':
      io.to(`site:${event.targetId}`).emit(event.event, event.data)
      break
    case 'emit_to_user':
      io.to(`user:${event.targetId}`).emit(event.event, event.data)
      break
    case 'emit_to_health_check':
      io.to(`hc:${event.targetId}`).emit(event.event, event.data)
      break
  }
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(socket: Socket) {
  console.log('WebSocket client connected:', socket.id)

  // Handle authentication (optional - can be used for user-specific notifications)
  const token = socket.handshake.auth?.token
  const handshakeOrgId = socket.handshake.auth?.organizationId
  let userId: string | null = null
  let organizationId: string | null = null
  let siteId: string | null = null

  if (token) {
    try {
      // Verify token and get user info
      const { data: { user } } = await supabaseAdmin.auth.getUser(token)
      if (user) {
        // Multi-org: use organizationId from handshake to pick the right user record
        let query = supabaseAdmin
          .from('users')
          .select('id, organization_id, site_id')
          .eq('auth_id', user.id)

        if (handshakeOrgId) {
          query = query.eq('organization_id', handshakeOrgId)
        }

        const { data: userData } = await query.limit(1).single()

        if (userData) {
          userId = userData.id
          organizationId = userData.organization_id
          siteId = userData.site_id

          // Auto-join user's rooms
          if (userId) {
            socket.join(getRoomName.user(userId))
          }
          if (organizationId) {
            socket.join(getRoomName.organization(organizationId))
          }
          if (siteId) {
            socket.join(getRoomName.site(siteId))
          }

          console.log(`User ${userId} authenticated and joined rooms`)
        }
      }
    } catch (error) {
      console.error('WebSocket auth error:', error)
    }
  }

  // Handle join site room
  socket.on(WS_EVENTS.JOIN_SITE, (data: { siteId: string }) => {
    socket.join(getRoomName.site(data.siteId))
    console.log(`Socket ${socket.id} joined site ${data.siteId}`)
  })

  // Handle leave site room
  socket.on(WS_EVENTS.LEAVE_SITE, (data: { siteId: string }) => {
    socket.leave(getRoomName.site(data.siteId))
    console.log(`Socket ${socket.id} left site ${data.siteId}`)
  })

  // Handle join health check room (for real-time updates on specific health check)
  socket.on(WS_EVENTS.JOIN_HEALTH_CHECK, (data: { healthCheckId: string }) => {
    socket.join(getRoomName.healthCheck(data.healthCheckId))
    console.log(`Socket ${socket.id} joined health check ${data.healthCheckId}`)
  })

  // Handle leave health check room
  socket.on(WS_EVENTS.LEAVE_HEALTH_CHECK, (data: { healthCheckId: string }) => {
    socket.leave(getRoomName.healthCheck(data.healthCheckId))
    console.log(`Socket ${socket.id} left health check ${data.healthCheckId}`)
  })

  // Handle subscribe to user notifications
  socket.on(WS_EVENTS.SUBSCRIBE_USER, (data: { userId: string }) => {
    socket.join(getRoomName.user(data.userId))
    console.log(`Socket ${socket.id} subscribed to user ${data.userId}`)
  })

  // Handle disconnect
  socket.on('disconnect', (reason) => {
    console.log(`WebSocket client disconnected: ${socket.id}, reason: ${reason}`)
  })
}

/**
 * Emit event to a specific site
 */
export function emitToSite(siteId: string, event: string, data: unknown) {
  if (io) {
    io.to(getRoomName.site(siteId)).emit(event, data)
  }
}

/**
 * Emit event to a specific health check room
 */
export function emitToHealthCheck(healthCheckId: string, event: string, data: unknown) {
  if (io) {
    io.to(getRoomName.healthCheck(healthCheckId)).emit(event, data)
  }
}

/**
 * Emit event to a specific user
 */
export function emitToUser(userId: string, event: string, data: unknown) {
  if (io) {
    io.to(getRoomName.user(userId)).emit(event, data)
  }
}

/**
 * Emit event to an organization
 */
export function emitToOrganization(orgId: string, event: string, data: unknown) {
  if (io) {
    io.to(getRoomName.organization(orgId)).emit(event, data)
  }
}

/**
 * Broadcast event to all connected clients
 */
export function broadcast(event: string, data: unknown) {
  if (io) {
    io.emit(event, data)
  }
}

// Convenience functions for specific events

export function notifyHealthCheckStatusChanged(
  siteId: string,
  healthCheckId: string,
  data: {
    status: string
    previousStatus: string
    vehicleReg: string
    customerName?: string
    updatedBy?: string
  }
) {
  emitToSite(siteId, WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
  emitToHealthCheck(healthCheckId, WS_EVENTS.HEALTH_CHECK_STATUS_CHANGED, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyTechnicianClockedIn(
  siteId: string,
  healthCheckId: string,
  data: {
    technicianId: string
    technicianName: string
    vehicleReg: string
  }
) {
  emitToSite(siteId, WS_EVENTS.TECHNICIAN_CLOCKED_IN, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyTechnicianClockedOut(
  siteId: string,
  healthCheckId: string,
  data: {
    technicianId: string
    technicianName: string
    vehicleReg: string
    completed: boolean
    duration: number
  }
) {
  emitToSite(siteId, WS_EVENTS.TECHNICIAN_CLOCKED_OUT, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyTechnicianProgress(
  siteId: string,
  healthCheckId: string,
  data: {
    technicianId: string
    completedItems: number
    totalItems: number
    redCount: number
    amberCount: number
    greenCount: number
  }
) {
  emitToSite(siteId, WS_EVENTS.TECHNICIAN_PROGRESS, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyCustomerViewing(
  siteId: string,
  healthCheckId: string,
  data: {
    vehicleReg: string
    customerName: string
    viewCount: number
    isFirstView: boolean
  }
) {
  emitToSite(siteId, WS_EVENTS.CUSTOMER_VIEWING, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyCustomerAction(
  siteId: string,
  healthCheckId: string,
  data: {
    vehicleReg: string
    customerName: string
    action: 'authorized' | 'declined' | 'signed'
    itemTitle?: string
    itemPrice?: number
    totalAuthorized?: number
    totalDeclined?: number
  }
) {
  const event =
    data.action === 'authorized'
      ? WS_EVENTS.CUSTOMER_AUTHORIZED
      : data.action === 'declined'
      ? WS_EVENTS.CUSTOMER_DECLINED
      : WS_EVENTS.CUSTOMER_SIGNED

  emitToSite(siteId, event, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
  emitToHealthCheck(healthCheckId, event, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyLinkExpiring(
  siteId: string,
  healthCheckId: string,
  data: {
    vehicleReg: string
    customerName: string
    hoursRemaining: number
    expiresAt: string
  }
) {
  emitToSite(siteId, WS_EVENTS.LINK_EXPIRING, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function notifyLinkExpired(
  siteId: string,
  healthCheckId: string,
  data: {
    vehicleReg: string
    customerName: string
  }
) {
  emitToSite(siteId, WS_EVENTS.LINK_EXPIRED, {
    healthCheckId,
    ...data,
    timestamp: new Date().toISOString()
  })
}

export function sendUserNotification(
  userId: string,
  notification: {
    id: string
    type: string
    title: string
    message: string
    healthCheckId?: string
    priority?: string
    actionUrl?: string
  }
) {
  emitToUser(userId, WS_EVENTS.NOTIFICATION, {
    ...notification,
    timestamp: new Date().toISOString()
  })
}

/**
 * Get the Socket.io server instance
 */
export function getIO(): Server | null {
  return io
}

/**
 * Check if WebSocket server is initialized
 */
export function isWebSocketInitialized(): boolean {
  return io !== null
}
