import { useCallback } from 'react'

interface SelectOption {
  value: string
  label: string
  rag?: 'green' | 'amber' | 'red'
}

interface SelectInputProps {
  value: string | undefined
  onChange: (value: string) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: {
    options?: SelectOption[] | string[]
    ragMapping?: Record<string, 'green' | 'amber' | 'red'>
  }
}

export function SelectInput({
  value,
  onChange,
  onRAGChange,
  config
}: SelectInputProps) {
  // Normalize options to SelectOption format
  const options: SelectOption[] = (config?.options || []).map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt }
    }
    return opt
  })

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value
    onChange(newValue)

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(30)
    }

    // Check ragMapping config first
    if (config?.ragMapping && config.ragMapping[newValue]) {
      onRAGChange(config.ragMapping[newValue])
      return
    }

    // Find the option and set RAG if defined
    const selectedOption = options.find((opt) => opt.value === newValue)
    if (selectedOption?.rag) {
      onRAGChange(selectedOption.rag)
    } else {
      // Default RAG based on common patterns
      const lower = newValue.toLowerCase()
      if (lower === 'good' || lower === 'ok' || lower === 'pass') {
        onRAGChange('green')
      } else if (lower === 'fair' || lower === 'advisory' || lower === 'warn' || lower.includes('replacement') || lower.includes('required')) {
        onRAGChange('amber')
      } else if (lower === 'poor' || lower === 'bad' || lower === 'fail' || lower === 'urgent') {
        onRAGChange('red')
      } else {
        onRAGChange(null)
      }
    }
  }, [onChange, onRAGChange, options, config])

  const getColor = () => {
    if (!value) return 'border-gray-300'

    // Check ragMapping config first
    if (config?.ragMapping && config.ragMapping[value]) {
      switch (config.ragMapping[value]) {
        case 'green': return 'border-green-500 bg-green-50'
        case 'amber': return 'border-amber-500 bg-amber-50'
        case 'red': return 'border-red-500 bg-red-50'
      }
    }

    const selectedOption = options.find((opt) => opt.value === value)
    if (selectedOption?.rag) {
      switch (selectedOption.rag) {
        case 'green': return 'border-green-500 bg-green-50'
        case 'amber': return 'border-amber-500 bg-amber-50'
        case 'red': return 'border-red-500 bg-red-50'
      }
    }

    // Default color based on common patterns
    const lower = value.toLowerCase()
    if (lower === 'good' || lower === 'ok' || lower === 'pass') {
      return 'border-green-500 bg-green-50'
    }
    if (lower === 'fair' || lower === 'advisory' || lower === 'warn' || lower.includes('replacement') || lower.includes('required')) {
      return 'border-amber-500 bg-amber-50'
    }
    if (lower === 'poor' || lower === 'bad' || lower === 'fail' || lower === 'urgent') {
      return 'border-red-500 bg-red-50'
    }

    return 'border-gray-300'
  }

  return (
    <div className="relative">
      <select
        value={value || ''}
        onChange={handleChange}
        className={`
          w-full h-14 px-4 pr-10 text-lg appearance-none
          border-2 ${getColor()}
          focus:outline-none focus:ring-2 focus:ring-primary
          bg-white
        `}
      >
        <option value="" disabled>Select an option</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Dropdown indicator */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  )
}
