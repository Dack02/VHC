import { useCallback } from 'react'

interface TreadDepthSliderProps {
  value: number
  onChange: (value: number) => void
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
  const getColor = useCallback((val: number): 'red' | 'amber' | 'green' => {
    if (val < thresholds.red) return 'red'
    if (val < thresholds.amber) return 'amber'
    return 'green'
  }, [thresholds])

  const color = getColor(value)

  // Calculate gradient stops as percentages
  const redStop = (thresholds.red / 10) * 100
  const amberStop = (thresholds.amber / 10) * 100

  // Create gradient for the track
  const gradientStyle = {
    background: `linear-gradient(to right,
      #dc2626 0%,
      #dc2626 ${redStop}%,
      #f59e0b ${redStop}%,
      #f59e0b ${amberStop}%,
      #16a34a ${amberStop}%,
      #16a34a 100%)`
  }

  // Calculate thumb position percentage
  const thumbPosition = (value / 10) * 100

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    onChange(newValue)

    // Haptic feedback on value change
    if ('vibrate' in navigator) {
      navigator.vibrate(10)
    }
  }, [onChange])

  const colorClasses = {
    red: 'bg-red-100 border-red-500 text-red-700',
    amber: 'bg-amber-100 border-amber-500 text-amber-700',
    green: 'bg-green-100 border-green-500 text-green-700'
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {label && (
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
          {label}
        </span>
      )}

      {/* Slider container */}
      <div className="relative w-full">
        {/* Custom track with gradient */}
        <div
          className="absolute top-1/2 left-0 right-0 h-3 -translate-y-1/2 rounded-sm"
          style={gradientStyle}
        />

        {/* Thumb indicator line */}
        <div
          className="absolute top-1/2 w-0.5 h-5 bg-gray-800 -translate-y-1/2 pointer-events-none z-10"
          style={{ left: `${thumbPosition}%`, marginLeft: '-1px' }}
        />

        {/* Actual range input (invisible but interactive) */}
        <input
          type="range"
          min="0"
          max="10"
          step="0.1"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="
            relative w-full h-8 appearance-none bg-transparent cursor-pointer z-20
            disabled:opacity-50 disabled:cursor-not-allowed
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-6
            [&::-webkit-slider-thumb]:h-6
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-gray-400
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:active:cursor-grabbing
            [&::-moz-range-thumb]:w-6
            [&::-moz-range-thumb]:h-6
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-gray-400
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:cursor-grab
            [&::-webkit-slider-runnable-track]:bg-transparent
            [&::-moz-range-track]:bg-transparent
          "
        />
      </div>

      {/* Value display */}
      <div className={`
        w-16 h-10 flex items-center justify-center
        font-mono text-lg font-bold border-2
        ${colorClasses[color]}
      `}>
        {value.toFixed(1)}
      </div>
    </div>
  )
}
