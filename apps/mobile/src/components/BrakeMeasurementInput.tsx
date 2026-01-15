import { useState, useEffect, useCallback, useRef } from 'react'
import { useThresholds } from '../context/ThresholdsContext'
import { NumericPicker } from './NumericPicker'

type BrakeType = 'disc' | 'drum'

interface AxleMeasurement {
  brake_type: BrakeType
  ns_pad: number | null    // Near Side pad thickness
  ns_disc: number | null   // Near Side disc thickness (actual)
  ns_disc_min: number | null // Near Side disc minimum spec
  os_pad: number | null    // Off Side pad thickness
  os_disc: number | null   // Off Side disc thickness (actual)
  os_disc_min: number | null // Off Side disc minimum spec
}

interface BrakeMeasurementValue {
  front: AxleMeasurement
  rear: AxleMeasurement
}

interface BrakeMeasurementInputProps {
  value: BrakeMeasurementValue | undefined
  onChange: (value: BrakeMeasurementValue) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: Record<string, unknown> // Kept for compatibility but no longer used for thresholds
}

const DEFAULT_AXLE: AxleMeasurement = {
  brake_type: 'disc',
  ns_pad: null,
  ns_disc: null,
  ns_disc_min: null,
  os_pad: null,
  os_disc: null,
  os_disc_min: null
}

export function BrakeMeasurementInput({
  value,
  onChange,
  onRAGChange,
  config: _config // Kept for compatibility
}: BrakeMeasurementInputProps) {
  const { thresholds: orgThresholds } = useThresholds()
  const [measurements, setMeasurements] = useState<BrakeMeasurementValue>(() => {
    if (value?.front || value?.rear) {
      return {
        front: value.front || { ...DEFAULT_AXLE },
        rear: value.rear || { ...DEFAULT_AXLE }
      }
    }
    return {
      front: { ...DEFAULT_AXLE },
      rear: { ...DEFAULT_AXLE }
    }
  })

  // Use organization thresholds for brake pads only
  // Disc thresholds are vehicle-specific (actual vs manufacturer min spec)
  const minPad = orgThresholds.brakePadRedBelowMm
  const warnPad = orgThresholds.brakePadAmberBelowMm

  // Void the unused config to suppress linter warning
  void _config

  // Track the last RAG status using ref to avoid causing re-renders and infinite loops
  const lastRAGRef = useRef<'green' | 'amber' | 'red' | null>(null)

  // Store callback in ref to avoid triggering effect on every parent re-render
  const onRAGChangeRef = useRef(onRAGChange)
  onRAGChangeRef.current = onRAGChange

  // Track if user has interacted - don't auto-save on mount
  const hasUserInteracted = useRef(false)

  // Calculate RAG based on measurements
  useEffect(() => {
    const allPadValues: number[] = []
    let hasDiscBelowMinSpec = false

    // Collect all measurements
    ;['front', 'rear'].forEach((axle) => {
      const m = measurements[axle as keyof BrakeMeasurementValue]
      if (m.ns_pad !== null) allPadValues.push(m.ns_pad)
      if (m.os_pad !== null) allPadValues.push(m.os_pad)

      // Check disc measurements against their min specs
      if (m.brake_type === 'disc') {
        // NS disc: actual vs min spec
        if (m.ns_disc !== null && m.ns_disc_min !== null) {
          if (m.ns_disc < m.ns_disc_min) {
            hasDiscBelowMinSpec = true
          }
        }
        // OS disc: actual vs min spec
        if (m.os_disc !== null && m.os_disc_min !== null) {
          if (m.os_disc < m.os_disc_min) {
            hasDiscBelowMinSpec = true
          }
        }
      }
    })

    let newRAG: 'green' | 'amber' | 'red' | null = null

    // Check if any measurements entered
    const hasAnyMeasurement = allPadValues.length > 0 ||
      measurements.front.ns_disc !== null || measurements.front.os_disc !== null ||
      measurements.rear.ns_disc !== null || measurements.rear.os_disc !== null

    if (!hasAnyMeasurement) {
      newRAG = null
    } else {
      // Check for red conditions
      const hasRedPad = allPadValues.some((v) => v < minPad)

      // Disc below min spec = RED (replacement required)
      if (hasRedPad || hasDiscBelowMinSpec) {
        newRAG = 'red'
      } else {
        // Check for amber conditions (pads only - discs are either OK or need replacement)
        const hasAmberPad = allPadValues.some((v) => v < warnPad)

        if (hasAmberPad) {
          newRAG = 'amber'
        } else {
          newRAG = 'green'
        }
      }
    }

    // Only call onRAGChange if the status actually changed AND user has interacted
    if (newRAG !== lastRAGRef.current) {
      lastRAGRef.current = newRAG
      if (hasUserInteracted.current) {
        onRAGChangeRef.current(newRAG)
      }
    }
  }, [measurements, minPad, warnPad]) // Removed disc thresholds - using per-measurement min spec instead

  const handleAxleChange = useCallback((
    axle: 'front' | 'rear',
    field: keyof AxleMeasurement,
    newValue: BrakeType | number | null
  ) => {
    hasUserInteracted.current = true
    setMeasurements((prev) => {
      const newMeasurements = {
        ...prev,
        [axle]: {
          ...prev[axle],
          [field]: newValue
        }
      }
      onChange(newMeasurements)
      return newMeasurements
    })
  }, [onChange])

  const handleCopyToRear = useCallback(() => {
    hasUserInteracted.current = true
    if ('vibrate' in navigator) {
      navigator.vibrate(100)
    }

    setMeasurements((prev) => {
      const newMeasurements = {
        ...prev,
        rear: { ...prev.front }
      }
      onChange(newMeasurements)
      return newMeasurements
    })
  }, [onChange])

  return (
    <div className="space-y-6">
      {/* Front Brakes */}
      <AxleSection
        title="FRONT BRAKES"
        axle={measurements.front}
        onBrakeTypeChange={(type) => handleAxleChange('front', 'brake_type', type)}
        onPadChange={(side, val) => handleAxleChange('front', side === 'ns' ? 'ns_pad' : 'os_pad', val)}
        onDiscChange={(side, val) => handleAxleChange('front', side === 'ns' ? 'ns_disc' : 'os_disc', val)}
        onDiscMinChange={(side, val) => handleAxleChange('front', side === 'ns' ? 'ns_disc_min' : 'os_disc_min', val)}
        padThresholds={{ red: minPad, amber: warnPad }}
        showCopyButton
        onCopy={handleCopyToRear}
      />

      {/* Rear Brakes */}
      <AxleSection
        title="REAR BRAKES"
        axle={measurements.rear}
        onBrakeTypeChange={(type) => handleAxleChange('rear', 'brake_type', type)}
        onPadChange={(side, val) => handleAxleChange('rear', side === 'ns' ? 'ns_pad' : 'os_pad', val)}
        onDiscChange={(side, val) => handleAxleChange('rear', side === 'ns' ? 'ns_disc' : 'os_disc', val)}
        onDiscMinChange={(side, val) => handleAxleChange('rear', side === 'ns' ? 'ns_disc_min' : 'os_disc_min', val)}
        padThresholds={{ red: minPad, amber: warnPad }}
      />

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><span className="inline-block w-3 h-3 bg-rag-green mr-1" /> Disc ≥ Min Spec / Pad ≥{warnPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-amber mr-1" /> Pad ≥{minPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-red mr-1" /> Disc &lt; Min Spec or Pad &lt;{minPad}mm - requires replacement</p>
      </div>
    </div>
  )
}

interface AxleSectionProps {
  title: string
  axle: AxleMeasurement
  onBrakeTypeChange: (type: BrakeType) => void
  onPadChange: (side: 'ns' | 'os', value: number) => void
  onDiscChange: (side: 'ns' | 'os', value: number) => void
  onDiscMinChange: (side: 'ns' | 'os', value: number) => void
  padThresholds: { red: number; amber: number }
  showCopyButton?: boolean
  onCopy?: () => void
}

function AxleSection({
  title,
  axle,
  onBrakeTypeChange,
  onPadChange,
  onDiscChange,
  onDiscMinChange,
  padThresholds,
  showCopyButton,
  onCopy
}: AxleSectionProps) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <span className="font-semibold text-gray-700">{title}</span>
        {showCopyButton && onCopy && (
          <button
            onClick={onCopy}
            className="text-xs text-primary font-medium px-3 py-1 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
          >
            COPY TO REAR
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Brake Type Toggle */}
        <div>
          <label className="block text-sm text-gray-500 mb-2">Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if ('vibrate' in navigator) navigator.vibrate(30)
                onBrakeTypeChange('disc')
              }}
              className={`
                flex-1 py-3 font-medium text-sm border-2 transition-all
                ${axle.brake_type === 'disc'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                }
              `}
            >
              Disc
            </button>
            <button
              onClick={() => {
                if ('vibrate' in navigator) navigator.vibrate(30)
                onBrakeTypeChange('drum')
              }}
              className={`
                flex-1 py-3 font-medium text-sm border-2 transition-all
                ${axle.brake_type === 'drum'
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
          {/* N/S Column */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-center text-gray-600 border-b border-gray-200 pb-2">
              N/S
            </div>
            <NumericPicker
              label="Pad"
              value={axle.ns_pad}
              onChange={(v) => onPadChange('ns', v)}
              min={0}
              max={15}
              step={1}
              unit="mm"
              thresholds={padThresholds}
            />
            {axle.brake_type === 'disc' && (
              <DiscMeasurement
                actual={axle.ns_disc}
                minSpec={axle.ns_disc_min}
                onActualChange={(v) => onDiscChange('ns', v)}
                onMinSpecChange={(v) => onDiscMinChange('ns', v)}
              />
            )}
          </div>

          {/* O/S Column */}
          <div className="space-y-3">
            <div className="text-sm font-medium text-center text-gray-600 border-b border-gray-200 pb-2">
              O/S
            </div>
            <NumericPicker
              label="Pad"
              value={axle.os_pad}
              onChange={(v) => onPadChange('os', v)}
              min={0}
              max={15}
              step={1}
              unit="mm"
              thresholds={padThresholds}
            />
            {axle.brake_type === 'disc' && (
              <DiscMeasurement
                actual={axle.os_disc}
                minSpec={axle.os_disc_min}
                onActualChange={(v) => onDiscChange('os', v)}
                onMinSpecChange={(v) => onDiscMinChange('os', v)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Disc measurement component showing actual vs min spec
interface DiscMeasurementProps {
  actual: number | null
  minSpec: number | null
  onActualChange: (value: number) => void
  onMinSpecChange: (value: number) => void
}

function DiscMeasurement({ actual, minSpec, onActualChange, onMinSpecChange }: DiscMeasurementProps) {
  // Determine status based on actual vs min spec
  const getStatus = (): 'green' | 'red' | null => {
    if (actual === null || minSpec === null) return null
    return actual < minSpec ? 'red' : 'green'
  }

  const status = getStatus()

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase">Disc</div>

      <div className="space-y-2">
        {/* Actual thickness */}
        <NumericPicker
          label="Actual"
          value={actual}
          onChange={onActualChange}
          min={15}
          max={35}
          step={1}
          unit="mm"
        />

        {/* Min spec */}
        <NumericPicker
          label="Min Spec"
          value={minSpec}
          onChange={onMinSpecChange}
          min={15}
          max={35}
          step={1}
          unit="mm"
        />
      </div>

      {/* Status indicator */}
      {status && (
        <div className={`
          px-2 py-1 text-xs font-medium text-center rounded
          ${status === 'red' ? 'bg-rag-red text-white' : 'bg-rag-green text-white'}
        `}>
          {status === 'red' ? 'REPLACEMENT REQUIRED' : 'OK'}
        </div>
      )}
    </div>
  )
}
