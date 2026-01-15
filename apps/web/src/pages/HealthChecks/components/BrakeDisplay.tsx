/**
 * BrakeDisplay Component
 * Displays brake inspection data with pad and disc measurements
 */

type BrakeType = 'disc' | 'drum'

interface AxleMeasurement {
  brake_type: BrakeType
  ns_pad: number | null
  ns_disc: number | null
  ns_disc_min: number | null  // Manufacturer minimum spec
  os_pad: number | null
  os_disc: number | null
  os_disc_min: number | null  // Manufacturer minimum spec
}

interface BrakeData {
  front?: AxleMeasurement
  rear?: AxleMeasurement
}

interface BrakeDisplayProps {
  data: BrakeData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

// Pad thresholds (organization-wide settings)
const PAD_RED_THRESHOLD = 3    // mm - below this is red
const PAD_AMBER_THRESHOLD = 5  // mm - below this is amber

export function BrakeDisplay({ data, ragStatus: _ragStatus }: BrakeDisplayProps) {
  // ragStatus reserved for future color-coding enhancements
  void _ragStatus
  if (!data) {
    return <div className="text-sm text-gray-500">No brake data recorded</div>
  }

  const hasFront = data.front && (
    data.front.ns_pad !== null ||
    data.front.os_pad !== null ||
    data.front.ns_disc !== null ||
    data.front.os_disc !== null
  )

  const hasRear = data.rear && (
    data.rear.ns_pad !== null ||
    data.rear.os_pad !== null ||
    data.rear.ns_disc !== null ||
    data.rear.os_disc !== null
  )

  if (!hasFront && !hasRear) {
    return <div className="text-sm text-gray-500">No brake measurements recorded</div>
  }

  return (
    <div className="space-y-4">
      {hasFront && data.front && (
        <AxleDisplay
          title="Front Brakes"
          axle={data.front}
        />
      )}
      {hasRear && data.rear && (
        <AxleDisplay
          title="Rear Brakes"
          axle={data.rear}
        />
      )}
    </div>
  )
}

interface AxleDisplayProps {
  title: string
  axle: AxleMeasurement
}

function AxleDisplay({ title, axle }: AxleDisplayProps) {
  const brakeTypeLabel = axle.brake_type === 'disc' ? 'Disc' : 'Drum'

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3">
      <div className="font-medium text-gray-700 mb-3">
        {title} ({brakeTypeLabel})
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* N/S Side */}
        <div>
          <div className="text-xs text-gray-500 font-medium mb-2 text-center border-b border-gray-200 pb-1">
            N/S (Near Side)
          </div>
          <div className="space-y-2">
            <MeasurementRow
              label="Pad"
              value={axle.ns_pad}
              unit="mm"
              thresholds={{ red: PAD_RED_THRESHOLD, amber: PAD_AMBER_THRESHOLD }}
            />
            {axle.brake_type === 'disc' && (
              <DiscMeasurementRow
                actual={axle.ns_disc}
                minSpec={axle.ns_disc_min}
              />
            )}
          </div>
        </div>

        {/* O/S Side */}
        <div>
          <div className="text-xs text-gray-500 font-medium mb-2 text-center border-b border-gray-200 pb-1">
            O/S (Off Side)
          </div>
          <div className="space-y-2">
            <MeasurementRow
              label="Pad"
              value={axle.os_pad}
              unit="mm"
              thresholds={{ red: PAD_RED_THRESHOLD, amber: PAD_AMBER_THRESHOLD }}
            />
            {axle.brake_type === 'disc' && (
              <DiscMeasurementRow
                actual={axle.os_disc}
                minSpec={axle.os_disc_min}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface MeasurementRowProps {
  label: string
  value: number | null
  unit: string
  thresholds: { red: number; amber: number }
}

function MeasurementRow({ label, value, unit, thresholds }: MeasurementRowProps) {
  const getColor = () => {
    if (value === null) return 'text-gray-400'
    if (value < thresholds.red) return 'text-red-600'
    if (value < thresholds.amber) return 'text-amber-600'
    return 'text-green-600'
  }

  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-600">{label}:</span>
      <span className={`font-mono font-medium ${getColor()}`}>
        {value !== null ? `${value}${unit}` : '-'}
      </span>
    </div>
  )
}

interface DiscMeasurementRowProps {
  actual: number | null
  minSpec: number | null
}

function DiscMeasurementRow({ actual, minSpec }: DiscMeasurementRowProps) {
  // Determine status: actual < minSpec means replacement required
  const needsReplacement = actual !== null && minSpec !== null && actual < minSpec

  const getActualColor = () => {
    if (actual === null) return 'text-gray-400'
    if (needsReplacement) return 'text-red-600'
    return 'text-green-600'
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-600">Disc:</span>
        <span className={`font-mono font-medium ${getActualColor()}`}>
          {actual !== null ? `${actual}mm` : '-'}
        </span>
      </div>
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-500 text-xs">Min Spec:</span>
        <span className="font-mono text-xs text-gray-500">
          {minSpec !== null ? `${minSpec}mm` : '-'}
        </span>
      </div>
      {needsReplacement && (
        <div className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded text-center">
          REPLACEMENT REQUIRED
        </div>
      )}
    </div>
  )
}

/**
 * Compact brake summary for list views
 */
interface BrakeSummaryProps {
  data: BrakeData | null
}

export function BrakeSummary({ data }: BrakeSummaryProps) {
  if (!data) {
    return <span className="text-gray-500">-</span>
  }

  // Find lowest pad reading
  const padReadings = [
    data.front?.ns_pad,
    data.front?.os_pad,
    data.rear?.ns_pad,
    data.rear?.os_pad
  ].filter((v): v is number => v !== null && v !== undefined)

  const minPad = padReadings.length > 0 ? Math.min(...padReadings) : null

  // Check if any disc needs replacement
  const discNeedsReplacement = [
    { actual: data.front?.ns_disc, min: data.front?.ns_disc_min },
    { actual: data.front?.os_disc, min: data.front?.os_disc_min },
    { actual: data.rear?.ns_disc, min: data.rear?.ns_disc_min },
    { actual: data.rear?.os_disc, min: data.rear?.os_disc_min }
  ].some(({ actual, min }) =>
    actual !== null && actual !== undefined &&
    min !== null && min !== undefined &&
    actual < min
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
