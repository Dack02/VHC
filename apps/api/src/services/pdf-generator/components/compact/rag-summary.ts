/**
 * Compact RAG Summary Component
 * Four blocks showing red/amber/green counts with pricing, plus total quote
 */

import { formatCurrency } from '../../utils/formatters.js'

interface RagSummaryOptions {
  redCount: number
  amberCount: number
  greenCount: number
  redTotal: number
  amberTotal: number
  totalQuote: number
}

export function renderRagSummary(options: RagSummaryOptions): string {
  const { redCount, amberCount, greenCount, redTotal, amberTotal, totalQuote } = options

  return `
    <div class="rag-summary">
      <!-- Red Block -->
      <div class="rag-block red">
        <div class="rag-count">${redCount}</div>
        <div class="rag-info">
          <div class="rag-label">Immediate<br/>Attention</div>
        </div>
        <div class="rag-price">${redTotal > 0 ? formatCurrency(redTotal) : '—'}</div>
      </div>

      <!-- Amber Block -->
      <div class="rag-block amber">
        <div class="rag-count">${amberCount}</div>
        <div class="rag-info">
          <div class="rag-label">Advisory<br/>Items</div>
        </div>
        <div class="rag-price">${amberTotal > 0 ? formatCurrency(amberTotal) : '—'}</div>
      </div>

      <!-- Green Block -->
      <div class="rag-block green">
        <div class="rag-count">${greenCount}</div>
        <div class="rag-info">
          <div class="rag-label">Checked<br/>OK</div>
        </div>
        <div class="rag-price">—</div>
      </div>

      <!-- Total Block -->
      <div class="rag-block total">
        <div class="total-label">Total Quote</div>
        <div class="total-value">${formatCurrency(totalQuote)}</div>
      </div>
    </div>
  `
}
