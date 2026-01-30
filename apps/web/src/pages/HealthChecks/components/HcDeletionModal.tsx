import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface HcDeletionReason {
  id: string
  reason: string
  description: string | null
  isActive: boolean
  isSystem: boolean
  sortOrder: number
}

interface HcDeletionModalProps {
  isOpen: boolean
  vhcReference?: string
  vehicleRegistration?: string
  onClose: () => void
  onConfirm: (hcDeletionReasonId: string, notes: string) => Promise<void>
}

export function HcDeletionModal({ isOpen, vhcReference, vehicleRegistration, onClose, onConfirm }: HcDeletionModalProps) {
  const { session, user } = useAuth()
  const [reasons, setReasons] = useState<HcDeletionReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchReasons = async () => {
      if (!isOpen || !session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      try {
        const data = await api<{ reasons: HcDeletionReason[] }>(
          `/api/v1/organizations/${user.organization.id}/hc-deletion-reasons`,
          { token: session.accessToken }
        )

        if (!data.reasons || data.reasons.length === 0) {
          // Auto-seed defaults
          await api(
            `/api/v1/organizations/${user.organization.id}/hc-deletion-reasons/seed-defaults`,
            { method: 'POST', token: session.accessToken }
          )
          const seeded = await api<{ reasons: HcDeletionReason[] }>(
            `/api/v1/organizations/${user.organization.id}/hc-deletion-reasons`,
            { token: session.accessToken }
          )
          setReasons(seeded.reasons || [])
        } else {
          setReasons(data.reasons || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reasons')
      } finally {
        setLoading(false)
      }
    }

    if (isOpen) {
      setSelectedReasonId('')
      setNotes('')
      setError('')
      fetchReasons()
    }
  }, [isOpen, session?.accessToken, user?.organization?.id])

  const selectedReason = reasons.find(r => r.id === selectedReasonId)
  const notesRequired = selectedReason?.isSystem && selectedReason?.reason?.toLowerCase() === 'other'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedReasonId) {
      setError('Please select a reason')
      return
    }

    if (notesRequired && !notes.trim()) {
      setError('Notes are required when selecting "Other"')
      return
    }

    setSaving(true)
    try {
      await onConfirm(selectedReasonId, notes.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete health check')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white w-full max-w-md shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Delete Health Check</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Warning */}
            <div className="bg-amber-50 border border-amber-200 p-3 flex gap-2">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-amber-700">
                This will soft-delete the health check. It can be restored by an administrator.
              </div>
            </div>

            {/* HC details */}
            <div className="bg-gray-50 border border-gray-200 p-3 space-y-1">
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

            {/* Reason dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <select
                  value={selectedReasonId}
                  onChange={(e) => setSelectedReasonId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary bg-white"
                >
                  <option value="">Select a reason...</option>
                  {reasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.reason}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes {notesRequired ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={notesRequired ? 'Please provide details...' : 'Optional notes...'}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="flex-1 bg-red-600 text-white px-4 py-2 font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete Health Check'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
