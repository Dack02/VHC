import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

// Mirrors services/resource-config.ts (camelCase). P0 wires `targetLoadingPct`
// into the Booking Diary's RAG banding; the lead-time + drop-off fields are saved
// now (so sites can pre-configure) but only act as later phases ship.
interface ResourceConfig {
  targetLoadingPct: number
  overbookFactor: number
  bookingLeadTimeDays: number
  onlineLeadTimeHours: number
  bookingMaxDays: number
  releaseWindowDays: number
  dropoffWindowStart: string
  dropoffWindowEnd: string
  dropoffSlotIntervalMinutes: number
  dropoffSlotCapacity: number | null
  enableSkillRouting: boolean
  enableCategoryQuotas: boolean
}

interface ConfigResponse {
  siteId: string
  config: ResourceConfig
}

const FieldLabel = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <label className="block text-sm font-medium text-gray-700 mb-1">
    {children}
    {hint && <span className="block text-xs font-normal text-gray-500 mt-0.5">{hint}</span>}
  </label>
)

const Card = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {subtitle && <p className="text-sm text-gray-500 mt-0.5 mb-4">{subtitle}</p>}
    {!subtitle && <div className="mb-4" />}
    {children}
  </div>
)

export default function ResourceManager() {
  const { session, user } = useAuth()
  const toast = useToast()

  const [siteId, setSiteId] = useState<string | null>(null)
  const [config, setConfig] = useState<ResourceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const token = session?.accessToken

  const fetchConfig = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<ConfigResponse>(`/api/v1/resource-manager/config?${params}`, { token })
      setSiteId(data.siteId)
      setConfig(data.config)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load capacity settings')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const set = <K extends keyof ResourceConfig>(key: K, value: ResourceConfig[K]) =>
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev))

  const handleSave = async () => {
    if (!token || !siteId || !config) return
    if (config.dropoffWindowEnd <= config.dropoffWindowStart) {
      toast.error('Drop-off window end must be after start')
      return
    }
    setSaving(true)
    try {
      await api(`/api/v1/resource-manager/config?siteId=${siteId}`, {
        method: 'PUT',
        token,
        body: config
      })
      toast.success('Capacity settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!config) {
    return (
      <div className="max-w-3xl mx-auto">
        <SettingsBackLink />
        <div className="bg-rag-red/10 border border-rag-red/30 text-rag-red rounded-xl px-4 py-3 text-sm">
          No site selected — capacity settings are configured per site.
        </div>
      </div>
    )
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const targetPct = Math.round(config.targetLoadingPct * 100)

  return (
    <div className="max-w-3xl mx-auto pb-12">
      <SettingsBackLink />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Capacity &amp; Resource Manager</h1>
        <p className="text-gray-600 mt-1">
          How {user?.site?.name || 'this site'} loads its workshop. The loading target drives the
          Booking Diary's green/amber/red day bars.
        </p>
      </div>

      <div className="space-y-6">
        <Card title="Workshop loading" subtitle="The line you book to — not 100%. The diary turns amber at this target and red over 100% of available hours.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <FieldLabel hint="Book to this % of available technician hours.">Target loading</FieldLabel>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={50} max={100} step={1} value={targetPct}
                  onChange={e => set('targetLoadingPct', Number(e.target.value) / 100)}
                  className="flex-1"
                />
                <span className="text-sm font-medium w-12 text-right">{targetPct}%</span>
              </div>
            </div>
            <div>
              <FieldLabel hint="1.0 = no overbooking. Higher allows booking past available hours.">Overbook factor</FieldLabel>
              <input
                type="number" step={0.05} min={1} max={2} value={config.overbookFactor}
                onChange={e => set('overbookFactor', Number(e.target.value) || 1)}
                className={inputCls}
              />
            </div>
          </div>
        </Card>

        <Card title="Lead time" subtitle="Saved now; used by the booking recommender and online booking as those phases ship.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <FieldLabel hint="Minimum notice for advisor-taken bookings.">Advisor lead time (days)</FieldLabel>
              <input type="number" min={0} max={365} value={config.bookingLeadTimeDays}
                onChange={e => set('bookingLeadTimeDays', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className={inputCls} />
            </div>
            <div>
              <FieldLabel hint="Minimum notice for self-serve online bookings.">Online lead time (hours)</FieldLabel>
              <input type="number" min={0} max={720} value={config.onlineLeadTimeHours}
                onChange={e => set('onlineLeadTimeHours', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className={inputCls} />
            </div>
            <div>
              <FieldLabel hint="How far ahead bookings can be taken.">Booking horizon (days)</FieldLabel>
              <input type="number" min={1} max={365} value={config.bookingMaxDays}
                onChange={e => set('bookingMaxDays', Math.max(1, Math.round(Number(e.target.value) || 1)))}
                className={inputCls} />
            </div>
            <div>
              <FieldLabel hint="Days over which category protection decays.">Release window (days)</FieldLabel>
              <input type="number" min={0} max={60} value={config.releaseWindowDays}
                onChange={e => set('releaseWindowDays', Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className={inputCls} />
            </div>
          </div>
        </Card>

        <Card title="Drop-off window" subtitle="The morning band customers pick a drop-off time from for drop-off bookings (saved now; used when online booking ships).">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <FieldLabel>Window start</FieldLabel>
              <input type="time" value={config.dropoffWindowStart}
                onChange={e => set('dropoffWindowStart', e.target.value)} className={inputCls} />
            </div>
            <div>
              <FieldLabel>Window end</FieldLabel>
              <input type="time" value={config.dropoffWindowEnd}
                onChange={e => set('dropoffWindowEnd', e.target.value)} className={inputCls} />
            </div>
            <div>
              <FieldLabel hint="Spacing between offered drop-off times.">Interval (minutes)</FieldLabel>
              <input type="number" min={5} max={120} step={5} value={config.dropoffSlotIntervalMinutes}
                onChange={e => set('dropoffSlotIntervalMinutes', Math.max(5, Math.round(Number(e.target.value) || 15)))}
                className={inputCls} />
            </div>
            <div>
              <FieldLabel hint="Max cars per drop-off time. Blank = no limit.">Cars per slot</FieldLabel>
              <input type="number" min={1} max={100} value={config.dropoffSlotCapacity ?? ''}
                onChange={e => set('dropoffSlotCapacity', e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))))}
                className={inputCls} placeholder="No limit" />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-primary text-white font-semibold rounded-lg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
