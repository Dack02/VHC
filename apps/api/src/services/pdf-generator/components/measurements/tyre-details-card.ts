/**
 * Tyre Details Card Component
 * Enhanced display of tyre specifications and tread depth measurements for PDF generation
 * Shows clearly labeled specs (Make, Size, Load Rating, Speed Rating) plus visual tread depth bars
 */

interface TyreDetailsCardOptions {
  itemName?: string
  value: Record<string, unknown> | null | undefined
  ragStatus?: 'green' | 'amber' | 'red'
  thresholds?: {
    redBelowMm: number
    amberBelowMm: number
  }
}

interface TyreData {
  outer: number | null
  middle: number | null
  inner: number | null
  manufacturer: string | null
  size: string | null
  speedRating: string | null
  loadRating: string | null
  runFlat: boolean
  damage: string | null
  damageSeverity: 'advisory' | 'urgent' | null
}

/**
 * Normalize tyre data to handle various formats
 */
function normalizeTyreData(value: Record<string, unknown>): TyreData {
  return {
    outer: (value.outer as number | null) ?? null,
    middle: (value.middle as number | null) ?? null,
    inner: (value.inner as number | null) ?? null,
    manufacturer: (value.manufacturerName as string) || (value.manufacturer as string) || null,
    size: (value.size as string) || null,
    speedRating: (value.speedRating as string) || (value.speed_rating as string) || null,
    loadRating: (value.loadRating as string) || (value.load_rating as string) || null,
    runFlat: Boolean(value.runFlat || value.run_flat),
    damage: (value.damage as string) || null,
    damageSeverity: (value.damageSeverity as 'advisory' | 'urgent') || null
  }
}

/**
 * Get color for tread depth value
 */
function getTreadColor(value: number | null, thresholds: { red: number; amber: number }): string {
  if (value === null) return '#6b7280' // gray
  if (value < thresholds.red) return '#dc2626' // red
  if (value < thresholds.amber) return '#d97706' // amber
  return '#16a34a' // green
}

/**
 * Format measurement value for display
 */
function formatMm(value: number | null): string {
  if (value === null) return '-'
  return `${value.toFixed(1)}`
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
 * Calculate bar width as percentage (max 10mm = 100%)
 */
function getBarWidth(value: number | null): number {
  if (value === null) return 0
  return Math.min(100, (value / 10) * 100)
}

/**
 * Parse tyre position from item name
 */
function parsePosition(itemName?: string): string {
  if (!itemName) return 'TYRE'

  const lower = itemName.toLowerCase()

  // Check for specific positions
  if (lower.includes('front') && lower.includes('left')) return 'FRONT LEFT TYRE'
  if (lower.includes('front') && lower.includes('right')) return 'FRONT RIGHT TYRE'
  if (lower.includes('rear') && lower.includes('left')) return 'REAR LEFT TYRE'
  if (lower.includes('rear') && lower.includes('right')) return 'REAR RIGHT TYRE'

  // Check for N/S O/S naming
  if (lower.includes('n/s') && lower.includes('front')) return 'N/S FRONT TYRE'
  if (lower.includes('o/s') && lower.includes('front')) return 'O/S FRONT TYRE'
  if (lower.includes('n/s') && lower.includes('rear')) return 'N/S REAR TYRE'
  if (lower.includes('o/s') && lower.includes('rear')) return 'O/S REAR TYRE'

  // Generic front/rear
  if (lower.includes('front')) return 'FRONT TYRE'
  if (lower.includes('rear')) return 'REAR TYRE'

  return itemName.toUpperCase()
}

/**
 * Render a spec row for the specifications table
 */
function renderSpecRow(label: string, value: string | null): string {
  if (!value) return ''
  return `
    <tr>
      <td style="padding: 4px 8px; font-size: 10px; color: #6b7280; font-weight: 500; border-bottom: 1px solid #f3f4f6; width: 40%;">${label}</td>
      <td style="padding: 4px 8px; font-size: 11px; color: #1f2937; font-weight: 600; border-bottom: 1px solid #f3f4f6;">${value}</td>
    </tr>
  `
}

/**
 * Render tread depth bar
 */
function renderTreadBar(
  label: string,
  value: number | null,
  thresholds: { red: number; amber: number }
): string {
  const color = getTreadColor(value, thresholds)
  const width = getBarWidth(value)

  return `
    <div style="flex: 1; text-align: center;">
      <div style="font-size: 9px; color: #6b7280; text-transform: uppercase; margin-bottom: 4px;">${label}</div>
      <div style="font-size: 14px; font-weight: 600; color: ${color}; font-family: monospace; margin-bottom: 4px;">
        ${formatMm(value)}${value !== null ? 'mm' : ''}
      </div>
      <div style="height: 8px; background: #e5e7eb; position: relative;">
        <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${width}%; background: ${color};"></div>
        <!-- Legal limit marker at 1.6mm (16%) -->
        <div style="position: absolute; left: 16%; top: -2px; bottom: -2px; width: 2px; background: #dc2626;"></div>
      </div>
    </div>
  `
}

/**
 * Render the complete tyre details card with expanded specifications
 */
export function renderTyreDetailsCard(options: TyreDetailsCardOptions): string {
  const { itemName, value, ragStatus, thresholds = { redBelowMm: 2, amberBelowMm: 4 } } = options

  if (!value) return ''

  const data = normalizeTyreData(value)

  // Check if we have any measurements
  if (data.outer === null && data.middle === null && data.inner === null) return ''

  const positionLabel = parsePosition(itemName)

  // Calculate lowest reading and remaining legal tread
  const readings = [data.outer, data.middle, data.inner].filter((v): v is number => v !== null)
  const lowestReading = readings.length > 0 ? Math.min(...readings) : null
  const remainingLegal = lowestReading !== null ? Math.max(0, lowestReading - 1.6) : null
  const belowLegal = lowestReading !== null && lowestReading < 1.6

  const treadThresholds = { red: thresholds.redBelowMm, amber: thresholds.amberBelowMm }

  // Check if we have any specs to display
  const hasSpecs = data.manufacturer || data.size || data.loadRating || data.speedRating

  return `
    <div class="tyre-details-card" style="margin-top: 8px; border: 2px solid ${ragStatus === 'red' ? '#dc2626' : ragStatus === 'amber' ? '#d97706' : '#e5e7eb'}; background: white;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: ${ragStatus === 'red' ? '#fef2f2' : ragStatus === 'amber' ? '#fffbeb' : '#f9fafb'}; border-bottom: 1px solid #e5e7eb;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 600; font-size: 11px; color: #1f2937;">${positionLabel}</span>
          ${data.runFlat ? '<span style="background: #3b82f6; color: white; font-size: 8px; font-weight: 600; padding: 2px 6px;">RUN FLAT</span>' : ''}
        </div>
        ${getRagBadge(ragStatus)}
      </div>

      <!-- Tyre Specifications Table -->
      ${hasSpecs ? `
        <div style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">
          <div style="font-size: 9px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; font-weight: 500; letter-spacing: 0.5px;">Tyre Specifications</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${renderSpecRow('Make', data.manufacturer)}
              ${renderSpecRow('Size', data.size)}
              ${renderSpecRow('Load Rating', data.loadRating)}
              ${renderSpecRow('Speed Rating', data.speedRating)}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Damage Alert -->
      ${data.damage && data.damage !== 'None' ? `
        <div style="padding: 8px 12px; background: ${data.damageSeverity === 'urgent' ? '#fef2f2' : '#fffbeb'}; border-bottom: 1px solid ${data.damageSeverity === 'urgent' ? '#fecaca' : '#fde68a'};">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 10px; font-weight: 600; color: ${data.damageSeverity === 'urgent' ? '#dc2626' : '#d97706'};">
              ${data.damageSeverity === 'urgent' ? 'URGENT' : 'ADVISORY'} - ${data.damage}
            </span>
          </div>
        </div>
      ` : ''}

      <!-- Tread Depth Measurements -->
      <div style="padding: 12px;">
        <div style="font-size: 9px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; font-weight: 500; letter-spacing: 0.5px;">Tread Depth</div>

        <div style="display: flex; gap: 12px;">
          ${renderTreadBar('Outer', data.outer, treadThresholds)}
          ${renderTreadBar('Middle', data.middle, treadThresholds)}
          ${renderTreadBar('Inner', data.inner, treadThresholds)}
        </div>

        <!-- Remaining Legal Tread -->
        ${remainingLegal !== null ? `
          <div style="margin-top: 12px; padding: 8px; background: ${belowLegal ? '#fef2f2' : '#f0fdf4'}; border: 1px solid ${belowLegal ? '#fecaca' : '#bbf7d0'}; text-align: center;">
            <span style="font-size: 10px; color: ${belowLegal ? '#dc2626' : '#16a34a'}; font-weight: 500;">
              ${belowLegal
                ? 'BELOW LEGAL LIMIT (1.6mm)'
                : `✓ Remaining Legal Tread: ${remainingLegal.toFixed(1)}mm`
              }
            </span>
          </div>
        ` : ''}
      </div>
    </div>
  `
}

/**
 * Get CSS styles for tyre details cards
 */
export function getTyreDetailsCardStyles(): string {
  return `
    .tyre-details-card {
      page-break-inside: avoid;
    }
  `
}
