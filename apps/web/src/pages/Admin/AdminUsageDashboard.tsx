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
  estimatedSmsCost: number
}

type SortKey = 'sms_desc' | 'emails_desc' | 'health_checks_desc' | 'ai_cost_desc' | 'storage_desc' | 'name_asc'

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
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!session?.accessToken) return
    setLoading(true)
    Promise.all([
      api<{ totals: UsageTotals }>(`/api/v1/admin/usage/summary?period=${period}`, { token: session.accessToken }),
      api<{ organizations: OrgUsage[] }>(`/api/v1/admin/usage/by-organization?period=${period}&sort=${sort}`, { token: session.accessToken })
    ])
      .then(([summary, byOrg]) => {
        setTotals(summary.totals)
        setOrgs(byOrg.organizations || [])
      })
      .catch((err) => console.error('Failed to fetch usage data:', err))
      .finally(() => setLoading(false))
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard title="SMS Sent" value={num(totals?.smsSent || 0)} />
        <SummaryCard title="Emails Sent" value={num(totals?.emailsSent || 0)} />
        <SummaryCard title="Health Checks" value={num(totals?.healthChecksCreated || 0)} />
        <SummaryCard title="AI Cost (USD)" value={`$${(totals?.aiCostUsd || 0).toFixed(2)}`} />
        <SummaryCard title="Est. SMS Spend" value={gbp(orgs.reduce((s, o) => s + (o.estimatedSmsCost || 0), 0))} />
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
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Est. SMS £</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">No usage data for this period</td>
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
                    <td className="px-6 py-4 text-right text-gray-700">{gbp(o.estimatedSmsCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-100">
          SMS spend is estimated from a configurable per-message rate (Platform Settings → Billing). AI cost is billed in USD.
        </p>
      </div>
    </div>
  )
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
