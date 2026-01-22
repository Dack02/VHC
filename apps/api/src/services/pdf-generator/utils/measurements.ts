/**
 * PDF Generator Measurement Utilities
 * Generates HTML for tyre and brake measurement details
 */

import { renderTyreDetailsCard } from '../components/measurements/tyre-details-card.js'
import { renderBrakeMeasurementCard } from '../components/measurements/brake-card.js'

interface MeasurementOptions {
  itemName?: string
  ragStatus?: 'green' | 'amber' | 'red'
}

// Tyre specification data to merge with depth measurements
export interface TyreSpecData {
  manufacturerName?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
}

/**
 * Generate HTML for tyre depth measurement details
 * Optionally merges with tyre specification data from tyre_details item
 */
export function getTyreDetails(
  value: Record<string, unknown> | null | undefined,
  options?: MeasurementOptions,
  specs?: TyreSpecData | null
): string {
  if (!value) return ''

  // Merge depth measurements with specs if provided
  const mergedValue = specs ? {
    ...value,
    manufacturer: specs.manufacturerName || value.manufacturer,
    manufacturerName: specs.manufacturerName || value.manufacturerName,
    size: specs.size || value.size,
    speedRating: specs.speedRating || value.speedRating,
    loadRating: specs.loadRating || value.loadRating,
    runFlat: specs.runFlat ?? value.runFlat
  } : value

  // Use the detailed tyre card component with labeled specs
  return renderTyreDetailsCard({
    itemName: options?.itemName,
    value: mergedValue,
    ragStatus: options?.ragStatus
  })
}

/**
 * Generate HTML for brake measurement details
 */
export function getBrakeDetails(
  value: Record<string, unknown> | null | undefined,
  options?: MeasurementOptions
): string {
  if (!value) return ''

  // Use the new visual brake card component
  return renderBrakeMeasurementCard({
    itemName: options?.itemName,
    value,
    ragStatus: options?.ragStatus
  })
}
