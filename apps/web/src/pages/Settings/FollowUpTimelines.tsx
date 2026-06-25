import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Step {
  _key: string // stable client-side key (drag id / React key / expand state)
  id?: string
  stepOrder: number
  action: string
  offsetDays: number
  smsBody: string | null
  emailSubject: string | null
  emailBody: string | null
  defaultOutcomeId: string | null
}
interface Timeline {
  id: string
  name: string
  description: string | null
  anchor: string
  isDefault: boolean
  isActive: boolean
  steps: Step[]
}
interface Outcome { id: string; name: string }

// ---------------------------------------------------------------------------
// Action + placeholder metadata
// ---------------------------------------------------------------------------

type IconName =
  | 'flag' | 'sms' | 'email' | 'phone' | 'shield' | 'plus' | 'minus' | 'trash'
  | 'chevron-down' | 'chevron-up' | 'copy' | 'eye' | 'send' | 'check' | 'close' | 'info'

const ACTIONS: Array<{ value: string; label: string; short: string; icon: IconName }> = [
  { value: 'send_both', label: 'Send SMS + email', short: 'SMS + email', icon: 'sms' },
  { value: 'send_sms', label: 'Send SMS', short: 'SMS reminder', icon: 'sms' },
  { value: 'send_email', label: 'Send email', short: 'Email reminder', icon: 'email' },
  { value: 'manual_call', label: 'Manual call (park for human)', short: 'Call list', icon: 'phone' },
  { value: 'auto_close', label: 'Auto-close', short: 'Final notice', icon: 'shield' },
]
const actionMeta = (a: string) => ACTIONS.find((x) => x.value === a) || ACTIONS[1]

// Tokens the renderer understands. `deferredItemsTable` is the multi-line work
// list and only makes sense in an email body, so it's excluded from SMS chips.
const ALL_TOKENS = [
  { token: 'customerFirstName', label: 'first name' },
  { token: 'vehicleReg', label: 'reg' },
  { token: 'vehicleMakeModel', label: 'make & model' },
  { token: 'deferredTotal', label: 'total £' },
  { token: 'dueDate', label: 'due date' },
  { token: 'followUpUrl', label: 'booking link' },
  { token: 'dealershipName', label: 'dealership' },
  { token: 'dealershipPhone', label: 'phone' },
  { token: 'deferredItemsTable', label: 'work list' },
]
const SMS_TOKENS = ALL_TOKENS.filter((t) => t.token !== 'deferredItemsTable')

// ---------------------------------------------------------------------------
// Icons (hand-rolled, matching the Follow-Up detail modal aesthetic)
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<IconName, string> = {
  flag: 'M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5',
  sms: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  email: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75',
  phone: 'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
  shield: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  minus: 'M5 12h14',
  trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  'chevron-down': 'M19.5 8.25l-7.5 7.5-7.5-7.5',
  'chevron-up': 'M4.5 15.75l7.5-7.5 7.5 7.5',
  copy: 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75',
  eye: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  send: 'M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5',
  check: 'M4.5 12.75l6 6 9-13.5',
  close: 'M6 18L18 6M6 6l12 12',
  info: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[name]} />
    </svg>
  )
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-12a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Sample-data preview helpers (mirror the engine's renderFollowUpSample)
// ---------------------------------------------------------------------------

const SAMPLE_DUE = new Date(Date.now() + 21 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function sampleVars(orgName?: string): Record<string, string> {
  return {
    customerFirstName: 'Alex',
    vehicleReg: 'AB12 CDE',
    vehicleMakeModel: 'Ford Focus',
    deferredTotal: '£480.00',
    dueDate: SAMPLE_DUE,
    followUpUrl: `${window.location.origin}/view/sample`,
    dealershipName: orgName || 'Your dealership',
    dealershipPhone: '',
    deferredItemsTable: '• Front brake pads & discs — £320.00\n• Air filter — £45.00\n• Wiper blades (pair) — £115.00',
    itemCount: '3',
  }
}
const renderTpl = (tpl: string | null, vars: Record<string, string>) =>
  (tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')

function smsInfo(text: string): { len: number; seg: number } {
  const len = text.length
  const seg = len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153)
  return { len, seg }
}

// Anchor-aware offset wording, e.g. "14 days before due" / "on the due date".
function offsetWord(offset: number, anchor: string): string {
  const noun = anchor === 'deferral_date' ? 'deferral' : 'due date'
  if (offset === 0) return `on the ${noun}`
  if (offset < 0) return `${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} before ${noun}`
  return `${offset} day${offset === 1 ? '' : 's'} after ${noun}`
}
function offsetChip(offset: number): string {
  if (offset === 0) return 'due day'
  return offset < 0 ? `${Math.abs(offset)}d before` : `${offset}d after`
}

let _keyCounter = 0
const keyTimeline = (t: Timeline): Timeline => ({
  ...t,
  steps: (t.steps || []).map((s) => ({ ...s, _key: s.id || `new-${++_keyCounter}` })),
})

// ===========================================================================
// Visual cadence track — to-scale, anchored on the due/deferral date
// ===========================================================================

function CadenceTrack({ steps, anchor }: { steps: Step[]; anchor: string }) {
  const anchorShort = anchor === 'deferral_date' ? 'DEFERRED' : 'DUE'

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-gray-400 py-6">
        <Icon name="info" className="w-4 h-4" />
        Add a step below to see the timeline take shape.
      </div>
    )
  }

  const offsets = steps.map((s) => s.offsetDays)
  const lo = Math.min(0, ...offsets)
  const hi = Math.max(0, ...offsets)
  const span = hi - lo || 1
  const PAD = 9
  const MIN_GAP = 15 // % — keep adjacent node labels from colliding
  const rawPos = (o: number) => PAD + ((o - lo) / span) * (100 - 2 * PAD)

  // Place nodes left→right in time order, nudging apart any that would overlap.
  const sorted = [...steps].sort((a, b) => a.offsetDays - b.offsetDays)
  const placed: number[] = []
  sorted.forEach((s, i) => {
    let p = rawPos(s.offsetDays)
    if (i > 0 && p < placed[i - 1] + MIN_GAP) p = placed[i - 1] + MIN_GAP
    placed.push(Math.min(p, 100 - PAD))
  })
  const posByKey = new Map(sorted.map((s, i) => [s._key, placed[i]]))
  const zero = sorted.find((s) => s.offsetDays === 0)
  const anchorPos = zero ? posByKey.get(zero._key)! : rawPos(0)

  return (
    <div className="relative h-[126px] mx-1">
      {/* baseline */}
      <div className="absolute left-0 right-0 top-[38px] h-0.5 bg-gray-200 rounded-full" />
      {/* anchor marker */}
      <div className="absolute top-1 bottom-5 border-l-2 border-dashed border-primary/60" style={{ left: `${anchorPos}%` }} />
      <div
        className="absolute -top-0.5 -translate-x-1/2 text-[10px] font-bold tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5"
        style={{ left: `${anchorPos}%` }}
      >
        {anchorShort}
      </div>

      {sorted.map((s) => {
        const meta = actionMeta(s.action)
        const left = posByKey.get(s._key)!
        const sends = s.action === 'send_sms' || s.action === 'send_email' || s.action === 'send_both'
        return (
          <div
            key={s._key}
            className="absolute top-5 -translate-x-1/2 flex flex-col items-center w-[88px]"
            style={{ left: `${left}%` }}
          >
            <div
              className={
                'w-9 h-9 rounded-full flex items-center justify-center ' +
                (sends ? 'bg-primary text-white' : 'bg-white border-2 border-primary text-primary')
              }
            >
              <Icon name={meta.icon} className="w-5 h-5" />
            </div>
            <div className="mt-2 text-xs font-medium text-gray-900 text-center leading-tight">{meta.short}</div>
            <div className="text-[11px] text-gray-500">{offsetChip(s.offsetDays)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ===========================================================================
// Token field — textarea/input with click-to-insert placeholder chips
// ===========================================================================

function TokenField({
  value, onChange, placeholder, rows = 3, tokens, singleLine = false, footer,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  rows?: number
  tokens: Array<{ token: string; label: string }>
  singleLine?: boolean
  footer?: ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const insert = (token: string) => {
    const el = ref.current
    const str = `{{${token}}}`
    const s = el?.selectionStart ?? value.length
    const e = el?.selectionEnd ?? s
    const next = value.slice(0, s) + str + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const p = s + str.length
      el.setSelectionRange(p, p)
    })
  }
  const cls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  return (
    <div>
      {singleLine ? (
        <input ref={ref as React.RefObject<HTMLInputElement>} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      ) : (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={cls} />
      )}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="text-[11px] text-gray-400 mr-0.5">Insert</span>
        {tokens.map((t) => (
          <button
            key={t.token}
            type="button"
            onClick={() => insert(t.token)}
            className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 hover:bg-primary/10 hover:text-primary font-mono transition-colors"
          >
            {t.label}
          </button>
        ))}
      </div>
      {footer}
    </div>
  )
}

// ===========================================================================
// Sortable step row
// ===========================================================================

interface StepCallbacks {
  onChange: (patch: Partial<Step>) => void
  onRemove: () => void
  onToggle: () => void
  onPreviewEmail: () => void
  onTestSms: () => void
  onTestEmail: () => void
}

function SortableStep({
  step, index, anchor, expanded, outcomes, orgName, cb,
}: {
  step: Step
  index: number
  anchor: string
  expanded: boolean
  outcomes: Outcome[]
  orgName?: string
  cb: StepCallbacks
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step._key })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const meta = actionMeta(step.action)
  const isSms = step.action === 'send_sms' || step.action === 'send_both'
  const isEmail = step.action === 'send_email' || step.action === 'send_both'
  const sv = sampleVars(orgName)

  const smsRendered = renderTpl(step.smsBody, sv)
  const { len, seg } = smsInfo(smsRendered)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border rounded-xl ${isDragging ? 'border-primary shadow-lg opacity-90' : 'border-gray-200'}`}
    >
      {/* Top row */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none"
          aria-label="Drag to reorder"
        >
          <GripIcon className="w-5 h-5" />
        </button>
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${expanded ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'}`}>
          {index + 1}
        </span>

        {expanded ? (
          <>
            <div className="relative inline-flex items-center">
              <span className="absolute left-2.5 text-primary pointer-events-none"><Icon name={meta.icon} className="w-4 h-4" /></span>
              <select
                value={step.action}
                onChange={(e) => cb.onChange({ action: e.target.value })}
                className="border border-gray-300 rounded-lg pl-8 pr-7 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
              >
                {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              <span className="absolute right-2 text-gray-400 pointer-events-none"><Icon name="chevron-down" className="w-4 h-4" /></span>
            </div>

            {/* offset stepper */}
            <div className="flex items-center gap-1">
              <button onClick={() => cb.onChange({ offsetDays: step.offsetDays - 1 })} className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50" aria-label="Earlier">
                <Icon name="minus" className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                value={step.offsetDays}
                onChange={(e) => cb.onChange({ offsetDays: Number(e.target.value) || 0 })}
                className="w-14 text-center border border-gray-300 rounded-lg px-1 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button onClick={() => cb.onChange({ offsetDays: step.offsetDays + 1 })} className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50" aria-label="Later">
                <Icon name="plus" className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-gray-400 ml-1 hidden sm:inline">{offsetWord(step.offsetDays, anchor)}</span>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button onClick={cb.onToggle} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Collapse"><Icon name="chevron-up" className="w-4 h-4" /></button>
              <button onClick={cb.onRemove} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove step"><Icon name="trash" className="w-4 h-4" /></button>
            </div>
          </>
        ) : (
          <>
            <span className="text-primary"><Icon name={meta.icon} className="w-4 h-4" /></span>
            <span className="text-sm font-medium text-gray-900">{meta.short}</span>
            {(isSms || isEmail) && !((isSms && (step.smsBody || '').trim()) || (isEmail && (step.emailBody || '').trim())) && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">no message</span>
            )}
            <span className="ml-auto text-xs text-gray-500">{offsetWord(step.offsetDays, anchor)}</span>
            <button onClick={cb.onToggle} className="p-1.5 text-gray-400 hover:text-gray-700" aria-label="Expand"><Icon name="chevron-down" className="w-4 h-4" /></button>
            <button onClick={cb.onRemove} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove step"><Icon name="trash" className="w-4 h-4" /></button>
          </>
        )}
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 pl-12 space-y-4">
          {isSms && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">SMS message</label>
                <button onClick={cb.onTestSms} className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-dark font-medium">
                  <Icon name="send" className="w-3.5 h-3.5" /> Send test SMS
                </button>
              </div>
              <TokenField
                value={step.smsBody || ''}
                onChange={(v) => cb.onChange({ smsBody: v })}
                placeholder="Hi {{customerFirstName}}, a reminder from {{dealershipName}}…"
                rows={3}
                tokens={SMS_TOKENS}
                footer={
                  <div className="flex items-start justify-between gap-3 mt-1.5">
                    <span className="text-[11px] text-gray-400 line-clamp-2 min-w-0">
                      <Icon name="eye" className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      Preview: <span className="text-gray-500">{smsRendered || '—'}</span>
                    </span>
                    <span className={`text-[11px] whitespace-nowrap ${len > 160 ? 'text-amber-600' : 'text-gray-400'}`}>{len} / 160 · {seg} SMS</span>
                  </div>
                }
              />
            </div>
          )}

          {isEmail && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">Email</label>
                <div className="flex items-center gap-3">
                  <button onClick={cb.onPreviewEmail} className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-dark font-medium">
                    <Icon name="eye" className="w-3.5 h-3.5" /> Preview email
                  </button>
                  <button onClick={cb.onTestEmail} className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-dark font-medium">
                    <Icon name="send" className="w-3.5 h-3.5" /> Send test
                  </button>
                </div>
              </div>
              <TokenField
                value={step.emailSubject || ''}
                onChange={(v) => cb.onChange({ emailSubject: v })}
                placeholder="Email subject…"
                singleLine
                tokens={SMS_TOKENS}
              />
              <div className="mt-3">
                <TokenField
                  value={step.emailBody || ''}
                  onChange={(v) => cb.onChange({ emailBody: v })}
                  placeholder="Email body… (include the work-list token to list the deferred items)"
                  rows={6}
                  tokens={ALL_TOKENS}
                />
              </div>
            </div>
          )}

          {step.action === 'manual_call' && (
            <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Icon name="info" className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
              No message is sent. The case is parked on the <strong className="font-medium text-gray-700">Call list</strong> for a human to phone the customer.
            </div>
          )}

          {step.action === 'auto_close' && (
            <div>
              <div className="flex items-start gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2">
                <Icon name="info" className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
                If the customer hasn&apos;t responded by now, the case is closed automatically with this outcome.
              </div>
              <select
                value={step.defaultOutcomeId || ''}
                onChange={(e) => cb.onChange({ defaultOutcomeId: e.target.value || null })}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Close with outcome…</option>
                {outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Modals — email preview + test send
// ===========================================================================

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><Icon name="close" className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function EmailPreviewModal({
  orgId, token, timelineId, subject, body, onClose,
}: {
  orgId: string
  token?: string
  timelineId: string
  subject: string
  body: string
  onClose: () => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [subj, setSubj] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api<{ subject?: string; html?: string }>(`/api/v1/organizations/${orgId}/follow-up-timelines/${timelineId}/preview`, {
      method: 'POST',
      token,
      body: { channel: 'email', email_subject: subject, email_body: body },
    })
      .then((r) => { if (live) { setHtml(r.html || ''); setSubj(r.subject || '') } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Failed to render preview') })
    return () => { live = false }
  }, [orgId, token, timelineId, subject, body])

  return (
    <ModalShell title="Email preview" onClose={onClose}>
      <div className="px-5 py-3 border-b border-gray-100 text-sm">
        <span className="text-gray-400">Subject:</span> <span className="font-medium text-gray-900">{subj || '—'}</span>
      </div>
      <div className="bg-gray-100 max-h-[60vh] overflow-y-auto">
        {error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : html === null ? (
          <div className="p-8 text-center text-gray-400 text-sm">Rendering…</div>
        ) : (
          <iframe title="Email preview" sandbox="" srcDoc={html} className="w-full" style={{ height: 520, border: 'none' }} />
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-200 text-xs text-gray-400">
        Rendered with your branding and sample data (Alex · AB12 CDE · £480).
      </div>
    </ModalShell>
  )
}

function TestSendModal({
  orgId, token, timelineId, channel, templates, onClose,
}: {
  orgId: string
  token?: string
  timelineId: string
  channel: 'sms' | 'email'
  templates: { sms_body?: string; email_subject?: string; email_body?: string }
  onClose: () => void
}) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (!to.trim()) return
    setSending(true)
    try {
      const res = await api<{ success: boolean; message?: string; error?: string }>(
        `/api/v1/organizations/${orgId}/follow-up-timelines/${timelineId}/test-send`,
        { method: 'POST', token, body: { channel, to: to.trim(), ...templates } }
      )
      if (res.success) { toast.success(res.message || 'Test sent'); onClose() }
      else toast.error(res.error || 'Failed to send test')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send test')
    } finally {
      setSending(false)
    }
  }

  return (
    <ModalShell title={channel === 'sms' ? 'Send test SMS' : 'Send test email'} onClose={onClose}>
      <div className="px-5 py-5 space-y-3">
        <p className="text-sm text-gray-500">
          Sends this step&apos;s message (with your branding and sample data) so you can check it end to end.
          Test sends ignore simulation mode and the send window.
        </p>
        <div className="flex gap-2">
          <input
            type={channel === 'sms' ? 'tel' : 'email'}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send() }}
            placeholder={channel === 'sms' ? '+447…' : 'you@dealership.co.uk'}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
          <button onClick={send} disabled={sending || !to.trim()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
            {sending ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ===========================================================================
// Timeline card
// ===========================================================================

function TimelineCard({
  tl, outcomes, orgId, token, orgName, dirty, onStepsChange, onSaved, onSetDefault, onAnchorChange, onRename, onDuplicate, onDelete,
}: {
  tl: Timeline
  outcomes: Outcome[]
  orgId: string
  token?: string
  orgName?: string
  dirty: boolean
  onStepsChange: (steps: Step[]) => void
  onSaved: (tl: Timeline) => void
  onSetDefault: () => void
  onAnchorChange: (anchor: string) => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(tl.name)
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string } | null>(null)
  const [testSend, setTestSend] = useState<{ channel: 'sms' | 'email'; sms_body?: string; email_subject?: string; email_body?: string } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const defaultExpanded = (s: Step) => {
    const smsMissing = (s.action === 'send_sms' || s.action === 'send_both') && !(s.smsBody || '').trim()
    const emailMissing = (s.action === 'send_email' || s.action === 'send_both') && !(s.emailBody || '').trim()
    return smsMissing || emailMissing
  }
  const isExpanded = (s: Step) => expanded[s._key] ?? defaultExpanded(s)
  const toggle = (s: Step) => setExpanded((e) => ({ ...e, [s._key]: !isExpanded(s) }))

  const mutate = (fn: (steps: Step[]) => Step[]) => onStepsChange(fn(tl.steps))
  const updateStep = (i: number, patch: Partial<Step>) => mutate((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)))
  const removeStep = (i: number) => mutate((s) => s.filter((_, idx) => idx !== i))
  const addStep = () => {
    const last = tl.steps[tl.steps.length - 1]
    const newStep: Step = {
      _key: `new-${++_keyCounter}`,
      stepOrder: tl.steps.length + 1,
      action: 'send_sms',
      offsetDays: last ? last.offsetDays : 0,
      smsBody: '', emailSubject: '', emailBody: '', defaultOutcomeId: null,
    }
    setExpanded((e) => ({ ...e, [newStep._key]: true }))
    onStepsChange([...tl.steps, newStep])
  }
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = tl.steps.findIndex((s) => s._key === active.id)
    const newIndex = tl.steps.findIndex((s) => s._key === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onStepsChange(arrayMove(tl.steps, oldIndex, newIndex))
  }

  const save = async () => {
    setSaving(true)
    try {
      const steps = tl.steps.map((s) => ({
        action: s.action,
        offset_days: s.offsetDays,
        sms_body: s.smsBody,
        email_subject: s.emailSubject,
        email_body: s.emailBody,
        default_outcome_id: s.defaultOutcomeId,
      }))
      const updated = await api<Timeline>(`/api/v1/organizations/${orgId}/follow-up-timelines/${tl.id}/steps`, { method: 'PUT', body: { steps }, token })
      onSaved(keyTimeline(updated))
      toast.success('Timeline saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save steps')
    } finally {
      setSaving(false)
    }
  }

  const commitName = () => {
    setEditingName(false)
    const next = nameDraft.trim()
    if (next && next !== tl.name) onRename(next)
    else setNameDraft(tl.name)
  }

  const summary = (() => {
    const n = tl.steps.length
    if (n === 0) return 'No steps yet'
    const offs = tl.steps.map((s) => s.offsetDays)
    const sendCount = tl.steps.filter((s) => s.action !== 'manual_call' && s.action !== 'auto_close').length
    const window = Math.max(...offs) - Math.min(...offs)
    return `${n} step${n === 1 ? '' : 's'} over ${window} day${window === 1 ? '' : 's'} · ${sendCount} automated message${sendCount === 1 ? '' : 's'}`
  })()

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {editingName ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameDraft(tl.name); setEditingName(false) } }}
              className="text-lg font-semibold text-gray-900 border-b-2 border-primary focus:outline-none"
              autoFocus
            />
          ) : (
            <button onClick={() => { setNameDraft(tl.name); setEditingName(true) }} className="text-lg font-semibold text-gray-900 hover:text-primary text-left">
              {tl.name}
            </button>
          )}
          {tl.isDefault && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Default</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={tl.anchor}
            onChange={(e) => onAnchorChange(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-primary"
            title="What the step offsets are measured from"
          >
            <option value="due_date">Anchor: due date</option>
            <option value="deferral_date">Anchor: deferral date</option>
          </select>
          <button onClick={onDuplicate} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 px-2 py-1"><Icon name="copy" className="w-4 h-4" /> Duplicate</button>
          {!tl.isDefault && <button onClick={onSetDefault} className="text-sm text-primary hover:text-primary-dark px-2 py-1">Set default</button>}
          {!tl.isDefault && <button onClick={onDelete} className="text-sm text-red-600 hover:text-red-800 px-2 py-1">Delete</button>}
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">{summary}</p>

      {/* Visual track */}
      <div className="border border-gray-200 rounded-xl px-4 pt-4 pb-2 mb-5 bg-gray-50/40">
        <CadenceTrack steps={tl.steps} anchor={tl.anchor} />
      </div>

      {/* Step list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tl.steps.map((s) => s._key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {tl.steps.map((s, i) => (
              <SortableStep
                key={s._key}
                step={s}
                index={i}
                anchor={tl.anchor}
                expanded={isExpanded(s)}
                outcomes={outcomes}
                orgName={orgName}
                cb={{
                  onChange: (patch) => updateStep(i, patch),
                  onRemove: () => removeStep(i),
                  onToggle: () => toggle(s),
                  onPreviewEmail: () => setEmailPreview({ subject: s.emailSubject || '', body: s.emailBody || '' }),
                  onTestSms: () => setTestSend({ channel: 'sms', sms_body: s.smsBody || '' }),
                  onTestEmail: () => setTestSend({ channel: 'email', email_subject: s.emailSubject || '', email_body: s.emailBody || '' }),
                }}
              />
            ))}
            {tl.steps.length === 0 && (
              <div className="text-center text-sm text-gray-400 py-6 border border-dashed border-gray-300 rounded-xl">No steps yet — add the first one below.</div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {/* Footer actions */}
      <div className="flex items-center gap-2 mt-4">
        <button onClick={addStep} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
          <Icon name="plus" className="w-4 h-4" /> Add step
        </button>
        {dirty && <span className="ml-auto text-xs text-amber-600 font-medium">● Unsaved changes</span>}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${dirty ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-gray-100 text-gray-400'} ${dirty ? '' : 'ml-auto'}`}
        >
          {saving ? 'Saving…' : 'Save timeline'}
        </button>
      </div>

      {emailPreview && (
        <EmailPreviewModal orgId={orgId} token={token} timelineId={tl.id} subject={emailPreview.subject} body={emailPreview.body} onClose={() => setEmailPreview(null)} />
      )}
      {testSend && (
        <TestSendModal
          orgId={orgId}
          token={token}
          timelineId={tl.id}
          channel={testSend.channel}
          templates={{ sms_body: testSend.sms_body, email_subject: testSend.email_subject, email_body: testSend.email_body }}
          onClose={() => setTestSend(null)}
        />
      )}
    </div>
  )
}

// ===========================================================================
// Page
// ===========================================================================

export default function FollowUpTimelines() {
  const { session, user } = useAuth()
  const toast = useToast()
  const organizationId = user?.organization?.id
  const orgName = user?.organization?.name
  const token = session?.accessToken

  const [timelines, setTimelines] = useState<Timeline[]>([])
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')

  useEffect(() => { if (organizationId) load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId])

  const load = async () => {
    if (!organizationId) return
    try {
      setLoading(true)
      const [tl, oc] = await Promise.all([
        api<{ timelines: Timeline[] }>(`/api/v1/organizations/${organizationId}/follow-up-timelines`, { token }),
        api<{ outcomes: Outcome[] }>(`/api/v1/organizations/${organizationId}/follow-up-outcomes`, { token }),
      ])
      setTimelines((tl.timelines || []).map(keyTimeline))
      setOutcomes(oc.outcomes || [])
      setDirty({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load timelines')
    } finally {
      setLoading(false)
    }
  }

  const createTimeline = async () => {
    if (!organizationId || !newName.trim()) return
    try {
      const created = await api<Timeline>(`/api/v1/organizations/${organizationId}/follow-up-timelines`, { method: 'POST', body: { name: newName.trim(), anchor: 'due_date' }, token })
      setTimelines((prev) => [...prev, keyTimeline(created)])
      setNewName('')
      toast.success('Timeline created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create timeline')
    }
  }

  const setSteps = (tlId: string, steps: Step[]) => {
    setTimelines((prev) => prev.map((t) => (t.id === tlId ? { ...t, steps } : t)))
    setDirty((d) => ({ ...d, [tlId]: true }))
  }
  const onSaved = (tl: Timeline) => {
    setTimelines((prev) => prev.map((t) => (t.id === tl.id ? tl : t)))
    setDirty((d) => ({ ...d, [tl.id]: false }))
  }

  // Scalar PATCHes update local state in place so unsaved step edits survive.
  const setDefault = async (tl: Timeline) => {
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'PATCH', body: { is_default: true }, token })
      setTimelines((prev) => prev.map((t) => ({ ...t, isDefault: t.id === tl.id })))
      toast.success(`"${tl.name}" is now the default`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default')
    }
  }
  const changeAnchor = async (tl: Timeline, anchor: string) => {
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'PATCH', body: { anchor }, token })
      setTimelines((prev) => prev.map((t) => (t.id === tl.id ? { ...t, anchor } : t)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update anchor')
    }
  }
  const rename = async (tl: Timeline, name: string) => {
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'PATCH', body: { name }, token })
      setTimelines((prev) => prev.map((t) => (t.id === tl.id ? { ...t, name } : t)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename')
    }
  }
  const duplicate = async (tl: Timeline) => {
    try {
      const created = await api<Timeline>(`/api/v1/organizations/${organizationId}/follow-up-timelines`, { method: 'POST', body: { name: `${tl.name} (copy)`, anchor: tl.anchor }, token })
      const steps = tl.steps.map((s) => ({ action: s.action, offset_days: s.offsetDays, sms_body: s.smsBody, email_subject: s.emailSubject, email_body: s.emailBody, default_outcome_id: s.defaultOutcomeId }))
      const withSteps = await api<Timeline>(`/api/v1/organizations/${organizationId}/follow-up-timelines/${created.id}/steps`, { method: 'PUT', body: { steps }, token })
      setTimelines((prev) => [...prev, keyTimeline(withSteps)])
      toast.success('Timeline duplicated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to duplicate')
    }
  }
  const remove = async (tl: Timeline) => {
    if (!confirm(`Delete timeline "${tl.name}"?`)) return
    try {
      await api(`/api/v1/organizations/${organizationId}/follow-up-timelines/${tl.id}`, { method: 'DELETE', token })
      setTimelines((prev) => prev.filter((t) => t.id !== tl.id))
      toast.success('Timeline deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  return (
    <div className="max-w-5xl mx-auto">
      <SettingsBackLink />
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Follow-Up Timelines</h1>
        <p className="text-sm text-gray-500 mt-1">Design the chase cadence — what goes out, on which channel, and how many days before or after the work&apos;s due date.</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-6">
        <Icon name="info" className="w-3.5 h-3.5" />
        Tokens like <code className="bg-gray-100 px-1 rounded font-mono">{'{{customerFirstName}}'}</code> are filled in per customer — click a chip to insert one.
      </div>

      <div className="flex gap-2 mb-6">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createTimeline() }}
          placeholder="New timeline name…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button onClick={createTimeline} disabled={!newName.trim()} className="inline-flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
          <Icon name="plus" className="w-4 h-4" /> Create timeline
        </button>
      </div>

      {timelines.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-300 rounded-xl">
          <p className="text-gray-500">No timelines yet.</p>
          <p className="text-sm text-gray-400 mt-1">Create one above to start designing your follow-up cadence.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {timelines.map((tl) => (
            <TimelineCard
              key={tl.id}
              tl={tl}
              outcomes={outcomes}
              orgId={organizationId!}
              token={token}
              orgName={orgName}
              dirty={!!dirty[tl.id]}
              onStepsChange={(steps) => setSteps(tl.id, steps)}
              onSaved={onSaved}
              onSetDefault={() => setDefault(tl)}
              onAnchorChange={(a) => changeAnchor(tl, a)}
              onRename={(name) => rename(tl, name)}
              onDuplicate={() => duplicate(tl)}
              onDelete={() => remove(tl)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
