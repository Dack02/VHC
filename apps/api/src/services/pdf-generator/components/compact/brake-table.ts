/**
 * Compact Brake Table Component
 * Two-column table showing front and rear brake measurements
 */

import type { ResultData } from '../../types.js'

interface BrakeSideData {
  pad: number | null
  disc: number | null
  disc_min: number | null
}

interface BrakeAxleData {
  axle: 'front' | 'rear'
  type: 'disc' | 'drum'
  nearside: BrakeSideData
  offside: BrakeSideData
  hasData: boolean
}

/**
 * Extract brake data from check results
 */
export function extractBrakeData(results: ResultData[]): { front: BrakeAxleData | null; rear: BrakeAxleData | null } {
  const brakeResults = results.filter(r =>
    r.template_item?.item_type === 'brake_measurement' ||
    r.template_item?.name?.toLowerCase().includes('brake')
  )

  const extractAxle = (axle: 'front' | 'rear'): BrakeAxleData | null => {
    const result = brakeResults.find(r => {
      const name = r.template_item?.name?.toLowerCase() || ''
      return name.includes(axle)
    })

    if (!result?.value) return null

    const value = result.value as Record<string, unknown>

    // Handle nested format (nearside/offside objects)
    if (value.nearside || value.offside) {
      const nearside = (value.nearside as Record<string, unknown>) || {}
      const offside = (value.offside as Record<string, unknown>) || {}

      return {
        axle,
        type: (value.brake_type as 'disc' | 'drum') || 'disc',
        nearside: {
          pad: nearside.pad as number | null ?? null,
          disc: nearside.disc as number | null ?? null,
          disc_min: nearside.disc_min as number | null ?? null
        },
        offside: {
          pad: offside.pad as number | null ?? null,
          disc: offside.disc as number | null ?? null,
          disc_min: offside.disc_min as number | null ?? null
        },
        hasData: true
      }
    }

    // Handle flat format (ns_pad, os_pad, etc.)
    return {
      axle,
      type: (value.type as 'disc' | 'drum') || 'disc',
      nearside: {
        pad: value.ns_pad as number | null ?? null,
        disc: value.ns_disc as number | null ?? null,
        disc_min: value.ns_disc_min as number | null ?? null
      },
      offside: {
        pad: value.os_pad as number | null ?? null,
        disc: value.os_disc as number | null ?? null,
        disc_min: value.os_disc_min as number | null ?? null
      },
      hasData: true
    }
  }

  return {
    front: extractAxle('front'),
    rear: extractAxle('rear')
  }
}

/**
 * Format measurement value
 */
function formatValue(value: number | null): string {
  if (value === null) return '—'
  return value.toFixed(1)
}

/**
 * Check if disc is below minimum spec
 */
function isBelowMinSpec(actual: number | null, min: number | null): boolean {
  if (actual === null || min === null) return false
  return actual < min
}

/**
 * Render a single axle column
 */
function renderAxleColumn(data: BrakeAxleData | null, label: string): string {
  if (!data || !data.hasData) {
    return `
      <div class="brake-axle">
        <div class="brake-axle-header">
          <span>${label}</span>
          <span>—</span>
        </div>
        <div class="brake-no-data">No data recorded</div>
      </div>
    `
  }

  const { type, nearside, offside } = data

  // Check for any below-spec conditions
  const nsDiscBelowSpec = isBelowMinSpec(nearside.disc, nearside.disc_min)
  const osDiscBelowSpec = isBelowMinSpec(offside.disc, offside.disc_min)
  const hasAlert = type === 'disc' && (nsDiscBelowSpec || osDiscBelowSpec)

  // Get the min spec to display (use offside if nearside is null)
  const minSpec = nearside.disc_min ?? offside.disc_min

  return `
    <div class="brake-axle">
      <div class="brake-axle-header">
        <span>${label}</span>
        <span style="font-weight: normal; font-size: 7px; color: #6b7280;">${type === 'disc' ? 'Disc' : 'Drum'}</span>
      </div>
      <table class="brake-table">
        <thead>
          <tr>
            <th></th>
            <th>Nearside</th>
            <th>Offside</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${type === 'disc' ? 'Pad' : 'Shoe'}</td>
            <td class="brake-value ok">${formatValue(nearside.pad)}</td>
            <td class="brake-value ok">${formatValue(offside.pad)}</td>
          </tr>
          ${type === 'disc' ? `
            <tr>
              <td>Disc</td>
              <td class="brake-value ${nsDiscBelowSpec ? 'critical' : 'ok'}">${formatValue(nearside.disc)}</td>
              <td class="brake-value ${osDiscBelowSpec ? 'critical' : 'ok'}">${formatValue(offside.disc)}</td>
            </tr>
            <tr>
              <td>Min spec</td>
              <td colspan="2" style="text-align: center; color: #6b7280;">${formatValue(minSpec)}</td>
            </tr>
          ` : ''}
        </tbody>
      </table>
      ${hasAlert ? `
        <div class="brake-alert">
          &#9888; Discs below minimum — replacement required
        </div>
      ` : ''}
    </div>
  `
}

/**
 * Render the compact brake measurements table
 */
export function renderBrakeTable(results: ResultData[]): string {
  const { front, rear } = extractBrakeData(results)

  // If no brake data at all, show message
  if (!front && !rear) {
    return `
      <div class="measurement-card">
        <div class="measurement-header">
          <div class="measurement-title">Brake Measurements</div>
        </div>
        <div class="measurement-content">
          <div class="brake-no-data">No brake measurements recorded</div>
        </div>
      </div>
    `
  }

  return `
    <div class="measurement-card">
      <div class="measurement-header">
        <div class="measurement-title">Brake Measurements</div>
        <div class="measurement-legend">Thickness in mm</div>
      </div>
      <div class="measurement-content">
        <div class="brake-table-container">
          ${renderAxleColumn(front, 'Front Brakes')}
          ${renderAxleColumn(rear, 'Rear Brakes')}
        </div>
      </div>
    </div>
  `
}
