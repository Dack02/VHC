import { useState, useCallback } from 'react'

type RAGStatus = 'green' | 'amber' | 'red' | null

interface RAGSelectorProps {
  value: RAGStatus
  onChange: (status: RAGStatus) => void
  disabled?: boolean
  showLabels?: boolean
  size?: 'default' | 'compact'
}

export function RAGSelector({
  value,
  onChange,
  disabled = false,
  showLabels = true,
  size = 'default'
}: RAGSelectorProps) {
  const [pressing, setPressing] = useState<RAGStatus>(null)

  const handleSelect = useCallback((status: RAGStatus) => {
    if (disabled) return

    // Haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(50)
    }

    // Toggle off if same value selected
    onChange(value === status ? null : status)
  }, [disabled, onChange, value])

  const buttonHeight = size === 'compact' ? 'h-14' : 'h-[72px]'

  const buttons: { status: RAGStatus; label: string; bgClass: string; activeClass: string }[] = [
    {
      status: 'green',
      label: 'OK',
      bgClass: 'bg-rag-green',
      activeClass: 'ring-4 ring-green-300 scale-[0.98]'
    },
    {
      status: 'amber',
      label: 'Advisory',
      bgClass: 'bg-rag-amber',
      activeClass: 'ring-4 ring-yellow-300 scale-[0.98]'
    },
    {
      status: 'red',
      label: 'Urgent',
      bgClass: 'bg-rag-red',
      activeClass: 'ring-4 ring-red-300 scale-[0.98]'
    }
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {buttons.map(({ status, label, bgClass, activeClass }) => {
        const isSelected = value === status
        const isPressing = pressing === status

        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            className={`
              ${buttonHeight} ${bgClass}
              text-white font-semibold text-lg
              transition-all duration-150
              flex flex-col items-center justify-center
              disabled:opacity-50 disabled:cursor-not-allowed
              ${isSelected ? activeClass : 'opacity-70'}
              ${isPressing && !isSelected ? 'scale-95' : ''}
              ${!isSelected && !disabled ? 'hover:opacity-90' : ''}
            `}
            onClick={() => handleSelect(status)}
            onTouchStart={() => setPressing(status)}
            onTouchEnd={() => setPressing(null)}
            onMouseDown={() => setPressing(status)}
            onMouseUp={() => setPressing(null)}
            onMouseLeave={() => setPressing(null)}
            aria-pressed={isSelected}
            aria-label={`Mark as ${label}`}
          >
            {isSelected && (
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {showLabels && <span className={isSelected ? '' : 'mt-2'}>{label}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Compact version for list views
interface RAGIndicatorProps {
  status: RAGStatus
  size?: 'sm' | 'md' | 'lg'
}

export function RAGIndicator({ status, size = 'md' }: RAGIndicatorProps) {
  if (!status) {
    return (
      <span className={`
        inline-block rounded-full bg-gray-200
        ${size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'}
      `} />
    )
  }

  const colors = {
    green: 'bg-rag-green',
    amber: 'bg-rag-amber',
    red: 'bg-rag-red'
  }

  return (
    <span className={`
      inline-block rounded-full ${colors[status]}
      ${size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5'}
    `} />
  )
}
