/**
 * SectionHeader Component
 * RAG-colored section header with item count, total price, and expand/collapse toggle
 */

import { useState } from 'react'

type RAGStatus = 'red' | 'amber' | 'green' | 'blue' | 'grey'

interface SectionHeaderProps {
  title: string
  ragStatus: RAGStatus
  itemCount: number
  totalPrice?: number
  defaultExpanded?: boolean
  collapsible?: boolean
  children: React.ReactNode
}

const ragColors: Record<RAGStatus, { bg: string; border: string; text: string; headerBg: string }> = {
  red: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    headerBg: 'bg-red-100'
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    headerBg: 'bg-amber-100'
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    headerBg: 'bg-green-100'
  },
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    headerBg: 'bg-blue-100'
  },
  grey: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-700',
    headerBg: 'bg-gray-100'
  }
}

const ragLabels: Record<RAGStatus, string> = {
  red: 'Immediate Attention',
  amber: 'Advisory',
  green: 'Items OK',
  blue: 'Authorised Work',
  grey: 'Declined'
}

export function SectionHeader({
  title,
  ragStatus,
  itemCount,
  totalPrice,
  defaultExpanded = true,
  collapsible = false,
  children
}: SectionHeaderProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const colors = ragColors[ragStatus]

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`

  return (
    <div className={`border ${colors.border} rounded-lg overflow-hidden mb-4`}>
      {/* Header */}
      <div
        className={`${colors.headerBg} px-4 py-3 flex items-center justify-between ${
          collapsible ? 'cursor-pointer hover:opacity-90' : ''
        }`}
        onClick={collapsible ? () => setExpanded(!expanded) : undefined}
      >
        <div className="flex items-center gap-3">
          {/* RAG indicator dot */}
          <div className={`w-3 h-3 rounded-full ${
            ragStatus === 'red' ? 'bg-red-500' :
            ragStatus === 'amber' ? 'bg-amber-500' :
            ragStatus === 'green' ? 'bg-green-500' :
            ragStatus === 'blue' ? 'bg-blue-500' :
            'bg-gray-400'
          }`} />

          {/* Title and count */}
          <div>
            <span className={`font-semibold ${colors.text}`}>
              {title || ragLabels[ragStatus]}
            </span>
            <span className={`ml-2 text-sm ${colors.text} opacity-75`}>
              ({itemCount} {itemCount === 1 ? 'item' : 'items'})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Total price */}
          {totalPrice !== undefined && totalPrice > 0 && (
            <span className={`font-semibold ${colors.text}`}>
              {formatCurrency(totalPrice)}
            </span>
          )}

          {/* Expand/collapse toggle */}
          {collapsible && (
            <svg
              className={`w-5 h-5 ${colors.text} transition-transform ${
                expanded ? 'transform rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Content */}
      {(!collapsible || expanded) && (
        <div className={colors.bg}>
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * SectionSubheader - For grouping items within a section (e.g., by template section)
 */
interface SectionSubheaderProps {
  title: string
  itemCount?: number
}

export function SectionSubheader({ title, itemCount }: SectionSubheaderProps) {
  return (
    <div className="px-4 py-2 bg-white border-b border-gray-200">
      <span className="text-sm font-medium text-gray-600">
        {title}
        {itemCount !== undefined && (
          <span className="ml-2 text-gray-400">({itemCount})</span>
        )}
      </span>
    </div>
  )
}
