import { useState, useCallback, useRef } from 'react'

interface TreadDepthSliderProps {
  value: number | null
  onChange: (value: number | null) => void
  thresholds?: {
    red: number    // Below this = red (default 2.0)
    amber: number  // Below this = amber (default 4.0)
  }
  label?: string
  disabled?: boolean
}

export function TreadDepthSlider({
  value,
  onChange,
  thresholds = { red: 2.0, amber: 4.0 },
  label,
  disabled = false
}: TreadDepthSliderProps) {
  const [inputText, setInputText] = useState(() =>
    value !== null ? value.toFixed(1) : ''
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const getColor = useCallback((val: number): 'red' | 'amber' | 'green' => {
    if (val < thresholds.red) return 'red'
    if (val < thresholds.amber) return 'amber'
    return 'green'
  }, [thresholds])

  const color = value !== null ? getColor(value) : null

  // Gradient stops as percentages
  const redStop = (thresholds.red / 10) * 100
  const amberStop = (thresholds.amber / 10) * 100

  const gradientStyle = {
    background: `linear-gradient(to right,
      #dc2626 0%,
      #dc2626 ${redStop}%,
      #f59e0b ${redStop}%,
      #f59e0b ${amberStop}%,
      #16a34a ${amberStop}%,
      #16a34a 100%)`
  }

  // Marker position on the gradient bar
  const markerPosition = value !== null ? Math.min(Math.max((value / 10) * 100, 0), 100) : null

  const commitValue = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') {
      setInputText('')
      onChange(null)
      return
    }

    const parsed = parseFloat(trimmed)
    if (isNaN(parsed)) {
      // Revert to previous value
      setInputText(value !== null ? value.toFixed(1) : '')
      return
    }

    const clamped = Math.min(Math.max(parsed, 0), 10)
    const rounded = Math.round(clamped * 10) / 10
    setInputText(rounded.toFixed(1))
    onChange(rounded)

    // Haptic feedback on value commit
    if ('vibrate' in navigator) {
      navigator.vibrate(10)
    }
  }, [value, onChange])

  const handleBlur = useCallback(() => {
    commitValue(inputText)
  }, [inputText, commitValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }, [])

  const borderClasses = {
    red: 'border-red-500 bg-red-50',
    amber: 'border-amber-500 bg-amber-50',
    green: 'border-green-500 bg-green-50'
  }

  const textClasses = {
    red: 'text-red-700',
    amber: 'text-amber-700',
    green: 'text-green-700'
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {label && (
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
          {label}
        </span>
      )}

      {/* Compact gradient bar with marker */}
      <div className="relative w-full">
        <div
          className="w-full h-2 rounded-sm"
          style={gradientStyle}
        />
        {markerPosition !== null && (
          <div
            className="absolute top-0 w-0.5 h-2 bg-gray-900 pointer-events-none"
            style={{ left: `${markerPosition}%`, marginLeft: '-1px' }}
          />
        )}
      </div>

      {/* Typed numeric input */}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={inputText}
          placeholder="--"
          disabled={disabled}
          onChange={(e) => setInputText(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onFocus={(e) => e.target.select()}
          className={`
            w-14 h-10 text-center font-mono text-lg font-bold border-2 rounded-lg
            outline-none transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
            ${color ? borderClasses[color] : 'border-gray-300 bg-white'}
            ${color ? textClasses[color] : 'text-gray-500'}
            focus:ring-2 focus:ring-indigo-300
          `}
        />
        <span className="text-xs text-gray-400">mm</span>
      </div>
    </div>
  )
}
