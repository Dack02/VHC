/**
 * NotificationBell Component
 * Shows notification bell with unread count badge and dropdown
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../contexts/SocketContext'
import { api } from '../lib/api'
import { isPushSupported, getPushPermission, subscribeToPush } from '../lib/push-notifications'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  health_check_id?: string
  action_url?: string
  is_read: boolean
  read_at?: string
  created_at: string
  health_check?: {
    id: string
    vehicle?: {
      registration: string
    }
  }
}

interface NotificationsResponse {
  notifications: Notification[]
  unreadCount: number
  hasMore: boolean
}

interface WebSocketNotification {
  id: string
  type: string
  title: string
  message: string
  healthCheckId?: string
  priority?: string
  actionUrl?: string
  timestamp: string
}

export default function NotificationBell() {
  const { session } = useAuth()
  const { on, off, isConnected } = useSocket()
  const navigate = useNavigate()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<WebSocketNotification | null>(null)
  const [showPushPrompt, setShowPushPrompt] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!session?.accessToken) return

    setIsLoading(true)
    try {
      const data = await api<NotificationsResponse>('/api/v1/notifications?limit=10', {
        token: session.accessToken
      })
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setIsLoading(false)
    }
  }, [session?.accessToken])

  // Mark notification as read
  const markAsRead = async (notificationId: string) => {
    if (!session?.accessToken) return

    try {
      await api(`/api/v1/notifications/${notificationId}/read`, {
        method: 'PUT',
        token: session.accessToken
      })

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }

  // Mark all as read
  const markAllAsRead = async () => {
    if (!session?.accessToken) return

    try {
      await api('/api/v1/notifications/read-all', {
        method: 'PUT',
        token: session.accessToken
      })

      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      )
      setUnreadCount(0)
    } catch (error) {
      console.error('Failed to mark all as read:', error)
    }
  }

  // Handle notification click
  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead(notification.id)
    }

    setIsOpen(false)

    if (notification.action_url) {
      navigate(notification.action_url)
    } else if (notification.health_check_id) {
      navigate(`/health-checks/${notification.health_check_id}`)
    }
  }

  // Handle real-time notification
  const handleRealtimeNotification = useCallback((data: WebSocketNotification) => {
    // Add to notifications list
    const newNotification: Notification = {
      id: data.id,
      type: data.type,
      title: data.title,
      message: data.message,
      priority: (data.priority || 'normal') as Notification['priority'],
      health_check_id: data.healthCheckId,
      action_url: data.actionUrl,
      is_read: false,
      created_at: data.timestamp
    }

    setNotifications(prev => [newNotification, ...prev.slice(0, 9)])
    setUnreadCount(prev => prev + 1)

    // Show toast
    setToast(data)

    // Clear previous timeout
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
    }

    // Auto-hide toast after 5 seconds
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null)
    }, 5000)
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Poll unread count every 30s as fallback
  useEffect(() => {
    if (!session?.accessToken) return
    const poll = async () => {
      try {
        const data = await api<{ count: number }>('/api/v1/notifications/unread-count', {
          token: session.accessToken,
          retry: false
        })
        setUnreadCount(data.count)
      } catch { /* next interval */ }
    }
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [session?.accessToken])

  // Refetch when tab becomes visible
  useEffect(() => {
    if (!session?.accessToken) return
    const handler = () => {
      if (document.visibilityState === 'visible') setTimeout(fetchNotifications, 500)
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [session?.accessToken, fetchNotifications])

  // WebSocket listener
  useEffect(() => {
    if (!isConnected) return

    on<WebSocketNotification>(WS_EVENTS.NOTIFICATION, handleRealtimeNotification)

    return () => {
      off(WS_EVENTS.NOTIFICATION, handleRealtimeNotification as (...args: unknown[]) => void)
    }
  }, [isConnected, on, off, handleRealtimeNotification])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup toast timeout on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  // Show push notification prompt after 5s if permission is 'default'
  useEffect(() => {
    if (!isPushSupported()) return
    if (getPushPermission() !== 'default') return

    const dismissed = sessionStorage.getItem('vhc_push_prompt_dismissed')
    if (dismissed) return

    const timer = setTimeout(() => setShowPushPrompt(true), 5000)
    return () => clearTimeout(timer)
  }, [])

  // Listen for SW notification click messages to navigate
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data.url) {
        navigate(event.data.url)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handler)
    return () => navigator.serviceWorker?.removeEventListener('message', handler)
  }, [navigate])

  const handleEnablePush = async () => {
    if (!session?.accessToken) return
    setShowPushPrompt(false)
    await subscribeToPush(session.accessToken)
  }

  const handleDismissPush = () => {
    setShowPushPrompt(false)
    sessionStorage.setItem('vhc_push_prompt_dismissed', '1')
  }

  // Format time ago
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'customer_viewed':
        return (
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
        )
      case 'customer_authorized':
        return (
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'customer_declined':
        return (
          <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      case 'link_expiring':
        return (
          <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
      case 'link_expired':
        return (
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
      case 'sms_received':
        return (
          <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
        )
      case 'health_check_assigned':
        return (
          <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
        )
    }
  }

  // Get priority badge color
  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500'
      case 'high': return 'bg-orange-500'
      default: return ''
    }
  }

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm">
            <div className="flex items-start">
              {getNotificationIcon(toast.type)}
              <div className="ml-3 flex-1">
                <p className="text-sm font-medium text-gray-900">{toast.title}</p>
                <p className="text-sm text-gray-500 mt-1">{toast.message}</p>
              </div>
              <button
                onClick={() => setToast(null)}
                className="ml-2 text-gray-400 hover:text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push notification prompt */}
      {showPushPrompt && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 max-w-xs">
            <p className="text-sm font-medium text-gray-900 mb-1">Enable desktop notifications?</p>
            <p className="text-xs text-gray-500 mb-3">Get notified about VHC updates even when this tab isn't active.</p>
            <div className="flex gap-2">
              <button
                onClick={handleEnablePush}
                className="flex-1 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-dark"
              >
                Enable
              </button>
              <button
                onClick={handleDismissPush}
                className="flex-1 px-3 py-1.5 text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification bell */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => {
            setIsOpen(!isOpen)
            if (!isOpen) fetchNotifications()
          }}
          className="relative text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-full p-1"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>

          {/* Unread badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-primary hover:text-primary-dark"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Notifications list */}
            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                </div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${
                      !notification.is_read ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-start">
                      {getNotificationIcon(notification.type)}
                      <div className="ml-3 flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm font-medium truncate ${
                            !notification.is_read ? 'text-gray-900' : 'text-gray-700'
                          }`}>
                            {notification.title}
                          </p>
                          {notification.priority && ['urgent', 'high'].includes(notification.priority) && (
                            <span className={`ml-2 w-2 h-2 rounded-full ${getPriorityClass(notification.priority)}`}></span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {notification.message}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatTimeAgo(notification.created_at)}
                        </p>
                      </div>
                      {!notification.is_read && (
                        <div className="ml-2 w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2"></div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
                <button
                  onClick={() => {
                    setIsOpen(false)
                    navigate('/notifications')
                  }}
                  className="text-xs text-primary hover:text-primary-dark w-full text-center"
                >
                  View all notifications
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS for animation */}
      <style>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </>
  )
}
