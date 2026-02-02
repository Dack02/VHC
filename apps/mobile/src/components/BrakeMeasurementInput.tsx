import { useState, useCallback } from 'react'
import { useThresholds } from '../context/ThresholdsContext'
import { NumericPicker } from './NumericPicker'
import { DecimalPicker } from './DecimalPicker'

type BrakeType = 'disc' | 'drum'

// Single axle measurement structure (used for ONE axle - Front OR Rear)
interface BrakeMeasurementValue {
  brake_type: BrakeType
  nearside: {
    pad: number | null
    disc: number | null
    disc_min: number | null
    disc_unable_to_access?: boolean
  }
  offside: {
    pad: number | null
    disc: number | null
    disc_min: number | null
    disc_unable_to_access?: boolean
  }
}

interface BrakeMeasurementInputProps {
  value: BrakeMeasurementValue | undefined
  onChange: (value: BrakeMeasurementValue, ragStatus: 'green' | 'amber' | 'red' | null) => void
  onRAGChange?: (status: 'green' | 'amber' | 'red' | null) => void  // Optional for backward compat
  config?: Record<string, unknown>
}

const DEFAULT_VALUE: BrakeMeasurementValue = {
  brake_type: 'disc',
  nearside: { pad: null, disc: null, disc_min: null, disc_unable_to_access: false },
  offside: { pad: null, disc: null, disc_min: null, disc_unable_to_access: false }
}

export function BrakeMeasurementInput({
  value,
  onChange,
  onRAGChange,
  config: _config
}: BrakeMeasurementInputProps) {
  const { thresholds: orgThresholds } = useThresholds()

  // Initialize with provided value or defaults
  const [measurement, setMeasurement] = useState<BrakeMeasurementValue>(() => {
    if (value?.nearside || value?.offside) {
      return {
        brake_type: value.brake_type || 'disc',
        nearside: value.nearside || { pad: null, disc: null, disc_min: null, disc_unable_to_access: false },
        offside: value.offside || { pad: null, disc: null, disc_min: null, disc_unable_to_access: false }
      }
    }
    return { ...DEFAULT_VALUE }
  })

  // Use organization thresholds for brake pads
  const minPad = orgThresholds.brakePadRedBelowMm
  const warnPad = orgThresholds.brakePadAmberBelowMm

  void _config

  // Calculate RAG status for a given measurement
  const calculateRAG = useCallback((m: BrakeMeasurementValue): 'green' | 'amber' | 'red' | null => {
    // Drum brakes are visual-only — always green (pass)
    if (m.brake_type === 'drum') {
      return 'green'
    }

    const padValues: number[] = []
    let hasDiscBelowMinSpec = false

    // Collect pad measurements
    if (m.nearside.pad !== null) padValues.push(m.nearside.pad)
    if (m.offside.pad !== null) padValues.push(m.offside.pad)

    // Check disc measurements against min specs (skip if unable to access)
    if (!m.nearside.disc_unable_to_access && m.nearside.disc !== null && m.nearside.disc_min !== null) {
      if (m.nearside.disc < m.nearside.disc_min) {
        hasDiscBelowMinSpec = true
      }
    }
    if (!m.offside.disc_unable_to_access && m.offside.disc !== null && m.offside.disc_min !== null) {
      if (m.offside.disc < m.offside.disc_min) {
        hasDiscBelowMinSpec = true
      }
    }

    // Consider disc accessible if not marked as unable_to_access
    const nsDiscAccessible = !m.nearside.disc_unable_to_access
    const osDiscAccessible = !m.offside.disc_unable_to_access
    const hasAnyMeasurement = padValues.length > 0 ||
      (nsDiscAccessible && m.nearside.disc !== null) ||
      (osDiscAccessible && m.offside.disc !== null)

    if (!hasAnyMeasurement) {
      return null
    }

    const hasRedPad = padValues.some((v) => v < minPad)
    if (hasRedPad || hasDiscBelowMinSpec) {
      return 'red'
    }

    const hasAmberPad = padValues.some((v) => v < warnPad)
    return hasAmberPad ? 'amber' : 'green'
  }, [minPad, warnPad])

  const handleBrakeTypeChange = useCallback((type: BrakeType) => {
    if ('vibrate' in navigator) navigator.vibrate(30)
    setMeasurement((prev) => {
      const newMeasurement: BrakeMeasurementValue = type === 'drum'
        ? {
            brake_type: 'drum',
            nearside: { pad: null, disc: null, disc_min: null, disc_unable_to_access: false },
            offside: { pad: null, disc: null, disc_min: null, disc_unable_to_access: false }
          }
        : { ...prev, brake_type: type }
      const ragStatus = calculateRAG(newMeasurement)
      onChange(newMeasurement, ragStatus)
      onRAGChange?.(ragStatus)
      return newMeasurement
    })
  }, [onChange, onRAGChange, calculateRAG])

  const handlePadChange = useCallback((side: 'nearside' | 'offside', val: number) => {
    setMeasurement((prev) => {
      const newMeasurement = {
        ...prev,
        [side]: { ...prev[side], pad: val }
      }
      const ragStatus = calculateRAG(newMeasurement)
      onChange(newMeasurement, ragStatus)
      onRAGChange?.(ragStatus)
      return newMeasurement
    })
  }, [onChange, onRAGChange, calculateRAG])

  const handleDiscChange = useCallback((side: 'nearside' | 'offside', val: number) => {
    setMeasurement((prev) => {
      const newMeasurement = {
        ...prev,
        [side]: { ...prev[side], disc: val }
      }
      const ragStatus = calculateRAG(newMeasurement)
      onChange(newMeasurement, ragStatus)
      onRAGChange?.(ragStatus)
      return newMeasurement
    })
  }, [onChange, onRAGChange, calculateRAG])

  const handleDiscMinChange = useCallback((side: 'nearside' | 'offside', val: number) => {
    setMeasurement((prev) => {
      const newMeasurement = {
        ...prev,
        [side]: { ...prev[side], disc_min: val }
      }
      const ragStatus = calculateRAG(newMeasurement)
      onChange(newMeasurement, ragStatus)
      onRAGChange?.(ragStatus)
      return newMeasurement
    })
  }, [onChange, onRAGChange, calculateRAG])

  const handleUnableToAccessChange = useCallback((side: 'nearside' | 'offside', checked: boolean) => {
    if ('vibrate' in navigator) navigator.vibrate(30)
    setMeasurement((prev) => {
      const newMeasurement = {
        ...prev,
        [side]: {
          ...prev[side],
          disc_unable_to_access: checked,
          // Clear disc measurements when marking as unable to access
          ...(checked ? { disc: null, disc_min: null } : {})
        }
      }
      const ragStatus = calculateRAG(newMeasurement)
      onChange(newMeasurement, ragStatus)
      onRAGChange?.(ragStatus)
      return newMeasurement
    })
  }, [onChange, onRAGChange, calculateRAG])

  const getDiscColor = (disc: number | null, discMin: number | null): 'default' | 'red' | 'green' => {
    if (disc === null || discMin === null) return 'default'
    return disc < discMin ? 'red' : 'green'
  }

  return (
    <div className="space-y-4">
      {/* Brake Type Toggle */}
      <div>
        <label className="block text-sm text-gray-500 mb-2">Type</label>
        <div className="flex gap-2">
          <button
            onClick={() => handleBrakeTypeChange('disc')}
            className={`
              flex-1 py-3 font-medium text-sm border-2 transition-all rounded
              ${measurement.brake_type === 'disc'
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }
            `}
          >
            Disc
          </button>
          <button
            onClick={() => handleBrakeTypeChange('drum')}
            className={`
              flex-1 py-3 font-medium text-sm border-2 transition-all rounded
              ${measurement.brake_type === 'drum'
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }
            `}
          >
            Drum
          </button>
        </div>
      </div>

      {measurement.brake_type === 'drum' ? (
        /* Drum: visual inspection only — no measurements needed */
        <div className="py-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-rag-green/10 border border-rag-green/30 rounded-lg">
            <svg className="w-5 h-5 text-rag-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-medium text-gray-700">Visual inspection only</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">No measurements required for drum brakes</p>
        </div>
      ) : (
        /* Disc: full measurement grid */
        <>
          {/* N/S and O/S columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* N/S (Nearside) Column */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-center text-gray-600 border-b border-gray-200 pb-2">
                N/S
              </div>
              <NumericPicker
                label="Pad"
                value={measurement.nearside.pad}
                onChange={(v) => handlePadChange('nearside', v)}
                min={0}
                max={15}
                step={1}
                unit="mm"
                thresholds={{ red: minPad, amber: warnPad }}
              />
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-500 uppercase">Disc</div>
                {/* Unable to access checkbox */}
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={measurement.nearside.disc_unable_to_access || false}
                    onChange={(e) => handleUnableToAccessChange('nearside', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-600">Unable to access</span>
                </label>
                {measurement.nearside.disc_unable_to_access ? (
                  <div className="px-2 py-2 text-xs font-medium text-center rounded bg-gray-200 text-gray-600">
                    NOT ACCESSIBLE
                  </div>
                ) : (
                  <>
                    <DecimalPicker
                      label="Actual"
                      value={measurement.nearside.disc}
                      onChange={(v) => handleDiscChange('nearside', v)}
                      wholeMin={8}
                      wholeMax={35}
                      unit="mm"
                      color={getDiscColor(measurement.nearside.disc, measurement.nearside.disc_min)}
                    />
                    <DecimalPicker
                      label="Min Spec"
                      value={measurement.nearside.disc_min}
                      onChange={(v) => handleDiscMinChange('nearside', v)}
                      wholeMin={8}
                      wholeMax={35}
                      unit="mm"
                    />
                    {/* Status indicator */}
                    {measurement.nearside.disc !== null && measurement.nearside.disc_min !== null && (
                      <div className={`
                        px-2 py-1 text-xs font-medium text-center rounded
                        ${measurement.nearside.disc < measurement.nearside.disc_min
                          ? 'bg-rag-red text-white'
                          : 'bg-rag-green text-white'
                        }
                      `}>
                        {measurement.nearside.disc < measurement.nearside.disc_min ? 'REPLACEMENT REQUIRED' : 'OK'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* O/S (Offside) Column */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-center text-gray-600 border-b border-gray-200 pb-2">
                O/S
              </div>
              <NumericPicker
                label="Pad"
                value={measurement.offside.pad}
                onChange={(v) => handlePadChange('offside', v)}
                min={0}
                max={15}
                step={1}
                unit="mm"
                thresholds={{ red: minPad, amber: warnPad }}
              />
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-500 uppercase">Disc</div>
                {/* Unable to access checkbox */}
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={measurement.offside.disc_unable_to_access || false}
                    onChange={(e) => handleUnableToAccessChange('offside', e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-gray-600">Unable to access</span>
                </label>
                {measurement.offside.disc_unable_to_access ? (
                  <div className="px-2 py-2 text-xs font-medium text-center rounded bg-gray-200 text-gray-600">
                    NOT ACCESSIBLE
                  </div>
                ) : (
                  <>
                    <DecimalPicker
                      label="Actual"
                      value={measurement.offside.disc}
                      onChange={(v) => handleDiscChange('offside', v)}
                      wholeMin={8}
                      wholeMax={35}
                      unit="mm"
                      color={getDiscColor(measurement.offside.disc, measurement.offside.disc_min)}
                    />
                    <DecimalPicker
                      label="Min Spec"
                      value={measurement.offside.disc_min}
                      onChange={(v) => handleDiscMinChange('offside', v)}
                      wholeMin={8}
                      wholeMax={35}
                      unit="mm"
                    />
                    {/* Status indicator */}
                    {measurement.offside.disc !== null && measurement.offside.disc_min !== null && (
                      <div className={`
                        px-2 py-1 text-xs font-medium text-center rounded
                        ${measurement.offside.disc < measurement.offside.disc_min
                          ? 'bg-rag-red text-white'
                          : 'bg-rag-green text-white'
                        }
                      `}>
                        {measurement.offside.disc < measurement.offside.disc_min ? 'REPLACEMENT REQUIRED' : 'OK'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-200">
            <p><span className="inline-block w-3 h-3 bg-rag-green mr-1 rounded" /> Disc ≥ Min Spec / Pad ≥{warnPad}mm</p>
            <p><span className="inline-block w-3 h-3 bg-rag-amber mr-1 rounded" /> Pad ≥{minPad}mm</p>
            <p><span className="inline-block w-3 h-3 bg-rag-red mr-1 rounded" /> Disc &lt; Min Spec or Pad &lt;{minPad}mm</p>
          </div>
        </>
      )}
    </div>
  )
}

