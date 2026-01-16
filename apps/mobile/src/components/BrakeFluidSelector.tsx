// Brake Fluid selector - OK or Replacement Required
// This is NOT a fluid level check - it's a pass/fail style check

interface BrakeFluidSelectorProps {
  value: string | undefined
  onChange: (value: string, ragStatus: 'green' | 'red') => void
}

export function BrakeFluidSelector({ value, onChange }: BrakeFluidSelectorProps) {
  const options: { label: string; value: string; rag: 'green' | 'red' }[] = [
    { label: 'OK', value: 'ok', rag: 'green' },
    { label: 'Replacement Required', value: 'replacement_required', rag: 'red' }
  ]

  return (
    <div className="flex gap-3">
      {options.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(50)
              onChange(option.value, option.rag)
            }}
            className={`
              flex-1 py-4 px-4 font-semibold text-sm border-2 rounded-lg transition-all
              ${isSelected
                ? option.rag === 'green'
                  ? 'bg-rag-green border-rag-green text-white'
                  : 'bg-rag-red border-rag-red text-white'
                : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
              }
            `}
          >
            <div className="flex flex-col items-center gap-1">
              <span className="text-xl">
                {option.rag === 'green' ? '✓' : '✕'}
              </span>
              <span>{option.label}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
