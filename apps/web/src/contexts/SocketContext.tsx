/**
 * Socket.io Context - Real-time WebSocket connection management
 */

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from './AuthContext'

// Match server-side WS_EVENTS
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

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  joinHealthCheck: (healthCheckId: string) => void
  leaveHealthCheck: (healthCheckId: string) => void
  on: <T = unknown>(event: string, callback: (data: T) => void) => void
  off: (event: string, callback?: (...args: unknown[]) => void) => void
}

const SocketContext = createContext<SocketContextType | null>(null)

interface SocketProviderProps {
  children: ReactNode
}

export function SocketProvider({ children }: SocketProviderProps) {
  const { session, activeOrgId } = useAuth()
  const token = session?.accessToken
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!token) {
      if (socket) {
        socket.disconnect()
        setSocket(null)
        setIsConnected(false)
      }
      return
    }

    // Get API URL from environment or use default
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5180'

    const newSocket = io(apiUrl, {
      auth: { token, organizationId: activeOrgId },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    })

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id)
      setIsConnected(true)
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason)
      setIsConnected(false)
    })

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message)
    })

    setSocket(newSocket)

    return () => {
      newSocket.disconnect()
    }
  }, [token, activeOrgId])

  const joinHealthCheck = useCallback((healthCheckId: string) => {
    if (socket) {
      socket.emit(WS_EVENTS.JOIN_HEALTH_CHECK, { healthCheckId })
    }
  }, [socket])

  const leaveHealthCheck = useCallback((healthCheckId: string) => {
    if (socket) {
      socket.emit(WS_EVENTS.LEAVE_HEALTH_CHECK, { healthCheckId })
    }
  }, [socket])

  const on = useCallback(<T = unknown>(event: string, callback: (data: T) => void) => {
    if (socket) {
      socket.on(event, callback as (...args: unknown[]) => void)
    }
  }, [socket])

  const off = useCallback((event: string, callback?: (...args: unknown[]) => void) => {
    if (socket) {
      socket.off(event, callback)
    }
  }, [socket])

  return (
    <SocketContext.Provider value={{ socket, isConnected, joinHealthCheck, leaveHealthCheck, on, off }}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket(): SocketContextType {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}
