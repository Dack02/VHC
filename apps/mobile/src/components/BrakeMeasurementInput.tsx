import { useState, useEffect } from 'react'

interface BrakeMeasurementValue {
  front_disc: number | null
  front_pad: number | null
  rear_disc: number | null
  rear_pad: number | null
}

interface BrakeMeasurementConfig {
  minDiscThickness?: number // Below this = red (default 20mm)
  minPadThickness?: number // Below this = red (default 3mm)
  warningDiscThickness?: number // Below this = amber (default 24mm)
  warningPadThickness?: number // Below this = amber (default 5mm)
}

interface BrakeMeasurementInputProps {
  value: BrakeMeasurementValue | undefined
  onChange: (value: BrakeMeasurementValue) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: BrakeMeasurementConfig
}

export function BrakeMeasurementInput({
  value,
  onChange,
  onRAGChange,
  config
}: BrakeMeasurementInputProps) {
  const [measurements, setMeasurements] = useState<BrakeMeasurementValue>(
    value || { front_disc: null, front_pad: null, rear_disc: null, rear_pad: null }
  )

  const minDisc = config?.minDiscThickness ?? 20
  const minPad = config?.minPadThickness ?? 3
  const warnDisc = config?.warningDiscThickness ?? 24
  const warnPad = config?.warningPadThickness ?? 5

  useEffect(() => {
    // Calculate RAG based on measurements
    const discValues = [measurements.front_disc, measurements.rear_disc].filter(
      (v): v is number => v !== null
    )
    const padValues = [measurements.front_pad, measurements.rear_pad].filter(
      (v): v is number => v !== null
    )

    if (discValues.length === 0 && padValues.length === 0) {
      onRAGChange(null)
      return
    }

    // Check for red conditions
    const hasRedDisc = discValues.some((v) => v < minDisc)
    const hasRedPad = padValues.some((v) => v < minPad)

    if (hasRedDisc || hasRedPad) {
      onRAGChange('red')
      return
    }

    // Check for amber conditions
    const hasAmberDisc = discValues.some((v) => v < warnDisc)
    const hasAmberPad = padValues.some((v) => v < warnPad)

    if (hasAmberDisc || hasAmberPad) {
      onRAGChange('amber')
      return
    }

    onRAGChange('green')
  }, [measurements, minDisc, minPad, warnDisc, warnPad, onRAGChange])

  const handleChange = (field: keyof BrakeMeasurementValue, valueStr: string) => {
    const numValue = valueStr === '' ? null : parseFloat(valueStr)

    const newMeasurements = {
      ...measurements,
      [field]: numValue
    }

    setMeasurements(newMeasurements)
    onChange(newMeasurements)
  }

  const getDiscColor = (value: number | null) => {
    if (value === null) return 'border-gray-300'
    if (value >= warnDisc) return 'border-rag-green bg-rag-green-bg'
    if (value >= minDisc) return 'border-rag-amber bg-rag-amber-bg'
    return 'border-rag-red bg-rag-red-bg'
  }

  const getPadColor = (value: number | null) => {
    if (value === null) return 'border-gray-300'
    if (value >= warnPad) return 'border-rag-green bg-rag-green-bg'
    if (value >= minPad) return 'border-rag-amber bg-rag-amber-bg'
    return 'border-rag-red bg-rag-red-bg'
  }

  return (
    <div className="space-y-6">
      {/* Front brakes */}
      <div>
        <h4 className="font-medium text-gray-700 mb-3">Front Brakes</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Disc (mm)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={measurements.front_disc ?? ''}
              onChange={(e) => handleChange('front_disc', e.target.value)}
              placeholder="Thickness"
              className={`
                w-full h-14 text-center text-lg font-bold
                border-2 ${getDiscColor(measurements.front_disc)}
                focus:outline-none focus:ring-2 focus:ring-primary
              `}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Pad (mm)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={measurements.front_pad ?? ''}
              onChange={(e) => handleChange('front_pad', e.target.value)}
              placeholder="Thickness"
              className={`
                w-full h-14 text-center text-lg font-bold
                border-2 ${getPadColor(measurements.front_pad)}
                focus:outline-none focus:ring-2 focus:ring-primary
              `}
            />
          </div>
        </div>
      </div>

      {/* Rear brakes */}
      <div>
        <h4 className="font-medium text-gray-700 mb-3">Rear Brakes</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">Disc (mm)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={measurements.rear_disc ?? ''}
              onChange={(e) => handleChange('rear_disc', e.target.value)}
              placeholder="Thickness"
              className={`
                w-full h-14 text-center text-lg font-bold
                border-2 ${getDiscColor(measurements.rear_disc)}
                focus:outline-none focus:ring-2 focus:ring-primary
              `}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-500 mb-1">Pad (mm)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={measurements.rear_pad ?? ''}
              onChange={(e) => handleChange('rear_pad', e.target.value)}
              placeholder="Thickness"
              className={`
                w-full h-14 text-center text-lg font-bold
                border-2 ${getPadColor(measurements.rear_pad)}
                focus:outline-none focus:ring-2 focus:ring-primary
              `}
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><span className="inline-block w-3 h-3 bg-rag-green mr-1" /> Disc ≥{warnDisc}mm / Pad ≥{warnPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-amber mr-1" /> Disc ≥{minDisc}mm / Pad ≥{minPad}mm</p>
        <p><span className="inline-block w-3 h-3 bg-rag-red mr-1" /> Below minimum - requires replacement</p>
      </div>
    </div>
  )
}
