/**
 * Header Component
 * Renders the PDF header with logo, title, and site info
 */

import type { HealthCheckPDFData } from '../types.js'
import { formatDate } from '../utils/formatters.js'

interface HeaderOptions {
  data: HealthCheckPDFData
  logoUrl: string | null | undefined
  organizationName: string
}

export function renderHeader({ data, logoUrl, organizationName }: HeaderOptions): string {
  const { site } = data

  return `
    <div class="header">
      <div class="header-left">
        ${logoUrl ? `<img src="${logoUrl}" alt="${organizationName}" class="header-logo" />` : ''}
        <h1>Vehicle Health Check Report</h1>
        ${data.vhc_reference ? `<div class="vhc-ref">Ref: ${data.vhc_reference}</div>` : ''}
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
  `
}
