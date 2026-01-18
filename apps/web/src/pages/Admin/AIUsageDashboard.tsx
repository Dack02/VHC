import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface UsageSummary {
  period: {
    start: string
    end: string
  }
  totals: {
    generations: number
    tokens: number
    costUsd: number
    successRate: number
  }
  byAction: Array<{
    action: string
    count: number
    tokens: number
    cost: number
  }>
  dailyBreakdown: Array<{
    date: string
    generations: number
    cost: number
  }>
}

interface OrganizationUsage {
  id: string
  name: string
  generations: number
  tokens: number
  costUsd: number
  limit: number
  percentageUsed: number
}

interface ActionBreakdown {
  action: string
  count: number
  percentage: number
}

interface Alert {
  id: string
  alertType: string
  message: string
  organizationId: string | null
  organizationName: string | null
  threshold: number
  currentValue: number
  createdAt: string
}

export default function AIUsageDashboard() {
  const { session } = useSuperAdmin()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30d')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [orgUsage, setOrgUsage] = useState<OrganizationUsage[]>([])
  const [actionBreakdown, setActionBreakdown] = useState<ActionBreakdown[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [session, period])

  const fetchData = async () => {
    if (!session?.accessToken) return

    setLoading(true)
    try {
      const [summaryData, orgData, alertsData] = await Promise.all([
        api<UsageSummary>(`/api/v1/admin/ai-usage/summary?period=${period}`, { token: session.accessToken }),
        api<{ organizations: OrganizationUsage[] }>(`/api/v1/admin/ai-usage/by-organization?period=${period}`, { token: session.accessToken }),
        api<{ alerts: Alert[] }>('/api/v1/admin/ai-usage/alerts', { token: session.accessToken })
      ])

      setSummary(summaryData)
      setOrgUsage(orgData.organizations || [])
      setAlerts(alertsData.alerts || [])

      // Use action breakdown from summary API
      const totalCount = (summaryData.byAction || []).reduce((sum, a) => sum + a.count, 0) || 1
      const breakdown: ActionBreakdown[] = (summaryData.byAction || []).map(a => ({
        action: a.action,
        count: a.count,
        percentage: Math.round((a.count / totalCount) * 100)
      }))
      setActionBreakdown(breakdown)
    } catch (error) {
      console.error('Failed to fetch AI usage data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    if (!session?.accessToken) return

    setExporting(true)
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5180'}/api/v1/admin/ai-usage/export?period=${period}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`
        }
      })
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-usage-${period}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Failed to export:', error)
    } finally {
      setExporting(false)
    }
  }

  const handleAcknowledgeAlert = async (alertId: string) => {
    if (!session?.accessToken) return

    try {
      await api(`/api/v1/admin/ai-usage/alerts/${alertId}/acknowledge`, {
        method: 'POST',
        token: session.accessToken
      })
      setAlerts(alerts.filter(a => a.id !== alertId))
    } catch (error) {
      console.error('Failed to acknowledge alert:', error)
    }
  }

  const formatNumber = (num: number | undefined | null) => {
    const n = num || 0
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
    return n.toString()
  }

  const formatActionName = (action: string) => {
    return action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading AI usage data...</div>
      </div>
    )
  }

  const generationsChange = null // No previous period data from API yet
  const tokensChange = null
  const costChange = null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Usage</h1>
          <p className="text-gray-500 mt-1">Monitor AI generation usage across the platform</p>
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

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-amber-800 mb-2">Active Alerts</h3>
          <div className="space-y-2">
            {alerts.map(alert => (
              <div key={alert.id} className="flex items-center justify-between bg-white rounded p-3 border border-amber-100">
                <div>
                  <p className="text-sm text-amber-800">{alert.message}</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    {alert.organizationName || 'Platform'} • {new Date(alert.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleAcknowledgeAlert(alert.id)}
                  className="text-xs text-amber-700 hover:text-amber-900 px-2 py-1 bg-amber-100 rounded"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          title="Generations"
          value={summary?.totals?.generations || 0}
          change={generationsChange}
        />
        <SummaryCard
          title="Tokens"
          value={formatNumber(summary?.totals?.tokens || 0)}
          change={tokensChange}
        />
        <SummaryCard
          title="Est. Cost"
          value={`$${(summary?.totals?.costUsd || 0).toFixed(2)}`}
          change={costChange}
          isCurrency
        />
      </div>

      {/* Usage by Organization */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Usage by Organization</h2>
          <button
            onClick={() => navigate('/admin/organizations')}
            className="text-sm text-indigo-600 hover:text-indigo-700"
          >
            View All Organizations
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organization</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gens</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tokens</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Limit Usage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {orgUsage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No usage data</td>
                </tr>
              ) : (
                orgUsage.slice(0, 10).map((org) => (
                  <tr key={org.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <button
                        onClick={() => navigate(`/admin/organizations/${org.id}`)}
                        className="font-medium text-gray-900 hover:text-indigo-600"
                      >
                        {org.name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right text-gray-900">{org.generations}</td>
                    <td className="px-6 py-4 text-right text-gray-500">{formatNumber(org.tokens)}</td>
                    <td className="px-6 py-4 text-right text-gray-500">${(org.costUsd || 0).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[120px]">
                          <div
                            className={`h-full rounded-full ${
                              org.percentageUsed >= 90 ? 'bg-red-500' :
                              org.percentageUsed >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${Math.min(org.percentageUsed || 0, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {org.generations}/{org.limit} ({org.percentageUsed || 0}%)
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Usage by Action */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage by Action</h2>
        <div className="space-y-3">
          {actionBreakdown.map((action) => (
            <div key={action.action} className="flex items-center gap-4">
              <div className="w-48 text-sm text-gray-700">{formatActionName(action.action)}</div>
              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${action.percentage}%` }}
                />
              </div>
              <div className="w-24 text-right text-sm text-gray-600">
                {action.count} ({action.percentage}%)
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Success Rate */}
      {summary && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">API Performance</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-500">Total Tokens</p>
              <p className="text-2xl font-bold text-gray-900">{formatNumber(summary.totals?.tokens)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">{(summary.totals?.successRate || 100).toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  title,
  value,
  change,
  isCurrency: _isCurrency = false
}: {
  title: string
  value: string | number
  change: number | null
  isCurrency?: boolean
}) {
  const isPositive = change && change > 0
  const isNegative = change && change < 0

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
      {change !== null && (
        <div className={`flex items-center mt-2 text-sm ${
          isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-500'
        }`}>
          {isPositive ? (
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          ) : isNegative ? (
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          ) : null}
          {Math.abs(change).toFixed(0)}% vs last period
        </div>
      )}
    </div>
  )
}
