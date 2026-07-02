import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'
import { Tooltip } from '../../components/ui/Tooltip'

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
  motDailyCap: number | null
  motCapacityHours: number | null
}

interface ConfigResponse {
  siteId: string
  config: ResourceConfig
}

interface QuotaRow {
  repairTypeId: string
  code: string
  label: string
  colour: string
  isMot: boolean
  protectPrimary: boolean
  releaseWindowDays: number
  minHours: number | null
  hardCapJobs: number | null
  enforcement: 'soft' | 'hard'
  allowOverride: boolean
  staffed: { primaryHours: number; eligibleHours: number; jobCeiling: number | null }
}

interface AssetItem {
  assetType: string
  label: string
  quantity: number | null   // null = no limit (untracked)
}

// Designated MOT tester pool (MOT_TESTER_ROUTING.md). Ordered = priority; the
// per-tester daily cap is the overflow point for Phase 2 auto-assign.
interface MotTester {
  technicianId: string
  name: string
  dailyMotCap: number | null
}
interface MotTestersResponse {
  siteId: string
  technicians: { id: string; name: string }[]
  testers: { technicianId: string; name: string; priority: number; dailyMotCap: number | null }[]
}

const FieldLabel = ({ children, hint, tip }: { children: React.ReactNode; hint?: string; tip?: string }) => (
  <label className="block text-sm font-medium text-gray-700 mb-1">
    <span className="inline-flex items-center gap-1">
      {children}
      {tip && (
        <Tooltip content={tip} className="cursor-help inline-flex" tabIndex={0}>
          <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 01.99 1v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
          </svg>
        </Tooltip>
      )}
    </span>
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

const InfoIcon = ({ className = 'w-3.5 h-3.5 text-gray-400' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 01.99 1v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
  </svg>
)

// Compact column header with an optional info-icon tooltip, for the quotas grid.
const QHead = ({ label, tip }: { label: string; tip?: string }) => (
  <span className="inline-flex items-center gap-1">
    {label}
    {tip && (
      <Tooltip content={tip} className="cursor-help inline-flex" tabIndex={0}>
        <InfoIcon className="w-3 h-3 text-gray-400" />
      </Tooltip>
    )}
  </span>
)

// Plain-English explainer for the whole Category quotas feature. The grid headers
// only have room for one-line tooltips; this is the "what is this and why" pop-out.
function QuotaHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const Term = ({ name, children }: { name: string; children: React.ReactNode }) => (
    <div>
      <dt className="font-semibold text-gray-900">{name}</dt>
      <dd className="text-gray-600 mt-0.5">{children}</dd>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="How category quotas work"
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">How category quotas work</h3>
            <p className="text-sm text-gray-500 mt-0.5">Protecting your service mix without turning work away.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1 -mr-1 shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto text-sm leading-relaxed space-y-4">
          <p className="text-gray-600">
            Your workshop runs a mix of work — services, MOTs, brakes, tyres and so on. Left alone, a
            run of one type can fill a day before the jobs you really want come in, or swallow a bay it
            shouldn't. <strong className="text-gray-900">Category quotas</strong> reserve a sensible slice
            of each day for each lane, then quietly hand the hours back if they go unused — so you protect
            your mix without ever turning a customer away unnecessarily.
          </p>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-gray-600">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">How it's sized</p>
            Protection is sized automatically from how each lane is staffed — the grey line under each
            category shows its primary-tech hours, total able hours and the resulting jobs-per-day
            ceiling. <strong className="text-gray-900">“No primary tech”</strong> means no one is set as
            the go-to technician for that lane yet, so there's nothing to size from — set a primary tech
            on each technician's skills. The columns below are your <em>overrides and caps</em> on top of that.
          </div>

          <dl className="space-y-3">
            <Term name="Protect">
              Hold this lane's unbooked hours for its own work on days still far off, instead of letting
              any job fill them. Turn off for lanes you're happy for anyone to book into.
            </Term>
            <Term name="Release (days)">
              How many days before the booking date the protection fades to nothing. Far out the hours are
              guarded; as the day nears and they're still empty, the guard winds down so the bay doesn't sit
              idle. Lower = release sooner. <strong className="text-gray-900">0 = never hold back.</strong>
            </Term>
            <Term name="Min hrs">
              An optional floor — keep at least this many hours reserved for this lane, on top of the
              automatic sizing. Leave blank for no floor.
            </Term>
            <Term name="Hard cap">
              An absolute limit on how many of this lane's jobs you'll take in a day — e.g. one MOT bay that
              can only fit so many tests. Leave blank for no cap.
            </Term>
            <Term name="Mode">
              What happens when a booking would break this lane's quota.
              {' '}<strong className="text-gray-900">Soft</strong> warns the advisor but lets them override
              and book anyway. <strong className="text-gray-900">Hard</strong> blocks the booking outright.
            </Term>
          </dl>

          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
            Nothing is throttled until <strong>Enforce category quotas</strong> is ticked — it saves the
            moment you toggle it. With it off, the diary still colours days by your loading target — it just
            won't hold anything back.
          </p>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ResourceManager() {
  const { session, user } = useAuth()
  const toast = useToast()

  const [siteId, setSiteId] = useState<string | null>(null)
  const [config, setConfig] = useState<ResourceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [quotas, setQuotas] = useState<QuotaRow[] | null>(null)
  const [savingQuotas, setSavingQuotas] = useState(false)
  const [assets, setAssets] = useState<AssetItem[] | null>(null)
  const [savingAssets, setSavingAssets] = useState(false)
  const [savingEnforce, setSavingEnforce] = useState(false)
  const [savingMot, setSavingMot] = useState(false)
  const [motTesters, setMotTesters] = useState<MotTester[] | null>(null)
  const [motRoster, setMotRoster] = useState<{ id: string; name: string }[]>([])
  const [savingTesters, setSavingTesters] = useState(false)
  const [showQuotaHelp, setShowQuotaHelp] = useState(false)
  // Tracks which site's config we've already loaded. Guards against `fetchConfig`
  // re-running (when the auth token/user object re-hydrates a few seconds after mount)
  // and overwriting the user's unsaved edits — most visibly the "Enforce quotas" toggle.
  const loadedConfigSite = useRef<string | null>(null)

  const token = session?.accessToken

  const fetchConfig = useCallback(async () => {
    if (!token) return
    const siteKey = user?.site?.id || '__default__'
    // Only load a given site's config once. Without this, the callback's identity changes
    // when the auth token/user re-hydrates, the effect re-runs, and setConfig() wipes out
    // any unsaved edits (e.g. a just-ticked "Enforce quotas" toggle reverting on its own).
    if (loadedConfigSite.current === siteKey) { setLoading(false); return }
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<ConfigResponse>(`/api/v1/resource-manager/config?${params}`, { token })
      setSiteId(data.siteId)
      setConfig(data.config)
      loadedConfigSite.current = siteKey
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load capacity settings')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  const fetchQuotas = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<{ quotas: QuotaRow[] }>(`/api/v1/resource-manager/quotas?${params}`, { token })
      setQuotas(data.quotas)
    } catch {
      setQuotas([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  const fetchAssets = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<{ assets: AssetItem[] }>(`/api/v1/resource-manager/assets?${params}`, { token })
      setAssets(data.assets)
    } catch {
      setAssets([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  const fetchMotTesters = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const data = await api<MotTestersResponse>(`/api/v1/resource-manager/mot-testers?${params}`, { token })
      setMotRoster(data.technicians || [])
      setMotTesters((data.testers || []).map(t => ({ technicianId: t.technicianId, name: t.name, dailyMotCap: t.dailyMotCap })))
    } catch {
      setMotTesters([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  useEffect(() => { fetchConfig(); fetchQuotas(); fetchAssets(); fetchMotTesters() }, [fetchConfig, fetchQuotas, fetchAssets, fetchMotTesters])

  const editAsset = (assetType: string, quantity: number | null) =>
    setAssets(prev => prev ? prev.map(a => a.assetType === assetType ? { ...a, quantity } : a) : prev)

  const handleSaveAssets = async () => {
    if (!token || !siteId || !assets) return
    setSavingAssets(true)
    try {
      await api(`/api/v1/resource-manager/assets?siteId=${siteId}`, {
        method: 'PUT', token,
        body: { assets: assets.map(a => ({ assetType: a.assetType, quantity: a.quantity })) }
      })
      toast.success('Resources saved')
      fetchAssets()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save resources')
    } finally {
      setSavingAssets(false)
    }
  }

  const set = <K extends keyof ResourceConfig>(key: K, value: ResourceConfig[K]) =>
    setConfig(prev => (prev ? { ...prev, [key]: value } : prev))

  // The MOT card is a partial PUT (server merges) so it saves independently of the
  // main config block's "Save changes" button.
  const handleSaveMot = async () => {
    if (!token || !siteId || !config) return
    setSavingMot(true)
    try {
      await api(`/api/v1/resource-manager/config?siteId=${siteId}`, {
        method: 'PUT', token,
        body: { motDailyCap: config.motDailyCap, motCapacityHours: config.motCapacityHours }
      })
      toast.success('MOT capacity saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save MOT capacity')
    } finally {
      setSavingMot(false)
    }
  }

  // MOT tester pool: array order = priority (1 = filled first). Edits are local
  // until "Save testers" persists the whole ordered list.
  const addMotTester = (techId: string) => {
    if (!techId) return
    setMotTesters(prev => {
      const list = prev || []
      if (list.some(t => t.technicianId === techId)) return list
      const entry = motRoster.find(r => r.id === techId)
      return [...list, { technicianId: techId, name: entry?.name || 'Technician', dailyMotCap: null }]
    })
  }
  const removeMotTester = (techId: string) =>
    setMotTesters(prev => (prev ? prev.filter(t => t.technicianId !== techId) : prev))
  const moveMotTester = (index: number, dir: -1 | 1) =>
    setMotTesters(prev => {
      if (!prev) return prev
      const to = index + dir
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  const editMotTesterCap = (techId: string, cap: number | null) =>
    setMotTesters(prev => (prev ? prev.map(t => t.technicianId === techId ? { ...t, dailyMotCap: cap } : t) : prev))

  const handleSaveTesters = async () => {
    if (!token || !siteId || !motTesters) return
    setSavingTesters(true)
    try {
      await api(`/api/v1/resource-manager/mot-testers?siteId=${siteId}`, {
        method: 'PUT', token,
        body: { testers: motTesters.map((t, i) => ({ technicianId: t.technicianId, priority: i + 1, dailyMotCap: t.dailyMotCap })) }
      })
      toast.success('MOT testers saved')
      fetchMotTesters()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save MOT testers')
    } finally {
      setSavingTesters(false)
    }
  }

  // Enforce-quotas is a live switch, not a draft field: persist it the moment it's toggled
  // (partial PUT — the server merges, other unsaved fields are untouched), so it no longer
  // depends on the user finding the right Save button and can't silently revert.
  const toggleEnforceQuotas = async (next: boolean) => {
    if (!token || !siteId || !config) return
    const prev = config.enableCategoryQuotas
    set('enableCategoryQuotas', next)
    setSavingEnforce(true)
    try {
      await api(`/api/v1/resource-manager/config?siteId=${siteId}`, {
        method: 'PUT', token, body: { enableCategoryQuotas: next }
      })
      toast.success(next ? 'Category quotas now enforced' : 'Category quotas turned off')
    } catch (err) {
      set('enableCategoryQuotas', prev)
      toast.error(err instanceof Error ? err.message : 'Failed to update category quotas')
    } finally {
      setSavingEnforce(false)
    }
  }

  const editQuota = (repairTypeId: string, patch: Partial<QuotaRow>) =>
    setQuotas(prev => prev ? prev.map(q => q.repairTypeId === repairTypeId ? { ...q, ...patch } : q) : prev)

  const handleSaveQuotas = async () => {
    if (!token || !siteId || !quotas) return
    setSavingQuotas(true)
    try {
      for (const q of quotas) {
        await api(`/api/v1/resource-manager/quotas/${q.repairTypeId}?siteId=${siteId}`, {
          method: 'PUT', token,
          body: {
            protectPrimary: q.protectPrimary,
            releaseWindowDays: q.releaseWindowDays,
            minHours: q.minHours,
            hardCapJobs: q.hardCapJobs,
            enforcement: q.enforcement,
            allowOverride: q.allowOverride
          }
        })
      }
      toast.success('Category quotas saved')
      fetchQuotas()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save quotas')
    } finally {
      setSavingQuotas(false)
    }
  }

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
              <FieldLabel
                hint="Days over which category protection decays."
                tip={"How long before a day a category stops guarding its spare hours.\n\nFar out, each lane's unbooked hours are reserved for its own work (e.g. MOT slots kept free for MOTs). As the day gets closer and those hours stay unbooked, that protection winds down to zero across this window — so any job can fill the bay instead of leaving it empty.\n\nLower = release sooner (protect less). 0 = never hold capacity back."}
              >Release window (days)</FieldLabel>
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

        <Card title="MOT capacity" subtitle="MOTs are capped by count, not hours — a bay only fits so many tests a day. Mark the MOT repair type as 'Is MOT' (Settings → Repair Types) so bookings are counted here.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <FieldLabel
                hint="Max MOTs booked per day. Blank = no limit."
                tip={"The number of MOTs you'll accept in a day — your bay slots. Counts any booking that includes MOT work.\n\nEnforced as a hard block only while 'Enforce category quotas' (below) is on; otherwise it's a guide."}
              >MOT daily cap</FieldLabel>
              <input
                type="number" min={0} max={200}
                className={inputCls + ' w-32'}
                value={config.motDailyCap ?? ''} placeholder="No limit"
                onChange={e => set('motDailyCap', e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))))}
              />
            </div>
            <div>
              <FieldLabel
                hint="Workshop time each MOT adds to the diary. Blank = use the booking's own hours."
                tip={"An MOT is often priced at a fraction of an hour of labour, which understates the time it actually ties up a bay/tester. Set the real workshop time here and the Booking Diary's load bar counts each MOT at this figure instead of its small labour line.\n\nApplies to the diary loading % whether or not quotas are enforced."}
              >MOT capacity hours</FieldLabel>
              <input
                type="number" min={0} max={24} step={0.05}
                className={inputCls + ' w-32'}
                value={config.motCapacityHours ?? ''} placeholder="Use booking hours"
                onChange={e => set('motCapacityHours', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={handleSaveMot} disabled={savingMot}
              className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {savingMot ? 'Saving…' : 'Save MOT capacity'}
            </button>
          </div>
        </Card>

        <Card title="MOT testers" subtitle="Your designated MOT tester(s) for this site, in priority order. When a job has an MOT plus other work, the MOT line is routed to a tester and the rest to another technician. Being listed here is the designation — no certificate needed.">
          {!motTesters ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              {motTesters.length === 0 ? (
                <p className="text-sm text-gray-400 mb-4">No MOT testers set — add one below. Until then the MOT line lists all technicians.</p>
              ) : (
                <div className="mb-4">
                  <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center text-[11px] uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100">
                    <span>Order</span>
                    <span>Technician</span>
                    <QHead label="Daily cap" tip="MOTs routed to this tester per day before overflow to the next. Blank = no per-tester cap (the site MOT bay cap still applies)." />
                    <span></span>
                  </div>
                  {motTesters.map((t, i) => (
                    <div key={t.technicianId} className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 items-center py-2 border-b border-gray-50">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 text-center text-sm font-semibold text-gray-500 tabular-nums">{i + 1}</span>
                        <div className="flex flex-col leading-none">
                          <button type="button" disabled={i === 0} onClick={() => moveMotTester(i, -1)}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-[10px]" title="Move up">▲</button>
                          <button type="button" disabled={i === motTesters.length - 1} onClick={() => moveMotTester(i, 1)}
                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-[10px]" title="Move down">▼</button>
                        </div>
                      </div>
                      <span className="text-sm text-gray-900">{t.name}</span>
                      <input type="number" min={1} max={200} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-20"
                        value={t.dailyMotCap ?? ''} placeholder="—"
                        onChange={e => editMotTesterCap(t.technicianId, e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))))} />
                      <button type="button" onClick={() => removeMotTester(t.technicianId)}
                        className="text-xs font-medium text-gray-400 hover:text-red-600" title="Remove from pool">Remove</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <select className={inputCls + ' flex-1'} value="" onChange={e => addMotTester(e.target.value)}>
                  <option value="">Add a technician…</option>
                  {motRoster.filter(r => !(motTesters ?? []).some(t => t.technicianId === r.id)).map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <button onClick={handleSaveTesters} disabled={savingTesters}
                  className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap">
                  {savingTesters ? 'Saving…' : 'Save testers'}
                </button>
              </div>
            </>
          )}
        </Card>

        <Card title="Category quotas" subtitle="Protect your service mix without turning away work. Protection is sized from how you've staffed each lane (the staffed column); these are overrides + caps.">
          <button
            type="button"
            onClick={() => setShowQuotaHelp(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mb-4"
          >
            <InfoIcon className="w-4 h-4 text-primary" />
            How category quotas work
          </button>
          <label className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-700">Enforce category quotas</span>
            <input type="checkbox" checked={config.enableCategoryQuotas} disabled={savingEnforce}
              onChange={e => toggleEnforceQuotas(e.target.checked)} />
          </label>
          {!config.enableCategoryQuotas && (
            <p className="text-xs text-gray-500 mb-3">Quotas are off — the diary still bands by loading target, but nothing is throttled. Turn on to enforce — it saves straight away.</p>
          )}

          {!quotas ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : quotas.length === 0 ? (
            <p className="text-sm text-gray-400">No repair types yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 gap-y-1 items-center text-[11px] uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100">
                <QHead label="Category" tip="Each repair type is its own lane. The grey line below shows how it's staffed — the basis protection is sized from." />
                <QHead label="Protect" tip="Hold this lane's unbooked hours for its own work on days still far off, instead of letting any job fill them." />
                <QHead label="Release" tip="Days before the booking date that protection fades to zero. Lower = release the held hours sooner. 0 = never hold back." />
                <QHead label="Min hrs" tip="Optional floor: keep at least this many hours reserved for this lane, on top of the automatic sizing. Blank = no floor." />
                <QHead label="Hard cap" tip="Absolute limit on this lane's jobs per day (e.g. one MOT bay). Blank = no cap." />
                <QHead label="Mode" tip="Soft = warn the advisor but allow them to override. Hard = block the booking outright." />
              </div>
              {quotas.map(q => (
                <div key={q.repairTypeId} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-3 gap-y-1 items-center py-2 border-b border-gray-50">
                  <div className="flex flex-col">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium w-fit" style={{ backgroundColor: `${q.colour}22`, color: q.colour }}>{q.label}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">
                      {q.staffed.primaryHours > 0 || q.staffed.eligibleHours > 0
                        ? `staffed ${q.staffed.primaryHours}h primary · ${q.staffed.eligibleHours}h able${q.staffed.jobCeiling != null ? ` · ${q.staffed.jobCeiling}/day` : ''}`
                        : 'no primary tech'}
                    </span>
                  </div>
                  <input type="checkbox" checked={q.protectPrimary} onChange={e => editQuota(q.repairTypeId, { protectPrimary: e.target.checked })} />
                  <input type="number" min={0} max={60} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-14" value={q.releaseWindowDays}
                    onChange={e => editQuota(q.repairTypeId, { releaseWindowDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                  <input type="number" min={0} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-14" value={q.minHours ?? ''} placeholder="—"
                    onChange={e => editQuota(q.repairTypeId, { minHours: e.target.value === '' ? null : Number(e.target.value) })} />
                  {q.isMot ? (
                    <Tooltip content="MOT bays are capped on the MOT capacity card above." className="inline-flex">
                      <input type="number" disabled className="border border-gray-200 bg-gray-50 text-gray-400 rounded-lg px-2 py-1 text-sm w-14 cursor-not-allowed"
                        value={config.motDailyCap ?? ''} placeholder="MOT card" />
                    </Tooltip>
                  ) : (
                    <input type="number" min={0} className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-14" value={q.hardCapJobs ?? ''} placeholder="—"
                      onChange={e => editQuota(q.repairTypeId, { hardCapJobs: e.target.value === '' ? null : Math.round(Number(e.target.value)) })} />
                  )}
                  <select className="border border-gray-300 rounded-lg px-2 py-1 text-sm" value={q.enforcement}
                    onChange={e => editQuota(q.repairTypeId, { enforcement: e.target.value as 'soft' | 'hard' })}>
                    <option value="soft">soft</option>
                    <option value="hard">hard</option>
                  </select>
                </div>
              ))}
              <div className="flex justify-end mt-4">
                <button onClick={handleSaveQuotas} disabled={savingQuotas}
                  className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                  {savingQuotas ? 'Saving…' : 'Save quotas'}
                </button>
              </div>
            </>
          )}
        </Card>

        <Card title="Physical resources" subtitle="Caps for things that aren't hours — courtesy cars and waiter seats per day. Leave blank for no limit. Booked counts come from the diary; online courtesy-car requests are checked against this. (MOT bays are set on the MOT capacity card above.)">
          {!assets ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <div className="space-y-3">
                {assets.map(a => (
                  <div key={a.assetType} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{a.label}</span>
                    <input
                      type="number" min={0} max={200}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28"
                      value={a.quantity ?? ''} placeholder="No limit"
                      onChange={e => editAsset(a.assetType, e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={handleSaveAssets} disabled={savingAssets}
                  className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                  {savingAssets ? 'Saving…' : 'Save resources'}
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      {showQuotaHelp && <QuotaHelpModal onClose={() => setShowQuotaHelp(false)} />}
    </div>
  )
}
