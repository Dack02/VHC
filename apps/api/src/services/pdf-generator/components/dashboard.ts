/**
 * Executive Summary Dashboard Component
 * Shows at-a-glance vehicle health status at the top of the PDF
 */

import type { HealthCheckPDFData } from '../types.js'
import { formatCurrency } from '../utils/formatters.js'

interface DashboardOptions {
  data: HealthCheckPDFData
  redCount: number
  amberCount: number
  greenCount: number
  motFailureCount: number
  totalQuote: number
  primaryColor: string
}

/**
 * Render a single RAG status circle with count
 */
function renderStatusCircle(
  count: number,
  label: string,
  bgColor: string,
  textColor: string
): string {
  return `
    <div style="text-align: center; flex: 1;">
      <div style="
        width: 60px;
        height: 60px;
        background: ${bgColor};
        margin: 0 auto 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <span style="font-size: 24px; font-weight: 700; color: ${textColor};">${count}</span>
      </div>
      <div style="font-size: 10px; color: #6b7280; text-transform: uppercase; font-weight: 500;">${label}</div>
    </div>
  `
}

/**
 * Render the executive summary dashboard
 */
export function renderDashboard(options: DashboardOptions): string {
  const {
    data,
    redCount,
    amberCount,
    greenCount,
    motFailureCount,
    totalQuote,
    primaryColor
  } = options

  const mileage = data.mileage

  return `
    <div class="dashboard-section" style="margin-bottom: 20px; border: 2px solid ${primaryColor}; background: #fafafa;">
      <!-- Header -->
      <div style="background: ${primaryColor}; padding: 8px 12px;">
        <span style="color: white; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Vehicle Health Overview</span>
      </div>

      <!-- Content -->
      <div style="padding: 16px;">
        <!-- RAG Status Circles -->
        <div style="display: flex; justify-content: center; gap: 24px; margin-bottom: 16px;">
          ${renderStatusCircle(redCount, 'Immediate', '#dc2626', 'white')}
          ${renderStatusCircle(amberCount, 'Advisory', '#d97706', 'white')}
          ${renderStatusCircle(greenCount, 'Checked OK', '#16a34a', 'white')}
        </div>

        <!-- Summary Stats -->
        <div style="display: flex; justify-content: center; gap: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
          <div style="text-align: center;">
            <div style="font-size: 18px; font-weight: 700; color: ${primaryColor};">${formatCurrency(totalQuote)}</div>
            <div style="font-size: 10px; color: #6b7280; text-transform: uppercase;">Total Quote</div>
          </div>

          ${motFailureCount > 0 ? `
            <div style="text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: #dc2626;">${motFailureCount}</div>
              <div style="font-size: 10px; color: #6b7280; text-transform: uppercase;">MOT Failures</div>
            </div>
          ` : ''}

          ${mileage ? `
            <div style="text-align: center;">
              <div style="font-size: 18px; font-weight: 700; color: #374151;">${mileage.toLocaleString()}</div>
              <div style="font-size: 10px; color: #6b7280; text-transform: uppercase;">Mileage</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `
}

/**
 * Get CSS styles for dashboard component
 */
export function getDashboardStyles(): string {
  return `
    .dashboard-section {
      page-break-inside: avoid;
    }
  `
}
