/**
 * ReasonAnalytics - Admin page for viewing reason usage statistics
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface ReasonStat {
  id: string
  reasonText: string
  reasonType: string | null
  defaultRag: string
  usageCount: number
  approvalRate: number | null
  timesApproved: number
  timesDeclined: number
  categoryName: string | null
  categoryColor: string | null
  itemName: string | null
  createdAt: string
}

interface StatsResponse {
  summary: {
    totalReasons: number
    totalUsage: number
    avgApprovalRate: number | null
    pendingSubmissions: number
    unusedCount: number
  }
  topReasons: ReasonStat[]
  unusedReasons: ReasonStat[]
  lowApprovalReasons: ReasonStat[]
  period: string
}

type Period = '7d' | '30d' | '90d' | 'all'

export default function ReasonAnalytics() {
  const { user, session } = useAuth()
  const orgId = user?.organization?.id

  const [period, setPeriod] = useState<Period>('30d')
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !session?.accessToken) return
    fetchStats()
  }, [orgId, session?.accessToken, period])

  const fetchStats = async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const data = await api<StatsResponse>(
        `/api/v1/organizations/${orgId}/reason-stats?period=${period}`,
        { token: session?.accessToken }
      )
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteReason = async (reasonId: string) => {
    if (!confirm('Are you sure you want to delete this unused reason?')) return
    setDeleting(reasonId)
    try {
      await api(`/api/v1/reasons/${reasonId}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      fetchStats()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete reason')
    } finally {
      setDeleting(null)
    }
  }

  const getApprovalColor = (rate: number | null): string => {
    if (rate === null) return 'text-gray-400'
    if (rate >= 70) return 'text-green-600'
    if (rate >= 50) return 'text-amber-600'
    return 'text-red-600'
  }

  const getApprovalBg = (rate: number | null): string => {
    if (rate === null) return 'bg-gray-100'
    if (rate >= 70) return 'bg-green-100'
    if (rate >= 50) return 'bg-amber-100'
    return 'bg-red-100'
  }

  const daysSince = (dateStr: string): number => {
    const created = new Date(dateStr)
    const now = new Date()
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  }

  const periodLabels: Record<Period, string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    'all': 'All time'
  }

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <SettingsBackLink />
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reason Analytics</h1>
          <p className="text-gray-600">Usage statistics and insights for your reason library</p>
        </div>

        {/* Period Selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Period:</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            {Object.entries(periodLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white shadow rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-900">
            {stats?.summary.totalReasons || 0}
          </div>
          <div className="text-sm text-gray-500">Total Reasons</div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <div className="text-3xl font-bold text-blue-600">
            {stats?.summary.totalUsage || 0}
          </div>
          <div className="text-sm text-gray-500">Total Uses</div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <div className={`text-3xl font-bold ${getApprovalColor(stats?.summary.avgApprovalRate ?? null)}`}>
            {stats?.summary.avgApprovalRate != null ? `${stats.summary.avgApprovalRate}%` : '-'}
          </div>
          <div className="text-sm text-gray-500">Avg Approval Rate</div>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <div className="text-3xl font-bold text-amber-600">
            {stats?.summary.pendingSubmissions || 0}
          </div>
          <div className="text-sm text-gray-500">Pending Submissions</div>
          {(stats?.summary.pendingSubmissions || 0) > 0 && (
            <Link to="/settings/reason-submissions" className="text-xs text-primary hover:underline">
              Review now
            </Link>
          )}
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-400">
            {stats?.summary.unusedCount || 0}
          </div>
          <div className="text-sm text-gray-500">Unused Reasons</div>
        </div>
      </div>

      {/* Top Used Reasons */}
      <div className="bg-white shadow rounded-lg mb-6">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Top Used Reasons</h2>
          <p className="text-sm text-gray-500">Most frequently selected reasons</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rank</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item/Type</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Usage</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stats?.topReasons.map((reason, index) => (
                <tr key={reason.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-700 font-medium">
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        reason.defaultRag === 'red' ? 'bg-red-500' :
                        reason.defaultRag === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                      }`} />
                      <span className="text-sm text-gray-900 max-w-md truncate">
                        {reason.reasonText}
                      </span>
                    </div>
                    {reason.categoryName && (
                      <span
                        className="inline-block mt-1 px-2 py-0.5 text-xs rounded"
                        style={{
                          backgroundColor: reason.categoryColor ? `${reason.categoryColor}20` : '#f3f4f6',
                          color: reason.categoryColor || '#6b7280'
                        }}
                      >
                        {reason.categoryName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {reason.reasonType ? (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                        {reason.reasonType}
                      </span>
                    ) : reason.itemName ? (
                      <span className="text-gray-700">{reason.itemName}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-lg font-semibold text-gray-900">
                      {reason.usageCount}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded text-sm font-medium ${getApprovalBg(reason.approvalRate)} ${getApprovalColor(reason.approvalRate)}`}>
                      {reason.approvalRate !== null ? `${reason.approvalRate}%` : '-'}
                    </span>
                    {reason.approvalRate !== null && (
                      <div className="text-xs text-gray-400 mt-1">
                        {reason.timesApproved}/{reason.timesApproved + reason.timesDeclined}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {(!stats?.topReasons || stats.topReasons.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No reason usage data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Unused Reasons */}
        <div className="bg-white shadow rounded-lg">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Unused Reasons</h2>
            <p className="text-sm text-gray-500">Reasons that have never been selected</p>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {stats?.unusedReasons.map((reason) => (
              <div key={reason.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      reason.defaultRag === 'red' ? 'bg-red-500' :
                      reason.defaultRag === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                    }`} />
                    <span className="text-sm text-gray-900 truncate">
                      {reason.reasonText}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    {reason.reasonType ? (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                        {reason.reasonType}
                      </span>
                    ) : reason.itemName ? (
                      <span>{reason.itemName}</span>
                    ) : null}
                    <span>Created {daysSince(reason.createdAt)} days ago</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteReason(reason.id)}
                  disabled={deleting === reason.id}
                  className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  title="Delete unused reason"
                >
                  {deleting === reason.id ? (
                    <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
            {(!stats?.unusedReasons || stats.unusedReasons.length === 0) && (
              <div className="p-8 text-center text-gray-500">
                No unused reasons - great!
              </div>
            )}
          </div>
        </div>

        {/* Low Approval Rate Insights */}
        <div className="bg-white shadow rounded-lg">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Approval Rate Insights</h2>
            <p className="text-sm text-gray-500">Reasons with less than 50% approval rate</p>
          </div>
          <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {stats?.lowApprovalReasons.map((reason) => (
              <div key={reason.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        reason.defaultRag === 'red' ? 'bg-red-500' :
                        reason.defaultRag === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                      }`} />
                      <span className="text-sm text-gray-900 truncate">
                        {reason.reasonText}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                      {reason.reasonType ? (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                          {reason.reasonType}
                        </span>
                      ) : reason.itemName ? (
                        <span>{reason.itemName}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <div className={`text-lg font-semibold ${getApprovalColor(reason.approvalRate)}`}>
                      {reason.approvalRate}%
                    </div>
                    <div className="text-xs text-gray-400">
                      {reason.timesApproved} approved / {reason.timesDeclined} declined
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded inline-block">
                  Consider reviewing or rewording this reason
                </div>
              </div>
            ))}
            {(!stats?.lowApprovalReasons || stats.lowApprovalReasons.length === 0) && (
              <div className="p-8 text-center text-gray-500">
                All reasons have good approval rates
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Link to Reason Library */}
      <div className="mt-6 text-center">
        <Link
          to="/settings/reasons"
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Reason Library
        </Link>
      </div>
    </div>
  )
}
