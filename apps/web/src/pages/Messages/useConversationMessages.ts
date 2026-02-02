/**
 * Hook: fetch message thread for a selected conversation
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api, SmsMessage } from '../../lib/api'

interface ConversationThread {
  phoneNumber: string
  customer: { id: string; firstName: string; lastName: string } | null
  healthChecks: { id: string; vhcReference: string | null; status: string }[]
  messages: SmsMessage[]
}

export function useConversationMessages(phoneNumber: string | null) {
  const { session } = useAuth()
  const [thread, setThread] = useState<ConversationThread | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchThread = useCallback(async () => {
    if (!session?.accessToken || !phoneNumber) return
    setLoading(true)
    try {
      const data = await api<ConversationThread>(
        `/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}`,
        { token: session.accessToken }
      )
      setThread(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, phoneNumber])

  useEffect(() => {
    if (phoneNumber) {
      fetchThread()
    } else {
      setThread(null)
    }
  }, [phoneNumber, fetchThread])

  const appendMessage = useCallback((message: SmsMessage) => {
    setThread(prev => {
      if (!prev) return prev
      // Avoid duplicates
      if (prev.messages.some(m => m.id === message.id || (m.twilio_sid && m.twilio_sid === message.twilio_sid))) {
        return prev
      }
      return { ...prev, messages: [...prev.messages, message] }
    })
  }, [])

  const markRead = useCallback(async () => {
    if (!session?.accessToken || !phoneNumber) return
    try {
      await api(`/api/v1/messages/conversations/${encodeURIComponent(phoneNumber)}/mark-read`, {
        method: 'PUT',
        token: session.accessToken
      })
    } catch {
      // Silently fail
    }
  }, [session?.accessToken, phoneNumber])

  return {
    thread,
    loading,
    error,
    refresh: fetchThread,
    appendMessage,
    markRead
  }
}
