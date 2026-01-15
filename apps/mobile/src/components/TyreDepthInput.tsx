import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useThresholds } from '../context/ThresholdsContext'
import { api } from '../lib/api'
import { TreadDepthSlider } from './TreadDepthSlider'

// Tyre details (manufacturer, size, etc.)
interface TyreDetails {
  manufacturerId?: string
  manufacturerName?: string
  sizeId?: string
  size?: string
  speedRating?: string
  loadRating?: string
}

// 3-point tread measurement per tyre
interface TyreTreadValue {
  outer: number
  middle: number
  inner: number
}

// Full tyre data including details and tread
interface TyreValue {
  details?: TyreDetails
  tread: TyreTreadValue
}

// All 4 tyres (plus optional spare)
interface TyreDepthValue {
  os_front: TyreValue | null  // Off Side (Driver) Front
  ns_front: TyreValue | null  // Near Side (Passenger) Front
  ns_rear: TyreValue | null   // Near Side Rear
  os_rear: TyreValue | null   // Off Side Rear
  spare?: TyreValue | null    // Optional spare
}

interface TyreDepthInputProps {
  value: TyreDepthValue | undefined
  onChange: (value: TyreDepthValue) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: Record<string, unknown> // Kept for compatibility but no longer used for thresholds
}

type TyrePosition = 'os_front' | 'ns_front' | 'ns_rear' | 'os_rear'
type TabType = 'details' | 'tread'

const TYRE_POSITIONS: { key: TyrePosition; label: string; shortLabel: string }[] = [
  { key: 'os_front', label: 'O/S Front', shortLabel: 'OSF' },
  { key: 'ns_front', label: 'N/S Front', shortLabel: 'NSF' },
  { key: 'ns_rear', label: 'N/S Rear', shortLabel: 'NSR' },
  { key: 'os_rear', label: 'O/S Rear', shortLabel: 'OSR' }
]

const DEFAULT_TREAD: TyreTreadValue = { outer: 5.0, middle: 5.0, inner: 5.0 }

// Reference data types
interface Manufacturer { id: string; name: string }
interface TyreSize { id: string; size: string }
interface SpeedRating { id: string; code: string; description: string }
interface LoadRating { id: string; code: string; maxLoadKg: number }

export function TyreDepthInput({
  value,
  onChange,
  onRAGChange,
  config: _config // Kept for compatibility
}: TyreDepthInputProps) {
  const { session } = useAuth()
  const { thresholds: orgThresholds } = useThresholds()
  const [activeTab, setActiveTab] = useState<TabType>('details')
  const [expandedTyre, setExpandedTyre] = useState<TyrePosition | null>('os_front')

  // Reference data
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([])
  const [tyreSizes, setTyreSizes] = useState<TyreSize[]>([])
  const [speedRatings, setSpeedRatings] = useState<SpeedRating[]>([])
  const [loadRatings, setLoadRatings] = useState<LoadRating[]>([])
  const [loadingRef, setLoadingRef] = useState(true)

  // Initialize with defaults if empty
  const [tyres, setTyres] = useState<TyreDepthValue>(() => {
    if (value && (value.os_front || value.ns_front || value.ns_rear || value.os_rear)) {
      return value
    }
    return {
      os_front: { tread: { ...DEFAULT_TREAD }, details: {} },
      ns_front: { tread: { ...DEFAULT_TREAD }, details: {} },
      ns_rear: { tread: { ...DEFAULT_TREAD }, details: {} },
      os_rear: { tread: { ...DEFAULT_TREAD }, details: {} }
    }
  })

  // Use organization thresholds
  const redBelowMm = orgThresholds.tyreRedBelowMm
  const amberBelowMm = orgThresholds.tyreAmberBelowMm
  const thresholds = { red: redBelowMm, amber: amberBelowMm }

  // Void the unused config to suppress linter warning
  void _config

  // Track the last RAG status using ref to avoid causing re-renders
  const lastRAGRef = useRef<'green' | 'amber' | 'red' | null>(null)

  // Store callback in ref to avoid triggering effect on every parent re-render
  const onRAGChangeRef = useRef(onRAGChange)
  onRAGChangeRef.current = onRAGChange

  // Track if user has interacted - don't auto-save on mount
  const hasUserInteracted = useRef(false)

  // Fetch reference data (only once on mount)
  useEffect(() => {
    if (!session) return

    const fetchReferenceData = async () => {
      try {
        const [mfgRes, sizesRes, speedRes, loadRes] = await Promise.all([
          api<{ manufacturers: Manufacturer[] }>('/api/v1/tyre-manufacturers?active_only=true', { token: session.access_token }),
          api<{ sizes: TyreSize[] }>('/api/v1/tyre-sizes?active_only=true', { token: session.access_token }),
          api<{ speedRatings: SpeedRating[] }>('/api/v1/speed-ratings', { token: session.access_token }),
          api<{ loadRatings: LoadRating[] }>('/api/v1/load-ratings', { token: session.access_token })
        ])

        setManufacturers(mfgRes.manufacturers || [])
        setTyreSizes(sizesRes.sizes || [])
        setSpeedRatings(speedRes.speedRatings || [])
        setLoadRatings(loadRes.loadRatings || [])
      } catch (error) {
        console.error('Failed to fetch tyre reference data:', error)
      } finally {
        setLoadingRef(false)
      }
    }

    fetchReferenceData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Calculate RAG based on lowest value across all tyres
  // Only notify parent when RAG actually changes
  useEffect(() => {
    const allValues: number[] = []

    TYRE_POSITIONS.forEach(({ key }) => {
      const tyre = tyres[key]
      if (tyre?.tread) {
        allValues.push(tyre.tread.outer, tyre.tread.middle, tyre.tread.inner)
      }
    })

    let newRAG: 'green' | 'amber' | 'red' | null = null

    if (allValues.length > 0) {
      const lowest = Math.min(...allValues)
      // RED: below redBelowMm, AMBER: below amberBelowMm but >= redBelowMm, GREEN: >= amberBelowMm
      if (lowest < redBelowMm) {
        newRAG = 'red'
      } else if (lowest < amberBelowMm) {
        newRAG = 'amber'
      } else {
        newRAG = 'green'
      }
    }

    // Only call onRAGChange if the status actually changed AND user has interacted
    // This prevents auto-saving on component mount
    if (newRAG !== lastRAGRef.current) {
      lastRAGRef.current = newRAG
      if (hasUserInteracted.current) {
        onRAGChangeRef.current(newRAG)
      }
    }
  }, [tyres, redBelowMm, amberBelowMm]) // Removed onRAGChange - using ref instead

  const handleTreadChange = useCallback((
    position: TyrePosition,
    point: keyof TyreTreadValue,
    newValue: number
  ) => {
    hasUserInteracted.current = true
    setTyres((prev) => {
      const currentTyre = prev[position] || { tread: { ...DEFAULT_TREAD }, details: {} }
      const newTyres = {
        ...prev,
        [position]: {
          ...currentTyre,
          tread: {
            ...currentTyre.tread,
            [point]: newValue
          }
        }
      }
      onChange(newTyres)
      return newTyres
    })
  }, [onChange])

  const handleDetailsChange = useCallback((
    position: TyrePosition,
    field: keyof TyreDetails,
    newValue: string
  ) => {
    hasUserInteracted.current = true
    setTyres((prev) => {
      const currentTyre = prev[position] || { tread: { ...DEFAULT_TREAD }, details: {} }
      const details = { ...currentTyre.details }

      // Handle manufacturer selection
      if (field === 'manufacturerId') {
        details.manufacturerId = newValue
        details.manufacturerName = manufacturers.find(m => m.id === newValue)?.name
      }
      // Handle size selection
      else if (field === 'sizeId') {
        details.sizeId = newValue
        details.size = tyreSizes.find(s => s.id === newValue)?.size
      }
      // Handle speed/load ratings
      else {
        (details as Record<string, unknown>)[field] = newValue
      }

      const newTyres = {
        ...prev,
        [position]: {
          ...currentTyre,
          details
        }
      }
      onChange(newTyres)
      return newTyres
    })
  }, [onChange, manufacturers, tyreSizes])

  const handleCopyToAll = useCallback((sourcePosition: TyrePosition) => {
    const sourceTyre = tyres[sourcePosition]
    if (!sourceTyre?.details) return

    hasUserInteracted.current = true
    if ('vibrate' in navigator) {
      navigator.vibrate(100)
    }

    // Only copy details (manufacturer, size, ratings) - NOT tread depths
    // Tread depths should be measured individually for each tyre
    setTyres((prev) => {
      const newTyres: TyreDepthValue = {
        os_front: { tread: prev.os_front?.tread || { ...DEFAULT_TREAD }, details: { ...sourceTyre.details } },
        ns_front: { tread: prev.ns_front?.tread || { ...DEFAULT_TREAD }, details: { ...sourceTyre.details } },
        ns_rear: { tread: prev.ns_rear?.tread || { ...DEFAULT_TREAD }, details: { ...sourceTyre.details } },
        os_rear: { tread: prev.os_rear?.tread || { ...DEFAULT_TREAD }, details: { ...sourceTyre.details } }
      }
      onChange(newTyres)
      return newTyres
    })
  }, [tyres, onChange])

  const getTyreRAG = (tyre: TyreValue | null): 'green' | 'amber' | 'red' | null => {
    if (!tyre?.tread) return null
    const lowest = Math.min(tyre.tread.outer, tyre.tread.middle, tyre.tread.inner)
    if (lowest < redBelowMm) return 'red'
    if (lowest < amberBelowMm) return 'amber'
    return 'green'
  }

  const getTyreLowest = (tyre: TyreValue | null): number | null => {
    if (!tyre?.tread) return null
    return Math.min(tyre.tread.outer, tyre.tread.middle, tyre.tread.inner)
  }

  return (
    <div className="space-y-4">
      {/* Tab selector */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveTab('details')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'details'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tyre Details
        </button>
        <button
          onClick={() => setActiveTab('tread')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'tread'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Tyre Tread
        </button>
      </div>

      {/* Visual summary - car diagram */}
      <div className="relative bg-gray-50 rounded-lg p-4">
        <div className="text-xs text-center text-gray-500 mb-2">FRONT</div>
        <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
          {/* Front row */}
          <TyreSummaryBox
            position="ns_front"
            label="N/S"
            rag={getTyreRAG(tyres.ns_front)}
            lowest={getTyreLowest(tyres.ns_front)}
            manufacturerName={tyres.ns_front?.details?.manufacturerName}
            isExpanded={expandedTyre === 'ns_front'}
            onClick={() => setExpandedTyre(expandedTyre === 'ns_front' ? null : 'ns_front')}
          />
          <TyreSummaryBox
            position="os_front"
            label="O/S"
            rag={getTyreRAG(tyres.os_front)}
            lowest={getTyreLowest(tyres.os_front)}
            manufacturerName={tyres.os_front?.details?.manufacturerName}
            isExpanded={expandedTyre === 'os_front'}
            onClick={() => setExpandedTyre(expandedTyre === 'os_front' ? null : 'os_front')}
          />
          {/* Rear row */}
          <TyreSummaryBox
            position="ns_rear"
            label="N/S"
            rag={getTyreRAG(tyres.ns_rear)}
            lowest={getTyreLowest(tyres.ns_rear)}
            manufacturerName={tyres.ns_rear?.details?.manufacturerName}
            isExpanded={expandedTyre === 'ns_rear'}
            onClick={() => setExpandedTyre(expandedTyre === 'ns_rear' ? null : 'ns_rear')}
          />
          <TyreSummaryBox
            position="os_rear"
            label="O/S"
            rag={getTyreRAG(tyres.os_rear)}
            lowest={getTyreLowest(tyres.os_rear)}
            manufacturerName={tyres.os_rear?.details?.manufacturerName}
            isExpanded={expandedTyre === 'os_rear'}
            onClick={() => setExpandedTyre(expandedTyre === 'os_rear' ? null : 'os_rear')}
          />
        </div>
        <div className="text-xs text-center text-gray-500 mt-2">REAR</div>
      </div>

      {/* Expanded tyre detail */}
      {expandedTyre && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
            <span className="font-semibold text-gray-700">
              {TYRE_POSITIONS.find(p => p.key === expandedTyre)?.label} Tyre
            </span>
            <button
              onClick={() => handleCopyToAll(expandedTyre)}
              className="text-xs text-primary font-medium px-3 py-1 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
            >
              COPY TO ALL
            </button>
          </div>

          <div className="p-4">
            {activeTab === 'details' ? (
              /* Tyre Details Tab */
              <div className="space-y-4">
                {loadingRef ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : (
                  <>
                    {/* Manufacturer */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Manufacturer
                      </label>
                      <select
                        value={tyres[expandedTyre]?.details?.manufacturerId || ''}
                        onChange={(e) => handleDetailsChange(expandedTyre, 'manufacturerId', e.target.value)}
                        className="w-full h-12 px-3 border border-gray-300 rounded-lg bg-white text-base"
                      >
                        <option value="">Select manufacturer...</option>
                        {manufacturers.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Size */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Size
                      </label>
                      <select
                        value={tyres[expandedTyre]?.details?.sizeId || ''}
                        onChange={(e) => handleDetailsChange(expandedTyre, 'sizeId', e.target.value)}
                        className="w-full h-12 px-3 border border-gray-300 rounded-lg bg-white text-base"
                      >
                        <option value="">Select size...</option>
                        {tyreSizes.map(s => (
                          <option key={s.id} value={s.id}>{s.size}</option>
                        ))}
                      </select>
                    </div>

                    {/* Speed & Load ratings in a row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Speed Rating
                        </label>
                        <select
                          value={tyres[expandedTyre]?.details?.speedRating || ''}
                          onChange={(e) => handleDetailsChange(expandedTyre, 'speedRating', e.target.value)}
                          className="w-full h-12 px-3 border border-gray-300 rounded-lg bg-white text-base"
                        >
                          <option value="">Select...</option>
                          {speedRatings.map(r => (
                            <option key={r.id} value={r.code}>{r.code}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Load Rating
                        </label>
                        <select
                          value={tyres[expandedTyre]?.details?.loadRating || ''}
                          onChange={(e) => handleDetailsChange(expandedTyre, 'loadRating', e.target.value)}
                          className="w-full h-12 px-3 border border-gray-300 rounded-lg bg-white text-base"
                        >
                          <option value="">Select...</option>
                          {loadRatings.map(r => (
                            <option key={r.id} value={r.code}>{r.code}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Tyre Tread Tab */
              <div className="grid grid-cols-3 gap-4">
                <TreadDepthSlider
                  label="OUTER"
                  value={tyres[expandedTyre]?.tread.outer ?? 5.0}
                  onChange={(v) => handleTreadChange(expandedTyre, 'outer', v)}
                  thresholds={thresholds}
                />
                <TreadDepthSlider
                  label="MIDDLE"
                  value={tyres[expandedTyre]?.tread.middle ?? 5.0}
                  onChange={(v) => handleTreadChange(expandedTyre, 'middle', v)}
                  thresholds={thresholds}
                />
                <TreadDepthSlider
                  label="INNER"
                  value={tyres[expandedTyre]?.tread.inner ?? 5.0}
                  onChange={(v) => handleTreadChange(expandedTyre, 'inner', v)}
                  thresholds={thresholds}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend (only on tread tab) */}
      {activeTab === 'tread' && (
        <div className="flex justify-center gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-rag-green" /> ≥{amberBelowMm}mm
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-rag-amber" /> {redBelowMm}-{amberBelowMm}mm
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-rag-red" /> {'<'}{redBelowMm}mm
          </span>
        </div>
      )}
    </div>
  )
}

// Summary box for each tyre position
interface TyreSummaryBoxProps {
  position: TyrePosition
  label: string
  rag: 'green' | 'amber' | 'red' | null
  lowest: number | null
  manufacturerName?: string
  isExpanded: boolean
  onClick: () => void
}

function TyreSummaryBox({ label, rag, lowest, manufacturerName, isExpanded, onClick }: TyreSummaryBoxProps) {
  const ragClasses = {
    green: 'border-green-500 bg-green-50',
    amber: 'border-amber-500 bg-amber-50',
    red: 'border-red-500 bg-red-50',
    null: 'border-gray-300 bg-white'
  }

  const ragIndicatorClasses = {
    green: 'bg-rag-green',
    amber: 'bg-rag-amber',
    red: 'bg-rag-red',
    null: 'bg-gray-300'
  }

  return (
    <button
      onClick={onClick}
      className={`
        p-3 border-2 rounded-lg transition-all text-left
        ${isExpanded ? 'ring-2 ring-primary ring-offset-1' : ''}
        ${ragClasses[rag ?? 'null']}
      `}
    >
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <div className={`w-3 h-3 rounded-full ${ragIndicatorClasses[rag ?? 'null']}`} />
          <span className="font-mono font-bold text-lg">
            {lowest !== null ? `${lowest.toFixed(1)}` : '--'}
          </span>
        </div>
      </div>
      {manufacturerName && (
        <div className="text-xs text-gray-500 mt-1 truncate">{manufacturerName}</div>
      )}
      {!manufacturerName && (
        <div className="text-xs text-gray-400 mt-1">mm min</div>
      )}
    </button>
  )
}
