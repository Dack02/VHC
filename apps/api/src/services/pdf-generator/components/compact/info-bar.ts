/**
 * Compact Info Bar Component
 * Single grey background row with vehicle, customer, and inspection info
 */

import type { HealthCheckPDFData } from '../../types.js'
import { formatDate } from '../../utils/formatters.js'

export function renderInfoBar(data: HealthCheckPDFData): string {
  const { vehicle, customer, technician } = data

  // Format vehicle info
  const vehicleInfo = [vehicle.make, vehicle.model, vehicle.year]
    .filter(Boolean)
    .join(' ')

  // Format customer name
  const customerName = customer
    ? `${customer.first_name} ${customer.last_name}`.trim()
    : 'Walk-in Customer'

  // Format technician info
  const technicianName = technician
    ? `${technician.first_name} ${technician.last_name}`.trim()
    : 'Unknown'

  // Use completed_at or closed_at or created_at as inspection date
  const inspectionDate = formatDate(data.completed_at || data.closed_at || data.created_at)

  return `
    <div class="info-bar">
      <div class="reg-plate">${vehicle.registration || 'NO REG'}</div>

      <div class="info-item">
        <div class="info-label">Vehicle</div>
        <div class="info-value">${vehicleInfo || 'Unknown Vehicle'}</div>
      </div>

      <div class="info-item">
        <div class="info-label">Customer</div>
        <div class="info-value">${customerName}</div>
      </div>

      <div class="info-item">
        <div class="info-label">Inspected</div>
        <div class="info-value">${inspectionDate} &bull; ${technicianName}</div>
      </div>
    </div>
  `
}
