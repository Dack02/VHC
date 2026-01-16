import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

// Tyre details (manufacturer, size, etc.) for one tyre
interface TyreDetail {
  manufacturerId?: string
  manufacturerName?: string
  sizeId?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
}

// All 4 tyres
interface TyreDetailsValue {
  front_left: TyreDetail
  front_right: TyreDetail
  rear_left: TyreDetail
  rear_right: TyreDetail
}

interface TyreDetailsInputProps {
  value: TyreDetailsValue | undefined
  onChange: (value: TyreDetailsValue) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: Record<string, unknown>
}

type TyrePosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'

const TYRE_POSITIONS: { key: TyrePosition; label: string }[] = [
  { key: 'front_left', label: 'Front Left' },
  { key: 'front_right', label: 'Front Right' },
  { key: 'rear_left', label: 'Rear Left' },
  { key: 'rear_right', label: 'Rear Right' }
]

const DEFAULT_DETAIL: TyreDetail = {}

// Reference data types
interface Manufacturer { id: string; name: string }
interface TyreSize { id: string; size: string }
interface SpeedRating { id: string; code: string; description: string }
interface LoadRating { id: string; code: string; maxLoadKg: number }

export function TyreDetailsInput({
  value,
  onChange,
  onRAGChange,
  config: _config
}: TyreDetailsInputProps) {
  const { session } = useAuth()

  // Reference data
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([])
  const [tyreSizes, setTyreSizes] = useState<TyreSize[]>([])
  const [speedRatings, setSpeedRatings] = useState<SpeedRating[]>([])
  const [loadRatings, setLoadRatings] = useState<LoadRating[]>([])
  const [loadingRef, setLoadingRef] = useState(true)

  // Initialize with defaults if empty
  const [tyres, setTyres] = useState<TyreDetailsValue>(() => {
    if (value && (value.front_left || value.front_right || value.rear_left || value.rear_right)) {
      return {
        front_left: value.front_left || { ...DEFAULT_DETAIL },
        front_right: value.front_right || { ...DEFAULT_DETAIL },
        rear_left: value.rear_left || { ...DEFAULT_DETAIL },
        rear_right: value.rear_right || { ...DEFAULT_DETAIL }
      }
    }
    return {
      front_left: { ...DEFAULT_DETAIL },
      front_right: { ...DEFAULT_DETAIL },
      rear_left: { ...DEFAULT_DETAIL },
      rear_right: { ...DEFAULT_DETAIL }
    }
  })

  void _config

  const onRAGChangeRef = useRef(onRAGChange)
  onRAGChangeRef.current = onRAGChange
  const hasUserInteracted = useRef(false)

  // Fetch reference data
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
  }, [])

  // Tyre details are always green once filled in
  useEffect(() => {
    if (!hasUserInteracted.current) return

    const hasSomeData = TYRE_POSITIONS.some(({ key }) => {
      const detail = tyres[key]
      return detail.manufacturerId || detail.sizeId
    })

    if (hasSomeData) {
      onRAGChangeRef.current('green')
    }
  }, [tyres])

  const handleDetailsChange = useCallback((
    position: TyrePosition,
    field: keyof TyreDetail,
    newValue: string | boolean
  ) => {
    hasUserInteracted.current = true
    setTyres((prev) => {
      const currentDetail = prev[position] || { ...DEFAULT_DETAIL }
      const details = { ...currentDetail }

      if (field === 'manufacturerId') {
        details.manufacturerId = newValue as string
        details.manufacturerName = manufacturers.find(m => m.id === newValue)?.name
      } else if (field === 'sizeId') {
        details.sizeId = newValue as string
        details.size = tyreSizes.find(s => s.id === newValue)?.size
      } else if (field === 'runFlat') {
        details.runFlat = newValue as boolean
      } else {
        (details as Record<string, unknown>)[field] = newValue
      }

      const newTyres = {
        ...prev,
        [position]: details
      }
      onChange(newTyres)
      return newTyres
    })
  }, [onChange, manufacturers, tyreSizes])

  const handleCopyToAll = useCallback(() => {
    const sourceTyre = tyres.front_left // Copy from first tyre (Front Left)
    if (!sourceTyre) return

    hasUserInteracted.current = true
    if ('vibrate' in navigator) {
      navigator.vibrate(100)
    }

    setTyres(() => {
      const newTyres: TyreDetailsValue = {
        front_left: { ...sourceTyre },
        front_right: { ...sourceTyre },
        rear_left: { ...sourceTyre },
        rear_right: { ...sourceTyre }
      }
      onChange(newTyres)
      return newTyres
    })
  }, [tyres, onChange])

  if (loadingRef) {
    return <div className="text-center py-8 text-gray-500">Loading tyre data...</div>
  }

  return (
    <div className="space-y-4">
      {/* Header with Copy button */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Tyre Specifications</h3>
        <button
          onClick={handleCopyToAll}
          className="text-xs text-primary font-medium px-3 py-1.5 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
        >
          Copy First Tyre to All
        </button>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-3">
        {TYRE_POSITIONS.map(({ key, label }) => (
          <div key={key} className="bg-gray-50 rounded-lg border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-600 mb-2 uppercase">{label}</div>

            {/* Manufacturer */}
            <select
              value={tyres[key]?.manufacturerId || ''}
              onChange={(e) => handleDetailsChange(key, 'manufacturerId', e.target.value)}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded bg-white mb-2"
            >
              <option value="">Manufacturer</option>
              {manufacturers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>

            {/* Size */}
            <select
              value={tyres[key]?.sizeId || ''}
              onChange={(e) => handleDetailsChange(key, 'sizeId', e.target.value)}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded bg-white mb-2"
            >
              <option value="">Size</option>
              {tyreSizes.map(s => (
                <option key={s.id} value={s.id}>{s.size}</option>
              ))}
            </select>

            {/* Speed & Load in row */}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={tyres[key]?.speedRating || ''}
                onChange={(e) => handleDetailsChange(key, 'speedRating', e.target.value)}
                className="h-10 px-2 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="">Speed</option>
                {speedRatings.map(r => (
                  <option key={r.id} value={r.code}>{r.code}</option>
                ))}
              </select>
              <select
                value={tyres[key]?.loadRating || ''}
                onChange={(e) => handleDetailsChange(key, 'loadRating', e.target.value)}
                className="h-10 px-2 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="">Load</option>
                {loadRatings.map(r => (
                  <option key={r.id} value={r.code}>{r.code}</option>
                ))}
              </select>
            </div>

            {/* Run Flat Toggle */}
            <button
              type="button"
              onClick={() => handleDetailsChange(key, 'runFlat', !tyres[key]?.runFlat)}
              className={`
                w-full mt-2 h-10 flex items-center justify-center gap-2 text-sm font-medium rounded border-2 transition-all
                ${tyres[key]?.runFlat
                  ? 'bg-amber-100 border-amber-500 text-amber-800'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                }
              `}
            >
              {tyres[key]?.runFlat ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  RUN FLAT
                </>
              ) : (
                'Run Flat?'
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
