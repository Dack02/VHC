import { useMemo, useCallback } from 'react'

interface NumericPickerProps {
  value: number | null
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  label?: string
  thresholds?: {
    red: number    // Below this = red
    amber: number  // Below this = amber
  }
  disabled?: boolean
}

export function NumericPicker({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  label,
  thresholds,
  disabled = false
}: NumericPickerProps) {
  // Generate options from min to max
  const options = useMemo(() => {
    const opts: number[] = []
    for (let i = min; i <= max; i += step) {
      opts.push(Math.round(i * 10) / 10) // Avoid floating point issues
    }
    return opts
  }, [min, max, step])

  const getColor = useCallback((val: number | null): 'default' | 'red' | 'amber' | 'green' => {
    if (val === null || !thresholds) return 'default'
    if (val < thresholds.red) return 'red'
    if (val < thresholds.amber) return 'amber'
    return 'green'
  }, [thresholds])

  const color = getColor(value)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseFloat(e.target.value)
    onChange(newValue)

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(30)
    }
  }, [onChange])

  const colorClasses = {
    default: 'bg-white border-gray-300',
    red: 'bg-red-100 border-red-500',
    amber: 'bg-amber-100 border-amber-500',
    green: 'bg-green-100 border-green-500'
  }

  return (
    <div className="flex flex-col">
      {label && (
        <label className="block text-sm text-gray-500 mb-1">{label}</label>
      )}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={value ?? ''}
            onChange={handleChange}
            disabled={disabled}
            className={`
              h-12 w-20 text-center text-lg font-mono font-bold
              border-2 appearance-none cursor-pointer
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-primary
              ${colorClasses[color]}
            `}
          >
            <option value="" disabled>--</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {/* Dropdown indicator */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        {unit && <span className="text-gray-600 text-sm">{unit}</span>}
      </div>
    </div>
  )
}
