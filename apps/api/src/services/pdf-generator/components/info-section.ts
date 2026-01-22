/**
 * Info Section Component
 * Renders vehicle and customer information boxes
 */

import type { HealthCheckPDFData } from '../types.js'
import { formatDate } from '../utils/formatters.js'

export function renderInfoSection(data: HealthCheckPDFData): string {
  const { vehicle, customer, technician } = data

  return `
    <div class="info-section">
      <div class="info-box">
        <h3>Vehicle Information</h3>
        <div class="registration">${vehicle.registration}</div>
        <div class="info-grid">
          <span class="info-label">Make/Model:</span>
          <span class="info-value">${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.year || ''}</span>
          ${vehicle.vin ? `
            <span class="info-label">VIN:</span>
            <span class="info-value">${vehicle.vin}</span>
          ` : ''}
          ${data.mileage ? `
            <span class="info-label">Mileage:</span>
            <span class="info-value">${data.mileage.toLocaleString()} miles</span>
          ` : ''}
          <span class="info-label">Date:</span>
          <span class="info-value">${formatDate(data.completed_at || data.created_at)}</span>
          ${technician ? `
            <span class="info-label">Technician:</span>
            <span class="info-value">${technician.first_name} ${technician.last_name}</span>
          ` : ''}
        </div>
      </div>

      <div class="info-box">
        <h3>Customer Information</h3>
        <div class="info-grid">
          <span class="info-label">Name:</span>
          <span class="info-value">${customer.first_name} ${customer.last_name}</span>
          ${customer.phone ? `
            <span class="info-label">Phone:</span>
            <span class="info-value">${customer.phone}</span>
          ` : ''}
          ${customer.email ? `
            <span class="info-label">Email:</span>
            <span class="info-value">${customer.email}</span>
          ` : ''}
        </div>
      </div>
    </div>
  `
}
