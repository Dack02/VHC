import { useState, useEffect } from 'react'

interface TyreDepthValue {
  fl: number | null // Front left
  fr: number | null // Front right
  rl: number | null // Rear left
  rr: number | null // Rear right
}

interface TyreDepthConfig {
  greenMin?: number // Above this = green (default 3mm)
  amberMin?: number // Above this = amber (default 1.6mm)
}

interface TyreDepthInputProps {
  value: TyreDepthValue | undefined
  onChange: (value: TyreDepthValue) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: TyreDepthConfig
}

export function TyreDepthInput({
  value,
  onChange,
  onRAGChange,
  config
}: TyreDepthInputProps) {
  const [depths, setDepths] = useState<TyreDepthValue>(
    value || { fl: null, fr: null, rl: null, rr: null }
  )

  const greenMin = config?.greenMin ?? 3
  const amberMin = config?.amberMin ?? 1.6

  useEffect(() => {
    // Calculate RAG based on lowest value
    const values = [depths.fl, depths.fr, depths.rl, depths.rr].filter(
      (v): v is number => v !== null
    )

    if (values.length === 0) {
      onRAGChange(null)
      return
    }

    const lowest = Math.min(...values)

    if (lowest >= greenMin) {
      onRAGChange('green')
    } else if (lowest >= amberMin) {
      onRAGChange('amber')
    } else {
      onRAGChange('red')
    }
  }, [depths, greenMin, amberMin, onRAGChange])

  const handleChange = (position: keyof TyreDepthValue, valueStr: string) => {
    const numValue = valueStr === '' ? null : parseFloat(valueStr)

    const newDepths = {
      ...depths,
      [position]: numValue
    }

    setDepths(newDepths)
    onChange(newDepths)
  }

  const getColor = (value: number | null) => {
    if (value === null) return 'border-gray-300'
    if (value >= greenMin) return 'border-rag-green bg-rag-green-bg'
    if (value >= amberMin) return 'border-rag-amber bg-rag-amber-bg'
    return 'border-rag-red bg-rag-red-bg'
  }

  return (
    <div className="space-y-4">
      {/* Visual tyre diagram */}
      <div className="relative aspect-[4/3] max-w-xs mx-auto">
        {/* Car outline */}
        <div className="absolute inset-x-8 inset-y-4 border-2 border-gray-300 rounded-lg" />

        {/* Tyres */}
        <TyreInput
          position="fl"
          label="FL"
          value={depths.fl}
          onChange={(v) => handleChange('fl', v)}
          color={getColor(depths.fl)}
          className="absolute top-0 left-0"
        />
        <TyreInput
          position="fr"
          label="FR"
          value={depths.fr}
          onChange={(v) => handleChange('fr', v)}
          color={getColor(depths.fr)}
          className="absolute top-0 right-0"
        />
        <TyreInput
          position="rl"
          label="RL"
          value={depths.rl}
          onChange={(v) => handleChange('rl', v)}
          color={getColor(depths.rl)}
          className="absolute bottom-0 left-0"
        />
        <TyreInput
          position="rr"
          label="RR"
          value={depths.rr}
          onChange={(v) => handleChange('rr', v)}
          color={getColor(depths.rr)}
          className="absolute bottom-0 right-0"
        />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-green" /> ≥{greenMin}mm
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-amber" /> ≥{amberMin}mm
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-rag-red" /> {'<'}{amberMin}mm
        </span>
      </div>
    </div>
  )
}

interface TyreInputProps {
  position: string
  label: string
  value: number | null
  onChange: (value: string) => void
  color: string
  className?: string
}

function TyreInput({ label, value, onChange, color, className }: TyreInputProps) {
  return (
    <div className={`w-20 ${className}`}>
      <label className="block text-xs text-center text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        max="10"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="mm"
        className={`
          w-full h-12 text-center text-lg font-bold
          border-2 ${color}
          focus:outline-none focus:ring-2 focus:ring-primary
        `}
      />
    </div>
  )
}
