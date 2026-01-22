/**
 * Compact Footer Component
 * Signature line with technician info, workshop contact, and page number
 */

import type { HealthCheckPDFData } from '../../types.js'
import { formatDate } from '../../utils/formatters.js'

interface FooterOptions {
  data: HealthCheckPDFData
  totalItems: number
  currentPage: number
  totalPages: number
}

export function renderCompactFooter(options: FooterOptions): string {
  const { data, totalItems, currentPage, totalPages } = options
  const { technician, technician_signature, site } = data

  // Format technician name
  const technicianName = technician
    ? `${technician.first_name} ${technician.last_name}`.trim()
    : 'Technician'

  // Format inspection date
  const inspectionDate = formatDate(data.completed_at || data.closed_at || data.created_at)

  // Workshop contact info
  const workshopName = site?.name || ''
  const workshopPhone = site?.phone || ''
  const workshopEmail = site?.email || ''

  return `
    <div class="compact-footer">
      <!-- Signature Section -->
      <div class="footer-signature">
        <div class="signature-image">
          ${technician_signature
            ? `<img src="${technician_signature}" alt="Signature" />`
            : '<span style="color: #9ca3af; font-style: italic;">(unsigned)</span>'
          }
        </div>
        <div class="signature-info">
          <strong>${technicianName}</strong><br/>
          ${inspectionDate} &bull; ${totalItems} items checked
        </div>
      </div>

      <!-- Workshop Contact -->
      <div class="footer-contact">
        ${workshopName ? `<div style="font-weight: 500;">${workshopName}</div>` : ''}
        ${workshopPhone || workshopEmail ? `
          <div>${[workshopPhone, workshopEmail].filter(Boolean).join(' &bull; ')}</div>
        ` : ''}
      </div>

      <!-- Page Number -->
      <div class="footer-page">
        Page ${currentPage} of ${totalPages}
      </div>
    </div>
  `
}
