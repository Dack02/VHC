/**
 * SMS Tab — Two-way SMS conversation UI for health check detail page
 * Shows inbound (customer) and outbound (staff) messages in a chat layout
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../../contexts/SocketContext'
import { api, SmsMessage } from '../../../lib/api'

interface SmsTabProps {
  healthCheckId: string
  onUnreadCountChange?: (count: number) => void
}

export function SmsTab({ healthCheckId, onUnreadCountChange }: SmsTabProps) {
  const { session } = useAuth()
  const { on, off, joinHealthCheck, leaveHealthCheck } = useSocket()
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const data = await api<{ messages: SmsMessage[] }>(
        `/api/v1/health-checks/${healthCheckId}/sms-messages`,
        { token: session.accessToken }
      )
      setMessages(data.messages || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, healthCheckId])

  // Mark messages as read
  const markRead = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/sms-messages/mark-read`, {
        method: 'PUT',
        token: session.accessToken
      })
      onUnreadCountChange?.(0)
    } catch {
      // Silently fail
    }
  }, [session?.accessToken, healthCheckId, onUnreadCountChange])

  // Initial load + mark read
  useEffect(() => {
    fetchMessages().then(() => {
      markRead()
    })
  }, [fetchMessages, markRead])

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Join health check room for real-time updates
  useEffect(() => {
    joinHealthCheck(healthCheckId)

    const handleSmsReceived = (data: { message: SmsMessage }) => {
      setMessages(prev => [...prev, data.message])
      // Auto mark-read since user is on the tab
      markRead()
    }

    const handleSmsSent = (data: { message: SmsMessage }) => {
      setMessages(prev => {
        // Avoid duplicates (if we already added it from the send response)
        if (prev.some(m => m.twilio_sid === data.message.twilio_sid)) return prev
        return [...prev, data.message]
      })
    }

    on(WS_EVENTS.SMS_RECEIVED, handleSmsReceived)
    on(WS_EVENTS.SMS_SENT, handleSmsSent)

    return () => {
      leaveHealthCheck(healthCheckId)
      off(WS_EVENTS.SMS_RECEIVED, handleSmsReceived as any)
      off(WS_EVENTS.SMS_SENT, handleSmsSent as any)
    }
  }, [healthCheckId, joinHealthCheck, leaveHealthCheck, on, off, markRead])

  // Send reply
  const handleSend = async () => {
    if (!replyText.trim() || sending || !session?.accessToken) return

    setSending(true)
    try {
      const data = await api<{ success: boolean; message: SmsMessage }>(`/api/v1/health-checks/${healthCheckId}/sms-reply`, {
        method: 'POST',
        token: session.accessToken,
        body: { message: replyText.trim() }
      })

      if (data.message) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.message.id)) return prev
          return [...prev, data.message]
        })
      }
      setReplyText('')
      textareaRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Character count for SMS segments
  const charCount = replyText.length
  const smsSegments = Math.ceil(charCount / 160) || 0

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col" style={{ height: 'calc(100vh - 380px)', minHeight: '400px' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
        <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <h3 className="text-sm font-semibold text-gray-900">SMS Conversation</h3>
        <span className="text-xs text-gray-500">({messages.length} message{messages.length !== 1 ? 's' : ''})</span>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {error && (
          <div className="text-center text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
            <button onClick={fetchMessages} className="ml-2 text-red-700 underline">Retry</button>
          </div>
        )}

        {messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">No SMS messages yet</p>
            <p className="text-xs mt-1">Send a message to start the conversation</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-xl px-4 py-2 ${
                msg.direction === 'outbound'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-900 rounded-bl-sm'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
              <div className={`flex items-center gap-2 mt-1 text-xs ${
                msg.direction === 'outbound' ? 'text-indigo-200' : 'text-gray-500'
              }`}>
                <span>{formatTime(msg.created_at)}</span>
                {msg.direction === 'outbound' && msg.sender && (
                  <span>- {msg.sender.first_name} {msg.sender.last_name}</span>
                )}
                {msg.direction === 'outbound' && msg.twilio_status === 'failed' && (
                  <span className="text-red-300 font-medium">Failed</span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Input */}
      <div className="border-t border-gray-200 px-4 py-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your SMS reply..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              disabled={sending}
            />
            <div className="absolute bottom-1 right-2 text-xs text-gray-400">
              {charCount > 0 && (
                <span className={charCount > 160 ? 'text-amber-500' : ''}>
                  {charCount}/160{smsSegments > 1 ? ` (${smsSegments} segments)` : ''}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleSend}
            disabled={!replyText.trim() || sending}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed self-end"
          >
            {sending ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
