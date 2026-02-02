/**
 * Compact Findings Group Component
 * Red/Amber/Green sections with finding rows showing name, description, deferred badge, and price
 */

import type { RepairItemData, ResultData, CheckResultReasonsMap, NewRepairItem } from '../../types.js'
import { formatCurrency, formatDate } from '../../utils/formatters.js'

interface ChildItem {
  name: string
  descriptions: string[]
}

interface FindingOptionItem {
  name: string
  totalIncVat: number
  isRecommended: boolean
}

interface FindingItem {
  id: string
  name: string
  descriptions: string[]  // All descriptions/reasons - no truncation
  price: number | null
  isDeferred: boolean
  deferredUntil: string | null
  isAuthorised: boolean
  isDeclined: boolean
  outcomeDate: string | null
  declinedReason: string | null
  status: 'red' | 'amber' | 'green'
  isGroup: boolean
  children: ChildItem[]
  options: FindingOptionItem[]
}

interface FindingsGroupOptions {
  items: RepairItemData[]
  results: ResultData[]
  reasonsByCheckResult?: CheckResultReasonsMap
  newRepairItems?: NewRepairItem[]
  status: 'red' | 'amber'
  maxItems?: number
}

/**
 * Get ALL descriptions/reasons for an item - no truncation
 */
function getDescriptions(
  item: RepairItemData,
  results: ResultData[],
  reasonsByCheckResult: CheckResultReasonsMap = {}
): string[] {
  const descriptions: string[] = []

  // First check for AI-generated reasons - include ALL of them
  const reasons = reasonsByCheckResult[item.check_result_id]
  if (reasons && reasons.length > 0) {
    for (const reason of reasons) {
      const text = reason.customerDescription || reason.reasonText
      if (text) {
        descriptions.push(text)
      }
    }
  }

  // If no reasons, fall back to item description
  if (descriptions.length === 0 && item.description) {
    descriptions.push(item.description)
  }

  // Also check result notes
  const result = results.find(r => r.id === item.check_result_id)
  if (result?.notes && !descriptions.includes(result.notes)) {
    descriptions.push(result.notes)
  }

  return descriptions
}

/**
 * Get descriptions for a child item
 */
function getChildDescriptions(
  child: { name: string; description?: string | null; check_result_id?: string },
  results: ResultData[],
  reasonsByCheckResult: CheckResultReasonsMap = {}
): string[] {
  const descriptions: string[] = []

  // Check for AI-generated reasons using check_result_id
  if (child.check_result_id) {
    const reasons = reasonsByCheckResult[child.check_result_id]
    if (reasons && reasons.length > 0) {
      for (const reason of reasons) {
        const text = reason.customerDescription || reason.reasonText
        if (text) {
          descriptions.push(text)
        }
      }
    }

    // Also check result notes
    const result = results.find(r => r.id === child.check_result_id)
    if (result?.notes && !descriptions.includes(result.notes)) {
      descriptions.push(result.notes)
    }
  }

  // Fall back to child description if no reasons
  if (descriptions.length === 0 && child.description) {
    descriptions.push(child.description)
  }

  return descriptions
}

/**
 * Render child items for a group
 */
function renderChildItems(children: ChildItem[]): string {
  if (children.length === 0) return ''

  return `
    <div class="finding-children">
      ${children.map(child => `
        <div class="finding-child">
          <div class="finding-child-name">${child.name}</div>
          ${child.descriptions.length > 0
            ? child.descriptions.map(desc => `<div class="finding-description">${desc}</div>`).join('')
            : ''
          }
        </div>
      `).join('')}
    </div>
  `
}

/**
 * Render options list for a finding row
 */
function renderFindingOptions(options: FindingOptionItem[]): string {
  if (options.length === 0) return ''

  return `
    <div class="finding-options">
      ${options.map(opt => `
        <div class="finding-option${opt.isRecommended ? ' recommended' : ''}">
          <span class="finding-option-name">${opt.name}${opt.isRecommended ? ' <span class="recommended-badge">Recommended</span>' : ''}</span>
          <span class="finding-option-price">${formatCurrency(opt.totalIncVat)}</span>
        </div>
      `).join('')}
    </div>
  `
}

function renderFindingRow(item: FindingItem): string {
  const hasOptions = item.options.length > 0

  // Format price or show POA (hide single price when options are shown)
  const priceDisplay = hasOptions
    ? ''
    : (item.price !== null && item.price > 0 ? formatCurrency(item.price) : 'POA')

  // For grouped items, show group name as header and children with descriptions
  if (item.isGroup && item.children.length > 0) {
    return `
      <div class="finding-row finding-group">
        <div class="finding-info">
          <div class="finding-name">
            ${item.name}
            <span class="group-badge">${item.children.length} items</span>
          </div>
          ${renderChildItems(item.children)}
          ${renderFindingOptions(item.options)}
          ${item.isAuthorised && item.outcomeDate ? `
            <div class="finding-authorised">&#10003; Authorised on ${formatDate(item.outcomeDate)}</div>
          ` : ''}
          ${item.isDeclined && item.outcomeDate ? `
            <div class="finding-declined">&#10007; Declined on ${formatDate(item.outcomeDate)}${item.declinedReason ? ` - ${item.declinedReason}` : ''}</div>
          ` : ''}
          ${item.isDeferred && item.deferredUntil ? `
            <div class="finding-deferred">&#9201; Deferred until ${formatDate(item.deferredUntil)}</div>
          ` : ''}
        </div>
        <div class="finding-price">
          ${item.isAuthorised ? `<span class="authorised-badge">Authorised</span>` : ''}
          ${item.isDeclined ? `<span class="declined-badge">Declined</span>` : ''}
          ${item.isDeferred ? `<span class="deferred-badge">Deferred</span>` : ''}
          ${priceDisplay ? `<span class="price-value">${priceDisplay}</span>` : ''}
        </div>
      </div>
    `
  }

  // Regular item (not a group)
  const descriptionsHtml = item.descriptions.length > 0
    ? item.descriptions.map(desc => `<div class="finding-description">${desc}</div>`).join('')
    : ''

  return `
    <div class="finding-row">
      <div class="finding-info">
        <div class="finding-name">${item.name}</div>
        ${descriptionsHtml}
        ${renderFindingOptions(item.options)}
        ${item.isAuthorised && item.outcomeDate ? `
          <div class="finding-authorised">&#10003; Authorised on ${formatDate(item.outcomeDate)}</div>
        ` : ''}
        ${item.isDeclined && item.outcomeDate ? `
          <div class="finding-declined">&#10007; Declined on ${formatDate(item.outcomeDate)}${item.declinedReason ? ` - ${item.declinedReason}` : ''}</div>
        ` : ''}
        ${item.isDeferred && item.deferredUntil ? `
          <div class="finding-deferred">&#9201; Deferred until ${formatDate(item.deferredUntil)}</div>
        ` : ''}
      </div>
      <div class="finding-price">
        ${item.isAuthorised ? `<span class="authorised-badge">Authorised</span>` : ''}
        ${item.isDeclined ? `<span class="declined-badge">Declined</span>` : ''}
        ${item.isDeferred ? `<span class="deferred-badge">Deferred</span>` : ''}
        ${priceDisplay ? `<span class="price-value">${priceDisplay}</span>` : ''}
      </div>
    </div>
  `
}

/**
 * Render a findings group (red or amber)
 */
export function renderFindingsGroup(options: FindingsGroupOptions): string {
  const { items, results, reasonsByCheckResult = {}, newRepairItems = [], status, maxItems = 5 } = options

  if (items.length === 0) return ''

  // Build lookup for new repair items by ID (to get options)
  const newItemsById = new Map(newRepairItems.map(ni => [ni.id, ni]))

  // Transform items to finding items
  const findingItems: FindingItem[] = items.map(item => {
    // Process children if this is a group
    const children: ChildItem[] = (item.children || []).map(child => ({
      name: child.name,
      descriptions: getChildDescriptions(child, results, reasonsByCheckResult)
    }))

    // Look up options from new repair items
    const newItem = newItemsById.get(item.id)
    const itemOptions: FindingOptionItem[] = (newItem?.options || []).map(opt => ({
      name: opt.name,
      totalIncVat: opt.totalIncVat,
      isRecommended: opt.isRecommended
    }))

    const outcomeStatus = item.outcome_status || null

    return {
      id: item.id,
      name: item.title,
      descriptions: getDescriptions(item, results, reasonsByCheckResult),
      price: item.total_price ?? null,
      isDeferred: outcomeStatus === 'deferred' || !!item.follow_up_date,
      deferredUntil: item.follow_up_date ?? null,
      isAuthorised: outcomeStatus === 'authorised',
      isDeclined: outcomeStatus === 'declined',
      outcomeDate: item.outcome_set_at || null,
      declinedReason: item.declined_reason || null,
      status: item.rag_status as 'red' | 'amber',
      isGroup: !!item.is_group,
      children,
      options: itemOptions
    }
  })

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
