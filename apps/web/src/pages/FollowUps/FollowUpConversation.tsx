/**
 * FollowUpConversation — live two-way SMS thread for the Follow-Up detail modal.
 *
 * Keyed by the customer's phone number, so it shows the *same* conversation as the
 * Messages module (all prior comms across visits), not just this visit. Reuses the
 * Messages conversation endpoints and subscribes to the org socket room for live
 * inbound/outbound updates (mirrors the per-health-check SmsTab pattern).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api, SmsMessage } from '../../lib/api'

interface Props {
  phoneNumber: string // E.164
  customerName: string | null
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function fmtPhone(phone: string): string {
  if (phone.startsWith('+44') && phone.length === 13) {
    const local = '0' + phone.substring(3)
    return `${local.substring(0, 5)} ${local.substring(5)}`
  }
  return phone
}

// The customer's side of a message: inbound → who it's from, outbound → who it's to.
const externalNumber = (m: { direction: string; from_number?: string; to_number?: string }) =>
  m.direction === 'inbound' ? m.from_number || '' : m.to_number || ''

export default function FollowUpConversation({ phoneNumber, customerName }: Props) {
  const { session } = useAuth()
  const token = session?.accessToken
  const { on, off } = useSocket()

  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchMessages = useCallback(async () => {
    if (!token || !phoneNumber) return
    try {
      const data = await api<{ messages: SmsMessage[] }>(
        `/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}`,
        { token }
      )
      setMessages(data.messages || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [token, phoneNumber])

  const markRead = useCallback(async () => {
    if (!token || !phoneNumber) return
    try {
      await api(`/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}/mark-read`, { method: 'PUT', token })
    } catch {
      /* non-fatal */
    }
  }, [token, phoneNumber])

  // Initial load + mark read
  useEffect(() => {
    fetchMessages().then(markRead)
  }, [fetchMessages, markRead])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Live updates from the org socket room (auto-joined on connect). Filter to this
  // customer's number so only their messages append.
  useEffect(() => {
    const append = (m: SmsMessage) =>
      setMessages((prev) =>
        prev.some((x) => x.id === m.id || (x.twilio_sid && x.twilio_sid === m.twilio_sid)) ? prev : [...prev, m]
      )

    const onReceived = (data: { message: SmsMessage }) => {
      if (externalNumber(data.message) !== phoneNumber) return
      append(data.message)
      markRead()
    }
    const onSent = (data: { message: SmsMessage }) => {
      if (externalNumber(data.message) !== phoneNumber) return
      append(data.message)
    }

    on(WS_EVENTS.SMS_RECEIVED, onReceived)
    on(WS_EVENTS.SMS_SENT, onSent)
    return () => {
      off(WS_EVENTS.SMS_RECEIVED, onReceived as (...args: unknown[]) => void)
      off(WS_EVENTS.SMS_SENT, onSent as (...args: unknown[]) => void)
    }
  }, [phoneNumber, on, off, markRead])

  const handleSend = async () => {
    if (!text.trim() || sending || !token) return
    setSending(true)
    setSendError(null)
    try {
      const data = await api<{ success: boolean; message: SmsMessage }>(
        `/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}/reply`,
        { method: 'POST', token, body: { message: text.trim() } }
      )
      if (data.message) {
        setMessages((prev) => (prev.some((x) => x.id === data.message.id) ? prev : [...prev, data.message]))
      }
      setText('')
      taRef.current?.focus()
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

  const charCount = text.length
  const segments = Math.ceil(charCount / 160) || 0

  return (
    <div className="flex flex-col h-full border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-gray-200 flex items-center gap-2">
        <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        <span className="text-sm font-semibold text-gray-900">Conversation</span>
        <span className="text-xs text-gray-400 ml-auto">{fmtPhone(phoneNumber)}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 bg-gray-50/40">
        {error && (
          <div className="text-center text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
            <button onClick={fetchMessages} className="ml-2 text-red-700 underline">Retry</button>
          </div>
        )}

        {loading && messages.length === 0 && !error && (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {!loading && messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 text-center px-4">
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Send {customerName || 'the customer'} an SMS to start the conversation</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 ${
                msg.direction === 'outbound' ? 'bg-primary text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
              <div className={`flex items-center gap-2 mt-1 text-[11px] ${msg.direction === 'outbound' ? 'text-indigo-200' : 'text-gray-400'}`}>
                <span>{fmtTime(msg.created_at)}</span>
                {msg.direction === 'outbound' && msg.sender && <span>· {msg.sender.first_name} {msg.sender.last_name}</span>}
                {msg.direction === 'outbound' && msg.twilio_status === 'failed' && <span className="text-red-300 font-medium">· Failed</span>}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-gray-200 px-3 py-2.5 bg-white">
        {sendError && <div className="mb-1.5 text-xs text-red-600">{sendError}</div>}
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type an SMS…"
              rows={2}
              disabled={sending}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {charCount > 0 && (
              <div className="absolute bottom-1 right-2 text-[11px] text-gray-400">
                <span className={charCount > 160 ? 'text-amber-500' : ''}>{charCount}/160{segments > 1 ? ` · ${segments}` : ''}</span>
              </div>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50 self-end"
            aria-label="Send SMS"
          >
            {sending ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
