/**
 * Approval Confirmation PDF Generator
 * Generates the complete HTML for customer approval confirmation PDFs
 */

import type { ApprovalConfirmationPDFData } from '../types.js'
import { formatCurrency, formatDateTime } from '../utils/formatters.js'
import { getApprovalConfirmationStyles } from '../styles/approval-confirmation.js'
import { renderHTMLToPDF } from '../pdf.js'

/**
 * Generate HTML for customer approval confirmation PDF
 */
export function generateApprovalConfirmationHTML(data: ApprovalConfirmationPDFData): string {
  const primaryColor = data.branding?.primaryColor || '#3B82F6'
  const organizationName = data.branding?.organizationName || data.siteName || 'Vehicle Health Check'
  const logoUrl = data.branding?.logoUrl

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${getApprovalConfirmationStyles(primaryColor)}
  </style>
</head>
<body>
  <div class="header">
    <div>
      ${logoUrl ? `<img src="${logoUrl}" alt="${organizationName}" class="logo" />` : `<div style="font-size: 18px; font-weight: bold; color: ${primaryColor};">${organizationName}</div>`}
    </div>
    <div class="title-section">
      <div class="title">Approval Confirmation</div>
      <div class="subtitle">Ref: ${data.healthCheckId.slice(0, 8).toUpperCase()}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-label">Vehicle</div>
      <div class="info-value">${data.vehicleReg}</div>
      <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${data.vehicleMakeModel}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Customer</div>
      <div class="info-value">${data.customerName}</div>
      ${data.customerEmail ? `<div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${data.customerEmail}</div>` : ''}
    </div>
  </div>

  ${data.approvedItems.length > 0 ? `
  <div class="section">
    <div class="section-header approved">
      ✓ Approved Work (${data.approvedItems.length} item${data.approvedItems.length > 1 ? 's' : ''})
    </div>
    <div class="item-list">
      ${data.approvedItems.map(item => `
        <div class="item">
          <div class="item-row">
            <div>
              <div class="item-name">${item.name}</div>
              ${item.selectedOption ? `<div class="item-option">Option: ${item.selectedOption}</div>` : ''}
              ${item.description ? `<div class="item-option">${item.description}</div>` : ''}
            </div>
            <div class="item-price">${formatCurrency(item.totalIncVat)}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="total-box">
      <div class="total-row">
        <div class="total-label">Total Approved (Inc VAT)</div>
        <div class="total-value">${formatCurrency(data.totalApproved)}</div>
      </div>
    </div>
  </div>
  ` : ''}

  ${data.declinedItems.length > 0 ? `
  <div class="section">
    <div class="section-header declined">
      ✗ Declined Items (${data.declinedItems.length})
    </div>
    <div class="item-list">
      ${data.declinedItems.map(item => `
        <div class="item">
          <div class="item-name">${item.name}</div>
          ${item.reason ? `<div class="item-reason">Reason: ${item.reason}</div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <div class="confirmation-text">
    <strong>Confirmation:</strong> This document confirms that ${data.customerName} has reviewed and responded to the vehicle health check for ${data.vehicleReg} on ${formatDateTime(data.approvedAt)}.
    ${data.approvedItems.length > 0 ? `The approved work totaling ${formatCurrency(data.totalApproved)} has been authorized for completion.` : ''}
  </div>

  <div class="footer">
    ${organizationName}${data.sitePhone ? ` • ${data.sitePhone}` : ''} • Generated ${new Date().toLocaleDateString('en-GB')}
  </div>
</body>
</html>
  `
}

/**
 * Generate customer approval confirmation PDF
 */
export async function generateApprovalConfirmationPDF(data: ApprovalConfirmationPDFData): Promise<Buffer> {
  const html = generateApprovalConfirmationHTML(data)
  return renderHTMLToPDF(html)
}
