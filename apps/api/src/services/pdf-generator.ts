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

/**
 * Generate HTML template for PDF
 */
function generateHTML(data: HealthCheckPDFData): string {
  const { vehicle, customer, technician, site, branding, results, repairItems, authorizations, summary } = data

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

    return `
      <tr class="item-row">
        <td class="item-cell">
          <div class="item-name">${item.title}</div>
          ${item.description ? `<div class="item-description">${item.description}</div>` : ''}
          ${details}
          ${result?.notes ? `<div class="tech-notes">Notes: ${result.notes}</div>` : ''}
        </td>
        ${item.is_mot_failure ? '<td class="mot-cell">MOT</td>' : '<td class="mot-cell"></td>'}
        ${showPrice ? `<td class="price-cell">${formatCurrency(item.total_price)}</td>` : ''}
      </tr>
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

  <!-- Items OK (Green) -->
  ${results.filter(r => r.rag_status === 'green').length > 0 ? `
    <div class="section">
      <div class="section-header green">
        <span class="section-title">Items Checked OK</span>
        <span class="section-stats">${results.filter(r => r.rag_status === 'green').length} items</span>
      </div>
      <div class="section-content">
        <div class="green-list">
          ${results.filter(r => r.rag_status === 'green').map(r => `
            <div class="green-item">
              <span class="green-check">✓</span>
              <span>${r.template_item?.name || 'Item'}</span>
            </div>
          `).join('')}
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

  <!-- Signature Section -->
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

export type { HealthCheckPDFData }
