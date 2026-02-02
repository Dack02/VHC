import { useMemo, useCallback } from 'react'

interface DecimalPickerProps {
  value: number | null
  onChange: (value: number) => void
  wholeMin: number
  wholeMax: number
  unit?: string
  label?: string
  color?: 'default' | 'red' | 'green'
  disabled?: boolean
}

export function DecimalPicker({
  value,
  onChange,
  wholeMin,
  wholeMax,
  unit,
  label,
  color = 'default',
  disabled = false
}: DecimalPickerProps) {
  // Decompose value into whole and tenth parts
  const whole = value !== null ? Math.floor(value) : null
  const tenth = value !== null ? Math.round((value - Math.floor(value)) * 10) : null

  // Generate whole number options
  const wholeOptions = useMemo(() => {
    const opts: number[] = []
    for (let i = wholeMin; i <= wholeMax; i++) {
      opts.push(i)
    }
    return opts
  }, [wholeMin, wholeMax])

  const tenthOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

  const handleWholeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newWhole = parseInt(e.target.value, 10)
    const currentTenth = tenth ?? 0
    const newValue = Math.round((newWhole + currentTenth / 10) * 10) / 10
    onChange(newValue)
    if ('vibrate' in navigator) navigator.vibrate(30)
  }, [onChange, tenth])

  const handleTenthChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTenth = parseInt(e.target.value, 10)
    const currentWhole = whole ?? wholeMin
    const newValue = Math.round((currentWhole + newTenth / 10) * 10) / 10
    onChange(newValue)
    if ('vibrate' in navigator) navigator.vibrate(30)
  }, [onChange, whole, wholeMin])

  const colorClasses = {
    default: 'bg-white border-gray-300',
    red: 'bg-red-100 border-red-500',
    green: 'bg-green-100 border-green-500'
  }

  const selectClass = `
    h-12 text-center text-lg font-mono font-bold
    border-2 appearance-none cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed
    focus:outline-none focus:ring-2 focus:ring-primary
    ${colorClasses[color]}
  `

  return (
    <div className="flex flex-col">
      {label && (
        <label className="block text-sm text-gray-500 mb-1">{label}</label>
      )}
      <div className="flex items-center gap-0.5">
        {/* Whole number select */}
        <div className="relative">
          <select
            value={whole ?? ''}
            onChange={handleWholeChange}
            disabled={disabled}
            className={`${selectClass} w-16`}
          >
            <option value="" disabled>--</option>
            {wholeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Decimal point */}
        <span className="text-lg font-bold text-gray-600">.</span>

        {/* Tenth select */}
        <div className="relative">
          <select
            value={tenth ?? ''}
            onChange={handleTenthChange}
            disabled={disabled}
            className={`${selectClass} w-12`}
          >
            <option value="" disabled>-</option>
            {tenthOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {unit && <span className="text-gray-600 text-sm ml-1">{unit}</span>}
      </div>
    </div>
  )
}
