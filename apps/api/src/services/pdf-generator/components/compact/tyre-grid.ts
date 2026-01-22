/**
 * Compact Tyre Grid Component
 * 2x2 grid showing all four tyres with depth readings and status dots
 */

import type { ResultData } from '../../types.js'

// Tyre position keys
type TyrePosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'

interface TyreReading {
  outer: number | null
  middle: number | null
  inner: number | null
}

interface TyreData {
  position: TyrePosition
  label: string
  readings: TyreReading
  status: 'green' | 'amber' | 'red'
  minReading: number | null
}

// Legal minimum tread depth in mm
const LEGAL_MIN = 1.6
const AMBER_THRESHOLD = 3.0

/**
 * Extract tyre data from check results
 */
export function extractTyreData(results: ResultData[]): TyreData[] {
  const tyres: TyreData[] = []

  // Find tyre depth results
  const tyreResults = results.filter(r =>
    r.template_item?.item_type === 'tyre_depth' ||
    r.template_item?.name?.toLowerCase().includes('tyre')
  )

  // Position mapping
  const positionMap: Record<TyrePosition, string[]> = {
    front_left: ['front left', 'front n/s', 'n/s front', 'fl'],
    front_right: ['front right', 'front o/s', 'o/s front', 'fr'],
    rear_left: ['rear left', 'rear n/s', 'n/s rear', 'rl'],
    rear_right: ['rear right', 'rear o/s', 'o/s rear', 'rr']
  }

  const positionLabels: Record<TyrePosition, string> = {
    front_left: 'Front Left',
    front_right: 'Front Right',
    rear_left: 'Rear Left',
    rear_right: 'Rear Right'
  }

  // Process each position
  for (const [position, keywords] of Object.entries(positionMap) as [TyrePosition, string[]][]) {
    const result = tyreResults.find(r => {
      const name = r.template_item?.name?.toLowerCase() || ''
      return keywords.some(kw => name.includes(kw))
    })

    if (result?.value) {
      const value = result.value as Record<string, unknown>
      const readings: TyreReading = {
        outer: typeof value.outer === 'number' ? value.outer : null,
        middle: typeof value.middle === 'number' ? value.middle : null,
        inner: typeof value.inner === 'number' ? value.inner : null
      }

      // Calculate minimum reading
      const validReadings = [readings.outer, readings.middle, readings.inner].filter(
        (v): v is number => v !== null
      )
      const minReading = validReadings.length > 0 ? Math.min(...validReadings) : null

      // Determine status
      let status: 'green' | 'amber' | 'red' = 'green'
      if (minReading !== null) {
        if (minReading < LEGAL_MIN) {
          status = 'red'
        } else if (minReading < AMBER_THRESHOLD) {
          status = 'amber'
        }
      }

      tyres.push({
        position,
        label: positionLabels[position],
        readings,
        status,
        minReading
      })
    }
  }

  return tyres
}

/**
 * Format tyre depth reading for display
 */
function formatReading(value: number | null): string {
  if (value === null) return '—'
  // Mark critical readings (below legal minimum)
  const isCritical = value < LEGAL_MIN
  const displayValue = value.toFixed(1)
  return isCritical ? `<span class="critical">${displayValue}</span>` : displayValue
}

/**
 * Render a single tyre cell
 */
function renderTyreCell(tyre: TyreData): string {
  const { label, readings, status } = tyre

  // Determine cell styling class
  const cellClass = status === 'red' ? 'urgent' : status === 'amber' ? 'advisory' : ''

  // Format depth readings
  const outerStr = formatReading(readings.outer)
  const middleStr = formatReading(readings.middle)
  const innerStr = formatReading(readings.inner)

  return `
    <div class="tyre-cell ${cellClass}">
      <div class="tyre-position">${label}</div>
      <div class="tyre-readings">
        <div class="tyre-depths">${outerStr} / ${middleStr} / ${innerStr}</div>
        <div class="tyre-status ${status}"></div>
      </div>
    </div>
  `
}

/**
 * Render the compact tyre grid
 */
export function renderTyreGrid(results: ResultData[]): string {
  const tyres = extractTyreData(results)

  // If no tyre data, show message
  if (tyres.length === 0) {
    return `
      <div class="measurement-card">
        <div class="measurement-header">
          <div class="measurement-title">Tyre Tread Depth</div>
        </div>
        <div class="measurement-content">
          <div class="brake-no-data">No tyre measurements recorded</div>
        </div>
      </div>
    `
  }

  // Position order for grid layout (FL, FR, RL, RR)
  const positionOrder: TyrePosition[] = ['front_left', 'front_right', 'rear_left', 'rear_right']

  // Create placeholder for missing tyres
  const placeholderTyre = (position: TyrePosition, label: string): TyreData => ({
    position,
    label,
    readings: { outer: null, middle: null, inner: null },
    status: 'green',
    minReading: null
  })

  // Ensure all 4 positions exist
  const allTyres: TyreData[] = positionOrder.map((pos, i) => {
    const labels = ['Front Left', 'Front Right', 'Rear Left', 'Rear Right']
    return tyres.find(t => t.position === pos) || placeholderTyre(pos, labels[i])
  })

  return `
    <div class="measurement-card">
      <div class="measurement-header">
        <div class="measurement-title">Tyre Tread Depth</div>
        <div class="measurement-legend">Outer / Middle / Inner (mm) &bull; Legal min: ${LEGAL_MIN}mm</div>
      </div>
      <div class="measurement-content">
        <div class="tyre-grid">
          ${allTyres.map(tyre => renderTyreCell(tyre)).join('')}
        </div>
      </div>
    </div>
  `
}
