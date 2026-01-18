import { useEffect } from 'react'

interface AILimitReachedModalProps {
  isOpen: boolean
  onClose: () => void
  limit: number
  resetDate: string
}

export default function AILimitReachedModal({
  isOpen,
  onClose,
  limit,
  resetDate
}: AILimitReachedModalProps) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const formatResetDate = () => {
    const date = new Date(resetDate)
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long'
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6 text-center">
          {/* Warning Icon */}
          <div className="w-16 h-16 mx-auto mb-4 bg-amber-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Monthly AI Generation Limit Reached
          </h2>

          {/* Description */}
          <p className="text-gray-600 mb-4">
            Your organization has used all <span className="font-semibold">{limit}</span> AI generations
            for this month. Your limit will reset on <span className="font-semibold">{formatResetDate()}</span>.
          </p>

          {/* Alternatives */}
          <div className="bg-gray-50 rounded-lg p-4 text-left mb-6">
            <p className="text-sm font-medium text-gray-900 mb-2">In the meantime, you can:</p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start">
                <span className="text-indigo-500 mr-2">&bull;</span>
                <span>Manually add reasons in the Reason Library</span>
              </li>
              <li className="flex items-start">
                <span className="text-indigo-500 mr-2">&bull;</span>
                <span>Edit existing generated reasons</span>
              </li>
              <li className="flex items-start">
                <span className="text-indigo-500 mr-2">&bull;</span>
                <span>Contact support to request a limit increase</span>
              </li>
            </ul>
          </div>

          {/* OK Button */}
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

// Hook to handle 429 errors from AI generation
export function useAILimitModal() {
  const showLimitModal = (error: unknown): { limit: number; resetDate: string } | null => {
    // Check if error is a 429 rate limit error
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 429
    ) {
      const errData = error as { details?: { limit?: number; periodEnd?: string } }
      return {
        limit: errData.details?.limit || 100,
        resetDate: errData.details?.periodEnd || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()
      }
    }
    return null
  }

  return { showLimitModal }
}
