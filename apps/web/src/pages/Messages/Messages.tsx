/**
 * Messages page — Two-panel layout: conversation list | chat thread
 * Shows all SMS conversations grouped by phone number, including orphan messages.
 */

import { useState, useCallback, useEffect } from 'react'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { useUnreadSmsCount } from '../../hooks/useUnreadSmsCount'
import { useIsMobile } from '../../hooks/useIsMobile'
import { SmsMessage } from '../../lib/api'
import ConversationList from './ConversationList'
import ChatThread from './ChatThread'
import { useConversations } from './useConversations'

export default function Messages() {
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread' | 'unlinked'>('all')
  const [search, setSearch] = useState('')
  const { on, off } = useSocket()
  const { decrement } = useUnreadSmsCount()
  const isMobile = useIsMobile()

  const showList = !isMobile || !selectedPhone
  const showThread = !isMobile || !!selectedPhone

  const handleBackToList = useCallback(() => {
    setSelectedPhone(null)
  }, [])

  const {
    conversations,
    loading,
    error,
    bumpConversation,
    markConversationRead
  } = useConversations({ filter, search })

  // Listen for real-time SMS events on org room
  useEffect(() => {
    const handleSmsReceived = (data: { message: SmsMessage & { from_number?: string; to_number?: string } }) => {
      const msg = data.message
      const phone = msg.direction === 'inbound' ? msg.from_number : msg.to_number
      if (!phone) return

      bumpConversation(phone, {
        body: msg.body,
        direction: msg.direction as 'inbound' | 'outbound',
        createdAt: msg.created_at,
        isRead: msg.is_read
      })
    }

    const handleSmsSent = (data: { message: SmsMessage & { from_number?: string; to_number?: string } }) => {
      const msg = data.message
      const phone = msg.direction === 'outbound' ? msg.to_number : msg.from_number
      if (!phone) return

      bumpConversation(phone, {
        body: msg.body,
        direction: 'outbound',
        createdAt: msg.created_at,
        isRead: true
      })
    }

    on(WS_EVENTS.SMS_RECEIVED, handleSmsReceived)
    on(WS_EVENTS.SMS_SENT, handleSmsSent)

    return () => {
      off(WS_EVENTS.SMS_RECEIVED, handleSmsReceived as any)
      off(WS_EVENTS.SMS_SENT, handleSmsSent as any)
    }
  }, [on, off, bumpConversation])

  const handleMarkRead = useCallback(() => {
    if (selectedPhone) {
      const conv = conversations.find(c => c.phoneNumber === selectedPhone)
      if (conv && conv.unreadCount > 0) {
        decrement(conv.unreadCount)
        markConversationRead(selectedPhone)
      }
    }
  }, [selectedPhone, conversations, decrement, markConversationRead])

  const handleMessageSent = useCallback((msg: SmsMessage) => {
    if (selectedPhone) {
      bumpConversation(selectedPhone, {
        body: msg.body,
        direction: 'outbound',
        createdAt: msg.created_at,
        isRead: true
      })
    }
  }, [selectedPhone, bumpConversation])

  // Get customer name for selected conversation
  const selectedConv = conversations.find(c => c.phoneNumber === selectedPhone)
  const customerName = selectedConv?.customer
    ? `${selectedConv.customer.firstName} ${selectedConv.customer.lastName}`
    : null

  return (
    <div className="h-[calc(100vh-130px)] flex bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Left panel: conversation list */}
      {showList && (
        <div className={`${isMobile ? 'w-full' : 'w-96'} border-r border-gray-200 flex-shrink-0`}>
          <ConversationList
            conversations={conversations}
            loading={loading}
            error={error}
            selectedPhone={selectedPhone}
            onSelect={setSelectedPhone}
            onFilterChange={setFilter}
            onSearchChange={setSearch}
            filter={filter}
            search={search}
          />
        </div>
      )}

      {/* Right panel: chat thread */}
      {showThread && (
        <div className="flex-1 min-w-0">
          {selectedPhone ? (
            <ChatThread
              phoneNumber={selectedPhone}
              customerName={customerName}
              onMarkRead={handleMarkRead}
              onMessageSent={handleMessageSent}
              onBack={isMobile ? handleBackToList : undefined}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg font-medium">Select a conversation</p>
              <p className="text-sm mt-1">Choose a conversation from the list to view messages</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
