import { useState, useEffect, useCallback, useRef } from 'react'

interface MeasurementInputProps {
  value: number | undefined
  onChange: (value: number | null) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: {
    unit?: string
    min?: number
    max?: number
    step?: number
    thresholds?: {
      red_below?: number
      amber_below?: number
    }
  }
}

export function MeasurementInput({
  value,
  onChange,
  onRAGChange,
  config
}: MeasurementInputProps) {
  const [inputValue, setInputValue] = useState<string>(
    value !== undefined ? String(value) : ''
  )

  const unit = config?.unit || ''
  const min = config?.min
  const max = config?.max
  const step = config?.step ?? 0.1
  const thresholds = config?.thresholds

  // Track the last RAG status using ref to avoid causing re-renders and infinite loops
  const lastRAGRef = useRef<'green' | 'amber' | 'red' | null>(null)

  // Store callback in ref to avoid triggering effect on every parent re-render
  const onRAGChangeRef = useRef(onRAGChange)
  onRAGChangeRef.current = onRAGChange

  // Track if user has interacted - don't auto-save on mount
  const hasUserInteracted = useRef(false)

  // Calculate RAG based on thresholds
  useEffect(() => {
    let newRAG: 'green' | 'amber' | 'red' | null = null

    if (inputValue === '' || !thresholds) {
      newRAG = null
    } else {
      const numValue = parseFloat(inputValue)
      if (isNaN(numValue)) {
        newRAG = null
      } else if (thresholds.red_below !== undefined && numValue < thresholds.red_below) {
        newRAG = 'red'
      } else if (thresholds.amber_below !== undefined && numValue < thresholds.amber_below) {
        newRAG = 'amber'
      } else {
        newRAG = 'green'
      }
    }

    // Only call onRAGChange if the status actually changed AND user has interacted
    if (newRAG !== lastRAGRef.current) {
      lastRAGRef.current = newRAG
      if (hasUserInteracted.current) {
        onRAGChangeRef.current(newRAG)
      }
    }
  }, [inputValue, thresholds]) // Removed onRAGChange - using ref instead

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    hasUserInteracted.current = true
    const newValue = e.target.value
    setInputValue(newValue)

    if (newValue === '') {
      onChange(null)
    } else {
      const numValue = parseFloat(newValue)
      if (!isNaN(numValue)) {
        onChange(numValue)
      }
    }
  }, [onChange])

  const getColor = () => {
    if (inputValue === '' || !thresholds) return 'border-gray-300'

    const numValue = parseFloat(inputValue)
    if (isNaN(numValue)) return 'border-gray-300'

    if (thresholds.red_below !== undefined && numValue < thresholds.red_below) {
      return 'border-red-500 bg-red-50'
    }
    if (thresholds.amber_below !== undefined && numValue < thresholds.amber_below) {
      return 'border-amber-500 bg-amber-50'
    }
    return 'border-green-500 bg-green-50'
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={inputValue}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        placeholder="Enter value"
        className={`
          flex-1 h-14 px-4 text-lg font-mono
          border-2 ${getColor()}
          focus:outline-none focus:ring-2 focus:ring-primary
        `}
      />
      {unit && (
        <span className="text-gray-600 font-medium min-w-[40px]">{unit}</span>
      )}
    </div>
  )
}
