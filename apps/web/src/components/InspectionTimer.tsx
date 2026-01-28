import { useState, useEffect } from 'react'

interface InspectionTimerProps {
  status: string
  totalClosedMinutes: number      // Sum of completed time entry durations
  activeClockInAt: string | null  // Current session start (null if paused)
  variant?: 'compact' | 'full'    // Kanban vs Detail view
  thresholds?: { amber: number; red: number }  // Minutes
  className?: string
  showIcon?: boolean
}

// Format time for display
function formatTime(totalSeconds: number, showSeconds: boolean): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = (n: number) => n.toString().padStart(2, '0')

  if (showSeconds) {
    // Full format: HH:MM:SS
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }
  // Compact format: M:SS or H:MM:SS
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${minutes}:${pad(seconds)}`
}

// Get color class based on duration thresholds
function getTimerColor(
  minutes: number,
  thresholds: { amber: number; red: number }
): { text: string; bg: string } {
  if (minutes >= thresholds.red) {
    return { text: 'text-red-600', bg: 'bg-red-50 border-red-200' }
  }
  if (minutes >= thresholds.amber) {
    return { text: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' }
  }
  return { text: 'text-green-600', bg: 'bg-green-50 border-green-200' }
}

export function InspectionTimer({
  status,
  totalClosedMinutes,
  activeClockInAt,
  variant = 'compact',
  thresholds = { amber: 30, red: 60 },
  className = '',
  showIcon = true
}: InspectionTimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Only show timer for in_progress status
  if (status !== 'in_progress') return null

  const isActive = !!activeClockInAt

  useEffect(() => {
    if (!isActive) {
      setElapsedSeconds(0)
      return
    }

    // Calculate initial elapsed time from active session
    const clockIn = new Date(activeClockInAt).getTime()
    const calculateElapsed = () => Math.max(0, Math.floor((Date.now() - clockIn) / 1000))

    setElapsedSeconds(calculateElapsed())

    // Update interval - every second for full variant, every 10s for compact
    const intervalMs = variant === 'full' ? 1000 : 10000
    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsed())
    }, intervalMs)

    return () => clearInterval(interval)
  }, [activeClockInAt, isActive, variant])

  // Total time = closed sessions + active session
  const totalSeconds = (totalClosedMinutes * 60) + (isActive ? elapsedSeconds : 0)
  const totalMinutes = Math.floor(totalSeconds / 60)

  const colors = getTimerColor(totalMinutes, thresholds)
  const showSeconds = variant === 'full'
  const timeString = formatTime(totalSeconds, showSeconds)

  // Clock icon SVG
  const ClockIcon = ({ className: iconClass }: { className?: string }) => (
    <svg
      className={iconClass}
      fill="currentColor"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
        clipRule="evenodd"
      />
    </svg>
  )

  if (variant === 'compact') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${colors.text} ${className}`}
        title={`Active inspection time: ${timeString}${isActive ? ' (running)' : ' (paused)'}`}
      >
        {showIcon && (
          <ClockIcon className={`w-3 h-3 ${isActive ? 'animate-pulse' : ''}`} />
        )}
        {timeString}
      </span>
    )
  }

  // Full variant for detail page
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-none border ${colors.bg}`}
        title={`Active inspection time${isActive ? ' (running)' : ' (paused)'}`}
      >
        {showIcon && (
          <ClockIcon className={`w-5 h-5 ${colors.text} ${isActive ? 'animate-pulse' : ''}`} />
        )}
        <span className={`text-lg font-mono font-bold ${colors.text}`}>
          {timeString}
        </span>
        {isActive && (
          <span className="text-xs text-green-600 font-medium uppercase tracking-wide">
            Active
          </span>
        )}
        {!isActive && totalMinutes > 0 && (
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
            Paused
          </span>
        )}
      </div>
    </div>
  )
}
