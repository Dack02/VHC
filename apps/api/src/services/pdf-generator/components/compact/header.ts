/**
 * Compact Header Component
 * Slim horizontal bar with logo, title, site name, reference, and date
 */

import type { HealthCheckPDFData } from '../../types.js'
import { formatDate } from '../../utils/formatters.js'

interface CompactHeaderOptions {
  data: HealthCheckPDFData
  logoUrl?: string | null
  organizationName: string
}

export function renderCompactHeader({ data, logoUrl, organizationName }: CompactHeaderOptions): string {
  const siteName = data.site?.name || ''
  const reference = data.vhc_reference || `VHC${data.id.slice(0, 8).toUpperCase()}`
  const reportDate = formatDate(new Date().toISOString())

  // Create a short org name for logo placeholder (max 2 lines of 4 chars)
  const shortOrgName = organizationName
    .split(' ')
    .slice(0, 2)
    .map(w => w.slice(0, 4).toUpperCase())
    .join('\n')

  return `
    <div class="compact-header">
      <div class="header-left">
        ${logoUrl
          ? `<img src="${logoUrl}" alt="${organizationName}" class="header-logo" />`
          : `<div class="header-logo-placeholder">${shortOrgName}</div>`
        }
        <div>
          <div class="header-title">Vehicle Health Check</div>
          <div class="header-subtitle">${siteName}</div>
        </div>
      </div>
      <div class="header-right">
        <div class="header-ref">${reference}</div>
        <div class="header-date">${reportDate}</div>
      </div>
    </div>
  `
}
