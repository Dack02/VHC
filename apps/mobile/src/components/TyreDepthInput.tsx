import { useState, useCallback } from 'react'
import { useThresholds } from '../context/ThresholdsContext'
import { TreadDepthSlider } from './TreadDepthSlider'

// Damage severity levels
type DamageSeverity = 'advisory' | 'urgent'

// 3-point tread measurement for ONE tyre
// null means "not measured yet" - distinguishes from "measured at 0mm"
interface TyreDepthValue {
  outer: number | null
  middle: number | null
  inner: number | null
  damage?: string
  damageSeverity?: DamageSeverity
}

// Damage types
const DAMAGE_OPTIONS = ['None', 'Cut', 'Bulge', 'Cracking', 'Sidewall Damage', 'Other'] as const

interface TyreDepthInputProps {
  value: TyreDepthValue | undefined
  onChange: (value: TyreDepthValue, ragStatus: 'green' | 'amber' | 'red' | null) => void
  onRAGChange?: (status: 'green' | 'amber' | 'red' | null) => void  // Optional for backward compat
  config?: Record<string, unknown>
}

// Default is null (not measured) - sliders will show at 0mm visually
const DEFAULT_VALUE: TyreDepthValue = {
  outer: null,
  middle: null,
  inner: null,
  damage: 'None',
  damageSeverity: undefined
}

export function TyreDepthInput({
  value,
  onChange,
  onRAGChange,
  config: _config
}: TyreDepthInputProps) {
  const { thresholds: orgThresholds } = useThresholds()

  // Initialize with existing values or defaults (null = not measured)
  const [measurement, setMeasurement] = useState<TyreDepthValue>(() => {
    if (value && (value.outer !== undefined || value.middle !== undefined || value.inner !== undefined)) {
      return {
        outer: value.outer ?? null,
        middle: value.middle ?? null,
        inner: value.inner ?? null,
        damage: value.damage || 'None',
        damageSeverity: value.damageSeverity
      }
    }
    return { ...DEFAULT_VALUE }
  })

  // Use organization thresholds
  const redBelowMm = orgThresholds.tyreRedBelowMm
  const amberBelowMm = orgThresholds.tyreAmberBelowMm
  const thresholds = { red: redBelowMm, amber: amberBelowMm }

  void _config

  // Calculate RAG status for a given measurement
  const calculateRAG = useCallback((m: TyreDepthValue): 'green' | 'amber' | 'red' | null => {
    // Get all measured values (filter out nulls)
    const measuredValues = [m.outer, m.middle, m.inner]
      .filter((v): v is number => v !== null)

    const hasDamage = m.damage && m.damage !== 'None'
    const damageIsUrgent = hasDamage && m.damageSeverity === 'urgent'
    const damageIsAdvisory = hasDamage && m.damageSeverity === 'advisory'

    // If no measurements yet, RAG is null (incomplete)
    if (measuredValues.length === 0) {
      return null
    }

    const lowest = Math.min(...measuredValues)

    // Tread depth takes priority
    if (lowest < redBelowMm) {
      return 'red'
    } else if (lowest < amberBelowMm) {
      return 'amber'
    } else if (damageIsUrgent) {
      return 'red'
    } else if (damageIsAdvisory) {
      return 'amber'
    }
    return 'green'
  }, [redBelowMm, amberBelowMm])

  const handleDepthChange = (point: 'outer' | 'middle' | 'inner', newValue: number) => {
    setMeasurement((prev) => {
      const updated = { ...prev, [point]: newValue }
      const ragStatus = calculateRAG(updated)
      onChange(updated, ragStatus)
      onRAGChange?.(ragStatus)
      return updated
    })
  }

  const handleDamageChange = (damage: string) => {
    setMeasurement((prev) => {
      // Clear severity if damage is set to 'None'
      const updated = {
        ...prev,
        damage,
        damageSeverity: damage === 'None' ? undefined : prev.damageSeverity
      }
      const ragStatus = calculateRAG(updated)
      onChange(updated, ragStatus)
      onRAGChange?.(ragStatus)
      return updated
    })
  }

  const handleSeverityChange = (severity: DamageSeverity) => {
    if ('vibrate' in navigator) navigator.vibrate(30)
    setMeasurement((prev) => {
      const updated = { ...prev, damageSeverity: severity }
      const ragStatus = calculateRAG(updated)
      onChange(updated, ragStatus)
      onRAGChange?.(ragStatus)
      return updated
    })
  }

  // Calculate lowest for display (only from measured values)
  const measuredValues = [measurement.outer, measurement.middle, measurement.inner]
    .filter((v): v is number => v !== null)
  const lowest = measuredValues.length > 0 ? Math.min(...measuredValues) : null
  const rag = lowest === null ? null : lowest < redBelowMm ? 'red' : lowest < amberBelowMm ? 'amber' : 'green'

  // Count how many fields still need to be set
  const unmeasuredCount = 3 - measuredValues.length

  return (
    <div className="space-y-4">
      {/* Required fields indicator */}
      {unmeasuredCount > 0 && (
        <div className="bg-red-100 border-2 border-red-400 rounded-lg p-3 flex items-center gap-2">
          <span className="text-red-600 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-red-800">
              {unmeasuredCount} measurement{unmeasuredCount > 1 ? 's' : ''} required
            </p>
            <p className="text-xs text-red-600">
              Tap each slider to record the tread depth
            </p>
          </div>
        </div>
      )}

      {/* Depth summary */}
      <div className={`
        flex items-center justify-between p-3 rounded-lg border-2
        ${rag === null ? 'bg-gray-100 border-gray-400' :
          rag === 'green' ? 'bg-green-50 border-green-500' :
          rag === 'amber' ? 'bg-amber-50 border-amber-500' :
          'bg-red-50 border-red-500'
        }
      `}>
        <span className="text-sm font-medium text-gray-700">Lowest Reading</span>
        <span className={`
          text-xl font-bold
          ${rag === null ? 'text-gray-500' :
            rag === 'green' ? 'text-green-700' :
            rag === 'amber' ? 'text-amber-700' :
            'text-red-700'
          }
        `}>
          {lowest !== null ? `${lowest.toFixed(1)}mm` : '-- mm'}
        </span>
      </div>

      {/* Tread depth sliders */}
      <div className="grid grid-cols-3 gap-4">
        <div className="relative">
          <TreadDepthSlider
            label="OUTER"
            value={measurement.outer ?? 0}
            onChange={(v) => handleDepthChange('outer', v)}
            thresholds={thresholds}
          />
          {measurement.outer === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
                TAP TO SET
              </span>
            </div>
          )}
        </div>
        <div className="relative">
          <TreadDepthSlider
            label="MIDDLE"
            value={measurement.middle ?? 0}
            onChange={(v) => handleDepthChange('middle', v)}
            thresholds={thresholds}
          />
          {measurement.middle === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
                TAP TO SET
              </span>
            </div>
          )}
        </div>
        <div className="relative">
          <TreadDepthSlider
            label="INNER"
            value={measurement.inner ?? 0}
            onChange={(v) => handleDepthChange('inner', v)}
            thresholds={thresholds}
          />
          {measurement.inner === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">
                TAP TO SET
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Damage selection */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Damage</label>
          <select
            value={measurement.damage || 'None'}
            onChange={(e) => handleDamageChange(e.target.value)}
            className={`
              w-full h-12 px-3 text-sm border-2 rounded-lg bg-white
              ${measurement.damage && measurement.damage !== 'None'
                ? measurement.damageSeverity === 'urgent'
                  ? 'border-red-500 bg-red-50'
                  : 'border-amber-500 bg-amber-50'
                : 'border-gray-300'
              }
            `}
          >
            {DAMAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        {/* Severity picker - shown when damage is selected */}
        {measurement.damage && measurement.damage !== 'None' && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <label className="block text-xs font-semibold text-gray-600 mb-2 uppercase">
              Damage Severity
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSeverityChange('advisory')}
                className={`
                  py-3 px-4 rounded-lg font-medium text-sm transition-all border-2
                  ${measurement.damageSeverity === 'advisory'
                    ? 'bg-amber-500 text-white border-amber-600'
                    : 'bg-white text-amber-700 border-amber-300 hover:border-amber-400'
                  }
                `}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-lg">⚠️</span>
                  <span>Advisory</span>
                  <span className="text-xs opacity-75">(Amber)</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleSeverityChange('urgent')}
                className={`
                  py-3 px-4 rounded-lg font-medium text-sm transition-all border-2
                  ${measurement.damageSeverity === 'urgent'
                    ? 'bg-red-500 text-white border-red-600'
                    : 'bg-white text-red-700 border-red-300 hover:border-red-400'
                  }
                `}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-lg">🚨</span>
                  <span>Urgent</span>
                  <span className="text-xs opacity-75">(Red)</span>
                </div>
              </button>
            </div>
            {!measurement.damageSeverity && (
              <p className="text-xs text-red-600 mt-2 text-center font-medium">
                Please select a severity level
              </p>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-green rounded" /> ≥{amberBelowMm}mm
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-amber rounded" /> {redBelowMm}-{amberBelowMm}mm
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-red rounded" /> {'<'}{redBelowMm}mm
        </span>
      </div>
    </div>
  )
}
