/**
 * Hook: fetch and manage conversation list for Messages page
 */

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

export interface Conversation {
  phoneNumber: string
  customer: { id: string; firstName: string; lastName: string } | null
  latestMessage: {
    body: string
    direction: 'inbound' | 'outbound'
    createdAt: string
    isRead: boolean
  }
  unreadCount: number
  latestHealthCheck: { id: string; vhcReference: string | null; status: string } | null
}

interface UseConversationsOptions {
  filter?: 'all' | 'unread' | 'unlinked'
  search?: string
}

export function useConversations(options: UseConversationsOptions = {}) {
  const { session } = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const fetchConversations = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const params = new URLSearchParams()
      if (options.filter && options.filter !== 'all') params.set('filter', options.filter)
      if (options.search) params.set('search', options.search)

      const qs = params.toString()
      const data = await api<{ conversations: Conversation[]; total: number }>(
        `/api/v1/messages/conversations${qs ? `?${qs}` : ''}`,
        { token: session.accessToken }
      )
      setConversations(data.conversations || [])
      setTotal(data.total || 0)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, options.filter, options.search])

  useEffect(() => {
    setLoading(true)
    fetchConversations()
  }, [fetchConversations])

  const bumpConversation = useCallback((phoneNumber: string, message: { body: string; direction: 'inbound' | 'outbound'; createdAt: string; isRead: boolean }) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => c.phoneNumber === phoneNumber)
      if (idx >= 0) {
        const conv = { ...prev[idx] }
        conv.latestMessage = message
        if (message.direction === 'inbound' && !message.isRead) {
          conv.unreadCount++
        }
        const updated = [...prev]
        updated.splice(idx, 1)
        return [conv, ...updated]
      }
      // New conversation — add to top
      return [{
        phoneNumber,
        customer: null,
        latestMessage: message,
        unreadCount: message.direction === 'inbound' && !message.isRead ? 1 : 0,
        latestHealthCheck: null
      }, ...prev]
    })
  }, [])

  const markConversationRead = useCallback((phoneNumber: string) => {
    setConversations(prev =>
      prev.map(c => c.phoneNumber === phoneNumber ? { ...c, unreadCount: 0 } : c)
    )
  }, [])

  return {
    conversations,
    loading,
    error,
    total,
    refresh: fetchConversations,
    bumpConversation,
    markConversationRead
  }
}
