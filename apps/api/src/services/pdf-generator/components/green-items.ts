/**
 * Green Items Component
 * Renders the list of items that passed inspection
 */

import type { ResultData, CheckResultReasonsMap } from '../types.js'

export function renderGreenItems(
  results: ResultData[],
  reasonsByCheckResult: CheckResultReasonsMap
): string {
  const greenResults = results.filter(r => r.rag_status === 'green')

  if (greenResults.length === 0) return ''

  return `
    <div class="section">
      <div class="section-header green">
        <span class="section-title">Items Checked OK</span>
        <span class="section-stats">${greenResults.length} items</span>
      </div>
      <div class="section-content">
        <div class="green-list">
          ${greenResults.map(r => {
            const reasons = reasonsByCheckResult[r.id] || []
            const positiveReason = reasons.find(reason => reason.customerDescription || reason.reasonText)
            return `
              <div class="green-item">
                <span class="green-check">✓</span>
                <span>${r.template_item?.name || 'Item'}</span>
                ${positiveReason ? `<span class="green-reason">- ${positiveReason.customerDescription || positiveReason.reasonText}</span>` : ''}
              </div>
            `
          }).join('')}
        </div>
      </div>
    </div>
  `
}
