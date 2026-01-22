/**
 * Summary Component
 * Renders the pricing summary table
 */

import type { HealthCheckPDFData, RepairItemData } from '../types.js'
import { formatCurrency } from '../utils/formatters.js'

interface PricingSummaryOptions {
  summary: HealthCheckPDFData['summary']
  redItems: RepairItemData[]
  amberItems: RepairItemData[]
  authorisedItems: RepairItemData[]
  declinedItems: RepairItemData[]
}

export function renderPricingSummary({
  summary,
  redItems,
  amberItems,
  authorisedItems,
  declinedItems
}: PricingSummaryOptions): string {
  return `
    <div class="summary-section">
      <div class="summary-title">Pricing Summary</div>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Items</th>
            <th style="text-align: right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Immediate Attention (Red)</td>
            <td>${summary.red_count}</td>
            <td class="amount">${formatCurrency(redItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
          </tr>
          <tr>
            <td>Advisory (Amber)</td>
            <td>${summary.amber_count}</td>
            <td class="amount">${formatCurrency(amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
          </tr>
          <tr>
            <td>Checked OK (Green)</td>
            <td>${summary.green_count}</td>
            <td class="amount">-</td>
          </tr>
          <tr class="total-row">
            <td>Total Identified</td>
            <td>${summary.red_count + summary.amber_count}</td>
            <td class="amount">${formatCurrency(summary.total_identified)}</td>
          </tr>
          ${authorisedItems.length > 0 ? `
            <tr style="background: #eff6ff">
              <td>Customer Authorised</td>
              <td>${authorisedItems.length}</td>
              <td class="amount">${formatCurrency(summary.total_authorised)}</td>
            </tr>
            <tr>
              <td>Work Completed</td>
              <td>${authorisedItems.filter(i => i.work_completed_at).length}</td>
              <td class="amount">${formatCurrency(summary.work_completed_value)}</td>
            </tr>
          ` : ''}
          ${declinedItems.length > 0 ? `
            <tr>
              <td>Customer Declined</td>
              <td>${declinedItems.length}</td>
              <td class="amount">${formatCurrency(declinedItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
            </tr>
          ` : ''}
        </tbody>
      </table>
    </div>
  `
}

/**
 * Render authorised work section
 */
export function renderAuthorisedWork(authorisedItems: RepairItemData[]): string {
  if (authorisedItems.length === 0) return ''

  return `
    <div class="section">
      <div class="section-header blue">
        <span class="section-title">Authorised Work</span>
        <span class="section-stats">${authorisedItems.length} item${authorisedItems.length !== 1 ? 's' : ''} - ${formatCurrency(authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</span>
      </div>
      <div class="section-content">
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style="width: 80px">Status</th>
              <th style="text-align: right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${authorisedItems.map(item => `
              <tr class="item-row">
                <td class="item-cell">
                  <div class="item-name">${item.title}</div>
                </td>
                <td style="text-align: center">
                  ${item.work_completed_at
                    ? '<span style="color: #16a34a">✓ Complete</span>'
                    : '<span style="color: #d97706">Pending</span>'}
                </td>
                <td class="price-cell">${formatCurrency(item.total_price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `
}

/**
 * Render declined work section
 */
export function renderDeclinedWork(declinedItems: RepairItemData[]): string {
  if (declinedItems.length === 0) return ''

  return `
    <div class="section">
      <div class="section-header grey">
        <span class="section-title">Declined Items</span>
        <span class="section-stats">${declinedItems.length} item${declinedItems.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="section-content">
        <div class="green-list">
          ${declinedItems.map(item => `
            <div class="green-item">
              <span style="color: #dc2626">✗</span>
              <span>${item.title}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `
}
