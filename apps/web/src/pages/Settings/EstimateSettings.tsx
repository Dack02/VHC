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
  onlineBookingEnabled: boolean
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
  const [showBookingInfo, setShowBookingInfo] = useState(false)
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

        {/* Online booking */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-center justify-between">
          <div className="pr-4">
            <div className="text-sm font-medium text-gray-900">Let customers book a slot online</div>
            <p className="text-sm text-gray-500 mt-0.5">After approving, the customer picks a slot. Availability respects your workshop loading and category limits (Capacity &amp; Resource Manager).</p>
            <button type="button" onClick={() => setShowBookingInfo(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              How online bookings work
            </button>
          </div>
          <Toggle on={settings.onlineBookingEnabled} onClick={() => patchSettings({ onlineBookingEnabled: !settings.onlineBookingEnabled })} />
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

      {showBookingInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBookingInfo(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">How online bookings work</h2>
                <p className="text-xs text-gray-500 mt-0.5">When a customer accepts an estimate online</p>
              </div>
              <button onClick={() => setShowBookingInfo(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <ol className="p-5 space-y-3.5">
              {[
                ['Customer approves online', 'They review the estimate, approve the work, and (if you require it) sign.'],
                ['They pick a slot', 'Only days within your workshop loading target are offered — busy or full days are hidden, and your online lead-time, drop-off window and category limits all apply. Set these in Settings → Resource Manager.'],
                ['It becomes a real booking', 'Picking a slot auto-creates a jobsheet from the approved work (pre-authorised) on that day, so it counts towards workshop capacity like any booking. Stacked online bookings can never push a day past your target.'],
                ['Courtesy car, if free', 'A courtesy car is offered only when one is still available on the chosen day.'],
                ['You see it flagged', 'The new jobsheet carries an "Online estimate" badge in your Jobsheets list and Booking Diary — handy for confirming the exact time on MOT or timed-slot work.'],
              ].map(([title, body], i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-900">{title}</div>
                    <p className="text-sm text-gray-500 mt-0.5">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="p-5 pt-0">
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-800">
                Needs the Jobsheets module enabled. If it's off, the chosen slot is recorded on the estimate for you to convert manually.
              </div>
              <button onClick={() => setShowBookingInfo(false)} className="mt-4 w-full h-10 rounded-lg bg-[#16191f] text-white text-sm font-medium hover:bg-black">Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
