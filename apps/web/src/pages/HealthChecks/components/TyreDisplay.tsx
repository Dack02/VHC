/**
 * TyreDisplay Component
 * Displays tyre inspection data with 3-point readings and remaining legal tread calculation
 * Supports both new format (flat depth readings) and legacy format (nested tread/details)
 * Shows run flat indicator, damage info with severity, and tyre specifications
 */

type DamageSeverity = 'advisory' | 'urgent'

interface TyreReading {
  outer: number | null
  middle: number | null
  inner: number | null
}

// Legacy details format (snake_case)
interface TyreDetailsLegacy {
  manufacturer?: string
  size?: string
  speed_rating?: string
  load_rating?: string
  run_flat?: boolean
}

// New details format from TyreDetailsInput (camelCase)
interface TyreDetailsNew {
  manufacturerId?: string
  manufacturerName?: string
  sizeId?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
}

// Normalized details for display
interface TyreDetails {
  manufacturer?: string
  size?: string
  speed_rating?: string
  load_rating?: string
  run_flat?: boolean
}

// Damage info
interface DamageInfo {
  type: string
  severity?: DamageSeverity
}

// Can be legacy format (nested tread/details) or new format (flat depth readings)
interface TyreData {
  // Legacy nested format
  tread?: TyreReading
  details?: TyreDetailsLegacy | TyreDetailsNew
  // New flat format from TyreDepthInput
  outer?: number | null
  middle?: number | null
  inner?: number | null
  damage?: string
  damageSeverity?: DamageSeverity
  // New details format fields (camelCase)
  manufacturerId?: string
  manufacturerName?: string
  sizeId?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
  // Legacy run_flat
  run_flat?: boolean
}

interface TyreDisplayProps {
  position: string  // e.g., "Front Left", "Rear Right"
  data: TyreData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

const LEGAL_LIMIT = 1.6 // UK legal minimum tread depth in mm

// Normalize details from new camelCase format to legacy snake_case format
function normalizeDetails(data: TyreDetailsLegacy | TyreDetailsNew | TyreData | null): TyreDetails | null {
  if (!data) return null

  const newFormat = data as TyreDetailsNew
  const legacyFormat = data as TyreDetailsLegacy
  const dataFormat = data as TyreData

  // Check for new camelCase format
  if (newFormat.manufacturerName || newFormat.speedRating || newFormat.loadRating || newFormat.runFlat !== undefined) {
    return {
      manufacturer: newFormat.manufacturerName,
      size: newFormat.size,
      speed_rating: newFormat.speedRating,
      load_rating: newFormat.loadRating,
      run_flat: newFormat.runFlat
    }
  }

  // Legacy snake_case format
  if (legacyFormat.manufacturer || legacyFormat.speed_rating || legacyFormat.load_rating || legacyFormat.run_flat !== undefined) {
    return {
      manufacturer: legacyFormat.manufacturer,
      size: legacyFormat.size,
      speed_rating: legacyFormat.speed_rating,
      load_rating: legacyFormat.load_rating,
      run_flat: legacyFormat.run_flat
    }
  }

  // Check top-level runFlat/run_flat
  if (dataFormat.runFlat !== undefined || dataFormat.run_flat !== undefined) {
    return {
      run_flat: dataFormat.runFlat ?? dataFormat.run_flat
    }
  }

  return null
}

// Normalize tread readings from various formats
function normalizeTread(data: TyreData | null): TyreReading | null {
  if (!data) return null

  // Check for nested tread object (legacy format)
  if (data.tread) {
    return data.tread
  }

  // Check for flat format (new TyreDepthInput format)
  if (data.outer !== undefined || data.middle !== undefined || data.inner !== undefined) {
    return {
      outer: data.outer ?? null,
      middle: data.middle ?? null,
      inner: data.inner ?? null
    }
  }

  return null
}

// Extract damage info from data
function getDamageInfo(data: TyreData | null): DamageInfo | null {
  if (!data) return null
  if (!data.damage || data.damage === 'None') return null

  return {
    type: data.damage,
    severity: data.damageSeverity
  }
}

export function TyreDisplay({ position, data, ragStatus }: TyreDisplayProps) {
  if (!data) {
    return (
      <div className="text-sm text-gray-500">No data recorded</div>
    )
  }

  // Normalize data from various formats
  const tread = normalizeTread(data)
  const details = normalizeDetails(data.details || data)
  const damageInfo = getDamageInfo(data)
  const isRunFlat = details?.run_flat || data.runFlat || data.run_flat

  // Calculate minimum tread depth
  const readings = [tread?.outer, tread?.middle, tread?.inner].filter(
    (r): r is number => r !== null && r !== undefined
  )
  const minReading = readings.length > 0 ? Math.min(...readings) : null
  const remainingLegal = minReading !== null ? minReading - LEGAL_LIMIT : null
  const isBelowLegal = remainingLegal !== null && remainingLegal < 0

  // Determine card styling based on RAG status
  const isUrgent = ragStatus === 'red' || (damageInfo?.severity === 'urgent')
  const isAdvisory = ragStatus === 'amber' || (damageInfo?.severity === 'advisory' && !isUrgent)

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

  return (
    <div className={`${cardBgClass} ${cardBorderClass} rounded-lg p-3 text-sm`}>
      {/* Header with position and Run Flat badge */}
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-gray-700">{position}</div>
        {isRunFlat && (
          <div className="bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
            <span>⚠️</span>
            <span>RUN FLAT</span>
          </div>
        )}
      </div>

      {/* Tyre Specifications - Always shown prominently */}
      {details && (details.manufacturer || details.size || details.speed_rating || details.load_rating || details.run_flat !== undefined) && (
        <div className={`mb-3 p-2 rounded-xl ${isUrgent ? 'bg-red-100' : isAdvisory ? 'bg-amber-100' : 'bg-white'} border border-gray-200`}>
          <div className="text-xs font-medium text-gray-500 mb-1">Specifications</div>
          <div className="space-y-0.5">
            {details.manufacturer && (
              <div className="text-sm font-medium text-gray-800">{details.manufacturer}</div>
            )}
            {details.size && (
              <div className="text-sm text-gray-700">{details.size}</div>
            )}
            {(details.speed_rating || details.load_rating) && (
              <div className="text-xs text-gray-600">
                {details.load_rating && <span>Load: {details.load_rating}</span>}
                {details.load_rating && details.speed_rating && <span> • </span>}
                {details.speed_rating && <span>Speed: {details.speed_rating}</span>}
              </div>
            )}
            {details.run_flat !== undefined && (
              <div className="text-xs text-gray-600">
                Run Flat: {details.run_flat ? (
                  <span className="font-semibold text-amber-700">Yes</span>
                ) : (
                  <span className="font-medium text-gray-700">No</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Damage Alert - Shown prominently if damage exists */}
      {damageInfo && (
        <div className={`mb-3 p-2 rounded-lg flex items-center gap-2 ${
          damageInfo.severity === 'urgent'
            ? 'bg-red-100 border-2 border-red-400'
            : 'bg-amber-100 border-2 border-amber-400'
        }`}>
          <span className="text-lg">{damageInfo.severity === 'urgent' ? '🚨' : '⚠️'}</span>
          <div>
            <div className={`font-semibold text-sm ${
              damageInfo.severity === 'urgent' ? 'text-red-800' : 'text-amber-800'
            }`}>
              {damageInfo.type}
            </div>
            <div className={`text-xs font-medium ${
              damageInfo.severity === 'urgent' ? 'text-red-600' : 'text-amber-600'
            }`}>
              {damageInfo.severity === 'urgent' ? 'URGENT - Requires Immediate Attention' : 'Advisory - Monitor'}
            </div>
          </div>
        </div>
      )}

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
            <div className={`text-center py-1.5 px-2 rounded text-xs font-semibold ${
              isBelowLegal
                ? 'bg-red-200 text-red-800 border border-red-300'
                : remainingLegal < 1.5
                ? 'bg-amber-200 text-amber-800 border border-amber-300'
                : 'bg-green-200 text-green-800 border border-green-300'
            }`}>
              {isBelowLegal ? (
                <span className="uppercase">⚠️ Below Legal Limit</span>
              ) : (
                <span>Remaining Legal Tread: {remainingLegal.toFixed(1)}mm</span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="text-gray-500 text-xs mb-2 italic">No tread readings</div>
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
 * Supports multiple data formats:
 * - Legacy: { ns_front, os_front, ns_rear, os_rear }
 * - New from TyreDetailsInput: { front_left, front_right, rear_left, rear_right }
 * - Single tyre (flat depth data): { outer, middle, inner, damage }
 */
interface TyreSetData {
  // Legacy position names
  os_front?: TyreData | null
  ns_front?: TyreData | null
  os_rear?: TyreData | null
  ns_rear?: TyreData | null
  // New position names from TyreDetailsInput
  front_left?: TyreData | null
  front_right?: TyreData | null
  rear_left?: TyreData | null
  rear_right?: TyreData | null
  // Single tyre flat format (from TyreDepthInput)
  outer?: number | null
  middle?: number | null
  inner?: number | null
  damage?: string
  damageSeverity?: DamageSeverity
  // Run flat fields
  runFlat?: boolean
  run_flat?: boolean
}

interface TyreSetDisplayProps {
  data: TyreSetData | null
  ragStatus?: 'green' | 'amber' | 'red' | null
}

// Position mapping: new names to legacy names
// front_left = N/S Front (nearside/passenger side in UK)
// front_right = O/S Front (offside/driver side in UK)
// rear_left = N/S Rear
// rear_right = O/S Rear
function getNormalisedTyreData(data: TyreSetData): {
  ns_front: TyreData | null
  os_front: TyreData | null
  ns_rear: TyreData | null
  os_rear: TyreData | null
} {
  return {
    ns_front: data.ns_front || data.front_left || null,
    os_front: data.os_front || data.front_right || null,
    ns_rear: data.ns_rear || data.rear_left || null,
    os_rear: data.os_rear || data.rear_right || null
  }
}

export function TyreSetDisplay({ data, ragStatus }: TyreSetDisplayProps) {
  if (!data) {
    return <div className="text-sm text-gray-500">No tyre data recorded</div>
  }

  // Check if this is single-tyre data (flat depth readings without position)
  const isSingleTyre = !data.ns_front && !data.os_front && !data.ns_rear && !data.os_rear &&
    !data.front_left && !data.front_right && !data.rear_left && !data.rear_right &&
    (data.outer !== undefined || data.middle !== undefined || data.inner !== undefined)

  if (isSingleTyre) {
    // Single tyre data - display as single tyre
    return (
      <div className="grid grid-cols-1 gap-4 max-w-xs">
        <TyreDisplay
          position="Tyre"
          data={data as TyreData}
          ragStatus={ragStatus}
        />
      </div>
    )
  }

  // Multi-tyre data - normalize positions
  const normalised = getNormalisedTyreData(data)
  const hasAnyData = normalised.ns_front || normalised.os_front ||
                     normalised.ns_rear || normalised.os_rear

  if (!hasAnyData) {
    return <div className="text-sm text-gray-500">No tyre data recorded</div>
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Front tyres */}
      <TyreDisplay
        position="N/S Front"
        data={normalised.ns_front}
        ragStatus={ragStatus}
      />
      <TyreDisplay
        position="O/S Front"
        data={normalised.os_front}
        ragStatus={ragStatus}
      />

      {/* Rear tyres */}
      <TyreDisplay
        position="N/S Rear"
        data={normalised.ns_rear}
        ragStatus={ragStatus}
      />
      <TyreDisplay
        position="O/S Rear"
        data={normalised.os_rear}
        ragStatus={ragStatus}
      />
    </div>
  )
}
