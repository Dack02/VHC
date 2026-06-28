import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api, downloadCsv } from '../../lib/api'

interface UsageTotals {
  smsSent: number
  emailsSent: number
  healthChecksCreated: number
  healthChecksCompleted: number
  aiGenerations: number
  aiCostUsd: number
  aiChargeoutGbp: number
  vehicleLookups: number
  vehicleLookupsBilled: number
  vehicleLookupCost: number
  vehicleLookupSell: number
  vehicleLookupMargin: number
  activeOrgs: number
}

interface OrgUsage {
  id: string
  name: string
  status: string
  smsSent: number
  emailsSent: number
  healthChecksCreated: number
  healthChecksCompleted: number
  storageUsedBytes: number
  aiGenerations: number
  aiCostUsd: number
  aiChargeoutGbp: number
  estimatedSmsCost: number
  vehicleLookups: number
  vehicleLookupsBilled: number
  vehicleLookupCost: number
  vehicleLookupSell: number
  vehicleLookupMargin: number
}

type SortKey = 'sms_desc' | 'emails_desc' | 'health_checks_desc' | 'ai_cost_desc' | 'storage_desc' | 'vehicle_cost_desc' | 'name_asc'

type FeatureState = 'active' | 'idle' | 'off'
interface FeatureDef { key: string; label: string; gated: boolean }
interface FeatureCell { key: string; state: FeatureState; count: number }
interface OrgAdoption { id: string; name: string; status: string; features: FeatureCell[] }

const gbp = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0)
const num = (n: number) => (n || 0).toLocaleString()
const gb = (bytes: number) => `${((bytes || 0) / (1024 * 1024 * 1024)).toFixed(2)} GB`

export default function AdminUsageDashboard() {
  const { session } = useSuperAdmin()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30d')
  const [sort, setSort] = useState<SortKey>('sms_desc')
  const [totals, setTotals] = useState<UsageTotals | null>(null)
  const [orgs, setOrgs] = useState<OrgUsage[]>([])
  const [marginPercent, setMarginPercent] = useState(0)
  const [usdToGbpRate, setUsdToGbpRate] = useState(0)
  const [features, setFeatures] = useState<FeatureDef[]>([])
  const [adoption, setAdoption] = useState<OrgAdoption[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!session?.accessToken) return
    const token = session.accessToken
    setLoading(true)
    Promise.all([
      api<{ totals: UsageTotals; marginPercent: number; usdToGbpRate: number }>(`/api/v1/admin/usage/summary?period=${period}`, { token }),
      api<{ organizations: OrgUsage[] }>(`/api/v1/admin/usage/by-organization?period=${period}&sort=${sort}`, { token })
    ])
      .then(([summary, byOrg]) => {
        setTotals(summary.totals)
        setMarginPercent(summary.marginPercent || 0)
        setUsdToGbpRate(summary.usdToGbpRate || 0)
        setOrgs(byOrg.organizations || [])
      })
      .catch((err) => console.error('Failed to fetch usage data:', err))
      .finally(() => setLoading(false))

    // Feature adoption loads independently: a failure (e.g. the RPC not yet
    // deployed) degrades to an empty matrix instead of blanking the dashboard.
    api<{ features: FeatureDef[]; organizations: OrgAdoption[] }>(`/api/v1/admin/usage/feature-adoption?period=${period}`, { token })
      .then((adopt) => {
        setFeatures(adopt.features || [])
        setAdoption(adopt.organizations || [])
      })
      .catch((err) => {
        console.error('Failed to fetch feature adoption:', err)
        setFeatures([])
        setAdoption([])
      })
  }, [session, period, sort])

  const handleExport = async () => {
    if (!session?.accessToken) return
    setExporting(true)
    try {
      await downloadCsv(`/api/v1/admin/usage/export?period=${period}`, session.accessToken, `usage-${period}-${new Date().toISOString().split('T')[0]}.csv`)
    } catch (err) {
      console.error('Failed to export usage:', err)
    } finally {
      setExporting(false)
    }
  }

  const sortable = (key: SortKey, label: string) => (
    <button
      onClick={() => setSort(key)}
      className={`uppercase text-xs font-medium ${sort === key ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
    >
      {label}{sort === key ? ' ↓' : ''}
    </button>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading usage data...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usage</h1>
          <p className="text-gray-500 mt-1">SMS, email, health-check, AI and storage usage across organisations</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <SummaryCard title="SMS Sent" value={num(totals?.smsSent || 0)} />
        <SummaryCard title="Emails Sent" value={num(totals?.emailsSent || 0)} />
        <SummaryCard title="Health Checks" value={num(totals?.healthChecksCreated || 0)} />
        <SummaryCard title="AI Cost (USD)" value={`$${(totals?.aiCostUsd || 0).toFixed(2)}`} />
        <SummaryCard title="AI Chargeout (GBP)" value={gbp(totals?.aiChargeoutGbp || 0)} />
        <SummaryCard title="Est. SMS Spend" value={gbp(orgs.reduce((s, o) => s + (o.estimatedSmsCost || 0), 0))} />
        <SummaryCard title="Vehicle Lookups" value={num(totals?.vehicleLookups || 0)} />
        <SummaryCard title="Vehicle Billable (GBP)" value={gbp(totals?.vehicleLookupSell || 0)} />
        <SummaryCard title="Vehicle Margin (GBP)" value={gbp(totals?.vehicleLookupMargin || 0)} />
        <SummaryCard title="Active Orgs" value={num(totals?.activeOrgs || 0)} />
      </div>

      {/* By-organisation leaderboard */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Usage by Organisation</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left">{sortable('name_asc', 'Organisation')}</th>
                <th className="px-6 py-3 text-right">{sortable('sms_desc', 'SMS')}</th>
                <th className="px-6 py-3 text-right">{sortable('emails_desc', 'Emails')}</th>
                <th className="px-6 py-3 text-right">{sortable('health_checks_desc', 'HC Created')}</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">HC Done</th>
                <th className="px-6 py-3 text-right">{sortable('storage_desc', 'Storage')}</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">AI Gens</th>
                <th className="px-6 py-3 text-right">{sortable('ai_cost_desc', 'AI Cost')}</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">AI Chargeout £</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Est. SMS £</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Veh Lookups</th>
                <th className="px-6 py-3 text-right">{sortable('vehicle_cost_desc', 'Veh Cost £')}</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Veh Billable £</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Veh Margin £</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-6 py-8 text-center text-gray-500">No usage data for this period</td>
                </tr>
              ) : (
                orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => navigate(`/admin/organizations/${o.id}`)}
                        className="font-medium text-gray-900 hover:text-indigo-600 text-left"
                      >
                        {o.name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900">{num(o.smsSent)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{num(o.emailsSent)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{num(o.healthChecksCreated)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{num(o.healthChecksCompleted)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{gb(o.storageUsedBytes)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{num(o.aiGenerations)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">${(o.aiCostUsd || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{gbp(o.aiChargeoutGbp || 0)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{gbp(o.estimatedSmsCost)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{num(o.vehicleLookups)}{o.vehicleLookups !== o.vehicleLookupsBilled ? ` (${o.vehicleLookupsBilled} billed)` : ''}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{gbp(o.vehicleLookupCost)}</td>
                    <td className="px-6 py-4 text-right text-gray-900">{gbp(o.vehicleLookupSell)}</td>
                    <td className="px-6 py-4 text-right text-gray-700">{gbp(o.vehicleLookupMargin)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">
          SMS spend is estimated from a configurable per-message rate (Platform Settings → Billing). AI cost is in USD;
          chargeout is billed in GBP = cost × margin{marginPercent ? ` (+${marginPercent}%)` : ''} × USD→GBP rate{usdToGbpRate ? ` (${usdToGbpRate})` : ''}, set in AI Configuration.
          Vehicle lookups: <span className="font-medium">Cost</span> is our actual spend with Vehicle Data Global; <span className="font-medium">Billable</span> = billed lookups × the per-lookup sell price (Platform Settings → Billing).
        </p>
      </div>

      {/* Feature adoption matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Feature adoption</h2>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />Active</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-gray-300" />Enabled · idle</span>
            <span className="inline-flex items-center gap-1.5"><span className="text-gray-300 font-medium">–</span>Off</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organisation</th>
                {features.map((f) => (
                  <th key={f.key} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {adoption.length === 0 ? (
                <tr>
                  <td colSpan={features.length + 1} className="px-6 py-8 text-center text-gray-500">No feature data for this period</td>
                </tr>
              ) : (
                adoption.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => navigate(`/admin/organizations/${o.id}`)}
                        className="font-medium text-gray-900 hover:text-indigo-600 text-left"
                      >
                        {o.name}
                      </button>
                    </td>
                    {o.features.map((cell) => (
                      <td key={cell.key} className="px-4 py-4 text-center"><AdoptionCell state={cell.state} count={cell.count} /></td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {adoption.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className="px-6 py-3 text-xs text-gray-500">Active orgs</td>
                  {features.map((f) => {
                    const active = adoption.filter((o) => o.features.find((c) => c.key === f.key)?.state === 'active').length
                    return <td key={f.key} className="px-4 py-3 text-center text-xs text-gray-500">{active}/{adoption.length}</td>
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">
          Active = activity in the selected period; Enabled · idle = module on but unused (the onboarding / churn signal).
          Reporting counts report views recorded since instrumentation; Parts &amp; Packages is always-on, so it is never “off”.
        </p>
      </div>
    </div>
  )
}

function AdoptionCell({ state, count }: { state: FeatureState; count: number }) {
  if (state === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 text-green-600 font-medium">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        {count.toLocaleString()}
      </span>
    )
  }
  if (state === 'idle') {
    return <span className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-gray-300" title="Enabled, no activity this period" />
  }
  return <span className="text-gray-300 font-medium" title="Module disabled">–</span>
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
