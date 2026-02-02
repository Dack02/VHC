import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useReportFilters } from './hooks/useReportFilters'
import { useReportData } from './hooks/useReportData'
import DataTable, { Column } from './components/DataTable'
import ReportFiltersBar from './components/ReportFiltersBar'
import { formatPercent } from './utils/formatters'

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

interface MriBypassAdvisorStat {
  id: string
  name: string
  totalCheckins: number
  bypassed: number
  bypassRate: number
  avgCompletionRate: number
}

interface MriBypassData {
  period: { from: string; to: string }
  summary: {
    totalCheckins: number
    completedMri: number
    bypassedCheckins: number
    bypassRate: number
  }
  byAdvisor: MriBypassAdvisorStat[]
  recentBypassed: Array<{
    healthCheckId: string
    vehicleReg: string
    advisorName: string
    siteName: string
    checkedInAt: string
    mriItemsTotal: number
    mriItemsCompleted: number
    completionRate: number
  }>
}

interface AuditEntry {
  id: string
  healthCheckId: string
  vehicleReg: string
  fromStatus: string | null
  toStatus: string
  notes: string | null
  userName: string
  timestamp: string
}

interface AuditData {
  period: { from: string; to: string }
  entries: AuditEntry[]
}

export default function QualityCompliance() {
  const { session } = useAuth()
  const token = session?.accessToken
  const {
    filters, queryString,
    setDatePreset, setGroupBy, setSiteId,
  } = useReportFilters()

  const [brakeDiscData, setBrakeDiscData] = useState<BrakeDiscData | null>(null)
  const [mriBypassData, setMriBypassData] = useState<MriBypassData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: auditData } = useReportData<AuditData>({
    endpoint: '/api/v1/reports/compliance/audit-trail',
    queryString,
  })

  const fetchComplianceData = useCallback(async () => {
    if (!token) return

    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.set('startDate', filters.dateFrom)
      params.set('endDate', filters.dateTo)
      if (filters.siteId) params.set('siteId', filters.siteId)

      const [brakeData, mriData] = await Promise.all([
        api<BrakeDiscData>(`/api/v1/reports/brake-disc-access?${params}`, { token }),
        api<MriBypassData>(`/api/v1/reports/mri-bypass?${params}`, { token }),
      ])

      setBrakeDiscData(brakeData)
      setMriBypassData(mriData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance data')
    } finally {
      setLoading(false)
    }
  }, [token, filters.dateFrom, filters.dateTo, filters.siteId])

  useEffect(() => {
    fetchComplianceData()
  }, [fetchComplianceData])

  const brakeColumns: Column<BrakeDiscTechnicianStat>[] = [
    { key: 'name', label: 'Technician', render: r => <span className="font-medium text-gray-900">{r.technicianName}</span> },
    { key: 'checks', label: 'Health Checks', render: r => r.totalHealthChecks, align: 'right', sortable: true, sortValue: r => r.totalHealthChecks },
    { key: 'notMeasured', label: 'Not Measured', render: r => (
      r.notMeasuredCount > 0
        ? <span className="font-medium text-amber-600">{r.notMeasuredCount}</span>
        : <span className="text-gray-400">0</span>
    ), align: 'right', sortable: true, sortValue: r => r.notMeasuredCount },
    { key: 'unable', label: 'Unable to Access', render: r => (
      r.unableToAccessCount > 0
        ? <span className="font-medium text-gray-600">{r.unableToAccessCount}</span>
        : <span className="text-gray-400">0</span>
    ), align: 'right', sortable: true, sortValue: r => r.unableToAccessCount },
  ]

  const mriColumns: Column<MriBypassAdvisorStat>[] = [
    { key: 'name', label: 'Advisor', render: r => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'checkins', label: 'Check-Ins', render: r => r.totalCheckins, align: 'right', sortable: true, sortValue: r => r.totalCheckins },
    { key: 'bypassed', label: 'Bypassed', render: r => (
      r.bypassed > 0
        ? <span className="font-medium text-amber-600">{r.bypassed}</span>
        : <span className="text-green-600">0</span>
    ), align: 'right', sortable: true, sortValue: r => r.bypassed },
    { key: 'rate', label: 'Bypass Rate', render: r => (
      <span className={r.bypassRate > 0 ? 'text-amber-600' : 'text-green-600'}>
        {formatPercent(r.bypassRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.bypassRate },
    { key: 'completion', label: 'Avg Completion', render: r => (
      <span className={r.avgCompletionRate >= 80 ? 'text-green-600' : r.avgCompletionRate >= 50 ? 'text-amber-600' : 'text-red-600'}>
        {formatPercent(r.avgCompletionRate)}
      </span>
    ), align: 'right', sortable: true, sortValue: r => r.avgCompletionRate },
  ]

  const auditColumns: Column<AuditEntry>[] = [
    { key: 'vehicle', label: 'Vehicle', render: r => (
      <Link to={`/health-checks/${r.healthCheckId}`} className="font-mono text-primary hover:underline">
        {r.vehicleReg}
      </Link>
    ) },
    { key: 'change', label: 'Status Change', render: r => (
      <span className="text-sm">
        {r.fromStatus && <span className="text-gray-400">{r.fromStatus}</span>}
        {r.fromStatus && <span className="mx-1 text-gray-300">&rarr;</span>}
        <span className="font-medium text-gray-700">{r.toStatus}</span>
      </span>
    ) },
    { key: 'user', label: 'By', render: r => r.userName },
    { key: 'notes', label: 'Notes', render: r => <span className="text-gray-500 text-xs">{r.notes || '-'}</span> },
    { key: 'time', label: 'When', render: r => new Date(r.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), align: 'right' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/reports" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quality & Compliance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Brake disc, MRI scan compliance, audit trail</p>
        </div>
      </div>

      <ReportFiltersBar
        datePreset={filters.datePreset}
        groupBy={filters.groupBy}
        siteId={filters.siteId}
        onDatePresetChange={setDatePreset}
        onGroupByChange={setGroupBy}
        onSiteChange={setSiteId}
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {loading && !brakeDiscData ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <>
          {/* Brake Disc Measurements */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">Brake Disc Measurements</h2>
              <p className="text-sm text-gray-500 mt-0.5">Tracking disc measurements not recorded by technicians</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <div className="text-sm text-gray-500">Total Health Checks</div>
                <div className="text-xl font-bold text-gray-900">{brakeDiscData?.totalHealthChecks || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Not Measured</div>
                <div className="text-xl font-bold text-amber-600">{brakeDiscData?.notMeasuredCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Unable to Access</div>
                <div className="text-xl font-bold text-gray-600">{brakeDiscData?.unableToAccessCount || 0}</div>
              </div>
            </div>

            <DataTable
              columns={brakeColumns}
              data={brakeDiscData?.byTechnician || []}
              rowKey={r => r.technicianId}
              pageSize={15}
              emptyMessage="No brake disc measurement data available"
            />
          </div>

          {/* MRI Scan Compliance */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="border-b border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900">MRI Scan Compliance</h2>
              <p className="text-sm text-gray-500 mt-0.5">Tracking when advisors complete check-in without fully completing MRI scan</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <div className="text-sm text-gray-500">Total Check-Ins</div>
                <div className="text-xl font-bold text-gray-900">{mriBypassData?.summary.totalCheckins || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">MRI Completed</div>
                <div className="text-xl font-bold text-green-600">{mriBypassData?.summary.completedMri || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">MRI Bypassed</div>
                <div className="text-xl font-bold text-amber-600">{mriBypassData?.summary.bypassedCheckins || 0}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Bypass Rate</div>
                <div className="text-xl font-bold text-amber-600">{mriBypassData?.summary.bypassRate || 0}%</div>
              </div>
            </div>

            <DataTable
              columns={mriColumns}
              data={mriBypassData?.byAdvisor || []}
              rowKey={r => r.id}
              pageSize={15}
              emptyMessage="No MRI check-in data available"
            />

            {/* Recent bypassed instances */}
            {(mriBypassData?.recentBypassed.length || 0) > 0 && (
              <div className="border-t border-gray-200">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700">Recent Bypassed Check-Ins</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {mriBypassData?.recentBypassed.slice(0, 5).map((item) => (
                    <div key={item.healthCheckId} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-medium text-gray-900">{item.vehicleReg}</span>
                        <span className="mx-2 text-gray-400">|</span>
                        <span className="text-sm text-gray-600">{item.advisorName}</span>
                        <span className="mx-2 text-gray-400">|</span>
                        <span className="text-sm text-gray-500">{item.siteName}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm text-amber-600 font-medium">
                          {item.mriItemsCompleted}/{item.mriItemsTotal} items ({item.completionRate}%)
                        </span>
                        <div className="text-xs text-gray-400">
                          {new Date(item.checkedInAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Audit Trail */}
          {(auditData?.entries.length || 0) > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
              <div className="border-b border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Audit Trail</h2>
                <p className="text-sm text-gray-500 mt-0.5">Recent status changes and significant actions</p>
              </div>
              <DataTable
                columns={auditColumns}
                data={auditData?.entries || []}
                rowKey={r => r.id}
                pageSize={20}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
