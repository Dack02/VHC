import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, HealthCheck, Customer } from '../../lib/api'

interface UnableToSendReason {
  id: string
  reason: string
  description: string | null
}

interface PublishModalProps {
  healthCheck: HealthCheck
  customer: Customer | undefined
  onClose: () => void
  onPublished: () => void
  onRecordAuth?: () => void
}

export function PublishModal({ healthCheck, customer, onClose, onPublished, onRecordAuth }: PublishModalProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [showUnableToSend, setShowUnableToSend] = useState(false)
  const [unableReasons, setUnableReasons] = useState<UnableToSendReason[]>([])
  const [loadingReasons, setLoadingReasons] = useState(false)
  const [savingReason, setSavingReason] = useState(false)

  const [sendOptions, setSendOptions] = useState({
    sendEmail: !!customer?.email,
    sendSms: !!customer?.mobile,
    expiresInDays: 7,
    message: ''
  })

  const canSend = sendOptions.sendEmail || sendOptions.sendSms
  const organizationId = user?.organization?.id

  const fetchUnableReasons = async () => {
    if (!organizationId || !session?.accessToken) return

    try {
      setLoadingReasons(true)
      const data = await api<{ reasons: UnableToSendReason[] }>(
        `/api/v1/organizations/${organizationId}/unable-to-send-reasons`,
        { token: session.accessToken }
      )
      let reasons = data.reasons || []

      // If no reasons exist, seed defaults first
      if (reasons.length === 0) {
        await api(
          `/api/v1/organizations/${organizationId}/unable-to-send-reasons/seed-defaults`,
          { method: 'POST', token: session.accessToken }
        )
        const refreshed = await api<{ reasons: UnableToSendReason[] }>(
          `/api/v1/organizations/${organizationId}/unable-to-send-reasons`,
          { token: session.accessToken }
        )
        reasons = refreshed.reasons || []
      }

      setUnableReasons(reasons)
    } catch {
      setUnableReasons([])
    } finally {
      setLoadingReasons(false)
    }
  }

  useEffect(() => {
    if (showUnableToSend && unableReasons.length === 0) {
      fetchUnableReasons()
    }
  }, [showUnableToSend])

  const handleSelectReason = async (reasonId: string) => {
    if (!session?.accessToken) return

    try {
      setSavingReason(true)
      await api(`/api/v1/health-checks/${healthCheck.id}/unable-to-send`, {
        method: 'PATCH',
        token: session.accessToken,
        body: { unable_to_send_reason_id: reasonId }
      })
      toast.success('Unable to send reason recorded')
      onPublished()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record reason')
      setSavingReason(false)
    }
  }

  const handlePublish = async () => {
    if (!session?.accessToken || !canSend) return

    setSending(true)
    setError(null)

    try {
      await api(`/api/v1/health-checks/${healthCheck.id}/publish`, {
        method: 'POST',
        token: session.accessToken,
        body: {
          send_email: sendOptions.sendEmail,
          send_sms: sendOptions.sendSms,
          expires_in_days: sendOptions.expiresInDays,
          message: sendOptions.message || undefined
        }
      })
      setSuccess(true)
      setTimeout(() => {
        onPublished()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {showUnableToSend ? 'Unable to Send' : 'Send to Customer'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-900">Sent Successfully!</p>
              <p className="text-gray-500 mt-1">The customer will receive their health check report.</p>
            </div>
          ) : showUnableToSend ? (
            <>
              {error && (
                <div className="bg-red-50 text-red-700 p-4 mb-4">
                  {error}
                </div>
              )}

              <p className="text-sm text-gray-600 mb-4">
                Select the reason this health check cannot be sent to the customer:
              </p>

              {loadingReasons ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="space-y-2">
                  {unableReasons.map((reason) => (
                    <button
                      key={reason.id}
                      onClick={() => handleSelectReason(reason.id)}
                      disabled={savingReason}
                      className="w-full text-left p-3 border border-gray-200 hover:border-primary hover:bg-indigo-50 transition-colors disabled:opacity-50"
                    >
                      <div className="font-medium text-gray-900">{reason.reason}</div>
                      {reason.description && (
                        <div className="text-sm text-gray-500 mt-0.5">{reason.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4">
                <button
                  onClick={() => { setShowUnableToSend(false); setError(null) }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  &larr; Back to send options
                </button>
              </div>
            </>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 text-red-700 p-4 mb-4">
                  {error}
                </div>
              )}

              {/* Customer info */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Sending to</h3>
                <div className="bg-gray-50 p-4">
                  <div className="font-medium">
                    {customer?.first_name} {customer?.last_name}
                  </div>
                  {customer?.email && (
                    <div className="text-sm text-gray-500">{customer.email}</div>
                  )}
                  {customer?.mobile && (
                    <div className="text-sm text-gray-500">{customer.mobile}</div>
                  )}
                </div>
              </div>

              {/* Send methods */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Send via</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 border border-gray-200 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={sendOptions.sendEmail}
                      onChange={e => setSendOptions({ ...sendOptions, sendEmail: e.target.checked })}
                      disabled={!customer?.email}
                      className="rounded"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">Email</div>
                      <div className="text-sm text-gray-500">
                        {customer?.email || 'No email on file'}
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-gray-200 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={sendOptions.sendSms}
                      onChange={e => setSendOptions({ ...sendOptions, sendSms: e.target.checked })}
                      disabled={!customer?.mobile}
                      className="rounded"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">SMS</div>
                      <div className="text-sm text-gray-500">
                        {customer?.mobile || 'No mobile on file'}
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* No contact info hint */}
              {!customer?.email && !customer?.mobile && onRecordAuth && (
                <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    This customer has no email or mobile number on file.
                    You can record their authorization in person instead.
                  </p>
                  <button
                    onClick={() => { onClose(); onRecordAuth() }}
                    className="mt-2 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                  >
                    Record Authorisation
                  </button>
                </div>
              )}

              {/* Unable to Send option */}
              <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-600">
                  Can't send this to the customer?
                </p>
                <button
                  onClick={() => setShowUnableToSend(true)}
                  className="mt-2 px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100"
                >
                  Unable to Send
                </button>
              </div>

              {/* Expiry */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Link expires in</h3>
                <select
                  value={sendOptions.expiresInDays}
                  onChange={e => setSendOptions({ ...sendOptions, expiresInDays: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>

              {/* Custom message */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Custom message (optional)</h3>
                <textarea
                  value={sendOptions.message}
                  onChange={e => setSendOptions({ ...sendOptions, message: e.target.value })}
                  placeholder="Add a personal note to the customer..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && !showUnableToSend && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={sending || !canSend}
              className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Now'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
