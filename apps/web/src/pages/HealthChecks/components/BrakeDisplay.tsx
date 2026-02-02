/**
 * BrakeDisplay Component
 * Displays brake inspection data with pad and disc measurements
 * Styled to match TyreDisplay card format with warning banners and color-coded values
 */

type BrakeType = 'disc' | 'drum'

// Legacy format (flat fields)
interface AxleMeasurementLegacy {
  brake_type: BrakeType
  ns_pad: number | null
  ns_disc: number | null
  ns_disc_min: number | null
  os_pad: number | null
  os_disc: number | null
  os_disc_min: number | null
}

// New format from BrakeMeasurementInput (nested objects)
interface SideMeasurement {
  pad: number | null
  disc: number | null
  disc_min: number | null
  disc_unable_to_access?: boolean
}

interface AxleMeasurementNew {
  brake_type: BrakeType
  nearside: SideMeasurement
  offside: SideMeasurement
}

// Normalized format for display
interface AxleMeasurement {
  brake_type: BrakeType
  ns_pad: number | null
  ns_disc: number | null
  ns_disc_min: number | null
  ns_disc_unable_to_access?: boolean
  os_pad: number | null
  os_disc: number | null
  os_disc_min: number | null
  os_disc_unable_to_access?: boolean
}

// Can be legacy format with front/rear, or new single-axle format
interface BrakeData {
  front?: AxleMeasurementLegacy | AxleMeasurementNew
  rear?: AxleMeasurementLegacy | AxleMeasurementNew
  // New format fields (single axle data without front/rear wrapper)
  brake_type?: BrakeType
  nearside?: SideMeasurement
  offside?: SideMeasurement
  // Legacy single-axle flat fields
  ns_pad?: number | null
  os_pad?: number | null
  ns_disc?: number | null
  os_disc?: number | null
  ns_disc_min?: number | null
  os_disc_min?: number | null
}

interface BrakeDisplayProps {
  data: BrakeData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

// Pad thresholds (organization-wide settings)
const PAD_RED_THRESHOLD = 3    // mm - below this is red (urgent)
const PAD_AMBER_THRESHOLD = 5  // mm - below this is amber (advisory)

// Convert new format to normalized format
function normalizeAxleData(data: AxleMeasurementLegacy | AxleMeasurementNew | BrakeData): AxleMeasurement | null {
  if (!data) return null

  // Check for new nested format (nearside/offside objects)
  const newFormat = data as AxleMeasurementNew
  if (newFormat.nearside || newFormat.offside) {
    return {
      brake_type: newFormat.brake_type || 'disc',
      ns_pad: newFormat.nearside?.pad ?? null,
      ns_disc: newFormat.nearside?.disc ?? null,
      ns_disc_min: newFormat.nearside?.disc_min ?? null,
      ns_disc_unable_to_access: newFormat.nearside?.disc_unable_to_access,
      os_pad: newFormat.offside?.pad ?? null,
      os_disc: newFormat.offside?.disc ?? null,
      os_disc_min: newFormat.offside?.disc_min ?? null,
      os_disc_unable_to_access: newFormat.offside?.disc_unable_to_access
    }
  }

  // Legacy flat format
  const legacyFormat = data as AxleMeasurementLegacy
  if (legacyFormat.ns_pad !== undefined || legacyFormat.os_pad !== undefined ||
      legacyFormat.ns_disc !== undefined || legacyFormat.os_disc !== undefined) {
    return {
      brake_type: legacyFormat.brake_type || 'disc',
      ns_pad: legacyFormat.ns_pad ?? null,
      ns_disc: legacyFormat.ns_disc ?? null,
      ns_disc_min: legacyFormat.ns_disc_min ?? null,
      os_pad: legacyFormat.os_pad ?? null,
      os_disc: legacyFormat.os_disc ?? null,
      os_disc_min: legacyFormat.os_disc_min ?? null
    }
  }

  return null
}

// Calculate severity level for an axle
function getAxleSeverity(axle: AxleMeasurement): 'urgent' | 'advisory' | null {
  // Check disc replacement (most urgent) - skip if unable to access
  const nsDiscBelowMin = !axle.ns_disc_unable_to_access && axle.ns_disc !== null && axle.ns_disc_min !== null && axle.ns_disc < axle.ns_disc_min
  const osDiscBelowMin = !axle.os_disc_unable_to_access && axle.os_disc !== null && axle.os_disc_min !== null && axle.os_disc < axle.os_disc_min

  // Check pad levels
  const nsPadUrgent = axle.ns_pad !== null && axle.ns_pad < PAD_RED_THRESHOLD
  const osPadUrgent = axle.os_pad !== null && axle.os_pad < PAD_RED_THRESHOLD
  const nsPadAdvisory = axle.ns_pad !== null && axle.ns_pad < PAD_AMBER_THRESHOLD
  const osPadAdvisory = axle.os_pad !== null && axle.os_pad < PAD_AMBER_THRESHOLD

  if (nsDiscBelowMin || osDiscBelowMin || nsPadUrgent || osPadUrgent) {
    return 'urgent'
  }
  if (nsPadAdvisory || osPadAdvisory) {
    return 'advisory'
  }
  return null
}

// Get summary info for an axle
function getAxleSummary(axle: AxleMeasurement): { minSpec: number | null; lowest: number | null; diff: number | null; type: 'disc' | 'pad' } | null {
  const isDisc = axle.brake_type === 'disc'

  // For disc brakes, prioritize disc measurements if below spec (skip if unable to access)
  if (isDisc) {
    const nsDiscBelowMin = !axle.ns_disc_unable_to_access && axle.ns_disc !== null && axle.ns_disc_min !== null && axle.ns_disc < axle.ns_disc_min
    const osDiscBelowMin = !axle.os_disc_unable_to_access && axle.os_disc !== null && axle.os_disc_min !== null && axle.os_disc < axle.os_disc_min

    if (nsDiscBelowMin || osDiscBelowMin) {
      const discReadings: { value: number; min: number }[] = []
      if (!axle.ns_disc_unable_to_access && axle.ns_disc !== null && axle.ns_disc_min !== null) {
        discReadings.push({ value: axle.ns_disc, min: axle.ns_disc_min })
      }
      if (!axle.os_disc_unable_to_access && axle.os_disc !== null && axle.os_disc_min !== null) {
        discReadings.push({ value: axle.os_disc, min: axle.os_disc_min })
      }

      if (discReadings.length > 0) {
        // Find the reading furthest below spec
        const worstReading = discReadings.reduce((worst, current) => {
          const worstDiff = worst.value - worst.min
          const currentDiff = current.value - current.min
          return currentDiff < worstDiff ? current : worst
        })

        return {
          minSpec: worstReading.min,
          lowest: worstReading.value,
          diff: worstReading.value - worstReading.min,
          type: 'disc'
        }
      }
    }
  }

  // Check pad levels
  const padReadings = [axle.ns_pad, axle.os_pad].filter((v): v is number => v !== null)
  if (padReadings.length > 0) {
    const lowestPad = Math.min(...padReadings)
    const threshold = lowestPad < PAD_RED_THRESHOLD ? PAD_RED_THRESHOLD : PAD_AMBER_THRESHOLD

    if (lowestPad < PAD_AMBER_THRESHOLD) {
      return {
        minSpec: threshold,
        lowest: lowestPad,
        diff: lowestPad - threshold,
        type: 'pad'
      }
    }

    // Show positive info even if OK
    return {
      minSpec: PAD_AMBER_THRESHOLD,
      lowest: lowestPad,
      diff: lowestPad - PAD_AMBER_THRESHOLD,
      type: 'pad'
    }
  }

  return null
}

export function BrakeDisplay({ data, ragStatus }: BrakeDisplayProps) {
  if (!data) {
    return <div className="text-sm text-gray-500">No brake data recorded</div>
  }

  // Check if data is single-axle (no front/rear wrapper) vs multi-axle
  const isSingleAxle = !data.front && !data.rear && (
    data.nearside !== undefined || data.offside !== undefined ||
    data.ns_pad !== undefined || data.os_pad !== undefined ||
    data.brake_type !== undefined
  )

  if (isSingleAxle) {
    const axle = normalizeAxleData(data)
    if (!axle) {
      return <div className="text-sm text-gray-500">No brake measurements recorded</div>
    }

    const hasData = axle.brake_type === 'drum' ||
                    axle.ns_pad !== null || axle.os_pad !== null ||
                    axle.ns_disc !== null || axle.os_disc !== null

    if (!hasData) {
      return <div className="text-sm text-gray-500">No brake measurements recorded</div>
    }

    return (
      <div className="grid grid-cols-1 gap-4 max-w-sm">
        <AxleCard title="Brakes" axle={axle} ragStatus={ragStatus} />
      </div>
    )
  }

  // Multi-axle data (front/rear)
  const frontAxle = data.front ? normalizeAxleData(data.front) : null
  const rearAxle = data.rear ? normalizeAxleData(data.rear) : null

  const hasFront = frontAxle && (
    frontAxle.brake_type === 'drum' ||
    frontAxle.ns_pad !== null || frontAxle.os_pad !== null ||
    frontAxle.ns_disc !== null || frontAxle.os_disc !== null
  )

  const hasRear = rearAxle && (
    rearAxle.brake_type === 'drum' ||
    rearAxle.ns_pad !== null || rearAxle.os_pad !== null ||
    rearAxle.ns_disc !== null || rearAxle.os_disc !== null
  )

  if (!hasFront && !hasRear) {
    return <div className="text-sm text-gray-500">No brake measurements recorded</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {hasFront && frontAxle && (
        <AxleCard title="Front Brakes" axle={frontAxle} ragStatus={ragStatus} />
      )}
      {hasRear && rearAxle && (
        <AxleCard title="Rear Brakes" axle={rearAxle} ragStatus={ragStatus} />
      )}
    </div>
  )
}

interface AxleCardProps {
  title: string
  axle: AxleMeasurement
  ragStatus?: 'green' | 'amber' | 'red' | null
}

function AxleCard({ title, axle, ragStatus }: AxleCardProps) {
  const brakeTypeLabel = axle.brake_type === 'disc' ? 'Disc' : 'Drum'
  const isDisc = axle.brake_type === 'disc'

  // Determine severity
  const severity = getAxleSeverity(axle)
  const isUrgent = ragStatus === 'red' || severity === 'urgent'
  const isAdvisory = ragStatus === 'amber' || (severity === 'advisory' && !isUrgent)

  // Get summary for bottom bar
  const summary = getAxleSummary(axle)

  // Card styling matching TyreDisplay
  const cardBorderClass = isUrgent
    ? 'border-red-400 border-2'
    : isAdvisory
    ? 'border-amber-400 border-2'
    : 'border-gray-200 border'

  const cardBgClass = isUrgent
    ? 'bg-red-50'
    : isAdvisory
    ? 'bg-amber-50'
    : 'bg-gray-50'

  // Get text color classes for measurements (matching TyreDisplay getReadingColor style)
  const getPadColor = (value: number | null): string => {
    if (value === null) return 'text-gray-400'
    if (value < PAD_RED_THRESHOLD) return 'text-red-600'
    if (value < PAD_AMBER_THRESHOLD) return 'text-amber-600'
    return 'text-green-600'
  }

  const getDiscColor = (actual: number | null, minSpec: number | null): string => {
    if (actual === null) return 'text-gray-400'
    if (minSpec !== null && actual < minSpec) return 'text-red-600'
    return 'text-green-600'
  }

  const formatReading = (value: number | null): string => {
    if (value === null) return '-'
    return `${value}mm`
  }

  const formatDiscReading = (value: number | null): string => {
    if (value === null) return '-'
    return `${value.toFixed(1)}mm`
  }

  // Labels for brake type
  const frictionLabel = isDisc ? 'Pad' : 'Shoe'

  return (
    <div className={`${cardBgClass} ${cardBorderClass} rounded-lg p-3 text-sm max-w-sm`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-gray-700">{title} ({brakeTypeLabel})</div>
      </div>

      {/* Measurements - Simple grid like TyreDisplay */}
      {isDisc ? (
        // Disc brakes: 4-column grid (N/S Pad, N/S Disc, O/S Pad, O/S Disc)
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div className="text-center">
            <div className="text-xs text-gray-500">N/S {frictionLabel}</div>
            <div className={`font-mono font-medium ${getPadColor(axle.ns_pad)}`}>
              {formatReading(axle.ns_pad)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">N/S Disc</div>
            {axle.ns_disc_unable_to_access ? (
              <div className="text-xs text-gray-500 italic">N/A</div>
            ) : (
              <div className={`font-mono font-medium ${getDiscColor(axle.ns_disc, axle.ns_disc_min)}`}>
                {formatDiscReading(axle.ns_disc)}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">O/S {frictionLabel}</div>
            <div className={`font-mono font-medium ${getPadColor(axle.os_pad)}`}>
              {formatReading(axle.os_pad)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">O/S Disc</div>
            {axle.os_disc_unable_to_access ? (
              <div className="text-xs text-gray-500 italic">N/A</div>
            ) : (
              <div className={`font-mono font-medium ${getDiscColor(axle.os_disc, axle.os_disc_min)}`}>
                {formatDiscReading(axle.os_disc)}
              </div>
            )}
          </div>
        </div>
      ) : axle.ns_pad === null && axle.os_pad === null ? (
        // Drum brakes with no measurements: visual inspection only
        <div className="text-center py-2 mb-2">
          <span className="text-xs font-medium text-green-700 bg-green-100 px-3 py-1 rounded-full">
            Visual inspection only
          </span>
        </div>
      ) : (
        // Drum brakes with legacy pad data: show shoe measurements
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="text-center">
            <div className="text-xs text-gray-500">N/S {frictionLabel}</div>
            <div className={`font-mono font-medium ${getPadColor(axle.ns_pad)}`}>
              {formatReading(axle.ns_pad)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500">O/S {frictionLabel}</div>
            <div className={`font-mono font-medium ${getPadColor(axle.os_pad)}`}>
              {formatReading(axle.os_pad)}
            </div>
          </div>
        </div>
      )}

      {/* Summary Bar (like Remaining Legal Tread) */}
      {summary && (
        <div className={`text-center py-1.5 px-2 rounded text-xs font-semibold ${
          summary.diff !== null && summary.diff < 0
            ? 'bg-red-200 text-red-800 border border-red-300'
            : summary.diff !== null && summary.diff < 2
            ? 'bg-amber-200 text-amber-800 border border-amber-300'
            : 'bg-green-200 text-green-800 border border-green-300'
        }`}>
          {summary.diff !== null && summary.diff < 0 ? (
            <span>
              {isUrgent ? '⚠️ ' : ''}Min: {summary.type === 'disc' ? summary.minSpec?.toFixed(1) : summary.minSpec}mm • Lowest: {summary.type === 'disc' ? summary.lowest?.toFixed(1) : summary.lowest}mm • {Math.abs(summary.diff).toFixed(1)}mm under
            </span>
          ) : (
            <span>
              Min: {summary.type === 'disc' ? summary.minSpec?.toFixed(1) : summary.minSpec}mm • Lowest: {summary.type === 'disc' ? summary.lowest?.toFixed(1) : summary.lowest}mm • {summary.diff?.toFixed(1)}mm above
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Compact brake summary for list views
 * Supports both new format (nearside/offside) and legacy format (ns_pad/os_pad)
 */
interface BrakeSummaryProps {
  data: BrakeData | null
}

export function BrakeSummary({ data }: BrakeSummaryProps) {
  if (!data) {
    return <span className="text-gray-500">-</span>
  }

  // Normalize all axle data first
  const isSingleAxle = !data.front && !data.rear && (
    data.nearside !== undefined || data.offside !== undefined ||
    data.ns_pad !== undefined || data.os_pad !== undefined ||
    data.brake_type !== undefined
  )

  let padReadings: number[] = []
  let discChecks: { actual: number | null; min: number | null; unableToAccess?: boolean }[] = []

  if (isSingleAxle) {
    const axle = normalizeAxleData(data)
    if (axle) {
      padReadings = [axle.ns_pad, axle.os_pad].filter((v): v is number => v !== null)
      discChecks = [
        { actual: axle.ns_disc, min: axle.ns_disc_min, unableToAccess: axle.ns_disc_unable_to_access },
        { actual: axle.os_disc, min: axle.os_disc_min, unableToAccess: axle.os_disc_unable_to_access }
      ]
    }
  } else {
    const frontAxle = data.front ? normalizeAxleData(data.front) : null
    const rearAxle = data.rear ? normalizeAxleData(data.rear) : null

    padReadings = [
      frontAxle?.ns_pad, frontAxle?.os_pad,
      rearAxle?.ns_pad, rearAxle?.os_pad
    ].filter((v): v is number => v !== null && v !== undefined)

    discChecks = [
      { actual: frontAxle?.ns_disc ?? null, min: frontAxle?.ns_disc_min ?? null, unableToAccess: frontAxle?.ns_disc_unable_to_access },
      { actual: frontAxle?.os_disc ?? null, min: frontAxle?.os_disc_min ?? null, unableToAccess: frontAxle?.os_disc_unable_to_access },
      { actual: rearAxle?.ns_disc ?? null, min: rearAxle?.ns_disc_min ?? null, unableToAccess: rearAxle?.ns_disc_unable_to_access },
      { actual: rearAxle?.os_disc ?? null, min: rearAxle?.os_disc_min ?? null, unableToAccess: rearAxle?.os_disc_unable_to_access }
    ]
  }

  const minPad = padReadings.length > 0 ? Math.min(...padReadings) : null

  const discNeedsReplacement = discChecks.some(({ actual, min, unableToAccess }) =>
    !unableToAccess && actual !== null && min !== null && actual < min
  )

  if (minPad === null && !discNeedsReplacement) {
    return <span className="text-gray-500">-</span>
  }

  const getPadColor = () => {
    if (minPad === null) return ''
    if (minPad < PAD_RED_THRESHOLD) return 'text-red-600'
    if (minPad < PAD_AMBER_THRESHOLD) return 'text-amber-600'
    return 'text-green-600'
  }

  return (
    <div className="space-y-1">
      {minPad !== null && (
        <span className={`font-mono ${getPadColor()}`}>
          Min pad: {minPad}mm
        </span>
      )}
      {discNeedsReplacement && (
        <span className="text-red-600 block text-xs font-medium">
          Disc replacement required
        </span>
      )}
    </div>
  )
}
