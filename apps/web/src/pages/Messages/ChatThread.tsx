/**
 * ChatThread — Right panel: message thread with reply input
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, SmsMessage } from '../../lib/api'
import { useConversationMessages } from './useConversationMessages'

interface ChatThreadProps {
  phoneNumber: string
  customerName: string | null
  onMarkRead: () => void
  onMessageSent: (msg: SmsMessage) => void
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatPhoneDisplay(phone: string): string {
  if (phone.startsWith('+44') && phone.length === 13) {
    const local = '0' + phone.substring(3)
    return `${local.substring(0, 5)} ${local.substring(5)}`
  }
  return phone
}

export default function ChatThread({ phoneNumber, customerName, onMarkRead, onMessageSent }: ChatThreadProps) {
  const { session } = useAuth()
  const { thread, loading, error, appendMessage, markRead } = useConversationMessages(phoneNumber)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Scroll on new messages
  useEffect(() => {
    scrollToBottom()
  }, [thread?.messages, scrollToBottom])

  // Mark read on mount and phone change
  useEffect(() => {
    markRead().then(() => {
      onMarkRead()
    })
  }, [phoneNumber, markRead, onMarkRead])

  // Reset reply when switching conversations
  useEffect(() => {
    setReplyText('')
    setSendError(null)
  }, [phoneNumber])

  const handleSend = async () => {
    if (!replyText.trim() || sending || !session?.accessToken) return

    setSending(true)
    setSendError(null)
    try {
      const data = await api<{ success: boolean; message: SmsMessage }>(
        `/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}/reply`,
        {
          method: 'POST',
          token: session.accessToken,
          body: { message: replyText.trim() }
        }
      )

      if (data.message) {
        appendMessage(data.message)
        onMessageSent(data.message)
      }
      setReplyText('')
      textareaRef.current?.focus()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send')
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

  const charCount = replyText.length
  const smsSegments = Math.ceil(charCount / 160) || 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {customerName || formatPhoneDisplay(phoneNumber)}
            </h2>
            {customerName && (
              <p className="text-xs text-gray-500">{formatPhoneDisplay(phoneNumber)}</p>
            )}
          </div>
          {thread?.healthChecks && thread.healthChecks.length > 0 && (
            <div className="flex gap-1.5">
              {thread.healthChecks.slice(0, 3).map(hc => (
                <Link
                  key={hc.id}
                  to={`/health-checks/${hc.id}`}
                  className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                >
                  {hc.vhcReference || 'HC'}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {error && (
          <div className="text-center text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {thread?.messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <p className="text-sm">No messages in this conversation</p>
          </div>
        )}

        {thread?.messages.map((msg) => (
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

      {/* Reply input */}
      <div className="border-t border-gray-200 px-5 py-3 bg-white">
        {sendError && (
          <div className="mb-2 text-xs text-red-600">{sendError}</div>
        )}
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
