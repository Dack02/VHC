import { useCallback } from 'react'

interface SelectOption {
  value: string
  label: string
}

interface MultiSelectInputProps {
  value: string[] | undefined
  onChange: (value: string[]) => void
  config?: {
    options?: SelectOption[] | string[]
  }
}

export function MultiSelectInput({
  value = [],
  onChange,
  config
}: MultiSelectInputProps) {
  // Normalize options to SelectOption format
  const options: SelectOption[] = (config?.options || []).map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt }
    }
    return opt
  })

  const handleToggle = useCallback((optValue: string) => {
    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(30)
    }

    const currentValues = value || []
    const isSelected = currentValues.includes(optValue)

    if (isSelected) {
      onChange(currentValues.filter((v) => v !== optValue))
    } else {
      onChange([...currentValues, optValue])
    }
  }, [value, onChange])

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const isSelected = (value || []).includes(opt.value)

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleToggle(opt.value)}
            className={`
              w-full p-3 text-left border-2 transition-colors flex items-center gap-3
              ${isSelected
                ? 'border-primary bg-blue-50 text-primary'
                : 'border-gray-200 hover:border-gray-300'
              }
            `}
          >
            <div className={`
              w-5 h-5 border-2 rounded flex items-center justify-center flex-shrink-0
              ${isSelected
                ? 'border-primary bg-primary'
                : 'border-gray-300'
              }
            `}>
              {isSelected && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="font-medium">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
