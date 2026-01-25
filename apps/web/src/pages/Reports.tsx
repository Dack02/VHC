import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface ChartDataPoint {
  period: string
  total: number
  completed: number
  authorized: number
  declined: number
  value: number
}

interface TechnicianMetric {
  id: string
  name: string
  total: number
  completed: number
  avgTimeMinutes: number
}

interface AdvisorMetric {
  id: string
  name: string
  total: number
  sent: number
  authorized: number
  conversionRate: number
  totalValue: number
}

interface BrakeDiscTechnicianStat {
  technicianId: string
  technicianName: string
  notMeasuredCount: number
  unableToAccessCount: number
  totalHealthChecks: number
}

interface BrakeDiscData {
  period: { from: string; to: string }
  totalHealthChecks: number
  unableToAccessCount: number
  notMeasuredCount: number
  byTechnician: BrakeDiscTechnicianStat[]
}

interface ReportSummary {
  total: number
  completed: number
  sent: number
  authorized: number
  declined: number
  pending: number
  conversionRate: number
  totalValueIdentified: number
  totalValueAuthorized: number
  totalValueDeclined: number
}

interface ReportData {
  period: { from: string; to: string }
  summary: ReportSummary
  chartData: ChartDataPoint[]
  technicianMetrics: TechnicianMetric[]
  advisorMetrics: AdvisorMetric[]
}

export default function Reports() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<ReportData | null>(null)
  const [brakeDiscData, setBrakeDiscData] = useState<BrakeDiscData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [dateRange, setDateRange] = useState<'week' | 'month' | '3months'>('month')
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')

  const fetchReports = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      setError(null)

      // Calculate date range
      const today = new Date()
      let dateFrom: Date

      if (dateRange === 'week') {
        dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      } else if (dateRange === 'month') {
        dateFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      } else {
        dateFrom = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
      }

      // Fetch main report data and brake disc data in parallel
      const [reportData, brakeData] = await Promise.all([
        api<ReportData>(
          `/api/v1/reports?date_from=${dateFrom.toISOString()}&date_to=${today.toISOString()}&group_by=${groupBy}`,
          { token }
        ),
        api<BrakeDiscData>(
          `/api/v1/reports/brake-disc-access?startDate=${dateFrom.toISOString()}&endDate=${today.toISOString()}`,
          { token }
        )
      ])

      setData(reportData)
      setBrakeDiscData(brakeData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [token, dateRange, groupBy])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const handleExportCSV = async () => {
    if (!token) return

    try {
      setExporting(true)

      const today = new Date()
      let dateFrom: Date

      if (dateRange === 'week') {
        dateFrom = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      } else if (dateRange === 'month') {
        dateFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      } else {
        dateFrom = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
      }

      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5180'
      const res = await fetch(
        `${apiUrl}/api/v1/reports/export?date_from=${dateFrom.toISOString()}&date_to=${today.toISOString()}&format=csv`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )

      if (!res.ok) throw new Error('Failed to export data')

      // Download the CSV
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `health-checks-report-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export CSV')
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  // Simple bar chart renderer
  const renderChart = () => {
    if (!data?.chartData.length) return null

    const maxValue = Math.max(...data.chartData.map(d => d.total))

    return (
      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Health Checks Over Time</h2>
        <div className="h-64 flex items-end gap-1">
          {data.chartData.map((point, index) => {
            const height = maxValue > 0 ? (point.total / maxValue) * 100 : 0
            const authorizedHeight = maxValue > 0 ? (point.authorized / maxValue) * 100 : 0

            return (
              <div
                key={index}
                className="flex-1 flex flex-col items-center group"
                title={`${formatDate(point.period)}: ${point.total} total, ${point.authorized} authorized`}
              >
                <div className="w-full flex flex-col justify-end" style={{ height: '200px' }}>
                  {/* Total bar (gray) */}
                  <div
                    className="w-full bg-gray-200 relative"
                    style={{ height: `${height}%` }}
                  >
                    {/* Authorized portion (green) */}
                    <div
                      className="absolute bottom-0 w-full bg-rag-green"
                      style={{ height: `${authorizedHeight > 0 ? (authorizedHeight / height) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2 transform -rotate-45 origin-left whitespace-nowrap">
                  {formatDate(point.period)}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 mt-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-200"></div>
            <span className="text-gray-600">Total</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-rag-green"></div>
            <span className="text-gray-600">Authorized</span>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Date Range Filter */}
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
            className="px-3 py-2 border border-gray-300 text-sm"
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="3months">Last 90 Days</option>
          </select>

          {/* Group By Filter */}
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
            className="px-3 py-2 border border-gray-300 text-sm"
          >
            <option value="day">Group by Day</option>
            <option value="week">Group by Week</option>
            <option value="month">Group by Month</option>
          </select>

          {/* Export Button */}
          <button
            onClick={handleExportCSV}
            disabled={exporting}
            className="px-4 py-2 bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 p-4 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">Dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-gray-900">{data?.summary.total || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Total Health Checks</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-rag-green">{data?.summary.completed || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Completed</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-3xl font-bold text-primary">{data?.summary.conversionRate || 0}%</div>
          <div className="text-sm text-gray-500 mt-1">Conversion Rate</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-xl font-bold text-rag-green">{formatCurrency(data?.summary.totalValueAuthorized || 0)}</div>
          <div className="text-sm text-gray-500 mt-1">Value Authorized</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-4">
          <div className="text-xl font-bold text-gray-900">{formatCurrency(data?.summary.totalValueIdentified || 0)}</div>
          <div className="text-sm text-gray-500 mt-1">Value Identified</div>
        </div>
      </div>

      {/* Chart */}
      {renderChart()}

      {/* Metrics Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Technician Metrics */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="border-b border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900">Technician Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Technician</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.technicianMetrics.map((tech) => (
                  <tr key={tech.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{tech.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">{tech.total}</td>
                    <td className="px-4 py-3 text-sm text-rag-green text-right font-medium">{tech.completed}</td>
                  </tr>
                ))}
                {(data?.technicianMetrics.length || 0) === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500 text-sm">
                      No technician data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Advisor Metrics */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="border-b border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900">Advisor Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Advisor</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sent</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Conv. %</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data?.advisorMetrics.map((advisor) => (
                  <tr key={advisor.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{advisor.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">{advisor.sent}</td>
                    <td className="px-4 py-3 text-sm text-primary text-right font-medium">{advisor.conversionRate}%</td>
                    <td className="px-4 py-3 text-sm text-rag-green text-right font-medium">
                      {formatCurrency(advisor.totalValue)}
                    </td>
                  </tr>
                ))}
                {(data?.advisorMetrics.length || 0) === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500 text-sm">
                      No advisor data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Brake Disc Measurements */}
      <div className="bg-white border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900">Brake Disc Measurements</h2>
          <p className="text-sm text-gray-500 mt-1">
            Tracking disc measurements not recorded by technicians
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4 p-4 border-b border-gray-200 bg-gray-50">
          <div>
            <div className="text-sm text-gray-500">Total Health Checks</div>
            <div className="text-xl font-bold text-gray-900">{brakeDiscData?.totalHealthChecks || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Not Measured</div>
            <div className="text-xl font-bold text-rag-amber">{brakeDiscData?.notMeasuredCount || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Unable to Access</div>
            <div className="text-xl font-bold text-gray-600">{brakeDiscData?.unableToAccessCount || 0}</div>
          </div>
        </div>

        {/* By technician table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Technician</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Health Checks</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Not Measured</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unable to Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brakeDiscData?.byTechnician.map((tech) => (
                <tr key={tech.technicianId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{tech.technicianName}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-right">{tech.totalHealthChecks}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {tech.notMeasuredCount > 0 ? (
                      <span className="font-medium text-rag-amber">{tech.notMeasuredCount}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">
                    {tech.unableToAccessCount > 0 ? (
                      <span className="font-medium text-gray-600">{tech.unableToAccessCount}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
              {(brakeDiscData?.byTechnician.length || 0) === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500 text-sm">
                    No brake disc measurement data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Breakdown */}
      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Status Breakdown</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-gray-500">Sent to Customer</div>
            <div className="text-2xl font-bold text-gray-900">{data?.summary.sent || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Authorized</div>
            <div className="text-2xl font-bold text-rag-green">{data?.summary.authorized || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Declined</div>
            <div className="text-2xl font-bold text-rag-red">{data?.summary.declined || 0}</div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Pending</div>
            <div className="text-2xl font-bold text-rag-amber">{data?.summary.pending || 0}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
