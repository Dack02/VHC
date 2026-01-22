/**
 * Health Check PDF Generator
 * Generates the complete HTML for health check PDFs
 */

import type { HealthCheckPDFData, CustomerSignatureData } from '../types.js'
import { formatCurrency } from '../utils/formatters.js'
import { getBaseStyles } from '../styles/base.js'
import { getHealthCheckStyles } from '../styles/health-check.js'
import { renderHeader } from '../components/header.js'
import { renderInfoSection } from '../components/info-section.js'
import { renderDashboard } from '../components/dashboard.js'
import { renderItemRow, renderPhotoGrid, type TyreDetailsValue } from '../components/item-rows.js'
import { renderNewRepairItemCard, renderQuoteSummary } from '../components/repair-items.js'
import { renderGreenItems } from '../components/green-items.js'
import { renderTechnicianSignature, renderCustomerSignature } from '../components/signatures.js'
import { renderPricingSummary, renderAuthorisedWork, renderDeclinedWork } from '../components/summary.js'
import { renderVehicleSummary, getVehicleSummaryStyles } from '../components/vehicle-summary.js'
import { renderHTMLToPDF } from '../pdf.js'

/**
 * Generate HTML template for health check PDF
 */
export function generateHealthCheckHTML(data: HealthCheckPDFData): string {
  const {
    branding,
    site,
    results,
    repairItems,
    authorizations,
    summary,
    reasonsByCheckResult = {},
    newRepairItems = [],
    hasNewRepairItems = false,
    vatRate = 20,
    showDetailedBreakdown = false,
    customer
  } = data

  // Get branding colors with fallbacks
  const primaryColor = branding?.primaryColor || '#1a3a5c'
  const organizationName = branding?.organizationName || site?.name || 'Vehicle Health Check'
  const logoUrl = branding?.logoUrl

  // Create lookup maps
  const resultById = new Map(results.map(r => [r.id, r]))
  const authByItemId = new Map(authorizations.map(a => [a.repair_item_id, a]))

  // Extract tyre_details value for merging specs with depth measurements
  const tyreDetailsResult = results.find(r => r.template_item?.item_type === 'tyre_details' && r.value)
  const tyreDetailsValue = tyreDetailsResult?.value as TyreDetailsValue | undefined

  // Group repair items by RAG status
  const redItems = repairItems.filter(i => i.rag_status === 'red')
  const amberItems = repairItems.filter(i => i.rag_status === 'amber')

  // Count green items from results
  const greenResults = results.filter(r => r.rag_status === 'green')
  const greenCount = greenResults.length

  // Count MOT failures
  const motFailureCount = repairItems.filter(i => i.is_mot_failure).length

  // Calculate total quote from repair items
  const totalQuote = redItems.reduce((sum, i) => sum + (i.total_price || 0), 0)
    + amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0)

  // Get authorised and declined items
  const authorisedItems = repairItems.filter(i => authByItemId.get(i.id)?.decision === 'approved')
  const declinedItems = repairItems.filter(i => authByItemId.get(i.id)?.decision === 'declined')

  // Get signature if exists - check NEW system first (newRepairItems), then fall back to OLD system (authorizations)
  const newSystemSignature = newRepairItems.find(item => item.customerSignatureData && item.customerApproved === true)
  const oldSystemSignature = authorizations.find(a => a.signature_data)

  // Unified signature data for rendering
  const customerSignature: CustomerSignatureData | null = newSystemSignature
    ? {
        signatureData: newSystemSignature.customerSignatureData,
        signedAt: newSystemSignature.customerApprovedAt
      }
    : oldSystemSignature
    ? {
        signatureData: oldSystemSignature.signature_data,
        signedAt: oldSystemSignature.signed_at
      }
    : null

  // Build the HTML
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${getBaseStyles()}
    ${getHealthCheckStyles(primaryColor)}
    ${getVehicleSummaryStyles()}
  </style>
</head>
<body>
  ${renderHeader({ data, logoUrl, organizationName })}

  ${renderInfoSection(data)}

  ${renderDashboard({
    data,
    redCount: redItems.length,
    amberCount: amberItems.length,
    greenCount,
    motFailureCount,
    totalQuote,
    primaryColor
  })}

  ${renderVehicleSummary(results)}

  <!-- Immediate Attention (Red Items) -->
  ${redItems.length > 0 ? `
    <div class="section">
      <div class="section-header red">
        <span class="section-title">Immediate Attention Required</span>
        <span class="section-stats">${redItems.length} item${redItems.length !== 1 ? 's' : ''} - ${formatCurrency(redItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</span>
      </div>
      <div class="section-content">
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>MOT</th>
              <th style="text-align: right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${redItems.map(item => renderItemRow({ item, resultById, reasonsByCheckResult, tyreDetailsValue })).join('')}
          </tbody>
        </table>
        ${renderPhotoGrid(redItems, resultById)}
      </div>
    </div>
  ` : ''}

  <!-- Advisory (Amber Items) -->
  ${amberItems.length > 0 ? `
    <div class="section">
      <div class="section-header amber">
        <span class="section-title">Advisory Items</span>
        <span class="section-stats">${amberItems.length} item${amberItems.length !== 1 ? 's' : ''} - ${formatCurrency(amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</span>
      </div>
      <div class="section-content">
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>MOT</th>
              <th style="text-align: right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${amberItems.map(item => renderItemRow({ item, resultById, reasonsByCheckResult, tyreDetailsValue })).join('')}
          </tbody>
        </table>
        ${renderPhotoGrid(amberItems, resultById)}
      </div>
    </div>
  ` : ''}

  <!-- Recommended Work (New Repair Items - Phase 6+) -->
  ${hasNewRepairItems && newRepairItems.length > 0 ? `
    <div class="section">
      <div class="section-header purple">
        <span class="section-title">Recommended Work</span>
        <span class="section-stats">${newRepairItems.length} item${newRepairItems.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="section-content">
        ${newRepairItems.map(item => renderNewRepairItemCard({ item, showDetailedBreakdown })).join('')}
        ${renderQuoteSummary(newRepairItems, vatRate)}
      </div>
    </div>
  ` : ''}

  ${renderGreenItems(results, reasonsByCheckResult)}

  ${renderAuthorisedWork(authorisedItems)}

  ${renderDeclinedWork(declinedItems)}

  ${renderPricingSummary({ summary, redItems, amberItems, authorisedItems, declinedItems })}

  ${renderTechnicianSignature(data)}

  ${renderCustomerSignature({
    customerSignature,
    customer,
    authorisedCount: hasNewRepairItems ? newRepairItems.filter(i => i.customerApproved === true).length : authorisedItems.length,
    totalAuthorised: summary.total_authorised
  })}

  <!-- Footer -->
  <div class="footer">
    <div>${organizationName}</div>
    <div style="margin-top: 4px;">Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
  </div>
</body>
</html>
  `
}

/**
 * Generate PDF from health check data
 */
export async function generateHealthCheckPDF(data: HealthCheckPDFData): Promise<Buffer> {
  const html = generateHealthCheckHTML(data)
  return renderHTMLToPDF(html)
}
