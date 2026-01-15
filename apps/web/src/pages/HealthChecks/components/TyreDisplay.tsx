/**
 * TyreDisplay Component
 * Displays tyre inspection data with 3-point readings and remaining legal tread calculation
 */

interface TyreReading {
  outer: number | null
  middle: number | null
  inner: number | null
}

interface TyreDetails {
  manufacturer?: string
  size?: string
  speed_rating?: string
  load_rating?: string
}

interface TyreData {
  tread?: TyreReading
  details?: TyreDetails
}

interface TyreDisplayProps {
  position: string  // e.g., "Front Left", "Rear Right"
  data: TyreData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

const LEGAL_LIMIT = 1.6 // UK legal minimum tread depth in mm

export function TyreDisplay({ position, data, ragStatus: _ragStatus }: TyreDisplayProps) {
  // ragStatus reserved for future color-coding enhancements
  void _ragStatus
  if (!data) {
    return (
      <div className="text-sm text-gray-500">No data recorded</div>
    )
  }

  const tread = data.tread
  const details = data.details

  // Calculate minimum tread depth
  const readings = [tread?.outer, tread?.middle, tread?.inner].filter(
    (r): r is number => r !== null && r !== undefined
  )
  const minReading = readings.length > 0 ? Math.min(...readings) : null
  const remainingLegal = minReading !== null ? minReading - LEGAL_LIMIT : null
  const isBelowLegal = remainingLegal !== null && remainingLegal < 0

  // Build tyre description string
  const tyreDescription = details
    ? [
        details.manufacturer,
        details.size,
        details.load_rating && details.speed_rating
          ? `${details.load_rating}${details.speed_rating}`
          : details.speed_rating || details.load_rating
      ]
        .filter(Boolean)
        .join(' ')
    : null

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
      <div className="font-medium text-gray-700 mb-2">{position}</div>

      {/* Tread readings */}
      {tread && (tread.outer !== null || tread.middle !== null || tread.inner !== null) ? (
        <>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="text-center">
              <div className="text-xs text-gray-500">Outer</div>
              <div className={`font-mono font-medium ${getReadingColor(tread.outer)}`}>
                {formatReading(tread.outer)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500">Middle</div>
              <div className={`font-mono font-medium ${getReadingColor(tread.middle)}`}>
                {formatReading(tread.middle)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500">Inner</div>
              <div className={`font-mono font-medium ${getReadingColor(tread.inner)}`}>
                {formatReading(tread.inner)}
              </div>
            </div>
          </div>

          {/* Remaining legal tread */}
          {remainingLegal !== null && (
            <div className={`text-center py-1 px-2 rounded text-xs font-medium ${
              isBelowLegal
                ? 'bg-red-100 text-red-700'
                : remainingLegal < 1.5
                ? 'bg-amber-100 text-amber-700'
                : 'bg-green-100 text-green-700'
            }`}>
              {isBelowLegal ? (
                <span className="uppercase">Below Legal Limit</span>
              ) : (
                <span>Remaining Legal Tread: {remainingLegal.toFixed(1)}mm</span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-500 text-xs mb-2">No tread readings</div>
      )}

      {/* Tyre details */}
      {tyreDescription && (
        <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-600">
          {tyreDescription}
        </div>
      )}
    </div>
  )
}

function formatReading(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  return `${value.toFixed(1)}mm`
}

function getReadingColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'text-gray-400'
  if (value < LEGAL_LIMIT) return 'text-red-600'
  if (value < 3) return 'text-amber-600'
  return 'text-green-600'
}

/**
 * TyreSetDisplay - Shows all 4 tyres in a car layout
 */
interface TyreSetData {
  os_front?: TyreData | null
  ns_front?: TyreData | null
  os_rear?: TyreData | null
  ns_rear?: TyreData | null
}

interface TyreSetDisplayProps {
  data: TyreSetData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

export function TyreSetDisplay({ data, ragStatus }: TyreSetDisplayProps) {
  if (!data) {
    return <div className="text-sm text-gray-500">No tyre data recorded</div>
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Front tyres */}
      <TyreDisplay
        position="N/S Front"
        data={data.ns_front || null}
        ragStatus={ragStatus}
      />
      <TyreDisplay
        position="O/S Front"
        data={data.os_front || null}
        ragStatus={ragStatus}
      />

      {/* Rear tyres */}
      <TyreDisplay
        position="N/S Rear"
        data={data.ns_rear || null}
        ragStatus={ragStatus}
      />
      <TyreDisplay
        position="O/S Rear"
        data={data.os_rear || null}
        ragStatus={ragStatus}
      />
    </div>
  )
}
