/**
 * ConversationList — Left panel: searchable, filterable conversation list
 */

import { useState } from 'react'
import ConversationItem from './ConversationItem'
import type { Conversation } from './useConversations'

interface ConversationListProps {
  conversations: Conversation[]
  loading: boolean
  error: string | null
  selectedPhone: string | null
  onSelect: (phoneNumber: string) => void
  onFilterChange: (filter: 'all' | 'unread' | 'unlinked') => void
  onSearchChange: (search: string) => void
  filter: 'all' | 'unread' | 'unlinked'
  search: string
}

export default function ConversationList({
  conversations,
  loading,
  error,
  selectedPhone,
  onSelect,
  onFilterChange,
  onSearchChange,
  filter,
  search
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(search)

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearchChange(searchInput)
    }
  }

  const handleSearchBlur = () => {
    if (searchInput !== search) {
      onSearchChange(searchInput)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={handleSearchBlur}
            placeholder="Search conversations..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex px-3 py-2 gap-1 border-b border-gray-100">
        {(['all', 'unread', 'unlinked'] as const).map(f => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              filter === f
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Unlinked'}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-red-600 text-center">{error}</div>
        )}

        {!loading && !error && conversations.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-gray-400">
            <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">No conversations found</p>
          </div>
        )}

        {conversations.map(conv => (
          <ConversationItem
            key={conv.phoneNumber}
            conversation={conv}
            isActive={selectedPhone === conv.phoneNumber}
            onClick={() => onSelect(conv.phoneNumber)}
          />
        ))}
      </div>
    </div>
  )
}
