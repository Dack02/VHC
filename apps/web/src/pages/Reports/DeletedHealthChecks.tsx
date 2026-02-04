import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import StatCard from './components/StatCard'
import ChartCard from './components/ChartCard'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import ExportButton from './components/ExportButton'
import { formatDate, formatDateFull, formatDurationExtended, formatPercent, formatNumber, trendDirection, trendPercent } from './utils/formatters'
import { CHART_COLORS, SERIES_COLORS } from './utils/colors'

interface DeletedHCData {
  kpis: {
    totalDeleted: number
    deletionRate: number
    mostCommonReason: { name: string; count: number } | null
    avgTimeToDeletionMinutes: number
    restorations: number
  }
  previousPeriod: { totalDeleted: number; deletionRate: number } | null
  deletionsOverTime: Array<{ period: string; count: number }>
  reasonsBreakdown: Array<{ name: string; count: number; percent: number }>
  deletionsByUser: Array<{ id: string; name: string; count: number }>
  deletionsByOriginalStatus: Array<{ status: string; count: number }>
  deletionsBySite: Array<{ name: string; count: number }>
  userSummary: Array<{
    id: string; name: string; role: string; siteName: string
    totalDeleted: number; topReason: string; lastDeletionDate: string
  }>
  detailedLog: Array<{
    id: string; deletedAt: string; jobNumber: string; vehicleReg: string
    vehicleMakeModel: string; customerName: string; deletedByName: string
    reason: string; notes: string; originalStatus: string
  }>
}

interface UserOption { id: string; firstName: string; lastName: string }

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function DeletedHealthChecks() {
  const { session, user } = useAuth()
  const [deletedByFilter, setDeletedByFilter] = useState<string | null>(null)
  const [users, setUsers] = useState<UserOption[]>([])

  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  // Build query string with deleted_by filter
  const fullQueryString = deletedByFilter
    ? `${queryString}&deleted_by=${deletedByFilter}`
    : queryString

  const { data, loading, error } = useReportData<DeletedHCData>({
    endpoint: '/api/v1/reports/deleted-health-checks',
    queryString: fullQueryString,
  })

  useEffect(() => {
    if (!session?.accessToken) return
    api<{ users: UserOption[] }>('/api/v1/users', { token: session.accessToken })
      .then(d => setUsers(d.users || []))
      .catch(() => {})
  }, [session?.accessToken])

  const k = data?.kpis
  const prev = data?.previousPeriod
  const hasMultiSite = (user?.isOrgAdmin || user?.role === 'super_admin' || user?.role === 'org_admin') && (data?.deletionsBySite?.length || 0) > 1

  const chartData = data?.deletionsOverTime.map(d => ({
    ...d,
    label: formatDate(d.period),
  })) || []

  const reasonsData = data?.reasonsBreakdown || []
  const userChartData = data?.deletionsByUser?.slice(0, 10) || []
  const statusData = data?.deletionsByOriginalStatus || []

  const userSummaryColumns: Column<DeletedHCData['userSummary'][0]>[] = [
    { key: 'name', label: 'Name', render: r => <span className="font-medium text-gray-900">{r.name}</span>, sortable: true, sortValue: r => r.name },
    { key: 'role', label: 'Role', render: r => <span className="text-gray-600 capitalize">{r.role.replace(/_/g, ' ')}</span> },
    { key: 'siteName', label: 'Site', render: r => r.siteName },
    { key: 'totalDeleted', label: 'Total Deleted', render: r => r.totalDeleted, align: 'right', sortable: true, sortValue: r => r.totalDeleted },
    { key: 'topReason', label: 'Top Reason', render: r => <span className="text-gray-600">{r.topReason}</span> },
    { key: 'lastDeletionDate', label: 'Last Deletion', render: r => formatDateFull(r.lastDeletionDate), sortable: true, sortValue: r => r.lastDeletionDate },
  ]

  const detailColumns: Column<DeletedHCData['detailedLog'][0]>[] = [
    { key: 'deletedAt', label: 'Date/Time', render: r => (
      <span className="text-gray-600 text-xs">{new Date(r.deletedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
    ), sortable: true, sortValue: r => r.deletedAt },
    { key: 'jobNumber', label: 'Job #', render: r => <span className="font-medium text-gray-900">{r.jobNumber}</span> },
    { key: 'vehicleReg', label: 'Reg', render: r => r.vehicleReg },
    { key: 'vehicleMakeModel', label: 'Vehicle', render: r => <span className="text-gray-600">{r.vehicleMakeModel}</span> },
    { key: 'customerName', label: 'Customer', render: r => r.customerName },
    { key: 'deletedByName', label: 'Deleted By', render: r => r.deletedByName, sortable: true, sortValue: r => r.deletedByName },
    { key: 'reason', label: 'Reason', render: r => (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">{r.reason}</span>
    ) },
    { key: 'originalStatus', label: 'Was Status', render: r => (
      <span className="text-gray-500 text-xs">{formatStatusLabel(r.originalStatus)}</span>
    ) },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Deleted Health Checks</h1>
            <p className="text-gray-500 text-sm mt-0.5">Deletion tracking, accountability, and trends</p>
          </div>
        </div>
        <ExportButton
          endpoint="/api/v1/reports/deleted-health-checks/export"
          queryString={fullQueryString}
          filename={`deleted-health-checks-${new Date().toISOString().split('T')[0]}.csv`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <ReportFiltersBar
          datePreset={filters.datePreset}
          groupBy={filters.groupBy}
          siteId={filters.siteId}
          onDatePresetChange={setDatePreset}
          onGroupByChange={setGroupBy}
          onSiteChange={setSiteId}
        />
        {users.length > 0 && (
          <select
            value={deletedByFilter || ''}
            onChange={e => setDeletedByFilter(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label="Total Deleted"
              value={formatNumber(k?.totalDeleted || 0)}
              trend={prev ? { direction: trendDirection(k?.totalDeleted || 0, prev.totalDeleted), percent: trendPercent(k?.totalDeleted || 0, prev.totalDeleted) } : undefined}
            />
            <StatCard
              label="Deletion Rate"
              value={formatPercent(k?.deletionRate || 0)}
              valueClassName="text-red-600"
              trend={prev ? { direction: trendDirection(k?.deletionRate || 0, prev.deletionRate), percent: trendPercent(k?.deletionRate || 0, prev.deletionRate) } : undefined}
            />
            <StatCard
              label="Most Common Reason"
              value={k?.mostCommonReason?.name || 'N/A'}
              valueClassName="text-gray-900 text-lg"
            />
            <StatCard
              label="Avg Time to Deletion"
              value={k?.avgTimeToDeletionMinutes ? formatDurationExtended(k.avgTimeToDeletionMinutes) : 'N/A'}
            />
            <StatCard
              label="Restorations"
              value={formatNumber(k?.restorations || 0)}
              valueClassName="text-green-600"
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Deletions Over Time">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Deletions" fill={CHART_COLORS.quaternary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Deletion Reasons">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={reasonsData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(value) => [value, 'Count']} />
                  <Bar dataKey="count" name="Count" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Deletions by User">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={userChartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip formatter={(value) => [value, 'Deletions']} />
                  <Bar dataKey="count" name="Deletions" radius={[0, 4, 4, 0]}>
                    {userChartData.map((_, i) => (
                      <rect key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Deletions by Original Status">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={statusData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} tickFormatter={formatStatusLabel} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip labelFormatter={(label) => formatStatusLabel(String(label))} />
                  <Bar dataKey="count" name="Count" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Deletions by Site (conditional) */}
          {hasMultiSite && (
            <ChartCard title="Deletions by Site">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data?.deletionsBySite || []} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(value) => [value, 'Deletions']} />
                  <Bar dataKey="count" name="Deletions" fill={CHART_COLORS.tertiary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* User Deletion Summary */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">User Deletion Summary</h2>
              <p className="text-sm text-gray-500 mt-0.5">Per-user deletion activity and patterns</p>
            </div>
            <DataTable
              columns={userSummaryColumns}
              data={data?.userSummary || []}
              rowKey={r => r.id}
              pageSize={10}
              emptyMessage="No deletion data available"
            />
          </div>

          {/* Detailed Deletion Log */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Detailed Deletion Log</h2>
                <p className="text-sm text-gray-500 mt-0.5">{data?.detailedLog.length || 0} deleted health checks in period</p>
              </div>
            </div>
            <DataTable
              columns={detailColumns}
              data={data?.detailedLog || []}
              rowKey={r => r.id}
              pageSize={15}
              emptyMessage="No deleted health checks found"
            />
          </div>
        </>
      )}
    </div>
  )
}
