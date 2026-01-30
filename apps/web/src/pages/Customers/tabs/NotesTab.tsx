import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { CustomerDetail, CustomerCommRecord } from '../../../lib/api'

interface NotesTabProps {
  customer: CustomerDetail
  onCustomerUpdate: (updated: CustomerDetail) => void
}

export default function NotesTab({ customer, onCustomerUpdate }: NotesTabProps) {
  const { session } = useAuth()
  const [notes, setNotes] = useState(customer.notes || '')
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [communications, setCommunications] = useState<CustomerCommRecord[]>([])
  const [commsLoading, setCommsLoading] = useState(true)

  useEffect(() => {
    fetchCommunications()
  }, [])

  useEffect(() => {
    setHasChanges(notes !== (customer.notes || ''))
  }, [notes, customer.notes])

  const fetchCommunications = async () => {
    try {
      const data = await api<{ communications: CustomerCommRecord[] }>(
        `/api/v1/customers/${customer.id}/communications`,
        { token: session?.accessToken }
      )
      setCommunications(data.communications || [])
    } catch {
      // Silently handle
    } finally {
      setCommsLoading(false)
    }
  }

  const handleSaveNotes = async () => {
    setSaving(true)
    try {
      const updated = await api<CustomerDetail>(`/api/v1/customers/${customer.id}`, {
        method: 'PATCH',
        body: { notes },
        token: session?.accessToken
      })
      onCustomerUpdate({ ...customer, ...updated })
      setHasChanges(false)
    } catch {
      // Error handled silently
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      sent: 'bg-green-100 text-green-700',
      delivered: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700',
      bounced: 'bg-red-100 text-red-700',
      pending: 'bg-yellow-100 text-yellow-700'
    }
    return colors[status] || 'bg-gray-100 text-gray-700'
  }

  return (
    <div className="space-y-6">
      {/* Customer Notes */}
      <div className="bg-white border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Customer Notes</h3>
          {hasChanges && (
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white text-sm font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          )}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Add internal notes about this customer..."
        />

        {customer.notesUpdatedAt && customer.notesUpdatedByUser && (
          <div className="mt-2 text-xs text-gray-400">
            Last edited by {customer.notesUpdatedByUser.firstName} {customer.notesUpdatedByUser.lastName} on{' '}
            {formatDate(customer.notesUpdatedAt)}
          </div>
        )}
      </div>

      {/* Communication History */}
      <div className="bg-white border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Communication History</h3>

        {commsLoading ? (
          <p className="text-sm text-gray-500">Loading communications...</p>
        ) : communications.length === 0 ? (
          <p className="text-sm text-gray-500">No communications sent to this customer yet</p>
        ) : (
          <div className="space-y-3">
            {communications.map((comm) => (
              <div key={comm.id} className="border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {comm.channel === 'email' ? (
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    )}
                    <span className="text-sm font-medium text-gray-900 uppercase">{comm.channel}</span>
                    <span className={`text-xs px-1.5 py-0.5 font-medium ${statusBadge(comm.status)}`}>
                      {comm.status}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">{formatDate(comm.sentAt)}</span>
                </div>

                {comm.subject && (
                  <div className="text-sm text-gray-700 mb-1">{comm.subject}</div>
                )}
                {comm.messagePreview && (
                  <div className="text-xs text-gray-500 truncate">{comm.messagePreview}</div>
                )}

                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>To: {comm.recipient}</span>
                  {comm.healthCheckId && (
                    <Link
                      to={`/health-checks/${comm.healthCheckId}`}
                      className="text-primary hover:text-primary-dark"
                    >
                      {comm.vhcReference || 'View HC'} {comm.vehicleReg && `(${comm.vehicleReg})`}
                    </Link>
                  )}
                </div>

                {comm.errorMessage && (
                  <div className="mt-1 text-xs text-red-600">Error: {comm.errorMessage}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
