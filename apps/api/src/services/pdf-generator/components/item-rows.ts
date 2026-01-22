/**
 * Item Rows Component
 * Renders red/amber item table rows with measurements and reasons
 */

import type { RepairItemData, ResultData, CheckResultReasonsMap } from '../types.js'
import { formatCurrency, formatFollowUp } from '../utils/formatters.js'
import { getTyreDetails, getBrakeDetails, type TyreSpecData } from '../utils/measurements.js'

// Map tyre position names to tyre_details keys
type TyreDetailsKey = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'

function parseTyreDetailsKey(itemName: string): TyreDetailsKey | null {
  const lower = itemName.toLowerCase()
  if (lower.includes('front') && (lower.includes('left') || lower.includes('n/s'))) return 'front_left'
  if (lower.includes('front') && (lower.includes('right') || lower.includes('o/s'))) return 'front_right'
  if (lower.includes('rear') && (lower.includes('left') || lower.includes('n/s'))) return 'rear_left'
  if (lower.includes('rear') && (lower.includes('right') || lower.includes('o/s'))) return 'rear_right'
  return null
}

// Tyre details value type (all 4 tyres)
export type TyreDetailsValue = Record<TyreDetailsKey, TyreSpecData>

interface ItemRowOptions {
  item: RepairItemData
  resultById: Map<string, ResultData>
  reasonsByCheckResult: CheckResultReasonsMap
  showPrice?: boolean
  tyreDetailsValue?: TyreDetailsValue | null
}

/**
 * Generate reasons HTML for an item
 */
function getReasonsHTML(
  checkResultId: string,
  ragStatus: string,
  reasonsByCheckResult: CheckResultReasonsMap
): string {
  const reasons = reasonsByCheckResult[checkResultId]
  if (!reasons || reasons.length === 0) return ''

  const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)
  const followUpText = followUpInfo ? formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText) : ''
  const bulletColor = ragStatus === 'red' ? '#dc2626' : '#d97706'

  return `
    <div class="reasons-section">
      ${reasons.length > 1 ? `
        <div class="reasons-intro">We identified the following ${ragStatus === 'red' ? 'issues' : 'items to monitor'}:</div>
        <ul class="reasons-list">
          ${reasons.map(r => `
            <li style="color: ${bulletColor}">
              <span style="color: #374151">${r.customerDescription || r.reasonText}</span>
            </li>
          `).join('')}
        </ul>
      ` : `
        <div class="single-reason">${reasons[0].customerDescription || reasons[0].reasonText}</div>
      `}
      ${followUpText ? `
        <div class="follow-up-note" style="color: ${bulletColor}">${followUpText}</div>
      ` : ''}
    </div>
  `
}

/**
 * Render grouped items (children) HTML
 */
function getGroupedItemsHTML(children: Array<{ name: string; rag_status: string }>): string {
  if (!children || children.length === 0) return ''

  return `
    <div class="grouped-items-section">
      <div class="grouped-items-header">GROUPED ITEMS</div>
      <div class="grouped-items-list">
        ${children.map(child => {
          const dotColor = child.rag_status === 'red' ? '#dc2626' : '#d97706'
          return `
            <div class="grouped-item">
              <span class="grouped-item-dot" style="background-color: ${dotColor}"></span>
              <span class="grouped-item-name">${child.name}</span>
            </div>
          `
        }).join('')}
      </div>
    </div>
  `
}

/**
 * Render a single repair item row
 */
export function renderItemRow({ item, resultById, reasonsByCheckResult, showPrice = true, tyreDetailsValue }: ItemRowOptions): string {
  const result = resultById.get(item.check_result_id)
  const inputType = result?.template_item?.item_type || ''

  let details = ''
  if (inputType === 'tyre_depth') {
    // Get tyre specs for this position from tyre_details
    const itemName = result?.template_item?.name || item.title
    const detailsKey = parseTyreDetailsKey(itemName)
    const specs = detailsKey && tyreDetailsValue ? tyreDetailsValue[detailsKey] : null

    details = getTyreDetails(
      result?.value as Record<string, unknown>,
      {
        itemName,
        ragStatus: item.rag_status as 'green' | 'amber' | 'red'
      },
      specs
    )
  } else if (inputType === 'brake_measurement') {
    details = getBrakeDetails(result?.value as Record<string, unknown>, {
      itemName: result?.template_item?.name || item.title,
      ragStatus: item.rag_status as 'green' | 'amber' | 'red'
    })
  }

  // Get reasons for this item
  const reasonsHTML = getReasonsHTML(item.check_result_id, item.rag_status, reasonsByCheckResult)
  // Only show description if no reasons are available
  const showDescription = !reasonsHTML && item.description

  // Check if this is a group with children
  const isGroup = item.is_group && item.children && item.children.length > 0
  const groupBadge = isGroup ? `<span class="group-badge">GROUP (${item.children!.length})</span>` : ''
  const groupedItemsHTML = isGroup ? getGroupedItemsHTML(item.children!) : ''

  return `
    <tr class="item-row${isGroup ? ' group-row' : ''}">
      <td class="item-cell">
        <div class="item-name">${item.title}${groupBadge}</div>
        ${showDescription ? `<div class="item-description">${item.description}</div>` : ''}
        ${groupedItemsHTML}
        ${reasonsHTML}
        ${details}
        ${result?.notes ? `<div class="tech-notes">Notes: ${result.notes}</div>` : ''}
      </td>
      ${item.is_mot_failure ? '<td class="mot-cell"><span class="mot-badge">MOT</span></td>' : '<td class="mot-cell"></td>'}
      ${showPrice ? `<td class="price-cell">${formatCurrency(item.total_price)}</td>` : ''}
    </tr>
  `
}

/**
 * Render photo grid for repair items
 */
export function renderPhotoGrid(
  items: RepairItemData[],
  resultById: Map<string, ResultData>
): string {
  const photos: { url: string; title: string; rag: string }[] = []

  items.forEach(item => {
    const result = resultById.get(item.check_result_id)
    if (result?.media) {
      result.media.forEach(m => {
        photos.push({
          url: m.url,
          title: item.title,
          rag: item.rag_status
        })
      })
    }
  })

  if (photos.length === 0) return ''

  return `
    <div class="photo-grid">
      ${photos.slice(0, 8).map(p => `
        <div class="photo-item">
          <img src="${p.url}" alt="${p.title}" />
          <div class="photo-caption ${p.rag}">${p.title}</div>
        </div>
      `).join('')}
      ${photos.length > 8 ? `<div class="more-photos">+${photos.length - 8} more photos</div>` : ''}
    </div>
  `
}
