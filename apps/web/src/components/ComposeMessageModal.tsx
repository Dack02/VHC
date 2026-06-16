/**
 * ComposeMessageModal — start a NEW SMS conversation with a customer that is
 * NOT linked to a health check. Reused by the Customers area (recipient
 * pre-filled) and the Messages page (recipient chosen via a customer search).
 */

import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { api } from '../lib/api'

export interface ComposeCustomer {
  id: string
  firstName: string
  lastName: string
  mobile?: string | null
}

interface ComposeMessageModalProps {
  onClose: () => void
  /** Called after a message is sent, with the normalised (E.164) recipient number. */
  onSent: (phoneNumber: string) => void
  /** Pre-filled recipient. When omitted the modal shows a customer search picker. */
  customer?: ComposeCustomer
}

interface CustomerSearchResult {
  id: string
  firstName: string
  lastName: string
  mobile?: string
  email?: string
}

const MAX_LEN = 1000

export default function ComposeMessageModal({ onClose, onSent, customer }: ComposeMessageModalProps) {
  const { session } = useAuth()
  const toast = useToast()
  const [selected, setSelected] = useState<ComposeCustomer | null>(customer ?? null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // Customer picker state (only used when no recipient is pre-filled)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced customer search (picker mode only)
  useEffect(() => {
    if (selected) return
    const term = query.trim()
    if (term.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const data = await api<{ customers: CustomerSearchResult[] }>(
          `/api/v1/customers?search=${encodeURIComponent(term)}&limit=8`,
          { token: session?.accessToken }
        )
        if (!cancelled) setResults(data.customers || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, selected, session?.accessToken])

  const recipientMobile = selected?.mobile?.trim() || ''
  const canSend = !!selected && !!recipientMobile && !!message.trim() && !sending

  const handleSend = async () => {
    if (!selected) { setError('Select a customer to message'); return }
    if (!recipientMobile) { setError('This customer has no mobile number on file'); return }
    if (!message.trim()) return
    setError('')
    setSending(true)
    try {
      const res = await api<{ success: boolean; phoneNumber: string }>(
        '/api/v1/messages/conversations',
        {
          method: 'POST',
          body: { customerId: selected.id, message: message.trim() },
          token: session?.accessToken
        }
      )
      toast.success('Message sent')
      onSent(res.phoneNumber)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message'
      setError(msg)
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }

  const len = message.length
  const segments = len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md rounded-xl shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* Recipient */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            {selected ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {selected.firstName} {selected.lastName}
                  </div>
                  {recipientMobile ? (
                    <div className="text-sm text-gray-500">{recipientMobile}</div>
                  ) : (
                    <div className="text-sm text-red-600">No mobile number on file</div>
                  )}
                </div>
                {!customer && (
                  <button
                    onClick={() => { setSelected(null); setResults([]); setError('') }}
                    className="text-sm text-primary hover:text-primary-dark flex-shrink-0"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search customers by name, phone, or email..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {query.trim().length >= 2 && (
                  <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                    {searching && <div className="px-3 py-2 text-sm text-gray-400">Searching…</div>}
                    {!searching && results.length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-400">No customers found</div>
                    )}
                    {!searching && results.map((r) => {
                      const hasMobile = !!r.mobile?.trim()
                      return (
                        <button
                          key={r.id}
                          disabled={!hasMobile}
                          onClick={() => setSelected({ id: r.id, firstName: r.firstName, lastName: r.lastName, mobile: r.mobile })}
                          className={`w-full text-left px-3 py-2 text-sm ${hasMobile ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'}`}
                        >
                          <div className="font-medium text-gray-900">{r.firstName} {r.lastName}</div>
                          <div className="text-gray-500">{r.mobile?.trim() || 'No mobile number'}</div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
              rows={4}
              placeholder="Type your message…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>SMS · sent from your messaging number</span>
              <span>{len} chars{segments > 0 ? ` · ${segments} SMS` : ''}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="px-4 py-2 bg-primary text-white font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  )
}
