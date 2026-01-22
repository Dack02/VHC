/**
 * OutcomeModals - Modals for Defer, Decline, and Delete actions
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

interface DeclinedReason {
  id: string
  reason: string
  description: string | null
  isSystem: boolean
}

interface DeletedReason {
  id: string
  reason: string
  description: string | null
  isSystem: boolean
}

// ============================================================================
// Defer Modal
// ============================================================================

interface DeferModalProps {
  isOpen: boolean
  itemName: string
  onClose: () => void
  onConfirm: (deferredUntil: string, notes: string) => Promise<void>
}

export function DeferModal({ isOpen, itemName, onClose, onConfirm }: DeferModalProps) {
  const [deferredUntil, setDeferredUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDeferredUntil('')
      setNotes('')
      setError('')
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!deferredUntil) {
      setError('Please select a date')
      return
    }

    // Validate date is in the future
    const selectedDate = new Date(deferredUntil)
    if (selectedDate <= new Date()) {
      setError('Please select a future date')
      return
    }

    setSaving(true)
    try {
      await onConfirm(deferredUntil, notes.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to defer item')
    } finally {
      setSaving(false)
    }
  }

  // Quick date options
  const getQuickDates = () => {
    const today = new Date()
    return [
      { label: '1 Month', date: new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()) },
      { label: '3 Months', date: new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()) },
      { label: '6 Months', date: new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()) },
      { label: '1 Year', date: new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()) }
    ].map(opt => ({
      ...opt,
      dateStr: opt.date.toISOString().split('T')[0]
    }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white w-full max-w-md shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Defer Repair</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Item name */}
            <div className="text-sm text-gray-600">
              <span className="font-medium">Item:</span> {itemName}
            </div>

            {/* Quick date buttons */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quick select:
              </label>
              <div className="flex flex-wrap gap-2">
                {getQuickDates().map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setDeferredUntil(opt.dateStr)}
                    className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                      deferredUntil === opt.dateStr
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Defer until: <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={deferredUntil}
                onChange={(e) => setDeferredUntil(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Deferring...' : 'Defer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Decline Modal
// ============================================================================

interface DeclineModalProps {
  isOpen: boolean
  itemName: string
  onClose: () => void
  onConfirm: (declinedReasonId: string, notes: string) => Promise<void>
}

export function DeclineModal({ isOpen, itemName, onClose, onConfirm }: DeclineModalProps) {
  const { session, user } = useAuth()
  const [reasons, setReasons] = useState<DeclinedReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Fetch declined reasons
  useEffect(() => {
    const fetchReasons = async () => {
      if (!isOpen || !session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      try {
        const data = await api<{ reasons: DeclinedReason[] }>(
          `/api/v1/organizations/${user.organization.id}/declined-reasons`,
          { token: session.accessToken }
        )
        setReasons(data.reasons || [])
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

  // Check if selected reason requires notes (is "Other")
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
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline item')
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
            <h3 className="text-lg font-semibold text-gray-900">Decline Repair</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Item name */}
            <div className="text-sm text-gray-600">
              <span className="font-medium">Item:</span> {itemName}
            </div>

            {/* Reason dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason: <span className="text-red-500">*</span>
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <select
                  value={selectedReasonId}
                  onChange={(e) => setSelectedReasonId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select reason...</option>
                  {reasons.map(reason => (
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
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="flex-1 bg-red-600 text-white px-4 py-2 font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Declining...' : 'Decline'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Delete Modal
// ============================================================================

interface DeleteModalProps {
  isOpen: boolean
  itemName: string
  onClose: () => void
  onConfirm: (deletedReasonId: string, notes: string) => Promise<void>
}

export function DeleteModal({ isOpen, itemName, onClose, onConfirm }: DeleteModalProps) {
  const { session, user } = useAuth()
  const [reasons, setReasons] = useState<DeletedReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Fetch deleted reasons
  useEffect(() => {
    const fetchReasons = async () => {
      if (!isOpen || !session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      try {
        const data = await api<{ reasons: DeletedReason[] }>(
          `/api/v1/organizations/${user.organization.id}/deleted-reasons`,
          { token: session.accessToken }
        )
        setReasons(data.reasons || [])
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

  // Check if selected reason requires notes (is "Other")
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
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item')
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
            <h3 className="text-lg font-semibold text-gray-900">Delete Repair Item</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Warning */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-amber-700">
                This will remove the item from the health check. It will be hidden from customer view but kept for audit purposes.
              </div>
            </div>

            {/* Item name */}
            <div className="text-sm text-gray-600">
              <span className="font-medium">Item:</span> {itemName}
            </div>

            {/* Reason dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason: <span className="text-red-500">*</span>
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <select
                  value={selectedReasonId}
                  onChange={(e) => setSelectedReasonId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select reason...</option>
                  {reasons.map(reason => (
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
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="flex-1 bg-red-600 text-white px-4 py-2 font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Bulk Defer Modal
// ============================================================================

interface BulkDeferModalProps {
  isOpen: boolean
  itemCount: number
  onClose: () => void
  onConfirm: (deferredUntil: string, notes: string) => Promise<void>
}

export function BulkDeferModal({ isOpen, itemCount, onClose, onConfirm }: BulkDeferModalProps) {
  const [deferredUntil, setDeferredUntil] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDeferredUntil('')
      setNotes('')
      setError('')
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!deferredUntil) {
      setError('Please select a date')
      return
    }

    // Validate date is in the future
    const selectedDate = new Date(deferredUntil)
    if (selectedDate <= new Date()) {
      setError('Please select a future date')
      return
    }

    setSaving(true)
    try {
      await onConfirm(deferredUntil, notes.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to defer items')
    } finally {
      setSaving(false)
    }
  }

  // Quick date options
  const getQuickDates = () => {
    const today = new Date()
    return [
      { label: '1 Month', date: new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()) },
      { label: '3 Months', date: new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()) },
      { label: '6 Months', date: new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()) },
      { label: '1 Year', date: new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()) }
    ].map(opt => ({
      ...opt,
      dateStr: opt.date.toISOString().split('T')[0]
    }))
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white w-full max-w-md shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Defer {itemCount} Repair{itemCount !== 1 ? 's' : ''}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Item count indicator */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {itemCount}
              </div>
              <span className="text-sm text-blue-700">
                item{itemCount !== 1 ? 's' : ''} will be deferred
              </span>
            </div>

            {/* Quick date buttons */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Quick select:
              </label>
              <div className="flex flex-wrap gap-2">
                {getQuickDates().map(opt => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setDeferredUntil(opt.dateStr)}
                    className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                      deferredUntil === opt.dateStr
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Defer until: <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={deferredUntil}
                onChange={(e) => setDeferredUntil(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for all items..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Deferring...' : `Defer ${itemCount} Item${itemCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Bulk Decline Modal
// ============================================================================

interface BulkDeclineModalProps {
  isOpen: boolean
  itemCount: number
  onClose: () => void
  onConfirm: (declinedReasonId: string, notes: string) => Promise<void>
}

export function BulkDeclineModal({ isOpen, itemCount, onClose, onConfirm }: BulkDeclineModalProps) {
  const { session, user } = useAuth()
  const [reasons, setReasons] = useState<DeclinedReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Fetch declined reasons
  useEffect(() => {
    const fetchReasons = async () => {
      if (!isOpen || !session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      try {
        const data = await api<{ reasons: DeclinedReason[] }>(
          `/api/v1/organizations/${user.organization.id}/declined-reasons`,
          { token: session.accessToken }
        )
        setReasons(data.reasons || [])
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

  // Check if selected reason requires notes (is "Other")
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
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline items')
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
            <h3 className="text-lg font-semibold text-gray-900">Decline {itemCount} Repair{itemCount !== 1 ? 's' : ''}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {/* Item count indicator */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                {itemCount}
              </div>
              <span className="text-sm text-red-700">
                item{itemCount !== 1 ? 's' : ''} will be declined
              </span>
            </div>

            {/* Reason dropdown */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason: <span className="text-red-500">*</span>
              </label>
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <select
                  value={selectedReasonId}
                  onChange={(e) => setSelectedReasonId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select reason...</option>
                  {reasons.map(reason => (
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
                placeholder={notesRequired ? 'Please provide details...' : 'Optional notes for all items...'}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="flex-1 bg-red-600 text-white px-4 py-2 font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Declining...' : `Decline ${itemCount} Item${itemCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
