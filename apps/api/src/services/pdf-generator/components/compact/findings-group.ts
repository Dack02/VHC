/**
 * Compact Findings Group Component
 * Red/Amber/Green sections with finding rows showing name, description, deferred badge, and price
 */

import type { RepairItemData, ResultData, CheckResultReasonsMap } from '../../types.js'
import { formatCurrency, formatDate } from '../../utils/formatters.js'

interface FindingItem {
  id: string
  name: string
  description: string | null
  price: number | null
  isDeferred: boolean
  deferredUntil: string | null
  status: 'red' | 'amber' | 'green'
}

interface FindingsGroupOptions {
  items: RepairItemData[]
  results: ResultData[]
  reasonsByCheckResult?: CheckResultReasonsMap
  status: 'red' | 'amber'
  maxItems?: number
}

/**
 * Get description from reasons or repair item
 */
function getDescription(
  item: RepairItemData,
  results: ResultData[],
  reasonsByCheckResult: CheckResultReasonsMap = {}
): string | null {
  // First check for AI-generated reasons
  const reasons = reasonsByCheckResult[item.check_result_id]
  if (reasons && reasons.length > 0) {
    // Use customer description or reason text
    const reason = reasons[0]
    return reason.customerDescription || reason.reasonText || null
  }

  // Fall back to item description
  if (item.description) {
    return item.description
  }

  // Check result notes
  const result = results.find(r => r.id === item.check_result_id)
  if (result?.notes) {
    return result.notes
  }

  return null
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string | null, maxLength: number): string {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/**
 * Render a single finding row
 */
function renderFindingRow(item: FindingItem): string {
  const description = truncate(item.description, 80)

  // Format price or show POA
  const priceDisplay = item.price !== null && item.price > 0
    ? formatCurrency(item.price)
    : 'POA'

  return `
    <div class="finding-row">
      <div class="finding-info">
        <div class="finding-name">${truncate(item.name, 40)}</div>
        ${description ? `<div class="finding-description">${description}</div>` : ''}
        ${item.isDeferred && item.deferredUntil ? `
          <div class="finding-deferred">&#9201; Deferred until ${formatDate(item.deferredUntil)}</div>
        ` : ''}
      </div>
      <div class="finding-price">
        ${item.isDeferred ? `<span class="deferred-badge">Deferred</span>` : ''}
        <span class="price-value">${priceDisplay}</span>
      </div>
    </div>
  `
}

/**
 * Render a findings group (red or amber)
 */
export function renderFindingsGroup(options: FindingsGroupOptions): string {
  const { items, results, reasonsByCheckResult = {}, status, maxItems = 5 } = options

  if (items.length === 0) return ''

  // Transform items to finding items
  const findingItems: FindingItem[] = items.map(item => ({
    id: item.id,
    name: item.title,
    description: getDescription(item, results, reasonsByCheckResult),
    price: item.total_price ?? null,
    isDeferred: !!item.follow_up_date,
    deferredUntil: item.follow_up_date ?? null,
    status: item.rag_status as 'red' | 'amber'
  }))

  // Determine icon and title
  const icon = status === 'red' ? '&#9888;' : '&#9889;'
  const title = status === 'red' ? 'Immediate Attention Required' : 'Advisory Items'

  // Handle overflow - show limited items with "and X more"
  const showItems = findingItems.slice(0, maxItems)
  const remainingCount = findingItems.length - showItems.length

  return `
    <div class="findings-section">
      <div class="findings-header ${status}">
        <span class="findings-icon">${icon}</span>
        <span class="findings-title">${title}</span>
      </div>
      <div class="findings-content">
        ${showItems.map(item => renderFindingRow(item)).join('')}
        ${remainingCount > 0 ? `
          <div class="finding-row" style="justify-content: center; color: #6b7280; font-style: italic;">
            and ${remainingCount} more item${remainingCount !== 1 ? 's' : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `
}

/**
 * Render the green items summary (count only, no individual items)
 */
export function renderGreenSummary(count: number): string {
  if (count === 0) return ''

  return `
    <div class="findings-section">
      <div class="findings-header green">
        <span class="findings-icon">&#10003;</span>
        <span class="findings-title">Checked OK</span>
      </div>
      <div class="green-summary">
        <span class="green-count">${count} item${count !== 1 ? 's' : ''}</span> passed inspection with no issues identified
      </div>
    </div>
  `
}
