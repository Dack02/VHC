/**
 * ConversationItem — Single row in the conversation list
 */

import type { Conversation } from './useConversations'

interface ConversationItemProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function formatPhoneDisplay(phone: string): string {
  // Format UK numbers nicely: +447700900123 → 07700 900123
  if (phone.startsWith('+44') && phone.length === 13) {
    const local = '0' + phone.substring(3)
    return `${local.substring(0, 5)} ${local.substring(5)}`
  }
  return phone
}

export default function ConversationItem({ conversation, isActive, onClick }: ConversationItemProps) {
  const { customer, latestMessage, unreadCount, phoneNumber, latestHealthCheck } = conversation

  const displayName = customer
    ? `${customer.firstName} ${customer.lastName}`
    : formatPhoneDisplay(phoneNumber)

  const preview = latestMessage.body.length > 60
    ? latestMessage.body.substring(0, 57) + '...'
    : latestMessage.body

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
        isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
          customer ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'
        }`}>
          <span className="text-sm font-medium">
            {customer ? customer.firstName.charAt(0).toUpperCase() : '#'}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className={`text-sm truncate ${unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
              {displayName}
            </span>
            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
              {formatRelativeTime(latestMessage.createdAt)}
            </span>
          </div>

          <div className="flex items-center justify-between mt-0.5">
            <p className={`text-xs truncate ${unreadCount > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              {latestMessage.direction === 'outbound' && (
                <span className="text-gray-400">You: </span>
              )}
              {preview}
            </p>
            {unreadCount > 0 && (
              <span className="ml-2 flex-shrink-0 bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          {/* HC chip */}
          {latestHealthCheck?.vhcReference && (
            <span className="inline-block mt-1 text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
              {latestHealthCheck.vhcReference}
            </span>
          )}

          {/* Phone number subtitle when customer name shown */}
          {customer && (
            <p className="text-xs text-gray-400 mt-0.5">{formatPhoneDisplay(phoneNumber)}</p>
          )}
        </div>
      </div>
    </button>
  )
}
