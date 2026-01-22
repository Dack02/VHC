/**
 * Signatures Component
 * Renders technician and customer signature sections
 */

import type { HealthCheckPDFData, CustomerSignatureData } from '../types.js'
import { formatDate, formatCurrency } from '../utils/formatters.js'

export function renderTechnicianSignature(data: HealthCheckPDFData): string {
  const { technician, summary } = data

  if (!data.technician_signature && !technician) return ''

  return `
    <div class="signature-section">
      <div class="summary-title">Technician Sign-Off</div>
      <div class="signature-box">
        <div class="signature-image">
          ${data.technician_signature ? `
            <img src="${data.technician_signature}" alt="Technician Signature" />
          ` : '<span style="color: #9ca3af">No signature</span>'}
        </div>
        <div class="signature-details">
          <div class="signature-label">Inspected by</div>
          <div class="info-value">${technician ? `${technician.first_name} ${technician.last_name}` : 'Unknown'}</div>
          <div class="signature-label" style="margin-top: 8px">Inspection Date</div>
          <div class="info-value">${formatDate(data.completed_at || data.created_at)}</div>
          <div class="signature-label" style="margin-top: 8px">Items Inspected</div>
          <div class="info-value">${summary.red_count + summary.amber_count + summary.green_count} items</div>
        </div>
      </div>
    </div>
  `
}

interface CustomerSignatureOptions {
  customerSignature: CustomerSignatureData | null
  customer: HealthCheckPDFData['customer']
  authorisedCount: number
  totalAuthorised: number
}

export function renderCustomerSignature({
  customerSignature,
  customer,
  authorisedCount,
  totalAuthorised
}: CustomerSignatureOptions): string {
  if (!customerSignature) return ''

  return `
    <div class="signature-section">
      <div class="summary-title">Customer Authorization</div>
      <div class="signature-box">
        <div class="signature-image">
          ${customerSignature.signatureData ? `
            <img src="${customerSignature.signatureData}" alt="Customer Signature" />
          ` : '<span style="color: #9ca3af">No signature</span>'}
        </div>
        <div class="signature-details">
          <div class="signature-label">Signed by</div>
          <div class="info-value">${customer.first_name} ${customer.last_name}</div>
          <div class="signature-label" style="margin-top: 8px">Date Signed</div>
          <div class="info-value">${formatDate(customerSignature.signedAt)}</div>
          <div class="signature-label" style="margin-top: 8px">Items Authorised</div>
          <div class="info-value">${authorisedCount} items - ${formatCurrency(totalAuthorised)}</div>
        </div>
      </div>
    </div>
  `
}
