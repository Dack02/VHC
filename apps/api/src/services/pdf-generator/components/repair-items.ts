/**
 * Repair Items Component
 * Renders new repair item cards and groups (Phase 6+)
 */

import type { NewRepairItem } from '../types.js'
import { formatCurrency } from '../utils/formatters.js'

interface RepairItemCardOptions {
  item: NewRepairItem
  showDetailedBreakdown: boolean
  isChild?: boolean
}

/**
 * Get approval status badge HTML
 */
function getApprovalBadge(customerApproved: boolean | null): string {
  if (customerApproved === true) {
    return '<span class="approval-status approved">✓ Approved</span>'
  } else if (customerApproved === false) {
    return '<span class="approval-status declined">✗ Declined</span>'
  }
  return '<span class="approval-status pending">Pending</span>'
}

/**
 * Render options HTML for a repair item
 */
function renderOptions(item: NewRepairItem): string {
  if (item.options.length === 0) return ''

  return `
    <div class="repair-options">
      ${item.options.map(opt => {
        const isSelected = opt.id === item.selectedOptionId
        const classes = ['repair-option']
        if (isSelected) classes.push('selected')
        if (opt.isRecommended) classes.push('recommended')
        return `
          <div class="${classes.join(' ')}">
            <div>
              <span class="repair-option-name">${opt.name}</span>
              ${opt.isRecommended ? '<span class="recommended-badge">Recommended</span>' : ''}
              ${isSelected ? '<span class="selected-badge">Selected</span>' : ''}
              ${opt.description ? `<div style="font-size: 9px; color: #6b7280; margin-top: 2px;">${opt.description}</div>` : ''}
            </div>
            <div class="repair-option-price">
              <div>${formatCurrency(opt.totalIncVat)}</div>
              <div style="font-size: 9px; color: #6b7280;">Inc VAT</div>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `
}

/**
 * Render labour/parts breakdown HTML
 */
function renderBreakdown(item: NewRepairItem, showDetailedBreakdown: boolean): string {
  if (!showDetailedBreakdown || (!item.labourEntries?.length && !item.partsEntries?.length)) {
    return ''
  }

  return `
    <div class="labour-parts-breakdown">
      ${item.labourEntries && item.labourEntries.length > 0 ? `
        <div style="margin-bottom: 8px;">
          <strong>Labour</strong>
          <table class="breakdown-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th class="right">Hours</th>
                <th class="right">Rate</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${item.labourEntries.map(l => `
                <tr>
                  <td>${l.code}</td>
                  <td>${l.description}${l.isVatExempt ? ' *' : ''}</td>
                  <td class="right">${l.hours.toFixed(2)}</td>
                  <td class="right">${formatCurrency(l.rate)}</td>
                  <td class="right">${formatCurrency(l.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      ${item.partsEntries && item.partsEntries.length > 0 ? `
        <div>
          <strong>Parts</strong>
          <table class="breakdown-table">
            <thead>
              <tr>
                <th>Part No.</th>
                <th>Description</th>
                <th class="right">Qty</th>
                <th class="right">Price</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${item.partsEntries.map(p => `
                <tr>
                  <td>${p.partNumber || '-'}</td>
                  <td>${p.description}</td>
                  <td class="right">${p.quantity}</td>
                  <td class="right">${formatCurrency(p.sellPrice)}</td>
                  <td class="right">${formatCurrency(p.lineTotal)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `
}

/**
 * Render a new repair item card
 */
export function renderNewRepairItemCard({ item, showDetailedBreakdown, isChild = false }: RepairItemCardOptions): string {
  const hasOptions = item.options.length > 0
  const selectedOption = hasOptions && item.selectedOptionId
    ? item.options.find(o => o.id === item.selectedOptionId)
    : null

  // Get price info based on whether there's a selected option
  const priceInfo = selectedOption || {
    subtotal: item.subtotal,
    vatAmount: item.vatAmount,
    totalIncVat: item.totalIncVat
  }

  // If this is a group with children, render group container
  if (item.isGroup && item.children && item.children.length > 0) {
    return `
      <div class="repair-group-container">
        <div class="repair-group-header">
          <div class="repair-group-header-content">
            <div class="repair-group-name">${item.name}</div>
            ${item.description ? `<div class="repair-group-description">${item.description}</div>` : ''}
          </div>
          <div class="repair-group-totals">
            ${getApprovalBadge(item.customerApproved)}
            <div class="repair-item-price">${formatCurrency(priceInfo.totalIncVat)}</div>
            <div class="repair-item-price-note">Group Total Inc VAT</div>
          </div>
        </div>
        <div class="repair-group-children">
          ${item.children.map(child => renderNewRepairItemCard({ item: child, showDetailedBreakdown, isChild: true })).join('')}
        </div>
      </div>
    `
  }

  // Regular item (or child item)
  const cardClass = isChild ? 'repair-item-card child-item' : 'repair-item-card'
  const optionsHtml = renderOptions(item)
  const breakdownHtml = renderBreakdown(item, showDetailedBreakdown)

  return `
    <div class="${cardClass}">
      <div class="repair-item-header">
        <div>
          <div class="repair-item-name">${item.name}</div>
          ${item.linkedCheckResults.length > 0 ? `
            <div class="linked-items">
              <strong>Related items:</strong> ${item.linkedCheckResults.join(', ')}
            </div>
          ` : ''}
        </div>
        <div style="text-align: right;">
          ${!isChild ? getApprovalBadge(item.customerApproved) : ''}
          <div class="repair-item-price">${formatCurrency(priceInfo.totalIncVat)}</div>
          <div class="repair-item-price-note">Inc VAT</div>
        </div>
      </div>
      ${item.description ? `<div class="repair-item-description">${item.description}</div>` : ''}
      ${optionsHtml}
      ${!hasOptions ? `
        <div style="font-size: 10px; color: #6b7280; margin-top: 4px;">
          Labour: ${formatCurrency(item.labourTotal)} • Parts: ${formatCurrency(item.partsTotal)}
        </div>
      ` : ''}
      ${breakdownHtml}
    </div>
  `
}

/**
 * Render quote summary for new repair items
 */
export function renderQuoteSummary(
  newRepairItems: NewRepairItem[],
  vatRate: number
): string {
  if (newRepairItems.length === 0) return ''

  // Calculate totals based on selected options
  let totalSubtotal = 0
  let totalVat = 0
  let totalIncVat = 0
  let hasVatExempt = false

  newRepairItems.forEach(item => {
    // Only count approved items (or all if none have been actioned)
    if (item.customerApproved === true || item.customerApproved === null) {
      if (item.options.length > 0 && item.selectedOptionId) {
        const opt = item.options.find(o => o.id === item.selectedOptionId)
        if (opt) {
          totalSubtotal += opt.subtotal
          totalVat += opt.vatAmount
          totalIncVat += opt.totalIncVat
        }
      } else if (item.options.length > 0) {
        // Use recommended option or first if not selected
        const opt = item.options.find(o => o.isRecommended) || item.options[0]
        totalSubtotal += opt.subtotal
        totalVat += opt.vatAmount
        totalIncVat += opt.totalIncVat
      } else {
        totalSubtotal += item.subtotal
        totalVat += item.vatAmount
        totalIncVat += item.totalIncVat
      }
    }

    // Check for VAT exempt labour
    if (item.labourEntries?.some(l => l.isVatExempt)) {
      hasVatExempt = true
    }
  })

  return `
    <div class="quote-summary-box">
      <div class="quote-summary-title">Quote Summary</div>
      <div class="quote-row">
        <span class="quote-label">Subtotal (Ex VAT)</span>
        <span class="quote-value">${formatCurrency(totalSubtotal)}</span>
      </div>
      <div class="quote-row">
        <span class="quote-label">VAT @ ${vatRate}%</span>
        <span class="quote-value">${formatCurrency(totalVat)}</span>
      </div>
      <div class="quote-row total">
        <span class="quote-label">Total Inc VAT</span>
        <span class="quote-value">${formatCurrency(totalIncVat)}</span>
      </div>
      ${hasVatExempt ? '<div class="vat-exempt-note">* MOT labour is VAT exempt</div>' : ''}
    </div>
  `
}
