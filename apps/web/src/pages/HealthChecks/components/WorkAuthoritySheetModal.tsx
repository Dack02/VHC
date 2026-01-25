/**
 * Work Authority Sheet Modal
 *
 * Modal for generating Work Authority Sheet PDFs.
 * Allows selection of variant (technician/service advisor) and options.
 */

import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'

// Inline SVG Icons
const XIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

const FileTextIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const SpinnerIcon = () => (
  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
)

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
)

const AlertIcon = () => (
  <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const WrenchIcon = () => (
  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const CalculatorIcon = () => (
  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
)

interface WorkAuthoritySheetModalProps {
  isOpen: boolean
  onClose: () => void
  healthCheckId: string
  vehicleReg: string
  userRole: string
}

type Variant = 'technician' | 'service_advisor'

export function WorkAuthoritySheetModal({
  isOpen,
  onClose,
  healthCheckId,
  vehicleReg,
  userRole
}: WorkAuthoritySheetModalProps) {
  const { session } = useAuth()
  const toast = useToast()

  const [variant, setVariant] = useState<Variant>('technician')
  const [includePreBooked, setIncludePreBooked] = useState(true)
  const [includeVhcWork, setIncludeVhcWork] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Technicians can only access technician variant
  const canAccessServiceAdvisor = userRole !== 'technician'

  const handleGenerate = async () => {
    if (!session?.accessToken || !healthCheckId) return

    // Validate at least one work type selected
    if (!includePreBooked && !includeVhcWork) {
      setError('Please select at least one type of work to include')
      return
    }

    setGenerating(true)
    setError(null)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
      const response = await fetch(
        `${apiUrl}/api/v1/health-checks/${healthCheckId}/work-authority-sheet`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            variant,
            includePreBooked,
            includeVhcWork
          })
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to generate Work Authority Sheet')
      }

      // Get document number from header
      const documentNumber = response.headers.get('X-Document-Number') || 'WA'

      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `WorkAuthority-${vehicleReg.replace(/\s+/g, '')}-${documentNumber}.pdf`
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch?.[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '')
        }
      }

      // Create blob and download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success(`Work Authority Sheet generated: ${documentNumber}`)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate Work Authority Sheet'
      setError(message)
      toast.error(message)
    } finally {
      setGenerating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <FileTextIcon />
            <h2 className="text-lg font-semibold text-gray-900">Generate Work Authority Sheet</h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="p-1 hover:bg-gray-100 disabled:opacity-50"
          >
            <XIcon />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 flex items-start gap-2">
              <AlertIcon />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Variant Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select Document Variant
            </label>
            <div className="space-y-3">
              {/* Technician Variant */}
              <label
                className={`flex items-start p-4 border cursor-pointer transition-colors ${
                  variant === 'technician'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value="technician"
                  checked={variant === 'technician'}
                  onChange={() => setVariant('technician')}
                  className="mt-1 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <WrenchIcon />
                    <span className="font-medium text-gray-900">Technician Version</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Work instructions only - no pricing. Shows labour hours, parts list, and checkboxes for completion tracking.
                  </p>
                </div>
              </label>

              {/* Service Advisor Variant */}
              <label
                className={`flex items-start p-4 border cursor-pointer transition-colors ${
                  !canAccessServiceAdvisor
                    ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                    : variant === 'service_advisor'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value="service_advisor"
                  checked={variant === 'service_advisor'}
                  onChange={() => canAccessServiceAdvisor && setVariant('service_advisor')}
                  disabled={!canAccessServiceAdvisor}
                  className="mt-1 mr-3"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <CalculatorIcon />
                    <span className="font-medium text-gray-900">Service Advisor Version</span>
                    {!canAccessServiceAdvisor && (
                      <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5">
                        Requires Service Advisor role
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Full pricing breakdown - labour rates, parts costs, VAT, and grand totals for invoice preparation.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Include Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Include Work Items
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={includePreBooked}
                  onChange={(e) => setIncludePreBooked(e.target.checked)}
                  className="w-4 h-4"
                />
                <div>
                  <span className="font-medium text-gray-900">Pre-Booked Work</span>
                  <p className="text-sm text-gray-500">Work scheduled through DMS before vehicle arrival</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={includeVhcWork}
                  onChange={(e) => setIncludeVhcWork(e.target.checked)}
                  className="w-4 h-4"
                />
                <div>
                  <span className="font-medium text-gray-900">Authorized VHC Work</span>
                  <p className="text-sm text-gray-500">Repair items authorized by the customer</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating || (!includePreBooked && !includeVhcWork)}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {generating ? (
              <>
                <SpinnerIcon />
                Generating...
              </>
            ) : (
              <>
                <DownloadIcon />
                Generate PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default WorkAuthoritySheetModal
