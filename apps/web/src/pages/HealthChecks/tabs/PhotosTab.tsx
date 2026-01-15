/**
 * PhotosTab Component
 * Grid layout for photos with filtering and lightbox viewer
 * Includes lazy loading for performance optimization
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { CheckResult, ResultMedia } from '../../../lib/api'

type RAGFilter = 'all' | 'red' | 'amber' | 'green'

interface PhotoWithContext {
  result: CheckResult
  media: ResultMedia
  index: number  // Global index for navigation
}

interface PhotosTabProps {
  results: CheckResult[]
}

export function PhotosTab({ results }: PhotosTabProps) {
  const [filter, setFilter] = useState<RAGFilter>('all')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Collect all photos from results with context
  const allPhotos: PhotoWithContext[] = []
  let globalIndex = 0
  results.forEach(result => {
    if (result.media) {
      result.media.forEach(media => {
        allPhotos.push({ result, media, index: globalIndex })
        globalIndex++
      })
    }
  })

  // Filter photos based on RAG status
  const filteredPhotos = filter === 'all'
    ? allPhotos
    : allPhotos.filter(p => p.result.rag_status === filter)

  // Count photos by RAG status
  const counts = {
    all: allPhotos.length,
    red: allPhotos.filter(p => p.result.rag_status === 'red').length,
    amber: allPhotos.filter(p => p.result.rag_status === 'amber').length,
    green: allPhotos.filter(p => p.result.rag_status === 'green').length
  }

  // Keyboard navigation for lightbox
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (selectedIndex === null) return

    if (e.key === 'Escape') {
      setSelectedIndex(null)
    } else if (e.key === 'ArrowLeft') {
      const currentFilteredIndex = filteredPhotos.findIndex(p => p.index === selectedIndex)
      if (currentFilteredIndex > 0) {
        setSelectedIndex(filteredPhotos[currentFilteredIndex - 1].index)
      }
    } else if (e.key === 'ArrowRight') {
      const currentFilteredIndex = filteredPhotos.findIndex(p => p.index === selectedIndex)
      if (currentFilteredIndex < filteredPhotos.length - 1) {
        setSelectedIndex(filteredPhotos[currentFilteredIndex + 1].index)
      }
    }
  }, [selectedIndex, filteredPhotos])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Get selected photo data
  const selectedPhoto = selectedIndex !== null
    ? allPhotos.find(p => p.index === selectedIndex)
    : null

  // Get navigation info
  const currentFilteredIndex = selectedIndex !== null
    ? filteredPhotos.findIndex(p => p.index === selectedIndex)
    : -1
  const canGoPrev = currentFilteredIndex > 0
  const canGoNext = currentFilteredIndex < filteredPhotos.length - 1

  const goToPrev = () => {
    if (canGoPrev) {
      setSelectedIndex(filteredPhotos[currentFilteredIndex - 1].index)
    }
  }

  const goToNext = () => {
    if (canGoNext) {
      setSelectedIndex(filteredPhotos[currentFilteredIndex + 1].index)
    }
  }

  if (allPhotos.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        No photos have been captured for this health check.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter buttons */}
      <div className="flex gap-2">
        <FilterButton
          label="All"
          count={counts.all}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterButton
          label="Red"
          count={counts.red}
          active={filter === 'red'}
          onClick={() => setFilter('red')}
          color="red"
        />
        <FilterButton
          label="Amber"
          count={counts.amber}
          active={filter === 'amber'}
          onClick={() => setFilter('amber')}
          color="amber"
        />
        <FilterButton
          label="Green"
          count={counts.green}
          active={filter === 'green'}
          onClick={() => setFilter('green')}
          color="green"
        />
      </div>

      {/* Photo grid */}
      {filteredPhotos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          No photos for this filter
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {filteredPhotos.map(({ result, media, index }) => (
            <div
              key={media.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden cursor-pointer group hover:shadow-md transition-shadow"
              onClick={() => setSelectedIndex(index)}
            >
              {/* Thumbnail with lazy loading */}
              <div className="relative aspect-square bg-gray-100 overflow-hidden">
                <LazyImage
                  src={media.thumbnail_url || media.url}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
                {/* RAG indicator */}
                <div className={`
                  absolute top-2 left-2 w-3 h-3 rounded-full ring-2 ring-white
                  ${result.rag_status === 'green' ? 'bg-green-500' : ''}
                  ${result.rag_status === 'amber' ? 'bg-amber-500' : ''}
                  ${result.rag_status === 'red' ? 'bg-red-500' : ''}
                `} />
                {/* Annotation indicator */}
                {media.annotation_data !== null && media.annotation_data !== undefined && (
                  <div className="absolute top-2 right-2 bg-white bg-opacity-90 rounded p-1">
                    <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                    </svg>
                  </div>
                )}
              </div>
              {/* Item name */}
              <div className="px-3 py-2">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {result.template_item?.name || 'Unknown Item'}
                </div>
                {result.notes && (
                  <div className="text-xs text-gray-500 truncate">{result.notes}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center"
          onClick={() => setSelectedIndex(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setSelectedIndex(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Navigation arrows */}
          {canGoPrev && (
            <button
              onClick={(e) => { e.stopPropagation(); goToPrev() }}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 p-2 z-10"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {canGoNext && (
            <button
              onClick={(e) => { e.stopPropagation(); goToNext() }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 p-2 z-10"
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* Image and info */}
          <div
            className="max-w-5xl max-h-full flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Image */}
            <div className="flex-1 flex items-center justify-center p-4">
              <img
                src={selectedPhoto.media.url}
                alt=""
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>

            {/* Info panel */}
            <div className="bg-gray-900 bg-opacity-80 p-4 rounded-b-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  {/* Item name and RAG */}
                  <div className="flex items-center gap-2">
                    <span className={`
                      w-3 h-3 rounded-full
                      ${selectedPhoto.result.rag_status === 'green' ? 'bg-green-500' : ''}
                      ${selectedPhoto.result.rag_status === 'amber' ? 'bg-amber-500' : ''}
                      ${selectedPhoto.result.rag_status === 'red' ? 'bg-red-500' : ''}
                    `} />
                    <span className="text-white font-medium">
                      {selectedPhoto.result.template_item?.name || 'Unknown Item'}
                    </span>
                  </div>
                  {/* Notes */}
                  {selectedPhoto.result.notes && (
                    <p className="text-gray-300 text-sm mt-2">{selectedPhoto.result.notes}</p>
                  )}
                </div>
                {/* Counter */}
                <div className="text-gray-400 text-sm">
                  {currentFilteredIndex + 1} of {filteredPhotos.length}
                </div>
              </div>
              {/* Keyboard hint */}
              <div className="text-gray-500 text-xs mt-3">
                Use arrow keys to navigate, Esc to close
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Filter button component
function FilterButton({
  label,
  count,
  active,
  onClick,
  color
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  color?: 'red' | 'amber' | 'green'
}) {
  const colorClasses = {
    red: active ? 'bg-red-100 text-red-700 border-red-300' : 'hover:bg-red-50',
    amber: active ? 'bg-amber-100 text-amber-700 border-amber-300' : 'hover:bg-amber-50',
    green: active ? 'bg-green-100 text-green-700 border-green-300' : 'hover:bg-green-50'
  }

  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors
        ${color && colorClasses[color]}
        ${!color && (active ? 'bg-gray-100 text-gray-900 border-gray-300' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50')}
        ${!active && !color && 'bg-white text-gray-600 border-gray-200'}
      `}
    >
      {label}
      {count > 0 && (
        <span className={`ml-1.5 ${active ? '' : 'text-gray-400'}`}>({count})</span>
      )}
    </button>
  )
}

// Lazy loading image component using Intersection Observer
function LazyImage({
  src,
  alt,
  className
}: {
  src: string
  alt: string
  className?: string
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    if (!imgRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '50px', // Start loading slightly before visible
        threshold: 0.01
      }
    )

    observer.observe(imgRef.current)

    return () => observer.disconnect()
  }, [])

  return (
    <div ref={imgRef} className={`relative ${className}`}>
      {/* Placeholder skeleton */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}

      {/* Actual image - only load src when in view */}
      {isInView && !hasError && (
        <img
          src={src}
          alt={alt}
          className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      )}
    </div>
  )
}
