import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import { jobPath } from '../../lib/jobLink'
import {
  FollowUpDetail,
  FollowUpOutcome,
  FollowUpEvent,
  CadenceNode,
  MatchLevel,
  fmtMoney,
  fmtDate,
  fmtDateTime,
  fmtDayMonth,
  inDaysLabel,
  buildCadence,
  STATUS_META,
} from './types'
import FollowUpConversation from './FollowUpConversation'
import DmsBookingModal from '../BookingDiary/DmsBookingModal'

// Booking-match verdict → panel tone + chip styling. Full class strings (no
// dynamic concatenation) so Tailwind keeps them.
const VERDICT_TONE: Record<'related' | 'partial' | 'unrelated', {
  box: string; head: string; sub: string; chip: string; chipLabel: string
}> = {
  related: { box: 'bg-green-50 border-green-200', head: 'text-green-800', sub: 'text-green-700', chip: 'bg-green-100 text-green-700', chipLabel: 'Likely included' },
  partial: { box: 'bg-amber-50 border-amber-200', head: 'text-amber-800', sub: 'text-amber-700', chip: 'bg-amber-100 text-amber-700', chipLabel: 'Partly included' },
  unrelated: { box: 'bg-gray-50 border-gray-200', head: 'text-gray-800', sub: 'text-gray-600', chip: 'bg-gray-200 text-gray-700', chipLabel: 'Not related' },
}
const LEVEL_DOT: Record<MatchLevel, string> = {
  high: 'bg-green-500', medium: 'bg-amber-500', low: 'bg-gray-400', none: 'bg-gray-400',
}

interface Props {
  caseId: string
  onClose: () => void
  onChanged: () => void
}

// Footer "log result" channels. 'call' maps to the API's 'phone' channel.
const CHANNELS: Array<{ key: ChannelKey; label: string; icon: IconName }> = [
  { key: 'call', label: 'Call', icon: 'phone' },
  { key: 'sms', label: 'SMS', icon: 'sms' },
  { key: 'email', label: 'Email', icon: 'email' },
  { key: 'note', label: 'Note', icon: 'note' },
]
type ChannelKey = 'call' | 'sms' | 'email' | 'note'

const SNOOZE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Tomorrow' },
  { value: 3, label: 'In 3 days' },
  { value: 7, label: 'In 1 week' },
  { value: 14, label: 'In 2 weeks' },
]

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

type IconName =
  | 'flag' | 'sms' | 'email' | 'phone' | 'shield' | 'system'
  | 'note' | 'plus' | 'reply' | 'calendar' | 'check' | 'clock' | 'loop' | 'trend' | 'close' | 'external'

const ICON_PATHS: Record<IconName, string> = {
  flag: 'M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5',
  sms: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  email: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
  phone: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
  shield: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  system: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
  note: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125',
  plus: 'M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z',
  reply: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3',
  calendar: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
  check: 'M4.5 12.75l6 6 9-13.5',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  loop: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  trend: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  close: 'M6 18L18 6M6 6l12 12',
  external: 'M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25',
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[name]} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Activity event → label / icon / colour
// ---------------------------------------------------------------------------

function eventMeta(e: FollowUpEvent): { label: string; icon: IconName; tone: string } {
  const body = (e.body || '').toLowerCase()
  switch (e.type) {
    case 'step_sent':
      return { label: `Message sent · ${e.channel ? e.channel.toUpperCase() : 'SMS'}`, icon: e.channel === 'email' ? 'email' : 'sms', tone: 'bg-primary text-white' }
    case 'sms_in':
    case 'email_in':
      return { label: 'Customer replied', icon: 'reply', tone: 'bg-purple-100 text-purple-600' }
    case 'booking_found':
      return { label: 'Booking found', icon: 'calendar', tone: 'bg-green-100 text-green-600' }
    case 'contact_logged':
    case 'call_logged': {
      const map: Record<string, { label: string; icon: IconName }> = {
        phone: { label: 'Call logged', icon: 'phone' },
        sms: { label: 'SMS logged', icon: 'sms' },
        email: { label: 'Email logged', icon: 'email' },
        note: { label: 'Note', icon: 'note' },
      }
      const m = map[e.channel || 'phone'] || { label: 'Contact logged', icon: 'phone' as IconName }
      return { ...m, tone: 'bg-indigo-100 text-indigo-600' }
    }
    case 'outcome_set':
      return { label: 'Closed', icon: 'check', tone: 'bg-gray-200 text-gray-600' }
    case 'snoozed':
      return { label: 'Snoozed', icon: 'clock', tone: 'bg-gray-100 text-gray-500' }
    case 'note':
    case 'disposition_set':
      return { label: e.type === 'note' ? 'Note' : 'Disposition', icon: 'note', tone: 'bg-gray-100 text-gray-500' }
    case 'status_change':
      return { label: 'Status changed', icon: 'loop', tone: 'bg-gray-100 text-gray-500' }
    case 'system':
    default:
      if (body.startsWith('follow-up case created')) return { label: 'Follow-up case created', icon: 'plus', tone: 'bg-gray-100 text-gray-500' }
      if (/skip|suppress/.test(body)) {
        const isEmail = body.includes('email')
        return { label: isEmail ? 'Email skipped' : 'SMS skipped', icon: isEmail ? 'email' : 'sms', tone: 'bg-gray-100 text-gray-400' }
      }
      return { label: 'System', icon: 'system', tone: 'bg-gray-100 text-gray-500' }
  }
}

// ---------------------------------------------------------------------------
// Cadence stepper
// ---------------------------------------------------------------------------

function nodeCircleCls(state: CadenceNode['state']): string {
  const base = 'w-10 h-10 rounded-full flex items-center justify-center'
  switch (state) {
    case 'done': return `${base} bg-primary text-white`
    case 'due': return `${base} bg-primary text-white ring-4 ring-primary/20`
    case 'skipped': return `${base} bg-white border-2 border-dashed border-gray-300 text-gray-400`
    default: return `${base} bg-white border border-gray-300 text-gray-400`
  }
}

function Stepper({ nodes }: { nodes: CadenceNode[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-start min-w-[640px] px-1">
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            <div className="flex flex-col items-center text-center w-[84px] flex-shrink-0">
              <div className="relative">
                <div className={nodeCircleCls(n.state)}>
                  <Icon name={n.icon} className="w-5 h-5" />
                </div>
                {n.offsetDays != null && (
                  <span className="absolute -right-3 -top-1 bg-white border border-gray-200 rounded-full px-1.5 text-[10px] font-semibold text-gray-500 shadow-sm">
                    {n.offsetDays}d
                  </span>
                )}
              </div>
              <div className={`mt-2 text-xs font-medium leading-tight ${n.state === 'future' || n.state === 'skipped' ? 'text-gray-400' : 'text-gray-900'}`}>
                {n.label}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">{n.state === 'skipped' ? 'skipped' : fmtDayMonth(n.date)}</div>
              {n.state === 'due' && (
                <span className="mt-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded-full text-[10px] font-bold tracking-wide">DUE NOW</span>
              )}
            </div>
            {i < nodes.length - 1 && (
              <div className={`flex-1 h-0.5 mt-5 min-w-[20px] rounded-full ${n.state === 'done' || n.state === 'skipped' ? 'bg-primary' : 'bg-gray-200'}`} />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

// Normalise a stored UK mobile to E.164 so the SMS thread keys the same way
// inbound replies are stored (and matches the Messages-module conversation).
function toE164(m?: string | null): string | null {
  if (!m) return null
  const s = m.replace(/[\s()-]/g, '')
  if (s.startsWith('+')) return s
  if (s.startsWith('0')) return '+44' + s.slice(1)
  if (s.startsWith('44')) return '+' + s
  return s
}

// Best human-readable label for a booked-repair line. DMS imports often leave the
// repair `code` as a bare letter ("A") and put the actual work on the labour line,
// so fall back description → labour descriptions → code.
function bookedRepairLabel(r: {
  code?: string | null; description?: string | null; labourItems?: Array<{ description?: string | null }> | null
}): string {
  const labour = Array.isArray(r.labourItems)
    ? r.labourItems.map((l) => (l?.description || '').trim()).filter(Boolean)
    : []
  return (r.description || '').trim() || labour.join(' · ') || (r.code || '').trim() || '—'
}

export default function FollowUpDetailModal({ caseId, onClose, onChanged }: Props) {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const orgId = user?.organization?.id

  const [detail, setDetail] = useState<FollowUpDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [outcomes, setOutcomes] = useState<FollowUpOutcome[]>([])
  const [submitting, setSubmitting] = useState(false)

  // LOG RESULT footer state
  const [channel, setChannel] = useState<ChannelKey>('call')
  const [outcomeId, setOutcomeId] = useState('')
  const [note, setNote] = useState('')
  const [snoozeDays, setSnoozeDays] = useState<number | ''>('')

  // Future-booking record viewer (click-through from the booking-found banner)
  const [showBooking, setShowBooking] = useState(false)
  // Confirm-as-booked dialog (the "OK to close the case" step)
  const [confirming, setConfirming] = useState<'booked' | null>(null)
  // Track bookings we've already re-fetched once (to pick up the AI-refined
  // verdict that the API computes in the background) so we don't loop.
  const aiRefetched = useRef<Set<string>>(new Set())

  // `silent` refetches (after a save) leave the current content on screen and
  // refresh it in place — without it the body briefly swaps to "Loading…",
  // collapsing the modal height and making it flick off/on.
  const fetchDetail = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const data = await api<FollowUpDetail>(`/api/v1/follow-ups/${caseId}`, { token })
      setDetail(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load case')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [caseId, token, toast])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  useEffect(() => {
    if (!orgId) return
    api<{ outcomes: FollowUpOutcome[] }>(`/api/v1/organizations/${orgId}/follow-up-outcomes`, { token })
      .then((d) => setOutcomes(d.outcomes || [])).catch(() => {})
  }, [orgId, token])

  // Esc-to-close + lock background scroll while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // A fast deterministic verdict on an ambiguous booking means the API is
  // computing the AI-refined verdict in the background — re-fetch once shortly
  // after to surface it (guarded so it never loops).
  useEffect(() => {
    const b = detail?.booking
    const v = b?.verdict
    if (!b || !v || v.source !== 'deterministic') return
    const ambiguous = v.relatedness === 'partial' || v.level === 'medium' || v.level === 'low'
    if (!ambiguous || aiRefetched.current.has(b.id)) return
    aiRefetched.current.add(b.id)
    const t = setTimeout(() => { fetchDetail(true) }, 3500)
    return () => clearTimeout(t)
  }, [detail?.booking, fetchDetail])

  const afterAction = async (msg: string) => {
    toast.success(msg)
    setOutcomeId(''); setNote(''); setSnoozeDays(''); setChannel('call')
    await fetchDetail(true)
    onChanged()
  }

  // Closing a case ends the workflow, so dismiss the modal straight after rather
  // than leaving it open to unmount the booking banner + footer in place (the
  // collapse-and-recentre that read as a "flick"). The confirmed booking id is
  // threaded through so the close event can be reconciled against the attributed
  // booking in the reporting module.
  const closeWithOutcome = async (outcome_id: string, opts: { bookingId?: string | null; successMsg?: string } = {}) => {
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/close`, {
        method: 'POST', token,
        body: { outcome_id, notes: note.trim() || null, booking_id: opts.bookingId ?? null },
      })
      toast.success(opts.successMsg || 'Case closed')
      onChanged()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close case')
      setSubmitting(false)
    }
  }

  const submitResult = async () => {
    if (!outcomeId && !note.trim() && snoozeDays === '') {
      toast.error('Add a note, an outcome, or a call-back first')
      return
    }
    if (outcomeId) { await closeWithOutcome(outcomeId); return }
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/log-call`, {
        method: 'POST', token,
        body: { channel: channel === 'call' ? 'phone' : channel, notes: note || null, snooze_days: snoozeDays || null },
      })
      const base = channel === 'note' ? 'Note added' : channel === 'call' ? 'Call logged' : channel === 'sms' ? 'SMS logged' : 'Email logged'
      const snz = snoozeDays !== '' ? SNOOZE_OPTIONS.find((s) => s.value === snoozeDays)?.label.toLowerCase() : null
      await afterAction(snz ? `${base} — chasing again ${snz}` : base)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save result')
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

  // The outcome to record when an advisor confirms a found booking. The booking
  // pre-exists (the sweep matched it), so the semantically correct label is
  // "Already Booked"; fall back to "Booked", then any won outcome.
  const bookedOutcome =
    outcomes.find((o) => o.name.toLowerCase() === 'already booked') ||
    outcomes.find((o) => o.name.toLowerCase() === 'booked') ||
    outcomes.find((o) => o.isWon) ||
    null

  // "Confirm as booked" → one decisive action: close as booked and dismiss the
  // modal. Invoked from the confirm dialog so the advisor explicitly OKs the close.
  const confirmAsBooked = async () => {
    if (!bookedOutcome) {
      toast.error('No "Booked" outcome is configured — add one in Follow-Up Settings first')
      return
    }
    await closeWithOutcome(bookedOutcome.id, { bookingId: detail?.booking?.id || null, successMsg: 'Closed — booked' })
  }

  // "Not related": don't resume the cadence — drop straight onto the call list
  // with a clear reason so the customer can be phoned about the deferred work.
  const bookingUnrelated = async () => {
    try {
      setSubmitting(true)
      await api(`/api/v1/follow-ups/${caseId}/booking-unrelated`, { method: 'POST', token, body: {} })
      await afterAction('Added to call list — call the customer to discuss')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    } finally { setSubmitting(false) }
  }

  const setItemOutcome = async (itemId: string, value: string) => {
    try {
      await api(`/api/v1/follow-ups/${caseId}/items/${itemId}/outcome`, { method: 'POST', token, body: { outcome_id: value || null } })
      await fetchDetail(true)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set item outcome')
    }
  }

  const c = detail?.case
  const customerPhone = toE164(c?.customer?.mobile)
  const isClosed = c?.status === 'closed'
  const cadence = detail && detail.timelineSteps.length > 0 ? buildCadence(detail) : null
  const resumable = !!c && !isClosed && (c.status === 'engaged' || c.status === 'booking_found' || c.status === 'manual')

  // "Next: … · then …" summary from the cadence nodes.
  let summary: string | null = null
  if (cadence) {
    const dueIdx = cadence.nodes.findIndex((n) => n.state === 'due')
    if (dueIdx >= 0) {
      const due = cadence.nodes[dueIdx]
      const then = cadence.nodes.slice(dueIdx + 1).find((n) => n.state === 'due' || n.state === 'future')
      summary = `Next: ${due.label} ${inDaysLabel(due.date)}${then ? ` · then ${then.label} ${inDaysLabel(then.date)}` : ''}`
    }
  }

  // Footer "Save" affordance — label + a one-line hint of what the press does,
  // so logging a plain note reads differently from logging a contact attempt.
  const saveLabel = outcomeId
    ? 'Close case'
    : channel === 'note'
    ? 'Add note'
    : channel === 'call'
    ? 'Log call'
    : channel === 'sms'
    ? 'Log SMS'
    : 'Log email'
  const snoozePick = snoozeDays !== '' ? SNOOZE_OPTIONS.find((s) => s.value === snoozeDays)?.label.toLowerCase() : null
  const saveHint = outcomeId
    ? 'Closes the case'
    : channel === 'note' && snoozeDays === ''
    ? 'Note only — stays in cadence'
    : snoozePick
    ? `Call list · chase again ${snoozePick}`
    : 'Call list · due now'
  const canSave = !!outcomeId || !!note.trim() || snoozeDays !== ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-7xl max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 truncate">{c?.customer?.name || 'Follow-up'}</h2>
              {c && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[c.status].cls}`}>
                  <Icon name={c.status === 'booking_found' ? 'calendar' : c.status === 'closed' ? 'check' : 'loop'} className="w-3 h-3" />
                  {STATUS_META[c.status].label}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
              {c?.vehicle?.registration && (
                <span className="px-2 py-0.5 bg-gray-100 rounded-md text-xs font-semibold tracking-wide text-gray-700">{c.vehicle.registration}</span>
              )}
              <span>{c?.vehicle?.makeModel}</span>
              <span className="text-gray-300">·</span>
              <span><span className="font-semibold text-gray-700">{fmtMoney(c?.deferredValue)}</span> deferred</span>
              <span className="text-gray-300">·</span>
              <span>{c?.itemCount} item{c?.itemCount === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {c?.healthCheckId && (
              <a
                href={jobPath({ jobsheetId: c.jobsheetId, healthCheckId: c.healthCheckId })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                title="Open the original health check in a new tab"
              >
                <Icon name="external" className="w-4 h-4" />
                Health check
              </a>
            )}
            {customerPhone && (
              <a
                href={`/messages?phone=${encodeURIComponent(customerPhone)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                title="Open this conversation in the Messages page"
              >
                <Icon name="sms" className="w-4 h-4" />
                Messages
              </a>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <Icon name="close" className="w-6 h-6" />
            </button>
          </div>
        </div>

        {loading || !c ? (
          <div className="p-16 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-5">
              {/* Cadence stepper */}
              {cadence && (
                <div className="border border-gray-200 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-primary"><Icon name="trend" className="w-5 h-5" /></span>
                      <span className="font-semibold text-gray-900">Chase cadence</span>
                      <span className="text-gray-400">· step {cadence.currentStep} of {cadence.totalSteps}</span>
                    </div>
                    <div className="text-right">
                      {summary && <div className="text-sm text-gray-500">{summary}</div>}
                      {resumable && (
                        <button onClick={resume} disabled={submitting} className="text-xs text-primary font-semibold hover:underline mt-0.5">
                          Resume cadence →
                        </button>
                      )}
                    </div>
                  </div>
                  <Stepper nodes={cadence.nodes} />
                </div>
              )}

              {/* Booking-found banner — with relatedness verdict */}
              {detail?.booking && !isClosed && (() => {
                const b = detail.booking
                const v = b.verdict || null
                const tone = VERDICT_TONE[v?.relatedness || 'related']
                const repairs = Array.isArray(b.booked_repairs) ? b.booked_repairs : []
                const moreCount = Math.max(0, repairs.length - 6)
                const callEmphasis = v?.suggestedAction === 'call'
                const confirmEmphasis = !v || v.suggestedAction === 'confirm'
                return (
                  <div className={`border rounded-xl p-4 ${tone.box}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className={`font-semibold ${tone.head}`}>Possible booking found</div>
                      {v && (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${tone.chip}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[v.level]}`} />
                          {tone.chipLabel} · {Math.round(v.confidence * 100)}%
                          {v.source === 'ai' && <span className="opacity-60">· AI</span>}
                        </span>
                      )}
                    </div>
                    <div className={`text-sm mt-1 ${tone.sub}`}>
                      Workshop booking on <strong>{fmtDate(b.due_date)}</strong>
                      {b.jobsheet_number ? ` (jobsheet ${b.jobsheet_number})` : ''}.
                      {v ? ` ${v.message}` : ' Confirm the deferred work is included.'}
                    </div>

                    {/* Coverage detail when not a clean match */}
                    {v && v.relatedness !== 'related' && (v.matchedItems.length > 0 || v.unmatchedItems.length > 0) && (
                      <div className="mt-2 space-y-0.5 text-xs">
                        {v.matchedItems.length > 0 && (
                          <div className="text-green-700">✓ Appears covered: {v.matchedItems.join(', ')}</div>
                        )}
                        {v.unmatchedItems.length > 0 && (
                          <div className={tone.sub}>– Not seen in booking: {v.unmatchedItems.join(', ')}</div>
                        )}
                      </div>
                    )}

                    {repairs.length > 0 && (
                      <ul className={`text-xs mt-2 list-disc list-inside ${tone.sub}`}>
                        {repairs.slice(0, 6).map((r, i) => <li key={i}>{bookedRepairLabel(r)}</li>)}
                        {moreCount > 0 && <li className="list-none opacity-70">+{moreCount} more booked item{moreCount === 1 ? '' : 's'} (assessed in full)</li>}
                      </ul>
                    )}

                    {b.notes && (
                      <p className={`text-xs mt-2 line-clamp-2 ${tone.sub}`}>
                        <span className="font-medium">Booking note:</span> {b.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        onClick={() => setConfirming('booked')}
                        disabled={submitting}
                        className={confirmEmphasis
                          ? 'px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 ring-2 ring-green-300 disabled:opacity-50'
                          : 'px-3 py-1.5 bg-white border border-green-300 text-green-700 rounded-lg text-sm font-medium hover:bg-green-50 disabled:opacity-50'}
                      >
                        Confirm as booked
                      </button>
                      <button
                        onClick={() => setShowBooking(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                      >
                        <Icon name="external" className="w-4 h-4" />
                        View booking
                      </button>
                      <button
                        onClick={bookingUnrelated}
                        disabled={submitting}
                        className={callEmphasis
                          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600'
                          : 'inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50'}
                        title="Not related to this deferred work — move to the call list to phone the customer"
                      >
                        <Icon name="phone" className="w-4 h-4" />
                        Not related — call customer
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* Closed banner */}
              {isClosed && (
                <div className="bg-gray-100 border border-gray-200 rounded-xl p-4 text-sm">
                  <span className="text-gray-700">Closed {fmtDate(c.closedAt)} — </span>
                  <span className="font-semibold text-gray-900">{c.outcome?.name || 'No outcome'}</span>
                  {c.outcomeNotes && <div className="text-gray-500 mt-1">{c.outcomeNotes}</div>}
                </div>
              )}

              {/* Three columns: deferred work | activity | conversation */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Deferred work */}
                <div className="min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Deferred work</h3>
                    <span className="text-xs text-gray-400">{c.itemCount} item{c.itemCount === 1 ? '' : 's'} · {fmtMoney(c.deferredValue)}</span>
                  </div>
                  <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                    {detail?.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 break-words">{it.name}</div>
                          {it.dueDate && <div className="text-xs text-gray-400">due {fmtDate(it.dueDate)}</div>}
                        </div>
                        <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">{fmtMoney(it.value)}</div>
                        {!isClosed ? (
                          <select
                            value={it.itemOutcome?.id || ''}
                            onChange={(e) => setItemOutcome(it.id, e.target.value)}
                            className="w-36 border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">— item outcome —</option>
                            {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        ) : it.itemOutcome ? (
                          <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs text-gray-600 whitespace-nowrap">{it.itemOutcome.name}</span>
                        ) : null}
                      </div>
                    ))}
                    {detail && detail.items.length === 0 && <div className="px-4 py-6 text-sm text-gray-400 text-center">No deferred items.</div>}
                  </div>
                </div>

                {/* Activity */}
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Activity</h3>
                  <div className="space-y-4">
                    {detail?.events.map((e) => {
                      const m = eventMeta(e)
                      return (
                        <div key={e.id} className="flex gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${m.tone}`}>
                            <Icon name={m.icon} className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-gray-800">{m.label}{e.disposition ? ` · ${e.disposition}` : ''}</span>
                              <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(e.createdAt)}</span>
                            </div>
                            {e.body && <div className="text-sm text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{e.body}</div>}
                            {e.actor && <div className="text-xs text-gray-400 mt-0.5">by {e.actor}</div>}
                          </div>
                        </div>
                      )
                    })}
                    {detail && detail.events.length === 0 && <div className="text-sm text-gray-400">No activity yet.</div>}
                  </div>
                </div>

                {/* Conversation — live two-way SMS, customer-wide (same thread as Messages) */}
                <div className="min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Conversation</h3>
                    {customerPhone && (
                      <a href={`/messages?phone=${encodeURIComponent(customerPhone)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:text-primary-dark">Open in Messages →</a>
                    )}
                  </div>
                  {customerPhone ? (
                    <div className="h-[460px]">
                      <FollowUpConversation phoneNumber={customerPhone} customerName={c.customer?.name || null} />
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl h-[460px] flex flex-col items-center justify-center text-center text-gray-400 px-4">
                      <Icon name="sms" className="w-8 h-8 mb-2" />
                      <p className="text-sm">No mobile number on file</p>
                      <p className="text-xs mt-1">Add a mobile to the customer to send SMS.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* LOG RESULT footer */}
            {!isClosed && (
              <div className="flex-shrink-0 border-t border-gray-200 bg-gray-50/60 px-6 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 mr-1">Log result</span>
                  <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                    {CHANNELS.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setChannel(t.key)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm ${channel === t.key ? 'bg-primary/10 text-primary font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        <Icon name={t.icon} className="w-4 h-4" />{t.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={outcomeId}
                    onChange={(e) => setOutcomeId(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— outcome —</option>
                    {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}{o.isWon ? ' ✓' : ''}</option>)}
                  </select>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note (optional)…"
                    className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  {c.customer?.mobile && (
                    <a href={`tel:${c.customer.mobile}`} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-white">
                      <Icon name="phone" className="w-4 h-4 text-primary" />{c.customer.mobile}
                    </a>
                  )}
                  <select
                    value={snoozeDays}
                    onChange={(e) => setSnoozeDays(e.target.value ? Number(e.target.value) : '')}
                    disabled={!!outcomeId}
                    title={outcomeId ? 'Selecting an outcome closes the case' : 'Defer — chase again later'}
                    className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                  >
                    <option value="">No call-back</option>
                    {SNOOZE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <span className="ml-auto text-xs text-gray-400 hidden sm:block text-right">{saveHint}</span>
                  <button
                    onClick={submitResult}
                    disabled={submitting || !canSave}
                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon name={channel === 'note' && !outcomeId ? 'note' : 'check'} className="w-4 h-4" />
                    {submitting ? 'Saving…' : saveLabel}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirm-as-booked dialog — the explicit "OK to close the case" step */}
      {confirming === 'booked' && detail?.booking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!submitting) setConfirming(null) }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                <Icon name="calendar" className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900">Close this case as booked?</h3>
                <p className="text-sm text-gray-500 mt-1.5">
                  Records the deferred work as recovered against the workshop booking on{' '}
                  <strong className="text-gray-700">{fmtDate(detail.booking.due_date)}</strong>
                  {detail.booking.jobsheet_number ? ` (jobsheet ${detail.booking.jobsheet_number})` : ''} and closes the follow-up
                  {bookedOutcome ? <> as <strong className="text-gray-700">{bookedOutcome.name}</strong></> : ''}.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirming(null)}
                disabled={submitting}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmAsBooked}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                <Icon name="check" className="w-4 h-4" />
                {submitting ? 'Closing…' : 'Yes, close as booked'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Future-booking record viewer (click-through) */}
      {showBooking && detail?.booking && (
        <DmsBookingModal
          healthCheckId={detail.booking.id}
          endpoint={`/api/v1/follow-ups/${caseId}/booking`}
          onClose={() => setShowBooking(false)}
          onOpenFull={() => window.open(jobPath({ healthCheckId: detail.booking!.id }), '_blank', 'noopener')}
        />
      )}
    </div>
  )
}
