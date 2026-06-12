import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface SmsConfirmModalProps {
  healthCheckId: string
  customerName: string
  customerMobile: string | null
  initialMessage: string
  /** Status that triggered the SMS; omit for an ad-hoc composed message */
  statusName?: string | null
  onClose: () => void
  onSent: () => void
}

/**
 * Confirmation popup shown before any SMS is sent (status-triggered or
 * composed ad-hoc). Nothing is ever sent automatically - the advisor
 * reviews (and can edit) the message, then explicitly confirms.
 */
export default function SmsConfirmModal({
  healthCheckId,
  customerName,
  customerMobile,
  initialMessage,
  statusName,
  onClose,
  onSent
}: SmsConfirmModalProps) {
  const { session } = useAuth()
  const toast = useToast()
  const [message, setMessage] = useState(initialMessage)
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!session?.accessToken || !message.trim()) return
    setSending(true)
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/sms-reply`, {
        method: 'POST',
        token: session.accessToken,
        body: { message: message.trim() }
      })
      toast.success('SMS sent to customer')
      onSent()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send SMS')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Send SMS to customer?</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {statusName && (
                <>Status set to <span className="font-medium">{statusName}</span>. </>
              )}
              Review the message before sending to{' '}
              <span className="font-medium">{customerName}</span>
              {customerMobile ? ` (${customerMobile})` : ''}.
            </p>
          </div>
        </div>

        {!customerMobile ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 mb-4">
            This customer has no mobile number on file - the SMS cannot be sent.
          </div>
        ) : (
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={4}
            maxLength={480}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-1"
          />
        )}
        {customerMobile && (
          <div className="text-xs text-gray-400 text-right mb-4">{message.length} characters</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {customerMobile ? "Don't send" : 'Close'}
          </button>
          {customerMobile && (
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send SMS'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
