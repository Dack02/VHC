import { useState } from 'react'
import { CheckResult, ResultMedia } from '../../../lib/api'

interface PhotosTabProps {
  results: CheckResult[]
}

export function PhotosTab({ results }: PhotosTabProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<ResultMedia | null>(null)

  // Collect all photos from results
  const allPhotos: { result: CheckResult; media: ResultMedia }[] = []
  results.forEach(result => {
    if (result.media) {
      result.media.forEach(media => {
        allPhotos.push({ result, media })
      })
    }
  })

  if (allPhotos.length === 0) {
    return (
      <div className="bg-white border border-gray-200 shadow-sm p-8 text-center text-gray-500">
        No photos have been captured for this health check.
      </div>
    )
  }

  return (
    <div>
      {/* Photo grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {allPhotos.map(({ result, media }) => (
          <div
            key={media.id}
            className="relative aspect-square bg-gray-100 cursor-pointer group overflow-hidden border border-gray-200"
            onClick={() => setSelectedPhoto(media)}
          >
            <img
              src={media.thumbnail_url || media.url}
              alt=""
              className="w-full h-full object-cover"
            />
            {/* RAG indicator overlay */}
            {result.rag_status && (
              <div className={`
                absolute top-2 left-2 w-4 h-4 rounded-full
                ${result.rag_status === 'green' ? 'bg-green-500' : ''}
                ${result.rag_status === 'amber' ? 'bg-yellow-500' : ''}
                ${result.rag_status === 'red' ? 'bg-red-500' : ''}
              `} />
            )}
            {/* Annotation indicator */}
            {media.annotation_data !== null && media.annotation_data !== undefined && (
              <div className="absolute top-2 right-2">
                <svg className="w-4 h-4 text-white drop-shadow" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </div>
            )}
            {/* Hover overlay */}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all" />
          </div>
        ))}
      </div>

      {/* Photo modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="relative max-w-4xl max-h-full"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={selectedPhoto.url}
              alt=""
              className="max-w-full max-h-[80vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}
