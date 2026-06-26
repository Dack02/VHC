import { useState, useEffect } from 'react'

interface ReopenHealthCheckModalProps {
  isOpen: boolean
  vhcReference?: string
  vehicleRegistration?: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}

/**
 * Confirmation for resetting a wrongly-started health check. Spells out exactly what
 * gets cleared (inspection results, photos, auto-generated quote lines) and what is
 * kept (clocked time), since the action is destructive and irreversible.
 */
export function ReopenHealthCheckModal({ isOpen, vhcReference, vehicleRegistration, onClose, onConfirm }: ReopenHealthCheckModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setReason('')
      setError('')
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reopen health check')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white w-full max-w-md shadow-xl rounded-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Reopen / Reset Health Check</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Warning */}
            <div className="bg-red-50 border border-red-200 p-3 flex gap-2">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-red-700">
                Use this when the wrong vehicle was started. This <strong>permanently clears</strong> the
                inspection and sends the check back to the start.
              </div>
            </div>

            {/* What happens */}
            <div className="bg-gray-50 border border-gray-200 p-3 space-y-2 text-sm rounded-lg">
              <div className="font-medium text-gray-700">This will:</div>
              <ul className="space-y-1 text-gray-600 list-disc list-inside">
                <li>Delete all inspection results and their photos</li>
                <li>Delete the auto-generated quote lines</li>
                <li>Unassign the technician and set the status back to <strong>Created</strong></li>
              </ul>
              <div className="font-medium text-gray-700 pt-1">Kept:</div>
              <ul className="space-y-1 text-gray-600 list-disc list-inside">
                <li>Clocked time stays on the record for the audit trail</li>
              </ul>
            </div>

            {/* HC details */}
            {(vhcReference || vehicleRegistration) && (
              <div className="bg-gray-50 border border-gray-200 p-3 space-y-1 rounded-lg">
                {vhcReference && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">VHC Ref:</span> {vhcReference}
                  </div>
                )}
                {vehicleRegistration && (
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Registration:</span>{' '}
                    <span className="font-bold text-gray-900">{vehicleRegistration}</span>
                  </div>
                )}
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Technician started the wrong vehicle"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm rounded-lg">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-red-600 text-white px-4 py-2 font-semibold hover:bg-red-700 disabled:opacity-50 rounded-lg"
              >
                {saving ? 'Resetting...' : 'Reset Health Check'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
