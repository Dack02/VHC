import { useState, useCallback } from 'react'
import { useThresholds } from '../context/ThresholdsContext'
import { NumericPicker } from './NumericPicker'

type BrakeType = 'disc' | 'drum'

// Single axle measurement structure (used for ONE axle - Front OR Rear)
interface BrakeMeasurementValue {
  brake_type: BrakeType
  nearside: {
    pad: number | null
    disc: number | null
    disc_min: number | null
  }
  offside: {
    pad: number | null
    disc: number | null
    disc_min: number | null
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
  nearside: { pad: null, disc: null, disc_min: null },
  offside: { pad: null, disc: null, disc_min: null }
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
        nearside: value.nearside || { pad: null, disc: null, disc_min: null },
        offside: value.offside || { pad: null, disc: null, disc_min: null }
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
    const padValues: number[] = []
    let hasDiscBelowMinSpec = false

    // Collect pad measurements
    if (m.nearside.pad !== null) padValues.push(m.nearside.pad)
    if (m.offside.pad !== null) padValues.push(m.offside.pad)

    // Check disc measurements against min specs
    if (m.brake_type === 'disc') {
      if (m.nearside.disc !== null && m.nearside.disc_min !== null) {
        if (m.nearside.disc < m.nearside.disc_min) {
          hasDiscBelowMinSpec = true
        }
      }
      if (m.offside.disc !== null && m.offside.disc_min !== null) {
        if (m.offside.disc < m.offside.disc_min) {
          hasDiscBelowMinSpec = true
        }
      }
    }

    const hasAnyMeasurement = padValues.length > 0 ||
      m.nearside.disc !== null || m.offside.disc !== null

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
      const newMeasurement = { ...prev, brake_type: type }
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
          {measurement.brake_type === 'disc' && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-500 uppercase">Disc</div>
              <NumericPicker
                label="Actual"
                value={measurement.nearside.disc}
                onChange={(v) => handleDiscChange('nearside', v)}
                min={15}
                max={35}
                step={1}
                unit="mm"
              />
              <NumericPicker
                label="Min Spec"
                value={measurement.nearside.disc_min}
                onChange={(v) => handleDiscMinChange('nearside', v)}
                min={15}
                max={35}
                step={1}
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
            </div>
          )}
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
          {measurement.brake_type === 'disc' && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-500 uppercase">Disc</div>
              <NumericPicker
                label="Actual"
                value={measurement.offside.disc}
                onChange={(v) => handleDiscChange('offside', v)}
                min={15}
                max={35}
                step={1}
                unit="mm"
              />
              <NumericPicker
                label="Min Spec"
                value={measurement.offside.disc_min}
                onChange={(v) => handleDiscMinChange('offside', v)}
                min={15}
                max={35}
                step={1}
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
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-200">
        <p><span className="inline-block w-3 h-3 bg-rag-green mr-1 rounded" /> Disc ≥ Min Spec / Pad ≥{warnPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-amber mr-1 rounded" /> Pad ≥{minPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-red mr-1 rounded" /> Disc &lt; Min Spec or Pad &lt;{minPad}mm</p>
      </div>
    </div>
  )
}

