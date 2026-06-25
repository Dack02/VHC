import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface SettingsData {
  linkExpiryDays: number
  autoExpire: boolean
  requireSignature: boolean
  termsText: string | null
}

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

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }
  if (!settings) return null

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-2xl mx-auto">
      <SettingsBackLink />
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Estimate Settings</h1>
      <p className="text-gray-600 mb-6">Control how estimates are sent to customers — link expiry, validity, signature and terms.</p>

      <div className="space-y-4">
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
