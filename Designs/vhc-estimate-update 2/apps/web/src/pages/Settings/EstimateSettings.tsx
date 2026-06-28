import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'
import { matchUspIcon, UspIcon } from '../../lib/uspIcons'

interface SettingsData {
  linkExpiryDays: number
  autoExpire: boolean
  requireSignature: boolean
  termsText: string | null
  // Tenant selling points shown on every customer estimate (max 6). Free text — the icon
  // is auto-matched from the wording (see lib/uspIcons).
  usps: string[]
  // Online booking — let the customer book a slot after approving (slots from Booking Diary capacity).
  onlineBookingEnabled: boolean
  bookingLeadDays: number
  bookingWindowDays: number
  bookingSlotMinutes: number
  bookingDayStart: string
  bookingDayEnd: string
  bookingCourtesyCar: boolean
}

const MAX_USPS = 6
const USP_MAXLEN = 80

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-primary' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function EstimateSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const orgId = user?.organization?.id

  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expiryInput, setExpiryInput] = useState('7')
  const [termsInput, setTermsInput] = useState('')
  // Editable USP rows (may include a trailing empty row mid-edit; empties are dropped on save).
  const [uspDrafts, setUspDrafts] = useState<string[]>([])

  useEffect(() => {
    if (orgId && session?.accessToken) fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, session?.accessToken])

  async function fetchAll() {
    setLoading(true)
    try {
      const data = await api<{ settings: SettingsData }>(
        `/api/v1/organizations/${orgId}/estimate-settings/settings`,
        { token: session!.accessToken }
      )
      setSettings(data.settings)
      setExpiryInput(String(data.settings.linkExpiryDays))
      setTermsInput(data.settings.termsText || '')
      setUspDrafts(data.settings.usps?.length ? data.settings.usps : [])
    } catch {
      toast.error('Failed to load estimate settings')
    } finally {
      setLoading(false)
    }
  }

  async function patchSettings(patch: Partial<SettingsData>, successMsg?: string) {
    if (!settings) return
    const prev = settings
    setSettings({ ...settings, ...patch }) // optimistic
    try {
      await api(`/api/v1/organizations/${orgId}/estimate-settings/settings`, {
        method: 'PATCH',
        token: session!.accessToken,
        body: patch
      })
      if (successMsg) toast.success(successMsg)
    } catch (e) {
      setSettings(prev) // revert
      toast.error(e instanceof ApiError ? e.message : 'Failed to update setting')
    }
  }

  const saveExpiry = () => {
    const n = parseInt(expiryInput, 10)
    if (isNaN(n) || n < 1 || n > 365) {
      toast.error('Link expiry must be between 1 and 365 days')
      setExpiryInput(String(settings?.linkExpiryDays ?? 7))
      return
    }
    if (n !== settings?.linkExpiryDays) patchSettings({ linkExpiryDays: n }, 'Saved')
  }

  const saveTerms = () => {
    if ((settings?.termsText || '') !== termsInput) patchSettings({ termsText: termsInput }, 'Saved')
  }

  // ── USPs ────────────────────────────────────────────────────────────────
  const cleanUsps = (rows: string[]) => rows.map((r) => r.trim()).filter(Boolean).slice(0, MAX_USPS)

  const saveUsps = (rows: string[]) => {
    const cleaned = cleanUsps(rows)
    const current = settings?.usps || []
    const changed = cleaned.length !== current.length || cleaned.some((v, i) => v !== current[i])
    if (changed) patchSettings({ usps: cleaned }, 'Saved')
  }

  const setDraft = (i: number, val: string) =>
    setUspDrafts((d) => d.map((v, idx) => (idx === i ? val.slice(0, USP_MAXLEN) : v)))

  const addUsp = () => setUspDrafts((d) => (d.length >= MAX_USPS ? d : [...d, '']))

  const removeUsp = (i: number) =>
    setUspDrafts((d) => {
      const next = d.filter((_, idx) => idx !== i)
      saveUsps(next)
      return next
    })

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }
  if (!settings) return null

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const previewUsps = cleanUsps(uspDrafts)

  return (
    <div className="max-w-2xl mx-auto">
      <SettingsBackLink />
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Estimate Settings</h1>
      <p className="text-gray-600 mb-6">Control how estimates are sent to customers — your selling points, link expiry, validity, signature and terms.</p>

      <div className="space-y-4">
        {/* ── Selling points (USPs) ─────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-900 mb-1">Your selling points</label>
          <p className="text-sm text-gray-500 mb-4">
            Short reasons customers should choose you. They appear as a trust strip on every estimate.
            Edit the wording — the icon is matched automatically.
          </p>

          <div className="space-y-2.5">
            {uspDrafts.map((usp, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0" title="Auto-matched icon">
                  <UspIcon name={matchUspIcon(usp)} size={18} />
                </span>
                <input
                  value={usp}
                  maxLength={USP_MAXLEN}
                  onChange={(e) => setDraft(i, e.target.value)}
                  onBlur={() => saveUsps(uspDrafts)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  placeholder="e.g. We only use genuine or approved parts"
                  className={inputCls}
                />
                <button
                  onClick={() => removeUsp(i)}
                  title="Remove"
                  className="w-9 h-9 shrink-0 rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:border-red-200 hover:text-red-500 flex items-center justify-center transition-colors"
                >
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </div>
            ))}
          </div>

          {uspDrafts.length < MAX_USPS && (
            <button onClick={addUsp} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-primary">
              <span className="w-6 h-6 rounded-md border border-dashed border-gray-300 flex items-center justify-center">
                <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              </span>
              Add a selling point
            </button>
          )}

          {/* Live preview */}
          <div className="mt-5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Live preview</div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-white px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-700">
                {user?.organization?.name || 'Your garage'}
              </div>
              {previewUsps.length > 0 ? (
                <div className="bg-primary/[0.08] flex flex-wrap">
                  {previewUsps.map((u, i) => (
                    <div key={i} className="flex items-center gap-2.5 px-4 py-3.5 min-w-[150px] flex-1">
                      <span className="text-primary shrink-0"><UspIcon name={matchUspIcon(u)} size={18} /></span>
                      <span className="text-[12.5px] font-semibold text-gray-700 leading-snug">{u}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-5 text-center text-xs text-gray-400">Add a selling point above to see it here.</div>
              )}
            </div>
          </div>
        </div>

        {/* Link expiry */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-900 mb-1">Customer link expiry</label>
          <p className="text-sm text-gray-500 mb-3">How long a sent estimate's link stays live. Also sets the default "valid until" date.</p>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={365} value={expiryInput}
              onChange={e => setExpiryInput(e.target.value)} onBlur={saveExpiry}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className={`${inputCls} w-24`}
            />
            <span className="text-sm text-gray-600">days</span>
          </div>
        </div>

        {/* Auto-expire */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-sm font-medium text-gray-900">Auto-expire stale estimates</div>
            <p className="text-sm text-gray-500 mt-0.5">Automatically mark sent estimates as expired once the valid-until date passes.</p>
          </div>
          <Toggle on={settings.autoExpire} onClick={() => patchSettings({ autoExpire: !settings.autoExpire })} />
        </div>

        {/* Require signature */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-sm font-medium text-gray-900">Require signature to approve</div>
            <p className="text-sm text-gray-500 mt-0.5">The customer must sign on the estimate page before they can approve.</p>
          </div>
          <Toggle on={settings.requireSignature} onClick={() => patchSettings({ requireSignature: !settings.requireSignature })} />
        </div>

        {/* ── Online booking ────────────────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <div className="text-sm font-medium text-gray-900">Let customers book online</div>
              <p className="text-sm text-gray-500 mt-0.5">After approving, the customer picks a slot themselves. Availability comes from your Booking Diary capacity — they can never book more than you can take.</p>
            </div>
            <Toggle on={settings.onlineBookingEnabled} onClick={() => patchSettings({ onlineBookingEnabled: !settings.onlineBookingEnabled })} />
          </div>

          {settings.onlineBookingEnabled && (
            <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-gray-700 mb-1">Earliest booking</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={60} defaultValue={settings.bookingLeadDays}
                      onBlur={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n !== settings.bookingLeadDays) patchSettings({ bookingLeadDays: n }, 'Saved') }}
                      className={`${inputCls} w-20`} />
                    <span className="text-sm text-gray-500">days ahead</span>
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-700 mb-1">Show slots up to</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={1} max={90} defaultValue={settings.bookingWindowDays}
                      onBlur={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n !== settings.bookingWindowDays) patchSettings({ bookingWindowDays: n }, 'Saved') }}
                      className={`${inputCls} w-20`} />
                    <span className="text-sm text-gray-500">days out</span>
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-700 mb-1">Slot length</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min={15} max={480} step={15} defaultValue={settings.bookingSlotMinutes}
                      onBlur={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n !== settings.bookingSlotMinutes) patchSettings({ bookingSlotMinutes: n }, 'Saved') }}
                      className={`${inputCls} w-20`} />
                    <span className="text-sm text-gray-500">mins</span>
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-700 mb-1">Opening hours</span>
                  <div className="flex items-center gap-1.5">
                    <input type="time" defaultValue={settings.bookingDayStart}
                      onBlur={(e) => { if (e.target.value && e.target.value !== settings.bookingDayStart) patchSettings({ bookingDayStart: e.target.value }, 'Saved') }}
                      className={`${inputCls} w-28`} />
                    <span className="text-sm text-gray-400">–</span>
                    <input type="time" defaultValue={settings.bookingDayEnd}
                      onBlur={(e) => { if (e.target.value && e.target.value !== settings.bookingDayEnd) patchSettings({ bookingDayEnd: e.target.value }, 'Saved') }}
                      className={`${inputCls} w-28`} />
                  </div>
                </label>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="pr-4">
                  <div className="text-sm font-medium text-gray-900">Offer a courtesy car</div>
                  <p className="text-sm text-gray-500 mt-0.5">Adds a courtesy-car opt-in to the slot picker.</p>
                </div>
                <Toggle on={settings.bookingCourtesyCar} onClick={() => patchSettings({ bookingCourtesyCar: !settings.bookingCourtesyCar })} />
              </div>
              <p className="text-xs text-gray-400">Days the workshop operates and technician shifts are set in your Workshop / Booking Diary settings — those drive which days appear here.</p>
            </div>
          )}
        </div>

        {/* Terms */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <label className="block text-sm font-medium text-gray-900 mb-1">Terms &amp; conditions</label>
          <p className="text-sm text-gray-500 mb-3">Shown to the customer on the estimate page (optional).</p>
          <textarea
            value={termsInput} onChange={e => setTermsInput(e.target.value)} onBlur={saveTerms}
            rows={5} maxLength={10000} placeholder="e.g. This estimate is valid for 30 days. Parts subject to availability…"
            className={inputCls}
          />
        </div>
      </div>
    </div>
  )
}
