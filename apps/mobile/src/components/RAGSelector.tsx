import { useState, useCallback } from 'react'

type RAGStatus = 'green' | 'amber' | 'red' | null

interface RAGSelectorProps {
  value: RAGStatus
  onChange: (status: RAGStatus) => void
  disabled?: boolean
  showLabels?: boolean
  size?: 'default' | 'large' | 'compact'
}

export function RAGSelector({
  value,
  onChange,
  disabled = false,
  showLabels = true,
  size = 'large'
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

  const buttonHeight = size === 'compact' ? 'h-14' : size === 'large' ? 'h-[72px]' : 'h-[56px]'

  const buttons: {
    status: RAGStatus
    label: string
    icon: string
    bgClass: string
    borderClass: string
    textClass: string
  }[] = [
    {
      status: 'green',
      label: 'PASS',
      icon: '✓',
      bgClass: 'bg-rag-green',
      borderClass: 'border-green-500',
      textClass: 'text-green-700'
    },
    {
      status: 'amber',
      label: 'ADVISORY',
      icon: '⚠',
      bgClass: 'bg-rag-amber',
      borderClass: 'border-amber-500',
      textClass: 'text-amber-700'
    },
    {
      status: 'red',
      label: 'URGENT',
      icon: '✕',
      bgClass: 'bg-rag-red',
      borderClass: 'border-red-500',
      textClass: 'text-red-700'
    }
  ]

  return (
    <div className="flex gap-3">
      {buttons.map(({ status, label, icon, bgClass, borderClass, textClass }) => {
        const isSelected = value === status
        const isPressing = pressing === status

        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            className={`
              flex-1 ${buttonHeight}
              border-2 transition-all duration-150
              flex flex-col items-center justify-center
              disabled:opacity-50 disabled:cursor-not-allowed
              ${isSelected
                ? `${bgClass} text-white border-transparent`
                : `bg-white ${textClass} border-gray-300 hover:${borderClass}`
              }
              ${isPressing && !isSelected ? 'scale-95' : ''}
              ${isSelected ? 'scale-[0.98] shadow-md' : ''}
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
            <span className="text-2xl">{icon}</span>
            {showLabels && <span className="text-sm font-semibold">{label}</span>}
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
