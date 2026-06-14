import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import {
  FollowUpDetail,
  FollowUpOutcome,
  FollowUpDisposition,
  FollowUpEvent,
  fmtMoney,
  fmtDate,
  fmtDateTime,
  STATUS_META,
} from './types'

interface Props {
  caseId: string
  onClose: () => void
  onChanged: () => void
}

const EVENT_LABEL: Record<string, string> = {
  step_sent: 'Message sent',
  sms_in: 'Customer replied',
  email_in: 'Customer replied',
  booking_found: 'Booking found',
  call_logged: 'Call logged',
  disposition_set: 'Disposition',
  status_change: 'Status changed',
  outcome_set: 'Closed',
  snoozed: 'Snoozed',
  note: 'Note',
  system: 'System',
}

export default function FollowUpDetailDrawer({ caseId, onClose, onChanged }: Props) {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const orgId = user?.organization?.id

  const [detail, setDetail] = useState<FollowUpDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [outcomes, setOutcomes] = useState<FollowUpOutcome[]>([])
  const [dispositions, setDispositions] = useState<FollowUpDisposition[]>([])

  const [panel, setPanel] = useState<'call' | 'close' | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Log-call form
  const [dispositionId, setDispositionId] = useState('')
  const [callNotes, setCallNotes] = useState('')
  const [callbackDate, setCallbackDate] = useState('')

  // Close form
  const [outcomeId, setOutcomeId] = useState('')
  const [closeNotes, setCloseNotes] = useState('')

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<FollowUpDetail>(`/api/v1/follow-ups/${caseId}`, { token })
      setDetail(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load case')
    } finally {
      setLoading(false)
    }
  }, [caseId, token, toast])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  useEffect(() => {
    if (!orgId) return
    api<{ outcomes: FollowUpOutcome[] }>(`/api/v1/organizations/${orgId}/follow-up-outcomes`, { token })
      .then((d) => setOutcomes(d.outcomes || [])).catch(() => {})
    api<{ dispositions: FollowUpDisposition[] }>(`/api/v1/organizations/${orgId}/follow-up-dispositions`, { token })
      .then((d) => setDispositions(d.dispositions || [])).catch(() => {})
  }, [orgId, token])

  const afterAction = async (msg: string) => {
    toast.success(msg)
    setPanel(null)
    setDispositionId(''); setCallNotes(''); setCallbackDate(''); setOutcomeId(''); setCloseNotes('')
    await fetchDetail()
    onChanged()
  }

  const submitCall = async () => {
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/log-call`, {
        method: 'POST', token,
        body: { disposition_id: dispositionId || null, notes: callNotes || null, callback_date: callbackDate || null },
      })
      await afterAction('Call logged')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log call')
    } finally { setSubmitting(false) }
  }

  const submitClose = async () => {
    if (!outcomeId) { toast.error('Pick an outcome'); return }
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/close`, { method: 'POST', token, body: { outcome_id: outcomeId, notes: closeNotes || null } })
      await afterAction('Case closed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close case')
    } finally { setSubmitting(false) }
  }

  const resume = async () => {
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/resume`, { method: 'POST', token })
      await afterAction('Cadence resumed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume')
    } finally { setSubmitting(false) }
  }

  const quickBooked = () => {
    const booked = outcomes.find((o) => o.isWon) || outcomes.find((o) => o.name.toLowerCase().includes('book'))
    if (booked) setOutcomeId(booked.id)
    setPanel('close')
  }

  const setItemOutcome = async (itemId: string, outcomeId: string) => {
    try {
      await api(`/api/v1/follow-ups/${caseId}/items/${itemId}/outcome`, { method: 'POST', token, body: { outcome_id: outcomeId || null } })
      await fetchDetail()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set item outcome')
    }
  }

  const c = detail?.case
  const isClosed = c?.status === 'closed'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-gray-50 h-full shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">{c?.customer?.name || 'Follow-up'}</h2>
              {c && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[c.status].cls}`}>{STATUS_META[c.status].label}</span>}
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              {c?.vehicle?.registration} · {c?.vehicle?.makeModel} · {fmtMoney(c?.deferredValue)} deferred
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {loading || !c ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Booking-found banner */}
            {detail?.booking && !isClosed && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="font-semibold text-green-800">Possible booking found</div>
                <div className="text-sm text-green-700 mt-1">
                  This customer has a workshop booking on <strong>{fmtDate(detail.booking.due_date)}</strong>
                  {detail.booking.jobsheet_number ? ` (jobsheet ${detail.booking.jobsheet_number})` : ''}. Confirm the deferred work is included.
                </div>
                {Array.isArray(detail.booking.booked_repairs) && detail.booking.booked_repairs.length > 0 && (
                  <ul className="text-xs text-green-700 mt-2 list-disc list-inside">
                    {detail.booking.booked_repairs.slice(0, 6).map((r, i) => <li key={i}>{r.description || r.code}</li>)}
                  </ul>
                )}
                <div className="flex gap-2 mt-3">
                  <button onClick={quickBooked} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Confirm as booked</button>
                  <button onClick={resume} disabled={submitting} className="px-3 py-1.5 border border-green-300 text-green-700 rounded-lg text-sm hover:bg-green-100">Not related — resume</button>
                </div>
              </div>
            )}

            {/* Closed banner */}
            {isClosed && (
              <div className="bg-gray-100 border border-gray-200 rounded-xl p-4 text-sm">
                <span className="text-gray-700">Closed {fmtDate(c.closedAt)} — </span>
                <span className="font-semibold text-gray-900">{c.outcome?.name || 'No outcome'}</span>
                {c.outcomeNotes && <div className="text-gray-500 mt-1">{c.outcomeNotes}</div>}
              </div>
            )}

            {/* Deferred work */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">Deferred work</div>
              <table className="min-w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {detail?.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-4 py-2.5 align-top">
                        <div className="text-gray-900">{it.name}</div>
                        {it.dueDate && <div className="text-xs text-gray-400">due {fmtDate(it.dueDate)}</div>}
                        {!isClosed ? (
                          <select
                            value={it.itemOutcome?.id || ''}
                            onChange={(e) => setItemOutcome(it.id, e.target.value)}
                            className="mt-1.5 border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">— item outcome —</option>
                            {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        ) : it.itemOutcome ? (
                          <div className="text-xs text-gray-500 mt-1">{it.itemOutcome.name}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap align-top">
                        <div className="font-medium text-gray-900">{fmtMoney(it.value)}</div>
                        {it.currentOutcomeStatus && it.currentOutcomeStatus !== 'deferred' && (
                          <div className="text-xs text-green-600 capitalize">{it.currentOutcomeStatus}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Contact + actions */}
            {!isClosed && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setPanel(panel === 'call' ? null : 'call')} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">Log call</button>
                <button onClick={() => setPanel(panel === 'close' ? null : 'close')} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">Close with outcome</button>
                {(c.status === 'engaged' || c.status === 'booking_found' || c.status === 'manual') && (
                  <button onClick={resume} disabled={submitting} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Resume cadence</button>
                )}
                {c.customer?.mobile && <a href={`tel:${c.customer.mobile}`} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 ml-auto">Call {c.customer.mobile}</a>}
              </div>
            )}

            {/* Log-call panel */}
            {panel === 'call' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Disposition</label>
                  <select value={dispositionId} onChange={(e) => setDispositionId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">— Select —</option>
                    {dispositions.map((d) => <option key={d.id} value={d.id}>{d.name}{d.snoozeDays ? ` (snooze ${d.snoozeDays}d)` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="What happened on the call?" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Call back on <span className="text-gray-400">(optional)</span></label>
                  <input type="date" value={callbackDate} onChange={(e) => setCallbackDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <button onClick={submitCall} disabled={submitting} className="w-full px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">{submitting ? 'Saving…' : 'Save call'}</button>
              </div>
            )}

            {/* Close panel */}
            {panel === 'close' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
                  <select value={outcomeId} onChange={(e) => setOutcomeId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">— Select —</option>
                    {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}{o.isWon ? ' ✓' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Optional notes" />
                </div>
                <button onClick={submitClose} disabled={submitting} className="w-full px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">{submitting ? 'Closing…' : 'Close case'}</button>
              </div>
            )}

            {/* Activity timeline */}
            <div>
              <div className="text-sm font-semibold text-gray-700 mb-2">Activity</div>
              <div className="space-y-2">
                {detail?.events.map((e: FollowUpEvent) => (
                  <div key={e.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">
                        {EVENT_LABEL[e.type] || e.type}{e.channel && e.type === 'step_sent' ? ` · ${e.channel}` : ''}{e.disposition ? ` · ${e.disposition}` : ''}
                      </span>
                      <span className="text-xs text-gray-400">{fmtDateTime(e.createdAt)}</span>
                    </div>
                    {e.body && <div className="text-gray-600 mt-0.5 whitespace-pre-wrap">{e.body}</div>}
                    {e.actor && <div className="text-xs text-gray-400 mt-0.5">by {e.actor}</div>}
                  </div>
                ))}
                {detail && detail.events.length === 0 && <div className="text-sm text-gray-400">No activity yet.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
