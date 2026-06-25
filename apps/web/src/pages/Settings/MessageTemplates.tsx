import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Placeholder {
  key: string
  label: string
  description: string
}

interface MessageTemplate {
  id?: string
  templateType: string
  channel: 'sms' | 'email'
  isCustom: boolean
  smsContent?: string
  emailSubject?: string
  emailGreeting?: string
  emailBody?: string
  emailClosing?: string
  emailSignature?: string
  emailCtaText?: string
}

interface TestRecipients {
  email: string | null
  phone: string | null
}

interface TemplatesResponse {
  templates: Record<string, { sms: MessageTemplate; email: MessageTemplate }>
  placeholders: Placeholder[]
  testRecipients?: TestRecipients
}

interface SmsPreviewResponse {
  preview: string
  characterCount: number
  segmentCount: number
  warning: string | null
}

interface EmailPreviewResponse {
  subject: string
  html: string
  text: string
}

interface NotificationSettings {
  defaultReminderEnabled: boolean
}

type CoreType =
  | 'health_check_ready'
  | 'reminder'
  | 'reminder_urgent'
  | 'authorization_confirmation'

interface CoreMeta {
  type: CoreType
  label: string
  description: string
  category: string
}

interface FollowUpStep {
  id: string
  stepOrder: number
  action: string
  offsetDays: number
  smsBody: string | null
  emailSubject: string | null
  emailBody: string | null
  defaultOutcomeId: string | null
}

interface FollowUpTimeline {
  id: string
  name: string
  description: string | null
  anchor: string
  isDefault: boolean
  isActive: boolean
  steps: FollowUpStep[]
}

interface Token {
  key: string
  label?: string
  description?: string
}

type Channel = 'sms' | 'email'

type Selection =
  | { kind: 'core'; type: CoreType }
  | { kind: 'fu'; timelineId: string; stepOrder: number }

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CORE_META: CoreMeta[] = [
  {
    type: 'health_check_ready',
    label: 'Health Check Ready',
    description: 'Sent when a health check is published to the customer.',
    category: 'Health Check Delivery'
  },
  {
    type: 'reminder',
    label: 'Reminder',
    description: "Sent at intervals to nudge customers who haven't viewed their health check.",
    category: 'Reminders & Chasing'
  },
  {
    type: 'reminder_urgent',
    label: 'Urgent Reminder',
    description: 'Sent when less than 24 hours remain before the link expires.',
    category: 'Reminders & Chasing'
  },
  {
    type: 'authorization_confirmation',
    label: 'Authorisation Confirmation',
    description: 'Sent after a customer authorises work.',
    category: 'Confirmations'
  }
]

const FU_TOKENS: Token[] = [
  { key: 'customerFirstName', description: 'Customer first name' },
  { key: 'vehicleReg', description: 'Vehicle registration' },
  { key: 'vehicleMakeModel', description: 'Vehicle make & model' },
  { key: 'deferredTotal', description: 'Total £ of deferred work' },
  { key: 'dueDate', description: 'Work due date' },
  { key: 'followUpUrl', description: 'Booking link' },
  { key: 'dealershipName', description: 'Dealership name' },
  { key: 'dealershipPhone', description: 'Dealership phone' },
  { key: 'deferredItemsTable', description: 'Work list table (email only)' }
]
const FU_SMS_TOKENS = FU_TOKENS.filter(t => t.key !== 'deferredItemsTable')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionChannels(action: string): Channel[] {
  if (action === 'send_sms') return ['sms']
  if (action === 'send_email') return ['email']
  if (action === 'send_both') return ['sms', 'email']
  return []
}

function anchorLabel(anchor: string): string {
  return anchor === 'deferral_date' ? 'deferral date' : 'due date'
}

function timingLabel(offsetDays: number, anchor: string): string {
  const a = anchorLabel(anchor)
  if (offsetDays === 0) return `on ${a}`
  const n = Math.abs(offsetDays)
  return offsetDays < 0 ? `${n} day${n > 1 ? 's' : ''} before ${a}` : `${n} day${n > 1 ? 's' : ''} after ${a}`
}

function ChannelBadge({ channel }: { channel: Channel }) {
  const isSms = channel === 'sms'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
        isSms ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
      }`}
    >
      {isSms ? 'SMS' : 'Email'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// TokenField — input/textarea with click-to-insert placeholder chips
// ---------------------------------------------------------------------------

function TokenField({
  label,
  value,
  onChange,
  tokens,
  multiline,
  rows = 4,
  placeholder,
  hint,
  mono,
  disabled
}: {
  label: string
  value: string
  onChange: (v: string) => void
  tokens: Token[]
  multiline?: boolean
  rows?: number
  placeholder?: string
  hint?: string
  mono?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  const insert = (key: string) => {
    const el = ref.current
    const ins = `{{${key}}}`
    if (!el) {
      onChange(value + ins)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    onChange(value.slice(0, start) + ins + value.slice(end))
    setTimeout(() => {
      el.focus()
      const pos = start + ins.length
      el.selectionStart = el.selectionEnd = pos
    }, 0)
  }

  const fieldClass = `w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm ${
    mono ? 'font-mono' : ''
  } disabled:bg-gray-50 disabled:text-gray-500`

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          className={fieldClass}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={fieldClass}
        />
      )}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
      {!disabled && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {tokens.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => insert(t.key)}
              title={t.description || t.label || t.key}
              className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary rounded border border-gray-200 transition-colors"
            >
              {`{{${t.key}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test-send button (sends to the logged-in admin's own account)
// ---------------------------------------------------------------------------

function TestSendButton({
  channel,
  recipients,
  onSend
}: {
  channel: Channel
  recipients?: TestRecipients
  onSend: () => Promise<{ success: boolean; message: string }>
}) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const dest = channel === 'sms' ? recipients?.phone : recipients?.email
  const noPhone = channel === 'sms' && !recipients?.phone

  const handle = async () => {
    setSending(true)
    setResult(null)
    try {
      const r = await onSend()
      setResult({ ok: r.success, msg: r.message })
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setSending(false)
      setTimeout(() => setResult(null), 6000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={sending || noPhone}
        title={
          noPhone
            ? 'Add a mobile number to your profile to test SMS'
            : dest
              ? `Sends to you: ${dest}`
              : 'Send a test to your account'
        }
        className="px-3 py-1.5 text-sm font-medium text-primary border border-primary/40 rounded-lg hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
      >
        {sending ? 'Sending…' : `Send test ${channel === 'sms' ? 'SMS' : 'email'}`}
      </button>
      {noPhone ? (
        <span className="text-[11px] text-gray-400">No mobile on your profile</span>
      ) : dest ? (
        <span className="text-[11px] text-gray-400">to you · {dest}</span>
      ) : null}
      {result && (
        <span className={`text-xs ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.msg}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SMS / Email preview panes
// ---------------------------------------------------------------------------

function SmsPreviewPane({ preview }: { preview: SmsPreviewResponse | null }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Preview</h4>
        <span
          className={`text-xs ${(preview?.characterCount || 0) > 160 ? 'text-amber-600' : 'text-gray-400'}`}
        >
          {preview?.characterCount || 0} chars
          {(preview?.segmentCount || 0) > 1 && ` · ${preview?.segmentCount} segments`}
        </span>
      </div>
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg min-h-[80px]">
        <div className="bg-green-100 text-green-900 p-3 rounded-2xl rounded-bl-sm max-w-xs text-sm whitespace-pre-wrap">
          {preview?.preview || '…'}
        </div>
      </div>
      {preview?.warning && <p className="text-xs text-amber-600 mt-2">{preview.warning}</p>}
    </div>
  )
}

function EmailPreviewPane({ preview }: { preview: EmailPreviewResponse | null }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Preview</h4>
      <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
        <div className="p-2 bg-gray-100 border-b border-gray-200 text-sm truncate">
          <strong>Subject:</strong> {preview?.subject || '…'}
        </div>
        <div className="h-[420px] overflow-auto bg-white">
          {preview?.html ? (
            <iframe srcDoc={preview.html} className="w-full h-full border-0" title="Email preview" />
          ) : (
            <div className="p-4 text-gray-400 text-sm">…</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Core template editor
// ---------------------------------------------------------------------------

function CoreEditor({
  orgId,
  token,
  meta,
  data,
  tokens,
  recipients,
  remindersEnabled,
  onToggleReminders,
  savingReminders,
  onSaved,
  onNotify
}: {
  orgId: string
  token: string | undefined
  meta: CoreMeta
  data: { sms: MessageTemplate; email: MessageTemplate }
  tokens: Token[]
  recipients?: TestRecipients
  remindersEnabled: boolean
  onToggleReminders: () => void
  savingReminders: boolean
  onSaved: () => void
  onNotify: (kind: 'success' | 'error', msg: string) => void
}) {
  const isReminder = meta.type === 'reminder' || meta.type === 'reminder_urgent'

  const [channel, setChannel] = useState<Channel>('sms')

  // Draft + baseline (last saved) state, seeded once at mount (component is keyed by type).
  const [sms, setSms] = useState(data.sms.smsContent || '')
  const [email, setEmail] = useState({
    emailSubject: data.email.emailSubject || '',
    emailGreeting: data.email.emailGreeting || '',
    emailBody: data.email.emailBody || '',
    emailClosing: data.email.emailClosing || '',
    emailSignature: data.email.emailSignature || '',
    emailCtaText: data.email.emailCtaText || ''
  })
  const [baselineSms, setBaselineSms] = useState(sms)
  const [baselineEmail, setBaselineEmail] = useState(email)

  const [smsPreview, setSmsPreview] = useState<SmsPreviewResponse | null>(null)
  const [emailPreview, setEmailPreview] = useState<EmailPreviewResponse | null>(null)
  const [saving, setSaving] = useState(false)

  const smsDirty = sms !== baselineSms
  const emailDirty = JSON.stringify(email) !== JSON.stringify(baselineEmail)

  // Live preview (debounced) for the active channel.
  useEffect(() => {
    if (!orgId) return
    const t = setTimeout(async () => {
      try {
        if (channel === 'sms') {
          const r = await api<SmsPreviewResponse>(
            `/api/v1/organizations/${orgId}/message-templates/${meta.type}/sms/preview`,
            { method: 'POST', body: { smsContent: sms }, token }
          )
          setSmsPreview(r)
        } else {
          const r = await api<EmailPreviewResponse>(
            `/api/v1/organizations/${orgId}/message-templates/${meta.type}/email/preview`,
            { method: 'POST', body: email, token }
          )
          setEmailPreview(r)
        }
      } catch {
        /* preview is best-effort */
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, sms, email])

  const saveSms = async () => {
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/message-templates/${meta.type}/sms`, {
        method: 'PATCH',
        body: { smsContent: sms },
        token
      })
      setBaselineSms(sms)
      onNotify('success', 'SMS template saved')
      onSaved()
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save SMS')
    } finally {
      setSaving(false)
    }
  }

  const saveEmail = async () => {
    setSaving(true)
    try {
      await api(`/api/v1/organizations/${orgId}/message-templates/${meta.type}/email`, {
        method: 'PATCH',
        body: email,
        token
      })
      setBaselineEmail(email)
      onNotify('success', 'Email template saved')
      onSaved()
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save email')
    } finally {
      setSaving(false)
    }
  }

  const resetChannel = async () => {
    if (!confirm(`Reset the ${channel === 'sms' ? 'SMS' : 'email'} template to the default? This cannot be undone.`))
      return
    setSaving(true)
    try {
      const r = await api<{ template: MessageTemplate }>(
        `/api/v1/organizations/${orgId}/message-templates/${meta.type}/${channel}/reset`,
        { method: 'POST', token }
      )
      const t = r.template
      if (channel === 'sms') {
        const v = t.smsContent || ''
        setSms(v)
        setBaselineSms(v)
      } else {
        const v = {
          emailSubject: t.emailSubject || '',
          emailGreeting: t.emailGreeting || '',
          emailBody: t.emailBody || '',
          emailClosing: t.emailClosing || '',
          emailSignature: t.emailSignature || '',
          emailCtaText: t.emailCtaText || ''
        }
        setEmail(v)
        setBaselineEmail(v)
      }
      onNotify('success', 'Reset to default')
      onSaved()
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to reset')
    } finally {
      setSaving(false)
    }
  }

  const testSend = async () => {
    const body = channel === 'sms' ? { smsContent: sms } : email
    const r = await api<{ success: boolean; to?: string; error?: string }>(
      `/api/v1/organizations/${orgId}/message-templates/${meta.type}/${channel}/test-send`,
      { method: 'POST', body, token, retry: false }
    )
    return {
      success: !!r.success,
      message: r.success ? `Test ${channel === 'sms' ? 'SMS' : 'email'} sent to ${r.to}` : r.error || 'Send failed'
    }
  }

  const isCustom = channel === 'sms' ? data.sms.isCustom : data.email.isCustom

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{meta.label}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{meta.description}</p>
        </div>
        <span
          className={`shrink-0 mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            isCustom ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isCustom ? 'Customised' : 'Default'}
        </span>
      </div>

      {/* Reminder auto-send toggle */}
      {isReminder && (
        <div className="my-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Automatic reminders</h3>
            <p className="text-xs text-gray-600">
              Send reminder notifications to customers who haven&apos;t viewed their health check.
            </p>
          </div>
          <button
            onClick={onToggleReminders}
            disabled={savingReminders}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${
              remindersEnabled ? 'bg-primary' : 'bg-gray-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                remindersEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      )}

      {/* Channel toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 my-4">
        {(['sms', 'email'] as Channel[]).map(ch => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              channel === ch ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {ch === 'sms' ? 'SMS' : 'Email'}
          </button>
        ))}
      </div>

      {/* Editor + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {channel === 'sms' ? (
            <TokenField
              label="SMS message"
              value={sms}
              onChange={setSms}
              tokens={tokens}
              multiline
              rows={5}
              mono
              placeholder="Enter SMS message…"
            />
          ) : (
            <>
              <TokenField label="Subject" value={email.emailSubject} onChange={v => setEmail({ ...email, emailSubject: v })} tokens={tokens} placeholder="Your Vehicle Health Check is Ready" />
              <TokenField label="Greeting" value={email.emailGreeting} onChange={v => setEmail({ ...email, emailGreeting: v })} tokens={tokens} placeholder="Hi {{customerName}}," />
              <TokenField label="Body" value={email.emailBody} onChange={v => setEmail({ ...email, emailBody: v })} tokens={tokens} multiline rows={5} hint="Leave a blank line between paragraphs." placeholder="Main message content…" />
              <TokenField label="Closing" value={email.emailClosing} onChange={v => setEmail({ ...email, emailClosing: v })} tokens={tokens} placeholder="If you have any questions…" />
              <div className="grid grid-cols-2 gap-4">
                <TokenField label="Signature" value={email.emailSignature} onChange={v => setEmail({ ...email, emailSignature: v })} tokens={tokens} placeholder="{{dealershipName}}" />
                <TokenField label="Button text" value={email.emailCtaText} onChange={v => setEmail({ ...email, emailCtaText: v })} tokens={tokens} placeholder="View Health Check" />
              </div>
              {meta.type === 'health_check_ready' && (
                <p className="text-xs text-gray-400">
                  The RAG summary, recommended-work list and action button are added automatically.
                </p>
              )}
            </>
          )}
        </div>

        <div>{channel === 'sms' ? <SmsPreviewPane preview={smsPreview} /> : <EmailPreviewPane preview={emailPreview} />}</div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-4 mt-6 pt-4 border-t border-gray-100">
        <button
          onClick={resetChannel}
          disabled={saving || !isCustom}
          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset to default
        </button>
        <div className="flex items-center gap-3">
          <TestSendButton channel={channel} recipients={recipients} onSend={testSend} />
          <button
            onClick={channel === 'sms' ? saveSms : saveEmail}
            disabled={saving || (channel === 'sms' ? !smsDirty : !emailDirty)}
            className="px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? 'Saving…' : channel === 'sms' ? 'Save SMS' : 'Save email'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Follow-up step editor (inline wording edit; cadence stays on Timelines page)
// ---------------------------------------------------------------------------

function FollowUpEditor({
  orgId,
  token,
  timeline,
  step,
  recipients,
  onSaved,
  onNotify
}: {
  orgId: string
  token: string | undefined
  timeline: FollowUpTimeline
  step: FollowUpStep
  recipients?: TestRecipients
  onSaved: () => void
  onNotify: (kind: 'success' | 'error', msg: string) => void
}) {
  const channels = actionChannels(step.action)
  const [channel, setChannel] = useState<Channel>(channels[0] || 'sms')

  const [smsBody, setSmsBody] = useState(step.smsBody || '')
  const [emailSubject, setEmailSubject] = useState(step.emailSubject || '')
  const [emailBody, setEmailBody] = useState(step.emailBody || '')
  const [baseline] = useState({
    smsBody: step.smsBody || '',
    emailSubject: step.emailSubject || '',
    emailBody: step.emailBody || ''
  })

  const [smsPreview, setSmsPreview] = useState<SmsPreviewResponse | null>(null)
  const [emailPreview, setEmailPreview] = useState<EmailPreviewResponse | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty =
    smsBody !== baseline.smsBody || emailSubject !== baseline.emailSubject || emailBody !== baseline.emailBody

  // Live preview via the follow-up preview endpoint (renders deferred-work sample).
  useEffect(() => {
    if (!orgId) return
    const t = setTimeout(async () => {
      try {
        const r = await api<{ sms?: string; subject?: string; html?: string; text?: string }>(
          `/api/v1/organizations/${orgId}/follow-up-timelines/${timeline.id}/preview`,
          {
            method: 'POST',
            body: { channel, sms_body: smsBody, email_subject: emailSubject, email_body: emailBody },
            token
          }
        )
        if (channel === 'sms') {
          const text = r.sms || ''
          setSmsPreview({
            preview: text,
            characterCount: text.length,
            segmentCount: Math.ceil(text.length / 160) || 1,
            warning: text.length > 160 ? 'Message exceeds 160 characters and will be split into multiple SMS' : null
          })
        } else {
          setEmailPreview({ subject: r.subject || '', html: r.html || '', text: r.text || '' })
        }
      } catch {
        /* best-effort */
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, smsBody, emailSubject, emailBody])

  const save = async () => {
    setSaving(true)
    try {
      // Rebuild the whole step list (the API replaces it), swapping in our edits.
      const steps = timeline.steps.map(s => ({
        action: s.action,
        offset_days: s.offsetDays,
        sms_body: s.id === step.id ? smsBody : s.smsBody,
        email_subject: s.id === step.id ? emailSubject : s.emailSubject,
        email_body: s.id === step.id ? emailBody : s.emailBody,
        default_outcome_id: s.defaultOutcomeId
      }))
      await api(`/api/v1/organizations/${orgId}/follow-up-timelines/${timeline.id}/steps`, {
        method: 'PUT',
        body: { steps },
        token
      })
      onNotify('success', 'Follow-up message saved')
      onSaved()
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const testSend = async () => {
    const to = channel === 'sms' ? recipients?.phone : recipients?.email
    if (!to) return { success: false, message: 'No recipient on your profile' }
    const r = await api<{ success: boolean; message?: string; error?: string }>(
      `/api/v1/organizations/${orgId}/follow-up-timelines/${timeline.id}/test-send`,
      {
        method: 'POST',
        body: { channel, to, sms_body: smsBody, email_subject: emailSubject, email_body: emailBody },
        token,
        retry: false
      }
    )
    return {
      success: !!r.success,
      message: r.success ? `Test ${channel === 'sms' ? 'SMS' : 'email'} sent to ${to}` : r.error || 'Send failed'
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">
              {timeline.name} · Step {step.stepOrder}
            </h2>
            {timeline.isDefault && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Default</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Deferred-work recovery reminder · sent {timingLabel(step.offsetDays, timeline.anchor)}.
          </p>
        </div>
        <Link
          to="/settings/follow-up-timelines"
          className="shrink-0 text-sm text-primary hover:underline whitespace-nowrap"
        >
          Edit cadence & timing →
        </Link>
      </div>

      <div className="my-4 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700">
        Edit the wording here. To change <strong>when</strong> this sends, add steps, or reorder the cadence, use the{' '}
        <Link to="/settings/follow-up-timelines" className="font-medium underline">
          Follow-Up Timelines
        </Link>{' '}
        editor.
      </div>

      {/* Channel toggle (only the channels this step actually sends) */}
      {channels.length > 1 && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 mb-4">
          {channels.map(ch => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                channel === ch ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {ch === 'sms' ? 'SMS' : 'Email'}
            </button>
          ))}
        </div>
      )}

      {/* Editor + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {channel === 'sms' ? (
            <TokenField
              label="SMS message"
              value={smsBody}
              onChange={setSmsBody}
              tokens={FU_SMS_TOKENS}
              multiline
              rows={5}
              mono
              placeholder="Hi {{customerFirstName}}, a reminder from {{dealershipName}}…"
            />
          ) : (
            <>
              <TokenField
                label="Subject"
                value={emailSubject}
                onChange={setEmailSubject}
                tokens={FU_SMS_TOKENS}
                placeholder="Work due soon on your {{vehicleReg}}"
              />
              <TokenField
                label="Body"
                value={emailBody}
                onChange={setEmailBody}
                tokens={FU_TOKENS}
                multiline
                rows={9}
                hint="Use {{deferredItemsTable}} to insert the list of deferred work."
                placeholder="Hi {{customerFirstName}},…"
              />
            </>
          )}
        </div>
        <div>{channel === 'sms' ? <SmsPreviewPane preview={smsPreview} /> : <EmailPreviewPane preview={emailPreview} />}</div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
        <TestSendButton channel={channel} recipients={recipients} onSend={testSend} />
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-1.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save message'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarItem {
  key: string
  selection: Selection
  label: string
  subtitle: string
  channels: Channel[]
  custom?: boolean
}

interface SidebarGroup {
  title: string
  items: SidebarItem[]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MessageTemplates() {
  const { session, user } = useAuth()
  const { isEnabled } = useModules()
  const organizationId = user?.organization?.id
  const token = session?.accessToken
  const followUpEnabled = isEnabled('follow_up')

  const [data, setData] = useState<TemplatesResponse | null>(null)
  const [timelines, setTimelines] = useState<FollowUpTimeline[]>([])
  const [loading, setLoading] = useState(true)
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [savingReminders, setSavingReminders] = useState(false)
  const [selected, setSelected] = useState<Selection>({ kind: 'core', type: 'health_check_ready' })
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const notify = (kind: 'success' | 'error', msg: string) => {
    setBanner({ kind, msg })
    setTimeout(() => setBanner(null), 4000)
  }

  const fetchTemplates = async () => {
    if (!organizationId) return
    const d = await api<TemplatesResponse>(`/api/v1/organizations/${organizationId}/message-templates`, { token })
    setData(d)
  }

  const fetchTimelines = async () => {
    if (!organizationId || !followUpEnabled) return
    try {
      const d = await api<{ timelines: FollowUpTimeline[] }>(
        `/api/v1/organizations/${organizationId}/follow-up-timelines`,
        { token }
      )
      setTimelines(d.timelines || [])
    } catch {
      setTimelines([])
    }
  }

  useEffect(() => {
    if (!organizationId) return
    ;(async () => {
      setLoading(true)
      try {
        await Promise.all([fetchTemplates(), fetchTimelines()])
        try {
          const ns = await api<NotificationSettings>(
            `/api/v1/organizations/${organizationId}/notification-settings`,
            { token }
          )
          setRemindersEnabled(ns.defaultReminderEnabled)
        } catch {
          /* default to enabled */
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Failed to load templates')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, followUpEnabled])

  const toggleReminders = async () => {
    if (!organizationId) return
    const next = !remindersEnabled
    setSavingReminders(true)
    try {
      await api(`/api/v1/organizations/${organizationId}/notification-settings`, {
        method: 'PATCH',
        body: { default_reminder_enabled: next },
        token
      })
      setRemindersEnabled(next)
      notify('success', next ? 'Automatic reminders enabled' : 'Automatic reminders disabled')
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Failed to update reminders')
    } finally {
      setSavingReminders(false)
    }
  }

  const coreTokens: Token[] = useMemo(
    () =>
      (data?.placeholders || []).map(p => ({ key: p.key, label: p.label, description: p.description })),
    [data]
  )

  // Build the sidebar groups
  const groups: SidebarGroup[] = useMemo(() => {
    const out: SidebarGroup[] = []
    const byCategory = new Map<string, SidebarItem[]>()
    for (const m of CORE_META) {
      const pair = data?.templates[m.type]
      const item: SidebarItem = {
        key: `core:${m.type}`,
        selection: { kind: 'core', type: m.type },
        label: m.label,
        subtitle: m.category,
        channels: ['sms', 'email'],
        custom: !!(pair?.sms.isCustom || pair?.email.isCustom)
      }
      const arr = byCategory.get(m.category) || []
      arr.push(item)
      byCategory.set(m.category, arr)
    }
    for (const [title, items] of byCategory) out.push({ title, items })

    if (followUpEnabled) {
      for (const tl of timelines) {
        const items: SidebarItem[] = tl.steps
          .filter(s => actionChannels(s.action).length > 0)
          .map(s => ({
            key: `fu:${tl.id}:${s.stepOrder}`,
            selection: { kind: 'fu', timelineId: tl.id, stepOrder: s.stepOrder },
            label: `Step ${s.stepOrder}`,
            subtitle: timingLabel(s.offsetDays, tl.anchor),
            channels: actionChannels(s.action)
          }))
        if (items.length > 0) out.push({ title: `Follow-up · ${tl.name}`, items })
      }
    }
    return out
  }, [data, timelines, followUpEnabled])

  // Resolve the current selection to concrete data for the editor
  const selectedCore =
    selected.kind === 'core' ? CORE_META.find(m => m.type === selected.type) : undefined
  const selectedTimeline =
    selected.kind === 'fu' ? timelines.find(t => t.id === selected.timelineId) : undefined
  const selectedStep =
    selected.kind === 'fu' && selectedTimeline
      ? selectedTimeline.steps.find(s => s.stepOrder === selected.stepOrder)
      : undefined

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded-lg w-1/3" />
          <div className="h-4 bg-gray-200 rounded-lg w-2/3" />
          <div className="h-64 bg-gray-200 rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl">
      <SettingsBackLink />
      <h1 className="text-2xl font-bold mb-1">Customer Messages</h1>
      <p className="text-gray-600 mb-6">
        Every automated SMS and email your customers receive — health checks, reminders, confirmations and
        deferred-work follow-ups — in one place. Edit the wording, preview with sample data, and send yourself a test.
      </p>

      {banner && (
        <div
          className={`mb-4 p-3 rounded-lg border text-sm ${
            banner.kind === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {banner.msg}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <aside className="lg:w-72 shrink-0">
          <nav className="space-y-5">
            {groups.map(group => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map(item => {
                    const isSel =
                      (selected.kind === 'core' &&
                        item.selection.kind === 'core' &&
                        selected.type === item.selection.type) ||
                      (selected.kind === 'fu' &&
                        item.selection.kind === 'fu' &&
                        selected.timelineId === item.selection.timelineId &&
                        selected.stepOrder === item.selection.stepOrder)
                    return (
                      <button
                        key={item.key}
                        onClick={() => setSelected(item.selection)}
                        className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                          isSel
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm font-medium ${isSel ? 'text-primary' : 'text-gray-800'}`}>
                            {item.label}
                          </span>
                          {item.custom && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="Customised" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {item.channels.map(ch => (
                            <ChannelBadge key={ch} channel={ch} />
                          ))}
                          <span className="text-[11px] text-gray-400 truncate">{item.subtitle}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Editor */}
        <main className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          {selected.kind === 'core' && selectedCore && data ? (
            <CoreEditor
              key={selectedCore.type}
              orgId={organizationId!}
              token={token}
              meta={selectedCore}
              data={data.templates[selectedCore.type]}
              tokens={coreTokens}
              recipients={data.testRecipients}
              remindersEnabled={remindersEnabled}
              onToggleReminders={toggleReminders}
              savingReminders={savingReminders}
              onSaved={fetchTemplates}
              onNotify={notify}
            />
          ) : selected.kind === 'fu' && selectedTimeline && selectedStep ? (
            <FollowUpEditor
              key={`${selectedTimeline.id}:${selectedStep.stepOrder}`}
              orgId={organizationId!}
              token={token}
              timeline={selectedTimeline}
              step={selectedStep}
              recipients={data?.testRecipients}
              onSaved={fetchTimelines}
              onNotify={notify}
            />
          ) : (
            <div className="text-gray-500 text-sm">Select a message to edit.</div>
          )}
        </main>
      </div>
    </div>
  )
}
