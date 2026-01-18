/**
 * PDF Generator Service
 * Generates PDF reports for health checks using puppeteer
 */

import puppeteer from 'puppeteer'

// Types for PDF generation
interface OrganizationBranding {
  logoUrl?: string | null
  primaryColor?: string
  organizationName?: string
}

interface HealthCheckPDFData {
  // Health check details
  id: string
  status: string
  created_at: string
  completed_at?: string | null
  closed_at?: string | null
  mileage?: number | null

  // Vehicle
  vehicle: {
    registration: string
    make?: string
    model?: string
    year?: number
    vin?: string
  }

  // Customer
  customer: {
    first_name: string
    last_name: string
    email?: string
    phone?: string
  }

  // Technician
  technician?: {
    first_name: string
    last_name: string
  }

  // Technician signature (base64 PNG)
  technician_signature?: string | null

  // Site/Dealer
  site?: {
    name: string
    address?: string
    phone?: string
    email?: string
  }

  // Organization branding
  branding?: OrganizationBranding

  // Results and items
  results: ResultData[]
  repairItems: RepairItemData[]
  authorizations: AuthorizationData[]

  // Selected reasons by check result ID
  reasonsByCheckResult?: CheckResultReasonsMap

  // New Repair Items (Phase 6+)
  newRepairItems?: NewRepairItem[]
  hasNewRepairItems?: boolean
  vatRate?: number // Default 20%
  showDetailedBreakdown?: boolean // Show labour/parts detail

  // Summary
  summary: {
    red_count: number
    amber_count: number
    green_count: number
    total_identified: number
    total_authorised: number
    work_completed_value: number
  }
}

interface ResultData {
  id: string
  rag_status: 'red' | 'amber' | 'green'
  notes?: string | null
  value?: Record<string, unknown> | null
  template_item?: {
    id: string
    name: string
    input_type: string
    section?: { name: string }
  }
  media?: MediaData[]
}

interface RepairItemData {
  id: string
  check_result_id: string
  title: string
  description?: string | null
  rag_status: 'red' | 'amber' | 'green'
  parts_cost?: number | null
  labor_cost?: number | null
  total_price?: number | null
  is_mot_failure?: boolean
  follow_up_date?: string | null
  work_completed_at?: string | null
}

interface MediaData {
  id: string
  url: string
  thumbnail_url?: string | null
  type: string
}

interface AuthorizationData {
  repair_item_id: string
  decision: 'approved' | 'declined'
  signature_data?: string | null
  signed_at?: string | null
}

interface SelectedReasonData {
  id: string
  reasonText: string
  customerDescription?: string | null
  followUpDays?: number | null
  followUpText?: string | null
}

interface CheckResultReasonsMap {
  [checkResultId: string]: SelectedReasonData[]
}

// New Repair Items (Phase 6+)
interface NewRepairOption {
  id: string
  name: string
  description?: string | null
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  isRecommended: boolean
}

interface NewRepairItem {
  id: string
  name: string
  description?: string | null
  isGroup: boolean
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  customerApproved: boolean | null
  customerApprovedAt?: string | null
  customerDeclinedReason?: string | null
  selectedOptionId?: string | null
  options: NewRepairOption[]
  linkedCheckResults: string[]
  // Labour and parts details for optional breakdown
  labourEntries?: Array<{
    code: string
    description: string
    hours: number
    rate: number
    total: number
    isVatExempt: boolean
  }>
  partsEntries?: Array<{
    partNumber?: string
    description: string
    quantity: number
    sellPrice: number
    lineTotal: number
  }>
}

/**
 * Generate HTML template for PDF
 */
function generateHTML(data: HealthCheckPDFData): string {
  const { vehicle, customer, technician, site, branding, results, repairItems, authorizations, summary, reasonsByCheckResult = {}, newRepairItems = [], hasNewRepairItems = false, vatRate = 20, showDetailedBreakdown = false } = data

  // Get branding colors with fallbacks
  const primaryColor = branding?.primaryColor || '#1a3a5c'
  const organizationName = branding?.organizationName || site?.name || 'Vehicle Health Check'
  const logoUrl = branding?.logoUrl

  // Create lookup maps
  const resultById = new Map(results.map(r => [r.id, r]))
  const authByItemId = new Map(authorizations.map(a => [a.repair_item_id, a]))

  // Group repair items by RAG status
  const redItems = repairItems.filter(i => i.rag_status === 'red')
  const amberItems = repairItems.filter(i => i.rag_status === 'amber')

  // Get authorised and declined items
  const authorisedItems = repairItems.filter(i => authByItemId.get(i.id)?.decision === 'approved')
  const declinedItems = repairItems.filter(i => authByItemId.get(i.id)?.decision === 'declined')

  // Get signature if exists
  const signatureAuth = authorizations.find(a => a.signature_data)

  // Format currency
  const formatCurrency = (amount: number | null | undefined) =>
    `£${(amount || 0).toFixed(2)}`

  // Format date
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  // Format follow-up text
  const formatFollowUp = (days?: number | null, text?: string | null): string => {
    if (text) return text
    if (!days) return ''
    if (days <= 7) return 'Recommend addressing within 1 week'
    if (days <= 30) return 'Recommend addressing within 1 month'
    if (days <= 90) return 'Recommend addressing within 3 months'
    if (days <= 180) return 'Recommend addressing within 6 months'
    return `Recommend addressing within ${Math.round(days / 30)} months`
  }

  // Generate reasons HTML for an item
  const getReasonsHTML = (checkResultId: string, ragStatus: string): string => {
    const reasons = reasonsByCheckResult[checkResultId]
    if (!reasons || reasons.length === 0) return ''

    const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)
    const followUpText = followUpInfo ? formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText) : ''
    const bulletColor = ragStatus === 'red' ? '#dc2626' : '#d97706'

    return `
      <div class="reasons-section">
        ${reasons.length > 1 ? `
          <div class="reasons-intro">We identified the following ${ragStatus === 'red' ? 'issues' : 'items to monitor'}:</div>
          <ul class="reasons-list">
            ${reasons.map(r => `
              <li style="color: ${bulletColor}">
                <span style="color: #374151">${r.customerDescription || r.reasonText}</span>
              </li>
            `).join('')}
          </ul>
        ` : `
          <div class="single-reason">${reasons[0].customerDescription || reasons[0].reasonText}</div>
        `}
        ${followUpText ? `
          <div class="follow-up-note" style="color: ${bulletColor}">${followUpText}</div>
        ` : ''}
      </div>
    `
  }

  // Generate tyre details HTML
  const getTyreDetails = (value: Record<string, unknown> | null | undefined): string => {
    if (!value) return ''
    const outer = value.outer as number | undefined
    const middle = value.middle as number | undefined
    const inner = value.inner as number | undefined
    const manufacturer = value.manufacturer as string | undefined
    const size = value.size as string | undefined

    if (!outer && !middle && !inner) return ''

    const lowest = Math.min(outer || 99, middle || 99, inner || 99)
    const remaining = Math.max(0, lowest - 1.6).toFixed(1)
    const belowLegal = lowest < 1.6

    return `
      <div class="measurement-details">
        <div class="measurements">
          ${outer !== undefined ? `<span>Outer: ${outer.toFixed(1)}mm</span>` : ''}
          ${middle !== undefined ? `<span>Middle: ${middle.toFixed(1)}mm</span>` : ''}
          ${inner !== undefined ? `<span>Inner: ${inner.toFixed(1)}mm</span>` : ''}
        </div>
        <div class="remaining ${belowLegal ? 'below-legal' : ''}">
          Remaining Legal Tread: ${remaining}mm
          ${belowLegal ? ' (BELOW LEGAL LIMIT)' : ''}
        </div>
        ${manufacturer || size ? `<div class="tyre-info">${manufacturer || ''} ${size || ''}</div>` : ''}
      </div>
    `
  }

  // Generate brake details HTML
  const getBrakeDetails = (value: Record<string, unknown> | null | undefined): string => {
    if (!value) return ''
    const type = value.type as string | undefined
    const ns_pad = value.ns_pad as number | undefined
    const os_pad = value.os_pad as number | undefined
    const ns_disc = value.ns_disc as number | undefined
    const os_disc = value.os_disc as number | undefined
    const ns_disc_min = value.ns_disc_min as number | undefined
    const os_disc_min = value.os_disc_min as number | undefined

    if (ns_pad === undefined && os_pad === undefined) return ''

    // Check if any disc needs replacement (actual < min spec)
    const nsDiscNeedsReplacement = ns_disc !== undefined && ns_disc_min !== undefined && ns_disc < ns_disc_min
    const osDiscNeedsReplacement = os_disc !== undefined && os_disc_min !== undefined && os_disc < os_disc_min

    return `
      <div class="measurement-details">
        <div class="brake-type">${type === 'drum' ? 'Drum' : 'Disc'} Brakes</div>
        <div class="measurements">
          ${ns_pad !== undefined ? `<span>N/S Pad: ${ns_pad.toFixed(1)}mm</span>` : ''}
          ${os_pad !== undefined ? `<span>O/S Pad: ${os_pad.toFixed(1)}mm</span>` : ''}
        </div>
        ${type === 'disc' && (ns_disc !== undefined || os_disc !== undefined) ? `
          <div class="measurements">
            ${ns_disc !== undefined ? `<span style="${nsDiscNeedsReplacement ? 'color: #dc2626;' : ''}">N/S Disc: ${ns_disc.toFixed(1)}mm${ns_disc_min !== undefined ? ` (Min: ${ns_disc_min.toFixed(1)}mm)` : ''}</span>` : ''}
            ${os_disc !== undefined ? `<span style="${osDiscNeedsReplacement ? 'color: #dc2626;' : ''}">O/S Disc: ${os_disc.toFixed(1)}mm${os_disc_min !== undefined ? ` (Min: ${os_disc_min.toFixed(1)}mm)` : ''}</span>` : ''}
          </div>
          ${nsDiscNeedsReplacement || osDiscNeedsReplacement ? `
            <div class="below-legal" style="color: #dc2626; font-weight: 500;">DISC REPLACEMENT REQUIRED</div>
          ` : ''}
        ` : ''}
      </div>
    `
  }

  // Generate repair item row HTML
  const getItemRow = (item: RepairItemData, showPrice = true): string => {
    const result = resultById.get(item.check_result_id)
    const inputType = result?.template_item?.input_type || ''

    let details = ''
    if (inputType === 'tyre_depth') {
      details = getTyreDetails(result?.value as Record<string, unknown>)
    } else if (inputType === 'brake_measurement') {
      details = getBrakeDetails(result?.value as Record<string, unknown>)
    }

    // Get reasons for this item
    const reasonsHTML = getReasonsHTML(item.check_result_id, item.rag_status)
    // Only show description if no reasons are available
    const showDescription = !reasonsHTML && item.description

    return `
      <tr class="item-row">
        <td class="item-cell">
          <div class="item-name">${item.title}</div>
          ${showDescription ? `<div class="item-description">${item.description}</div>` : ''}
          ${reasonsHTML}
          ${details}
          ${result?.notes ? `<div class="tech-notes">Notes: ${result.notes}</div>` : ''}
        </td>
        ${item.is_mot_failure ? '<td class="mot-cell">MOT</td>' : '<td class="mot-cell"></td>'}
        ${showPrice ? `<td class="price-cell">${formatCurrency(item.total_price)}</td>` : ''}
      </tr>
    `
  }

  // Generate new repair item card HTML (Phase 6+)
  const getNewRepairItemCard = (item: NewRepairItem): string => {
    const hasOptions = item.options.length > 0
    const selectedOption = hasOptions && item.selectedOptionId
      ? item.options.find(o => o.id === item.selectedOptionId)
      : null

    // Get price info based on whether there's a selected option
    const priceInfo = selectedOption || {
      subtotal: item.subtotal,
      vatAmount: item.vatAmount,
      totalIncVat: item.totalIncVat
    }

    // Approval status badge
    const getApprovalBadge = () => {
      if (item.customerApproved === true) {
        return '<span class="approval-status approved">✓ Approved</span>'
      } else if (item.customerApproved === false) {
        return '<span class="approval-status declined">✗ Declined</span>'
      }
      return '<span class="approval-status pending">Pending</span>'
    }

    // Options HTML
    const optionsHtml = hasOptions ? `
      <div class="repair-options">
        ${item.options.map(opt => {
          const isSelected = opt.id === item.selectedOptionId
          const classes = ['repair-option']
          if (isSelected) classes.push('selected')
          if (opt.isRecommended) classes.push('recommended')
          return `
            <div class="${classes.join(' ')}">
              <div>
                <span class="repair-option-name">${opt.name}</span>
                ${opt.isRecommended ? '<span class="recommended-badge">Recommended</span>' : ''}
                ${isSelected ? '<span class="selected-badge">Selected</span>' : ''}
                ${opt.description ? `<div style="font-size: 9px; color: #6b7280; margin-top: 2px;">${opt.description}</div>` : ''}
              </div>
              <div class="repair-option-price">
                <div>${formatCurrency(opt.totalIncVat)}</div>
                <div style="font-size: 9px; color: #6b7280;">Inc VAT</div>
              </div>
            </div>
          `
        }).join('')}
      </div>
    ` : ''

    // Labour/parts breakdown HTML (optional)
    const breakdownHtml = showDetailedBreakdown && (item.labourEntries?.length || item.partsEntries?.length) ? `
      <div class="labour-parts-breakdown">
        ${item.labourEntries && item.labourEntries.length > 0 ? `
          <div style="margin-bottom: 8px;">
            <strong>Labour</strong>
            <table class="breakdown-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th class="right">Hours</th>
                  <th class="right">Rate</th>
                  <th class="right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${item.labourEntries.map(l => `
                  <tr>
                    <td>${l.code}</td>
                    <td>${l.description}${l.isVatExempt ? ' *' : ''}</td>
                    <td class="right">${l.hours.toFixed(2)}</td>
                    <td class="right">${formatCurrency(l.rate)}</td>
                    <td class="right">${formatCurrency(l.total)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
        ${item.partsEntries && item.partsEntries.length > 0 ? `
          <div>
            <strong>Parts</strong>
            <table class="breakdown-table">
              <thead>
                <tr>
                  <th>Part No.</th>
                  <th>Description</th>
                  <th class="right">Qty</th>
                  <th class="right">Price</th>
                  <th class="right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${item.partsEntries.map(p => `
                  <tr>
                    <td>${p.partNumber || '-'}</td>
                    <td>${p.description}</td>
                    <td class="right">${p.quantity}</td>
                    <td class="right">${formatCurrency(p.sellPrice)}</td>
                    <td class="right">${formatCurrency(p.lineTotal)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      </div>
    ` : ''

    return `
      <div class="repair-item-card">
        <div class="repair-item-header">
          <div>
            <div class="repair-item-name">${item.name}</div>
            ${item.linkedCheckResults.length > 0 ? `
              <div class="linked-items">
                <strong>Related items:</strong> ${item.linkedCheckResults.join(', ')}
              </div>
            ` : ''}
          </div>
          <div style="text-align: right;">
            ${getApprovalBadge()}
            <div class="repair-item-price">${formatCurrency(priceInfo.totalIncVat)}</div>
            <div class="repair-item-price-note">Inc VAT</div>
          </div>
        </div>
        ${item.description ? `<div class="repair-item-description">${item.description}</div>` : ''}
        ${optionsHtml}
        ${!hasOptions ? `
          <div style="font-size: 10px; color: #6b7280; margin-top: 4px;">
            Labour: ${formatCurrency(item.labourTotal)} • Parts: ${formatCurrency(item.partsTotal)}
          </div>
        ` : ''}
        ${breakdownHtml}
      </div>
    `
  }

  // Generate quote summary HTML for new repair items
  const getQuoteSummaryHtml = (): string => {
    if (!hasNewRepairItems || newRepairItems.length === 0) return ''

    // Calculate totals based on selected options
    let totalSubtotal = 0
    let totalVat = 0
    let totalIncVat = 0
    let hasVatExempt = false

    newRepairItems.forEach(item => {
      // Only count approved items (or all if none have been actioned)
      if (item.customerApproved === true || item.customerApproved === null) {
        if (item.options.length > 0 && item.selectedOptionId) {
          const opt = item.options.find(o => o.id === item.selectedOptionId)
          if (opt) {
            totalSubtotal += opt.subtotal
            totalVat += opt.vatAmount
            totalIncVat += opt.totalIncVat
          }
        } else if (item.options.length > 0) {
          // Use recommended option or first if not selected
          const opt = item.options.find(o => o.isRecommended) || item.options[0]
          totalSubtotal += opt.subtotal
          totalVat += opt.vatAmount
          totalIncVat += opt.totalIncVat
        } else {
          totalSubtotal += item.subtotal
          totalVat += item.vatAmount
          totalIncVat += item.totalIncVat
        }
      }

      // Check for VAT exempt labour
      if (item.labourEntries?.some(l => l.isVatExempt)) {
        hasVatExempt = true
      }
    })

    return `
      <div class="quote-summary-box">
        <div class="quote-summary-title">Quote Summary</div>
        <div class="quote-row">
          <span class="quote-label">Subtotal (Ex VAT)</span>
          <span class="quote-value">${formatCurrency(totalSubtotal)}</span>
        </div>
        <div class="quote-row">
          <span class="quote-label">VAT @ ${vatRate}%</span>
          <span class="quote-value">${formatCurrency(totalVat)}</span>
        </div>
        <div class="quote-row total">
          <span class="quote-label">Total Inc VAT</span>
          <span class="quote-value">${formatCurrency(totalIncVat)}</span>
        </div>
        ${hasVatExempt ? '<div class="vat-exempt-note">* MOT labour is VAT exempt</div>' : ''}
      </div>
    `
  }

  // Generate photo grid HTML
  const getPhotoGrid = (items: RepairItemData[]): string => {
    const photos: { url: string; title: string; rag: string }[] = []

    items.forEach(item => {
      const result = resultById.get(item.check_result_id)
      if (result?.media) {
        result.media.forEach(m => {
          photos.push({
            url: m.url,
            title: item.title,
            rag: item.rag_status
          })
        })
      }
    })

    if (photos.length === 0) return ''

    return `
      <div class="photo-grid">
        ${photos.slice(0, 8).map(p => `
          <div class="photo-item">
            <img src="${p.url}" alt="${p.title}" />
            <div class="photo-caption ${p.rag}">${p.title}</div>
          </div>
        `).join('')}
        ${photos.length > 8 ? `<div class="more-photos">+${photos.length - 8} more photos</div>` : ''}
      </div>
    `
  }

  // Build the HTML
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #1f2937;
      padding: 20px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 15px;
      margin-bottom: 20px;
    }

    .header-left h1 {
      font-size: 20px;
      color: ${primaryColor};
      margin-bottom: 5px;
    }

    .header-logo {
      max-height: 48px;
      max-width: 180px;
      margin-bottom: 8px;
    }

    .header-left .subtitle {
      color: #6b7280;
      font-size: 12px;
    }

    .header-right {
      text-align: right;
    }

    .header-right .site-name {
      font-weight: 600;
      font-size: 14px;
      color: ${primaryColor};
    }

    .header-right .site-contact {
      color: #6b7280;
      font-size: 10px;
    }

    .info-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    .info-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
    }

    .info-box h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
    }

    .info-label {
      color: #6b7280;
      font-size: 10px;
    }

    .info-value {
      font-weight: 500;
    }

    .registration {
      font-size: 18px;
      font-weight: 700;
      color: ${primaryColor};
      background: #fef3c7;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 8px;
    }

    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    .section-header {
      padding: 8px 12px;
      border-radius: 4px 4px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-header.red {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-bottom: none;
    }

    .section-header.amber {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-bottom: none;
    }

    .section-header.green {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-bottom: none;
    }

    .section-header.blue {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-bottom: none;
    }

    .section-header.grey {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-bottom: none;
    }

    .section-title {
      font-weight: 600;
      font-size: 12px;
    }

    .section-header.red .section-title { color: #dc2626; }
    .section-header.amber .section-title { color: #d97706; }
    .section-header.green .section-title { color: #16a34a; }
    .section-header.blue .section-title { color: #2563eb; }
    .section-header.grey .section-title { color: #6b7280; }

    .section-stats {
      font-size: 11px;
      color: #6b7280;
    }

    .section-content {
      border: 1px solid #e5e7eb;
      border-top: none;
      border-radius: 0 0 4px 4px;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
    }

    .items-table th {
      text-align: left;
      padding: 8px 12px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
    }

    .items-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
    }

    .items-table tr:last-child td {
      border-bottom: none;
    }

    .item-name {
      font-weight: 500;
      margin-bottom: 2px;
    }

    .item-description {
      font-size: 10px;
      color: #6b7280;
    }

    .measurement-details {
      margin-top: 6px;
      padding: 6px 8px;
      background: #f9fafb;
      border-radius: 4px;
      font-size: 10px;
    }

    .measurements {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
    }

    .remaining {
      color: #16a34a;
      font-weight: 500;
    }

    .remaining.below-legal {
      color: #dc2626;
    }

    .brake-type {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .tyre-info {
      color: #6b7280;
      font-style: italic;
    }

    .tech-notes {
      margin-top: 6px;
      font-size: 10px;
      color: #4b5563;
      font-style: italic;
      background: #fefce8;
      padding: 4px 6px;
      border-radius: 3px;
    }

    .reasons-section {
      margin-top: 6px;
      font-size: 10px;
    }

    .reasons-intro {
      color: #374151;
      margin-bottom: 4px;
    }

    .reasons-list {
      margin: 0;
      padding-left: 16px;
    }

    .reasons-list li {
      margin-bottom: 2px;
    }

    .single-reason {
      color: #374151;
    }

    .follow-up-note {
      margin-top: 6px;
      font-weight: 500;
      font-size: 10px;
    }

    .green-reason {
      color: #16a34a;
      font-size: 10px;
      margin-left: 4px;
    }

    .mot-cell {
      width: 40px;
      text-align: center;
      color: #dc2626;
      font-weight: 600;
      font-size: 10px;
    }

    .price-cell {
      width: 80px;
      text-align: right;
      font-weight: 500;
    }

    .photo-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px;
    }

    .photo-item {
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    }

    .photo-item img {
      width: 100%;
      height: 80px;
      object-fit: cover;
    }

    .photo-caption {
      font-size: 9px;
      padding: 4px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .photo-caption.red { background: #fef2f2; color: #dc2626; }
    .photo-caption.amber { background: #fffbeb; color: #d97706; }
    .photo-caption.green { background: #f0fdf4; color: #16a34a; }

    .more-photos {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6b7280;
      font-size: 10px;
    }

    /* New Repair Items Section (Phase 6+) */
    .section-header.purple {
      background: #f5f3ff;
      border: 1px solid #ddd6fe;
      border-bottom: none;
    }

    .section-header.purple .section-title { color: #7c3aed; }

    .repair-item-card {
      padding: 12px;
      border-bottom: 1px solid #f3f4f6;
    }

    .repair-item-card:last-child {
      border-bottom: none;
    }

    .repair-item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .repair-item-name {
      font-weight: 600;
      font-size: 12px;
      color: #1f2937;
    }

    .repair-item-price {
      font-weight: 600;
      font-size: 14px;
      text-align: right;
    }

    .repair-item-price-note {
      font-size: 9px;
      color: #6b7280;
      font-weight: normal;
    }

    .repair-item-description {
      font-size: 10px;
      color: #4b5563;
      margin-bottom: 8px;
    }

    .linked-items {
      font-size: 10px;
      color: #6b7280;
      margin-bottom: 8px;
    }

    .linked-items strong {
      color: #4b5563;
    }

    .repair-options {
      margin-top: 8px;
    }

    .repair-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      margin-bottom: 4px;
    }

    .repair-option.selected {
      background: #eff6ff;
      border-color: #3b82f6;
    }

    .repair-option.recommended {
      border-left: 3px solid #16a34a;
    }

    .repair-option-name {
      font-weight: 500;
      font-size: 11px;
    }

    .recommended-badge {
      display: inline-block;
      background: #dcfce7;
      color: #16a34a;
      font-size: 8px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 6px;
      text-transform: uppercase;
    }

    .selected-badge {
      display: inline-block;
      background: #dbeafe;
      color: #2563eb;
      font-size: 8px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 6px;
      text-transform: uppercase;
    }

    .repair-option-price {
      font-weight: 500;
      font-size: 11px;
    }

    .quote-summary-box {
      margin-top: 16px;
      padding: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    .quote-summary-title {
      font-weight: 600;
      font-size: 12px;
      color: #1f2937;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }

    .quote-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 11px;
    }

    .quote-row.subtotal {
      border-top: 1px solid #e5e7eb;
      margin-top: 8px;
      padding-top: 8px;
    }

    .quote-row.total {
      border-top: 2px solid #1f2937;
      margin-top: 4px;
      padding-top: 8px;
      font-weight: 700;
      font-size: 14px;
    }

    .quote-label {
      color: #4b5563;
    }

    .quote-value {
      font-weight: 500;
      color: #1f2937;
    }

    .vat-exempt-note {
      font-size: 9px;
      color: #6b7280;
      font-style: italic;
      margin-top: 8px;
    }

    .approval-status {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 500;
    }

    .approval-status.approved {
      background: #dcfce7;
      color: #16a34a;
    }

    .approval-status.declined {
      background: #fee2e2;
      color: #dc2626;
    }

    .approval-status.pending {
      background: #fef9c3;
      color: #ca8a04;
    }

    .labour-parts-breakdown {
      margin-top: 12px;
      font-size: 10px;
    }

    .breakdown-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    .breakdown-table th {
      text-align: left;
      padding: 4px 6px;
      background: #f3f4f6;
      font-weight: 500;
      font-size: 9px;
      text-transform: uppercase;
      color: #6b7280;
    }

    .breakdown-table td {
      padding: 4px 6px;
      border-bottom: 1px solid #f3f4f6;
    }

    .breakdown-table .right {
      text-align: right;
    }

    .green-list {
      padding: 12px;
      columns: 2;
      column-gap: 20px;
    }

    .green-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      break-inside: avoid;
    }

    .green-check {
      color: #16a34a;
      font-weight: bold;
    }

    .summary-section {
      margin-top: 30px;
      page-break-inside: avoid;
    }

    .summary-title {
      font-size: 14px;
      font-weight: 600;
      color: ${primaryColor};
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
    }

    .summary-table th {
      text-align: left;
      padding: 8px 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      font-size: 10px;
      text-transform: uppercase;
    }

    .summary-table td {
      padding: 8px 12px;
      border: 1px solid #e5e7eb;
    }

    .summary-table .total-row {
      font-weight: 600;
      background: #f9fafb;
    }

    .summary-table .amount {
      text-align: right;
    }

    .signature-section {
      margin-top: 30px;
      page-break-inside: avoid;
    }

    .signature-box {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 15px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .signature-image {
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 10px;
      text-align: center;
    }

    .signature-image img {
      max-width: 200px;
      max-height: 80px;
    }

    .signature-details {
      font-size: 11px;
    }

    .signature-label {
      color: #6b7280;
      font-size: 10px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 9px;
    }

    @media print {
      body {
        padding: 0;
      }

      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-left">
      ${logoUrl ? `<img src="${logoUrl}" alt="${organizationName}" class="header-logo" />` : ''}
      <h1>Vehicle Health Check Report</h1>
      <div class="subtitle">Report generated on ${formatDate(new Date().toISOString())}</div>
    </div>
    <div class="header-right">
      <div class="site-name">${organizationName}</div>
      ${site ? `
        <div class="site-contact">${site.name}</div>
        ${site.phone ? `<div class="site-contact">${site.phone}</div>` : ''}
        ${site.email ? `<div class="site-contact">${site.email}</div>` : ''}
      ` : ''}
    </div>
  </div>

  <!-- Vehicle & Customer Info -->
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
            ${redItems.map(item => getItemRow(item)).join('')}
          </tbody>
        </table>
        ${getPhotoGrid(redItems)}
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
            ${amberItems.map(item => getItemRow(item)).join('')}
          </tbody>
        </table>
        ${getPhotoGrid(amberItems)}
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
        ${newRepairItems.map(item => getNewRepairItemCard(item)).join('')}
        ${getQuoteSummaryHtml()}
      </div>
    </div>
  ` : ''}

  <!-- Items OK (Green) -->
  ${results.filter(r => r.rag_status === 'green').length > 0 ? `
    <div class="section">
      <div class="section-header green">
        <span class="section-title">Items Checked OK</span>
        <span class="section-stats">${results.filter(r => r.rag_status === 'green').length} items</span>
      </div>
      <div class="section-content">
        <div class="green-list">
          ${results.filter(r => r.rag_status === 'green').map(r => {
            const reasons = reasonsByCheckResult[r.id] || []
            const positiveReason = reasons.find(reason => reason.customerDescription || reason.reasonText)
            return `
              <div class="green-item">
                <span class="green-check">✓</span>
                <span>${r.template_item?.name || 'Item'}</span>
                ${positiveReason ? `<span class="green-reason">- ${positiveReason.customerDescription || positiveReason.reasonText}</span>` : ''}
              </div>
            `
          }).join('')}
        </div>
      </div>
    </div>
  ` : ''}

  <!-- Authorised Work -->
  ${authorisedItems.length > 0 ? `
    <div class="section">
      <div class="section-header blue">
        <span class="section-title">Authorised Work</span>
        <span class="section-stats">${authorisedItems.length} item${authorisedItems.length !== 1 ? 's' : ''} - ${formatCurrency(authorisedItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</span>
      </div>
      <div class="section-content">
        <table class="items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style="width: 80px">Status</th>
              <th style="text-align: right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${authorisedItems.map(item => `
              <tr class="item-row">
                <td class="item-cell">
                  <div class="item-name">${item.title}</div>
                </td>
                <td style="text-align: center">
                  ${item.work_completed_at
                    ? '<span style="color: #16a34a">✓ Complete</span>'
                    : '<span style="color: #d97706">Pending</span>'}
                </td>
                <td class="price-cell">${formatCurrency(item.total_price)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : ''}

  <!-- Declined Work -->
  ${declinedItems.length > 0 ? `
    <div class="section">
      <div class="section-header grey">
        <span class="section-title">Declined Items</span>
        <span class="section-stats">${declinedItems.length} item${declinedItems.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="section-content">
        <div class="green-list">
          ${declinedItems.map(item => `
            <div class="green-item">
              <span style="color: #dc2626">✗</span>
              <span>${item.title}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  ` : ''}

  <!-- Pricing Summary -->
  <div class="summary-section">
    <div class="summary-title">Pricing Summary</div>
    <table class="summary-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Items</th>
          <th style="text-align: right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Immediate Attention (Red)</td>
          <td>${summary.red_count}</td>
          <td class="amount">${formatCurrency(redItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
        </tr>
        <tr>
          <td>Advisory (Amber)</td>
          <td>${summary.amber_count}</td>
          <td class="amount">${formatCurrency(amberItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
        </tr>
        <tr>
          <td>Checked OK (Green)</td>
          <td>${summary.green_count}</td>
          <td class="amount">-</td>
        </tr>
        <tr class="total-row">
          <td>Total Identified</td>
          <td>${summary.red_count + summary.amber_count}</td>
          <td class="amount">${formatCurrency(summary.total_identified)}</td>
        </tr>
        ${authorisedItems.length > 0 ? `
          <tr style="background: #eff6ff">
            <td>Customer Authorised</td>
            <td>${authorisedItems.length}</td>
            <td class="amount">${formatCurrency(summary.total_authorised)}</td>
          </tr>
          <tr>
            <td>Work Completed</td>
            <td>${authorisedItems.filter(i => i.work_completed_at).length}</td>
            <td class="amount">${formatCurrency(summary.work_completed_value)}</td>
          </tr>
        ` : ''}
        ${declinedItems.length > 0 ? `
          <tr>
            <td>Customer Declined</td>
            <td>${declinedItems.length}</td>
            <td class="amount">${formatCurrency(declinedItems.reduce((sum, i) => sum + (i.total_price || 0), 0))}</td>
          </tr>
        ` : ''}
      </tbody>
    </table>
  </div>

  <!-- Technician Signature Section -->
  ${data.technician_signature || technician ? `
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
  ` : ''}

  <!-- Customer Signature Section -->
  ${signatureAuth ? `
    <div class="signature-section">
      <div class="summary-title">Customer Authorization</div>
      <div class="signature-box">
        <div class="signature-image">
          ${signatureAuth.signature_data ? `
            <img src="${signatureAuth.signature_data}" alt="Customer Signature" />
          ` : '<span style="color: #9ca3af">No signature</span>'}
        </div>
        <div class="signature-details">
          <div class="signature-label">Signed by</div>
          <div class="info-value">${customer.first_name} ${customer.last_name}</div>
          <div class="signature-label" style="margin-top: 8px">Date Signed</div>
          <div class="info-value">${formatDate(signatureAuth.signed_at)}</div>
          <div class="signature-label" style="margin-top: 8px">Items Authorised</div>
          <div class="info-value">${authorisedItems.length} items - ${formatCurrency(summary.total_authorised)}</div>
        </div>
      </div>
    </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    ${organizationName} - Generated by VHC System - ${new Date().toISOString()}
  </div>
</body>
</html>
  `
}

/**
 * Generate PDF from health check data
 */
export async function generateHealthCheckPDF(data: HealthCheckPDFData): Promise<Buffer> {
  const html = generateHTML(data)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    })

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

// Customer Approval Confirmation PDF Types
interface ApprovalConfirmationPDFData {
  healthCheckId: string
  vehicleReg: string
  vehicleMakeModel: string
  customerName: string
  customerEmail?: string
  approvedAt: string
  approvedItems: Array<{
    name: string
    description?: string | null
    selectedOption?: string | null
    totalIncVat: number
  }>
  declinedItems: Array<{
    name: string
    reason?: string | null
  }>
  totalApproved: number
  totalDeclined: number
  branding?: OrganizationBranding
  siteName?: string
  sitePhone?: string
}

/**
 * Generate HTML for customer approval confirmation PDF
 */
function generateApprovalConfirmationHTML(data: ApprovalConfirmationPDFData): string {
  const primaryColor = data.branding?.primaryColor || '#3B82F6'
  const organizationName = data.branding?.organizationName || data.siteName || 'Vehicle Health Check'
  const logoUrl = data.branding?.logoUrl

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      line-height: 1.5;
      color: #1f2937;
      background: #ffffff;
      padding: 20mm;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid ${primaryColor};
    }

    .logo {
      max-height: 48px;
      max-width: 180px;
    }

    .title-section {
      text-align: right;
    }

    .title {
      font-size: 20px;
      font-weight: 700;
      color: ${primaryColor};
      margin-bottom: 4px;
    }

    .subtitle {
      font-size: 12px;
      color: #6b7280;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }

    .info-box {
      background: #f9fafb;
      border-radius: 6px;
      padding: 16px;
    }

    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 4px;
    }

    .info-value {
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-header {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      padding: 10px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
    }

    .section-header.approved {
      background: #dcfce7;
      color: #166534;
    }

    .section-header.declined {
      background: #fef2f2;
      color: #991b1b;
    }

    .item-list {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
    }

    .item {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }

    .item:last-child {
      border-bottom: none;
    }

    .item-name {
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 2px;
    }

    .item-option {
      font-size: 10px;
      color: #6b7280;
    }

    .item-price {
      font-weight: 600;
      color: ${primaryColor};
      text-align: right;
    }

    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .item-reason {
      font-size: 10px;
      color: #dc2626;
      margin-top: 4px;
    }

    .total-box {
      background: ${primaryColor};
      color: white;
      padding: 16px;
      border-radius: 6px;
      margin-top: 20px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .total-label {
      font-size: 14px;
      font-weight: 500;
    }

    .total-value {
      font-size: 20px;
      font-weight: 700;
    }

    .confirmation-text {
      margin-top: 24px;
      padding: 16px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      font-size: 12px;
      color: #166534;
    }

    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
    }
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
    <strong>Confirmation:</strong> This document confirms that ${data.customerName} has reviewed and responded to the vehicle health check for ${data.vehicleReg} on ${formatDate(data.approvedAt)}.
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

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    })

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

export type { HealthCheckPDFData, ApprovalConfirmationPDFData }
