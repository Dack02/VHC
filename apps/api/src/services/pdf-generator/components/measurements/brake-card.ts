/**
 * Brake Measurement Card Component
 * Visual display of brake pad and disc measurements for PDF generation
 */

interface BrakeSideData {
  pad: number | null
  disc: number | null
  disc_min: number | null
}

interface BrakeCardOptions {
  itemName?: string
  value: Record<string, unknown> | null | undefined
  ragStatus?: 'green' | 'amber' | 'red'
  thresholds?: {
    padRedBelowMm: number
    padAmberBelowMm: number
  }
}

/**
 * Normalize brake data to handle both flat and nested formats
 * Flat format: { ns_pad, os_pad, ns_disc, os_disc, ns_disc_min, os_disc_min, type }
 * Nested format: { nearside: { pad, disc, disc_min }, offside: { pad, disc, disc_min }, brake_type }
 */
function normalizeBrakeData(value: Record<string, unknown>): {
  brakeType: 'disc' | 'drum'
  nearside: BrakeSideData
  offside: BrakeSideData
} {
  // Check for nested format first
  if (value.nearside || value.offside) {
    const nearside = (value.nearside as Record<string, unknown>) || {}
    const offside = (value.offside as Record<string, unknown>) || {}
    return {
      brakeType: (value.brake_type as 'disc' | 'drum') || 'disc',
      nearside: {
        pad: nearside.pad as number | null ?? null,
        disc: nearside.disc as number | null ?? null,
        disc_min: nearside.disc_min as number | null ?? null
      },
      offside: {
        pad: offside.pad as number | null ?? null,
        disc: offside.disc as number | null ?? null,
        disc_min: offside.disc_min as number | null ?? null
      }
    }
  }

  // Flat format
  return {
    brakeType: (value.type as 'disc' | 'drum') || 'disc',
    nearside: {
      pad: value.ns_pad as number | null ?? null,
      disc: value.ns_disc as number | null ?? null,
      disc_min: value.ns_disc_min as number | null ?? null
    },
    offside: {
      pad: value.os_pad as number | null ?? null,
      disc: value.os_disc as number | null ?? null,
      disc_min: value.os_disc_min as number | null ?? null
    }
  }
}

/**
 * Get color for measurement value based on thresholds
 */
function getPadColor(value: number | null, thresholds: { red: number; amber: number }): string {
  if (value === null) return '#6b7280' // gray
  if (value < thresholds.red) return '#dc2626' // red
  if (value < thresholds.amber) return '#d97706' // amber
  return '#16a34a' // green
}

/**
 * Check if disc needs replacement
 */
function discNeedsReplacement(actual: number | null, min: number | null): boolean {
  if (actual === null || min === null) return false
  return actual < min
}

/**
 * Format measurement value for display
 */
function formatMm(value: number | null): string {
  if (value === null) return '-'
  return `${value.toFixed(1)}mm`
}

/**
 * Get RAG badge HTML
 */
function getRagBadge(status: 'green' | 'amber' | 'red' | undefined): string {
  if (!status) return ''
  const colors = {
    red: { bg: '#dc2626', text: 'URGENT' },
    amber: { bg: '#d97706', text: 'ADVISORY' },
    green: { bg: '#16a34a', text: 'OK' }
  }
  const { bg, text } = colors[status]
  return `<span style="background: ${bg}; color: white; font-size: 9px; font-weight: 600; padding: 2px 8px; text-transform: uppercase;">${text}</span>`
}

/**
 * Render a single side measurement box
 */
function renderSideBox(
  label: string,
  data: BrakeSideData,
  brakeType: 'disc' | 'drum',
  thresholds: { red: number; amber: number }
): string {
  // Drum with no pad measurement = visual inspection only
  if (brakeType === 'drum' && data.pad === null) {
    return `
      <div style="flex: 1; border: 1px solid #e5e7eb; padding: 12px; background: #fafafa;">
        <div style="font-weight: 600; font-size: 10px; text-transform: uppercase; color: #374151; margin-bottom: 10px; text-align: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
          ${label}
        </div>
        <div style="text-align: center; padding: 8px 0;">
          <span style="color: #16a34a; font-size: 10px; font-weight: 600;">VISUAL ONLY</span>
        </div>
      </div>
    `
  }

  const padColor = getPadColor(data.pad, thresholds)
  const needsDiscReplacement = brakeType === 'disc' && discNeedsReplacement(data.disc, data.disc_min)
  const discColor = needsDiscReplacement ? '#dc2626' : '#16a34a'

  return `
    <div style="flex: 1; border: 1px solid #e5e7eb; padding: 12px; background: #fafafa;">
      <div style="font-weight: 600; font-size: 10px; text-transform: uppercase; color: #374151; margin-bottom: 10px; text-align: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px;">
        ${label}
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <!-- Pad Measurement -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 10px; color: #6b7280;">${brakeType === 'drum' ? 'Shoe:' : 'Pad:'}</span>
          <span style="font-size: 13px; font-weight: 600; color: ${padColor}; font-family: monospace;">${formatMm(data.pad)}</span>
        </div>

        ${brakeType === 'disc' ? `
          <!-- Disc Measurement -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 10px; color: #6b7280;">Disc:</span>
            <span style="font-size: 13px; font-weight: 600; color: ${discColor}; font-family: monospace;">${formatMm(data.disc)}</span>
          </div>

          <!-- Min Spec -->
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 10px; color: #6b7280;">Min Spec:</span>
            <span style="font-size: 11px; color: #6b7280; font-family: monospace;">${formatMm(data.disc_min)}</span>
          </div>

          <!-- Status -->
          <div style="margin-top: 4px; padding-top: 8px; border-top: 1px solid #e5e7eb; text-align: center;">
            ${needsDiscReplacement
              ? '<span style="color: #dc2626; font-size: 9px; font-weight: 600;">REPLACE DISC</span>'
              : '<span style="color: #16a34a; font-size: 9px; font-weight: 600;">OK</span>'
            }
          </div>
        ` : ''}
      </div>
    </div>
  `
}

/**
 * Render the complete brake measurement card
 */
export function renderBrakeMeasurementCard(options: BrakeCardOptions): string {
  const { itemName, value, ragStatus, thresholds = { padRedBelowMm: 3, padAmberBelowMm: 5 } } = options

  if (!value) return ''

  const { brakeType, nearside, offside } = normalizeBrakeData(value)

  // Check if we have any measurements (drum with null pads is valid — visual inspection)
  if (brakeType !== 'drum' && nearside.pad === null && offside.pad === null) return ''

  // Determine position from item name
  let positionLabel = 'BRAKES'
  if (itemName) {
    const lower = itemName.toLowerCase()
    if (lower.includes('front')) positionLabel = 'FRONT BRAKES'
    else if (lower.includes('rear')) positionLabel = 'REAR BRAKES'
  }

  // Check for any alerts
  const hasReplacementAlert = brakeType === 'disc' && (
    discNeedsReplacement(nearside.disc, nearside.disc_min) ||
    discNeedsReplacement(offside.disc, offside.disc_min)
  )

  const padThresholds = { red: thresholds.padRedBelowMm, amber: thresholds.padAmberBelowMm }

  return `
    <div class="brake-measurement-card" style="margin-top: 8px; border: 2px solid ${ragStatus === 'red' ? '#dc2626' : ragStatus === 'amber' ? '#d97706' : '#e5e7eb'}; background: white;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: ${ragStatus === 'red' ? '#fef2f2' : ragStatus === 'amber' ? '#fffbeb' : '#f9fafb'}; border-bottom: 1px solid #e5e7eb;">
        <div style="font-weight: 600; font-size: 11px; color: #1f2937;">
          ${positionLabel} <span style="font-weight: normal; color: #6b7280;">(${brakeType === 'drum' ? 'Drum' : 'Disc'})</span>
        </div>
        ${getRagBadge(ragStatus)}
      </div>

      <!-- Measurements Grid -->
      <div style="display: flex; gap: 12px; padding: 12px;">
        ${renderSideBox('NEARSIDE (N/S)', nearside, brakeType, padThresholds)}
        ${renderSideBox('OFFSIDE (O/S)', offside, brakeType, padThresholds)}
      </div>

      ${hasReplacementAlert ? `
        <!-- Replacement Alert -->
        <div style="background: #fef2f2; border-top: 1px solid #fecaca; padding: 8px 12px; text-align: center;">
          <span style="color: #dc2626; font-size: 10px; font-weight: 600;">DISC REPLACEMENT REQUIRED</span>
        </div>
      ` : ''}
    </div>
  `
}

/**
 * Get CSS styles for brake measurement cards
 */
export function getBrakeCardStyles(): string {
  return `
    .brake-measurement-card {
      page-break-inside: avoid;
    }
  `
}
