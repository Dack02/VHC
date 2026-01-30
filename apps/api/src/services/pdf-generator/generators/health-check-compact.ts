/**
 * Health Check Compact PDF Generator
 * Generates a single-page A4 compact report with optional page 2 for photos
 */

import type { HealthCheckPDFData } from '../types.js'
import { getCompactStyles } from '../styles/health-check-compact.js'
import {
  renderCompactHeader,
  renderInfoBar,
  renderRagSummary,
  renderTyreGrid,
  renderBrakeTable,
  renderFindingsGroup,
  renderGreenSummary,
  renderCompactFooter,
  renderPhotoPage,
  hasPhotos,
  countPhotoPages
} from '../components/compact/index.js'
import { renderHTMLToPDF } from '../pdf.js'

/**
 * Generate HTML template for compact health check PDF
 */
export function generateCompactHealthCheckHTML(data: HealthCheckPDFData): string {
  const {
    branding,
    site,
    results,
    repairItems,
    newRepairItems = [],
    reasonsByCheckResult = {},
    vehicle
  } = data

  // Get branding
  const organizationName = branding?.organizationName || site?.name || 'Workshop'
  const logoUrl = branding?.logoUrl

  // Group repair items by RAG status
  const redItems = repairItems.filter(i => i.rag_status === 'red')
  const amberItems = repairItems.filter(i => i.rag_status === 'amber')

  // Count green items from results
  const greenResults = results.filter(r => r.rag_status === 'green')
  const greenCount = greenResults.length

  // Calculate totals
  const redTotal = redItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const amberTotal = amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
  const totalQuote = redTotal + amberTotal

  // Total items checked
  const totalItems = results.length

  // Check if photos exist and calculate total pages
  const hasPhotoEvidence = hasPhotos(repairItems, results)
  const numPhotoPages = countPhotoPages(repairItems, results)
  const totalPages = 1 + numPhotoPages // 1 for main report + photo pages

  // Generate reference
  const reference = data.vhc_reference || `VHC${data.id.slice(0, 8).toUpperCase()}`

  // Build the HTML
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${getCompactStyles()}
  </style>
</head>
<body>
  <!-- PAGE 1: Main Report -->
  <div class="page-1">
    ${renderCompactHeader({ data, logoUrl, organizationName })}

    ${renderInfoBar(data)}

    ${renderRagSummary({
      redCount: redItems.length,
      amberCount: amberItems.length,
      greenCount,
      redTotal,
      amberTotal,
      totalQuote
    })}

    <!-- Measurements Row -->
    <div class="measurements-row">
      ${renderTyreGrid(results)}
      ${renderBrakeTable(results)}
    </div>

    <!-- Findings Sections -->
    ${renderFindingsGroup({
      items: redItems,
      results,
      reasonsByCheckResult,
      newRepairItems,
      status: 'red',
      maxItems: 5
    })}

    ${renderFindingsGroup({
      items: amberItems,
      results,
      reasonsByCheckResult,
      newRepairItems,
      status: 'amber',
      maxItems: 5
    })}

    ${renderGreenSummary(greenCount)}

    ${renderCompactFooter({
      data,
      totalItems,
      currentPage: 1,
      totalPages
    })}
  </div>

  <!-- PAGE 2: Photo Evidence (conditional) -->
  ${hasPhotoEvidence ? renderPhotoPage({
    repairItems,
    results,
    reference,
    registration: vehicle.registration,
    siteName: site?.name
  }) : ''}
</body>
</html>
  `
}

/**
 * Generate PDF from health check data using compact layout
 */
export async function generateCompactHealthCheckPDF(data: HealthCheckPDFData): Promise<Buffer> {
  const html = generateCompactHealthCheckHTML(data)
  return renderHTMLToPDF(html)
}
