/**
 * Work Authority Sheet PDF Generator - V2
 * Matches the mockup at docs/work-authority-mockup-v2.html
 */

import type { WorkAuthoritySheetData, WorkSection, PricingSummary } from '../types.js'
import { getWorkAuthorityStyles } from '../styles/work-authority-sheet.js'
import { renderHTMLToPDF } from '../pdf.js'

// ============================================
// Helper Functions
// ============================================

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return '£0.00'
  return `£${value.toFixed(2)}`
}

function formatDate(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

function formatTime(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getSeverityClass(severity: string | undefined): string {
  switch (severity) {
    case 'red': return 'severity-red'
    case 'amber': return 'severity-amber'
    case 'green': return 'severity-green'
    default: return ''
  }
}

function getSeverityLabel(severity: string | undefined): string {
  switch (severity) {
    case 'red': return 'Red - Urgent'
    case 'amber': return 'Amber - Advisory'
    case 'green': return 'Green - OK'
    default: return ''
  }
}

// ============================================
// Component Renderers
// ============================================

function renderHeader(data: WorkAuthoritySheetData): string {
  return `
    <div class="header">
      <h1>WORK AUTHORITY SHEET</h1>
      <div class="header-right">
        <div class="doc-number">${data.documentNumber}</div>
        <div>${formatDate(data.generatedAt)} &nbsp; ${formatTime(data.generatedAt)}</div>
      </div>
    </div>
  `
}

function renderInfoGrid(data: WorkAuthoritySheetData): string {
  const { vehicle, customer } = data

  return `
    <div class="info-grid">
      <div class="info-box">
        <div class="info-box-title">Vehicle</div>
        <div class="info-row">
          <div class="info-item">
            <label>Reg</label>
            <span>${vehicle.vrm}</span>
          </div>
          <div class="info-item">
            <label>Make/Model</label>
            <span>${[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'N/A'}</span>
          </div>
          <div class="info-item">
            <label>Year</label>
            <span>${vehicle.year || 'N/A'}</span>
          </div>
          <div class="info-item">
            <label>Mileage</label>
            <span>${vehicle.mileageIn?.toLocaleString() || 'N/A'}</span>
          </div>
          <div class="info-item">
            <label>VIN</label>
            <span>${vehicle.vin || 'N/A'}</span>
          </div>
        </div>
      </div>
      <div class="info-box">
        <div class="info-box-title">Customer</div>
        <div class="info-row">
          <div class="info-item">
            <label>Name</label>
            <span>${customer.name}</span>
          </div>
          <div class="info-item">
            <label>Contact</label>
            <span>${customer.phone || 'N/A'}</span>
          </div>
          <div class="info-item">
            <label>Email</label>
            <span>${customer.email || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderReferenceBar(data: WorkAuthoritySheetData): string {
  return `
    <div class="reference-bar">
      <div><strong>Workshop:</strong> ${data.site?.name || 'Workshop'}</div>
      <div><strong>Service Advisor:</strong> ${data.serviceAdvisor}</div>
      <div><strong>Technician:</strong> ${data.assignedTechnician || 'Not assigned'}</div>
      <div><strong>VHC Ref:</strong> ${data.vhcReference}</div>
    </div>
  `
}

// ============================================
// Work Table Renderers
// ============================================

function renderWorkTableHeader(isServiceAdvisor: boolean): string {
  if (isServiceAdvisor) {
    return `
      <thead>
        <tr>
          <th style="width: 40%">Description</th>
          <th style="width: 15%">Code / Part No.</th>
          <th style="width: 10%" class="num">Qty/Hrs</th>
          <th style="width: 15%" class="num">Rate</th>
          <th style="width: 10%" class="num">Total</th>
          <th style="width: 10%"></th>
        </tr>
      </thead>
    `
  }

  // Technician variant - no pricing columns
  return `
    <thead>
      <tr>
        <th style="width: 50%">Description</th>
        <th style="width: 25%">Code / Part No.</th>
        <th style="width: 15%" class="num">Qty/Hrs</th>
        <th style="width: 10%"></th>
      </tr>
    </thead>
  `
}

function renderWorkItemRows(section: WorkSection, isServiceAdvisor: boolean): string {
  const rows: string[] = []

  // Item header row with title and severity badge
  const severityBadge = section.severity
    ? `<span class="severity-badge ${getSeverityClass(section.severity)}">${getSeverityLabel(section.severity)}</span>`
    : ''

  const colspan = isServiceAdvisor ? 5 : 3
  rows.push(`
    <tr class="item-row">
      <td colspan="${colspan}">
        <div class="item-title">
          <span>${section.title}</span>
          ${severityBadge}
        </div>
      </td>
      <td></td>
    </tr>
  `)

  // Labour lines
  for (const labour of section.labourLines) {
    if (isServiceAdvisor) {
      rows.push(`
        <tr>
          <td><span class="line-type">Labour</span> ${labour.description}</td>
          <td>${labour.labourCode || '-'}</td>
          <td class="num">${labour.hours.toFixed(1)}</td>
          <td class="num">${formatCurrency(labour.rate)}</td>
          <td class="num">${formatCurrency(labour.total)}</td>
          <td></td>
        </tr>
      `)
    } else {
      rows.push(`
        <tr>
          <td><span class="line-type">Labour</span> ${labour.description}</td>
          <td>${labour.labourCode || '-'}</td>
          <td class="num">${labour.hours.toFixed(1)}</td>
          <td></td>
        </tr>
      `)
    }
  }

  // Parts lines
  for (const part of section.partsLines) {
    if (isServiceAdvisor) {
      rows.push(`
        <tr>
          <td><span class="line-type">Part</span> ${part.description}</td>
          <td>${part.partNumber || '-'}</td>
          <td class="num">${part.quantity}</td>
          <td class="num">${formatCurrency(part.unitPrice)}</td>
          <td class="num">${formatCurrency(part.total)}</td>
          <td></td>
        </tr>
      `)
    } else {
      rows.push(`
        <tr>
          <td><span class="line-type">Part</span> ${part.description}</td>
          <td>${part.partNumber || '-'}</td>
          <td class="num">${part.quantity}</td>
          <td></td>
        </tr>
      `)
    }
  }

  // Child items (for grouped repairs)
  if (section.children && section.children.length > 0) {
    for (const child of section.children) {
      const childSeverityBadge = child.severity
        ? `<span class="severity-badge ${getSeverityClass(child.severity)}" style="font-size: 6pt;">${child.severity?.charAt(0).toUpperCase()}${child.severity?.slice(1)}</span>`
        : ''

      if (isServiceAdvisor) {
        rows.push(`
          <tr class="child-item">
            <td colspan="5"><span class="child-item-prefix">└</span><span class="child-item-text">${child.title}</span></td>
            <td>${childSeverityBadge}</td>
          </tr>
        `)
      } else {
        rows.push(`
          <tr class="child-item">
            <td colspan="3"><span class="child-item-prefix">└</span><span class="child-item-text">${child.title}</span></td>
            <td>${childSeverityBadge}</td>
          </tr>
        `)
      }
    }
  }

  // Subtotal row (service advisor only)
  if (isServiceAdvisor && section.subtotals) {
    rows.push(`
      <tr class="subtotal-row">
        <td colspan="4" style="text-align: right;">Subtotal:</td>
        <td class="num">${formatCurrency(section.subtotals.sectionTotal)}</td>
        <td></td>
      </tr>
    `)
  }

  return rows.join('')
}

function renderWorkTable(items: WorkSection[], isServiceAdvisor: boolean): string {
  if (items.length === 0) {
    return ''
  }

  const tableBody = items.map(item => renderWorkItemRows(item, isServiceAdvisor)).join('')

  return `
    <table class="work-table">
      ${renderWorkTableHeader(isServiceAdvisor)}
      <tbody>
        ${tableBody}
      </tbody>
    </table>
  `
}

// ============================================
// Summary Renderers
// ============================================

function renderServiceAdvisorSummary(totals: PricingSummary): string {
  return `
    <div class="summary-section">
      <div class="summary-header">TOTALS</div>
      <table class="summary-table">
        <tr>
          <td class="label">Pre-Booked Work</td>
          <td class="num">${formatCurrency(totals.preBooked.subtotal)}</td>
        </tr>
        <tr>
          <td class="label">Authorised VHC Work (${totals.totalLabourHours.toFixed(1)} hrs labour, ${totals.totalPartsLines} parts)</td>
          <td class="num">${formatCurrency(totals.vhcWork.subtotal)}</td>
        </tr>
        <tr class="subtotal">
          <td>Subtotal (ex VAT)</td>
          <td class="num">${formatCurrency(totals.subtotalExVat)}</td>
        </tr>
        <tr class="vat">
          <td>VAT @ ${(totals.vatRate * 100).toFixed(0)}%</td>
          <td class="num">${formatCurrency(totals.vatAmount)}</td>
        </tr>
        <tr class="total">
          <td>TOTAL (inc VAT)</td>
          <td class="num">${formatCurrency(totals.grandTotal)}</td>
        </tr>
      </table>
    </div>
  `
}

function renderTechnicianSummary(data: WorkAuthoritySheetData): string {
  const allSections = [...data.preBookedWork, ...data.authorizedVhcWork]

  const totalHours = allSections.reduce((sum, section) => {
    const sectionHours = section.labourLines.reduce((h, l) => h + l.hours, 0)
    const childHours = (section.children || []).reduce((ch, child) =>
      ch + child.labourLines.reduce((h, l) => h + l.hours, 0), 0)
    return sum + sectionHours + childHours
  }, 0)

  const totalPartsLines = allSections.reduce((sum, section) => {
    const sectionParts = section.partsLines.length
    const childParts = (section.children || []).reduce((cp, child) => cp + child.partsLines.length, 0)
    return sum + sectionParts + childParts
  }, 0)

  return `
    <div class="tech-summary-section">
      <div class="summary-header">WORK SUMMARY</div>
      <table class="tech-summary-table">
        <tr>
          <td>Total Labour Hours</td>
          <td class="num">${totalHours.toFixed(1)} hrs</td>
        </tr>
        <tr>
          <td>Total Parts Lines</td>
          <td class="num">${totalPartsLines} items</td>
        </tr>
      </table>
    </div>
  `
}

// ============================================
// Main HTML Generator
// ============================================

export function generateWorkAuthoritySheetHTML(data: WorkAuthoritySheetData): string {
  const isServiceAdvisor = data.variant === 'service_advisor'

  // Combine all work items into single table
  const allItems = [...data.preBookedWork, ...data.authorizedVhcWork]

  // Render summary based on variant
  const summarySection = isServiceAdvisor && data.totals
    ? renderServiceAdvisorSummary(data.totals)
    : renderTechnicianSummary(data)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    ${getWorkAuthorityStyles()}
  </style>
</head>
<body>
  <div class="page">
    ${renderHeader(data)}
    ${renderInfoGrid(data)}
    ${renderReferenceBar(data)}

    <div class="section-header">AUTHORISED WORK</div>
    ${renderWorkTable(allItems, isServiceAdvisor)}

    ${summarySection}
  </div>
</body>
</html>
  `
}

/**
 * Generate PDF buffer from Work Authority Sheet data
 */
export async function generateWorkAuthoritySheetPDF(data: WorkAuthoritySheetData): Promise<Buffer> {
  const html = generateWorkAuthoritySheetHTML(data)
  return renderHTMLToPDF(html)
}
