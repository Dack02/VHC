/**
 * Vehicle Summary Component
 * Displays all tyre and brake measurements regardless of RAG status
 * Provides a comprehensive overview of safety-critical measurements
 */

import type { ResultData } from '../types.js'
import { renderTyreDetailsCard } from './measurements/tyre-details-card.js'
import { renderBrakeMeasurementCard } from './measurements/brake-card.js'

type TyrePosition = 'front-left' | 'front-right' | 'rear-left' | 'rear-right'
type BrakePosition = 'front' | 'rear'

/**
 * Parse tyre position from item name
 */
function parseTyrePosition(itemName: string): TyrePosition | null {
  const lower = itemName.toLowerCase()

  // Check for specific positions
  if (lower.includes('front') && (lower.includes('left') || lower.includes('n/s'))) return 'front-left'
  if (lower.includes('front') && (lower.includes('right') || lower.includes('o/s'))) return 'front-right'
  if (lower.includes('rear') && (lower.includes('left') || lower.includes('n/s'))) return 'rear-left'
  if (lower.includes('rear') && (lower.includes('right') || lower.includes('o/s'))) return 'rear-right'

  // Check for N/S O/S at beginning (e.g., "N/S Front Tyre")
  if (lower.includes('n/s') && lower.includes('front')) return 'front-left'
  if (lower.includes('o/s') && lower.includes('front')) return 'front-right'
  if (lower.includes('n/s') && lower.includes('rear')) return 'rear-left'
  if (lower.includes('o/s') && lower.includes('rear')) return 'rear-right'

  return null
}

/**
 * Parse brake position from item name
 */
function parseBrakePosition(itemName: string): BrakePosition | null {
  const lower = itemName.toLowerCase()
  if (lower.includes('front')) return 'front'
  if (lower.includes('rear')) return 'rear'
  return null
}

// Map position keys for tyre_details lookup (uses underscores)
type TyreDetailsKey = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'

const positionToDetailsKey: Record<TyrePosition, TyreDetailsKey> = {
  'front-left': 'front_left',
  'front-right': 'front_right',
  'rear-left': 'rear_left',
  'rear-right': 'rear_right'
}

// Tyre specification data from tyre_details item
interface TyreSpecData {
  manufacturerName?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
}

/**
 * Render the vehicle summary section showing all tyre and brake measurements
 */
export function renderVehicleSummary(results: ResultData[]): string {
  // Filter tyre and brake results
  const tyreResults = results.filter(r => r.template_item?.item_type === 'tyre_depth' && r.value)
  const brakeResults = results.filter(r => r.template_item?.item_type === 'brake_measurement' && r.value)

  // Find tyre_details result (contains specs for all 4 tyres)
  const tyreDetailsResult = results.find(r => r.template_item?.item_type === 'tyre_details' && r.value)
  const tyreDetailsValue = tyreDetailsResult?.value as Record<string, TyreSpecData> | undefined

  // If no tyre or brake measurements, don't render the section
  if (tyreResults.length === 0 && brakeResults.length === 0) {
    return ''
  }

  // Group tyres by position
  const tyresByPosition = new Map<TyrePosition, ResultData>()
  for (const result of tyreResults) {
    const position = parseTyrePosition(result.template_item?.name || '')
    if (position) {
      tyresByPosition.set(position, result)
    }
  }

  // Group brakes by position
  const brakesByPosition = new Map<BrakePosition, ResultData>()
  for (const result of brakeResults) {
    const position = parseBrakePosition(result.template_item?.name || '')
    if (position) {
      brakesByPosition.set(position, result)
    }
  }

  // Render tyre card for a position (or empty placeholder)
  // Merges depth measurements with specs from tyre_details
  const renderTyreCell = (position: TyrePosition, label: string): string => {
    const result = tyresByPosition.get(position)
    if (!result) {
      return `
        <div class="vehicle-summary-cell">
          <div class="vehicle-summary-empty">${label} - No data</div>
        </div>
      `
    }

    // Get specs for this position from tyre_details
    const detailsKey = positionToDetailsKey[position]
    const specs = tyreDetailsValue?.[detailsKey]

    // Merge depth measurements with specs
    const mergedValue = {
      ...result.value,
      // Add specs if available (don't overwrite existing values)
      manufacturer: specs?.manufacturerName || (result.value as Record<string, unknown>)?.manufacturer,
      manufacturerName: specs?.manufacturerName || (result.value as Record<string, unknown>)?.manufacturerName,
      size: specs?.size || (result.value as Record<string, unknown>)?.size,
      speedRating: specs?.speedRating || (result.value as Record<string, unknown>)?.speedRating,
      loadRating: specs?.loadRating || (result.value as Record<string, unknown>)?.loadRating,
      runFlat: specs?.runFlat ?? (result.value as Record<string, unknown>)?.runFlat
    }

    return `
      <div class="vehicle-summary-cell">
        ${renderTyreDetailsCard({
          itemName: result.template_item?.name,
          value: mergedValue,
          ragStatus: result.rag_status
        })}
      </div>
    `
  }

  // Render brake card for a position (or empty placeholder)
  const renderBrakeCell = (position: BrakePosition, label: string): string => {
    const result = brakesByPosition.get(position)
    if (!result) {
      return `
        <div class="vehicle-summary-brake-cell">
          <div class="vehicle-summary-empty">${label} Brakes - No data</div>
        </div>
      `
    }
    return `
      <div class="vehicle-summary-brake-cell">
        ${renderBrakeMeasurementCard({
          itemName: result.template_item?.name,
          value: result.value,
          ragStatus: result.rag_status
        })}
      </div>
    `
  }

  // Build the HTML
  let html = `
    <div class="vehicle-summary-section">
      <div class="vehicle-summary-header">
        <span class="vehicle-summary-title">Vehicle Summary</span>
        <span class="vehicle-summary-subtitle">Safety-Critical Measurements</span>
      </div>
  `

  // Tyres section (if any)
  if (tyresByPosition.size > 0) {
    html += `
      <div class="vehicle-summary-subsection">
        <div class="vehicle-summary-subsection-header">
          <span class="vehicle-summary-subsection-title">Tyres</span>
          <span class="vehicle-summary-subsection-note">Legal minimum: 1.6mm tread depth</span>
        </div>
        <div class="vehicle-summary-tyre-grid">
          <div class="vehicle-summary-tyre-row">
            ${renderTyreCell('front-left', 'Front Left')}
            ${renderTyreCell('front-right', 'Front Right')}
          </div>
          <div class="vehicle-summary-tyre-row">
            ${renderTyreCell('rear-left', 'Rear Left')}
            ${renderTyreCell('rear-right', 'Rear Right')}
          </div>
        </div>
      </div>
    `
  }

  // Brakes section (if any)
  if (brakesByPosition.size > 0) {
    html += `
      <div class="vehicle-summary-subsection">
        <div class="vehicle-summary-subsection-header">
          <span class="vehicle-summary-subsection-title">Brakes</span>
        </div>
        <div class="vehicle-summary-brake-grid">
          ${renderBrakeCell('front', 'Front')}
          ${renderBrakeCell('rear', 'Rear')}
        </div>
      </div>
    `
  }

  html += `</div>`

  return html
}

/**
 * Get CSS styles for vehicle summary section
 */
export function getVehicleSummaryStyles(): string {
  return `
    .vehicle-summary-section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    .vehicle-summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: linear-gradient(to right, #1e40af, #1d4ed8);
      color: white;
      margin-bottom: 0;
    }

    .vehicle-summary-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .vehicle-summary-subtitle {
      font-size: 10px;
      opacity: 0.9;
    }

    .vehicle-summary-subsection {
      border: 1px solid #e5e7eb;
      border-top: none;
    }

    .vehicle-summary-subsection-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }

    .vehicle-summary-subsection-title {
      font-size: 12px;
      font-weight: 600;
      color: #1f2937;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .vehicle-summary-subsection-note {
      font-size: 9px;
      color: #6b7280;
    }

    .vehicle-summary-tyre-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .vehicle-summary-tyre-row {
      display: flex;
      gap: 0;
    }

    .vehicle-summary-cell {
      flex: 1;
      padding: 8px;
      border-right: 1px solid #e5e7eb;
      border-bottom: 1px solid #e5e7eb;
    }

    .vehicle-summary-cell:last-child {
      border-right: none;
    }

    .vehicle-summary-tyre-row:last-child .vehicle-summary-cell {
      border-bottom: none;
    }

    .vehicle-summary-brake-grid {
      display: flex;
      gap: 0;
    }

    .vehicle-summary-brake-cell {
      flex: 1;
      padding: 8px;
      border-right: 1px solid #e5e7eb;
    }

    .vehicle-summary-brake-cell:last-child {
      border-right: none;
    }

    .vehicle-summary-empty {
      padding: 20px;
      text-align: center;
      color: #9ca3af;
      font-size: 11px;
      font-style: italic;
      background: #f9fafb;
      border: 1px dashed #d1d5db;
    }

    /* Override card margins when inside vehicle summary */
    .vehicle-summary-cell .tyre-measurement-card,
    .vehicle-summary-cell .tyre-details-card,
    .vehicle-summary-cell .brake-measurement-card,
    .vehicle-summary-brake-cell .tyre-measurement-card,
    .vehicle-summary-brake-cell .tyre-details-card,
    .vehicle-summary-brake-cell .brake-measurement-card {
      margin-top: 0;
    }
  `
}
