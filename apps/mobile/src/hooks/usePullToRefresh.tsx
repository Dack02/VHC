import { useState, useRef, useCallback, useEffect } from 'react'

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>
  threshold?: number
  disabled?: boolean
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  disabled = false
}: UsePullToRefreshOptions) {
  const [refreshing, setRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || refreshing) return

      // Only enable if scrolled to top
      const container = containerRef.current
      if (!container || container.scrollTop > 0) return

      startY.current = e.touches[0].clientY
      setIsPulling(true)
    },
    [disabled, refreshing]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isPulling || disabled || refreshing) return

      const currentY = e.touches[0].clientY
      const distance = Math.max(0, (currentY - startY.current) * 0.5)

      if (distance > 0) {
        e.preventDefault()
        setPullDistance(Math.min(distance, threshold * 1.5))
      }
    },
    [isPulling, disabled, refreshing, threshold]
  )

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling || disabled) return

    setIsPulling(false)

    if (pullDistance >= threshold) {
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    }

    setPullDistance(0)
  }, [isPulling, disabled, pullDistance, threshold, onRefresh])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return {
    containerRef,
    refreshing,
    pullDistance,
    isPulling,
    progress: Math.min(pullDistance / threshold, 1)
  }
}

interface PullToRefreshIndicatorProps {
  progress: number
  refreshing: boolean
  pullDistance: number
}

export function PullToRefreshIndicator({
  progress,
  refreshing,
  pullDistance
}: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !refreshing) return null

  return (
    <div
      className="flex justify-center py-4 transition-opacity"
      style={{
        opacity: refreshing ? 1 : progress,
        transform: `translateY(${pullDistance}px)`
      }}
    >
      <div
        className={`w-8 h-8 border-3 border-primary border-t-transparent rounded-full ${
          refreshing ? 'animate-spin' : ''
        }`}
        style={{
          transform: refreshing ? undefined : `rotate(${progress * 360}deg)`
        }}
      />
    </div>
  )
}
