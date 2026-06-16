import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface PlatformStats {
  organizations: {
    total: number
    active: number
    pending: number
    suspended: number
    cancelled: number
  }
  users: {
    total: number
    active: number
  }
  sites: {
    total: number
  }
  healthChecks: {
    total: number
    thisMonth: number
  }
  communications: {
    smsThisMonth: number
    emailsThisMonth: number
  }
  revenue: {
    mrr: number
    currency: string
  }
  recentActivity: Array<{
    id: string
    action: string
    targetType: string
    targetId: string
    details: Record<string, unknown>
    createdAt: string
    superAdmin: { name: string; email: string } | null
  }>
}

interface ActivityItem {
  id: string
  action: string
  targetType: string
  targetId: string
  details: Record<string, unknown>
  ipAddress: string
  userAgent: string
  createdAt: string
  superAdmin: { id: string; name: string; email: string } | null
}

export default function AdminDashboard() {
  const { session } = useSuperAdmin()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!session?.accessToken) return
      if (mode === 'refresh') setRefreshing(true)
      setError(null)

      try {
        const [statsData, activityData] = await Promise.all([
          api<PlatformStats>('/api/v1/admin/stats', { token: session.accessToken }),
          api<{ activity: ActivityItem[] }>('/api/v1/admin/activity?limit=8', { token: session.accessToken })
        ])
        setStats(statsData)
        setActivity(activityData.activity || [])
        setLastUpdated(new Date())
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err)
        setError('Could not load platform data.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [session?.accessToken]
  )

  useEffect(() => {
    fetchData('initial')
  }, [fetchData])

  const currency = stats?.revenue?.currency || 'GBP'
  const money = (n: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(n))

  const org = stats?.organizations
  const orgTotal = org?.total || 0
  const activityList = activity.length > 0 ? activity : stats?.recentActivity ?? []

  const kpis: Array<{ label: string; value: ReactNode; sub?: string; icon: ReactNode; accent?: boolean; to?: string }> = [
    {
      label: 'Monthly recurring revenue',
      value: money(stats?.revenue?.mrr || 0),
      sub: `${money((stats?.revenue?.mrr || 0) * 12)} annualised`,
      accent: true,
      to: '/admin/plans',
      icon: icon('M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 18.75z')
    },
    {
      label: 'Active organisations',
      value: (stats?.organizations?.active || 0).toLocaleString(),
      sub: `of ${orgTotal.toLocaleString()} total${org?.pending ? ` · ${org.pending} pending` : ''}`,
      to: '/admin/organizations',
      icon: icon('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4')
    },
    {
      label: 'Platform users',
      value: (stats?.users?.total || 0).toLocaleString(),
      sub: `${(stats?.users?.active || 0).toLocaleString()} active`,
      icon: icon('M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z')
    },
    {
      label: 'Health checks this month',
      value: (stats?.healthChecks?.thisMonth || 0).toLocaleString(),
      sub: `${(stats?.healthChecks?.total || 0).toLocaleString()} all-time`,
      to: '/admin/usage',
      icon: icon('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4')
    }
  ]

  const orgBreakdown = [
    { label: 'Active', value: org?.active || 0, dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
    { label: 'Pending', value: org?.pending || 0, dot: 'bg-amber-500', bar: 'bg-amber-500' },
    { label: 'Suspended', value: org?.suspended || 0, dot: 'bg-rose-500', bar: 'bg-rose-500' },
    { label: 'Cancelled', value: org?.cancelled || 0, dot: 'bg-gray-400', bar: 'bg-gray-400' }
  ]

  if (loading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Platform overview</h1>
          <p className="mt-1 text-sm text-gray-500">A snapshot of activity across all organisations.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="hidden text-xs text-gray-400 sm:inline">
              Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => fetchData('refresh')}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M3.985 14.652H-.007m4.008 0a8.25 8.25 0 0014.43 2.418m1.58-7.07a8.25 8.25 0 00-14.43-2.418L3.985 9.348" />
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => fetchData('refresh')} className="font-medium text-rose-800 underline-offset-2 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-gray-500">{kpi.label}</p>
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    kpi.accent ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {kpi.icon}
                </span>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight text-gray-900">{kpi.value}</p>
              {kpi.sub && <p className="mt-1 text-xs text-gray-400">{kpi.sub}</p>}
            </>
          )
          return kpi.to ? (
            <Link
              key={i}
              to={kpi.to}
              className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-200 hover:shadow"
            >
              {body}
            </Link>
          ) : (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              {body}
            </div>
          )
        })}
      </div>

      {/* Main grid: left column (org status + comms), right column (activity) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-1">
          {/* Organisation status */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="font-semibold text-gray-900">Organisations</h2>
              <Link to="/admin/organizations" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                View all
              </Link>
            </div>
            <div className="px-5 py-5">
              {/* Proportion bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
                {orgBreakdown.map(
                  (s) =>
                    s.value > 0 && (
                      <div
                        key={s.label}
                        className={s.bar}
                        style={{ width: `${orgTotal ? (s.value / orgTotal) * 100 : 0}%` }}
                        title={`${s.label}: ${s.value}`}
                      />
                    )
                )}
              </div>
              {/* Legend */}
              <div className="mt-4 space-y-2.5">
                {orgBreakdown.map((s) => (
                  <div key={s.label} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-gray-600">
                      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                      {s.label}
                    </span>
                    <span className="font-semibold text-gray-900">{s.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              {/* Footer figures */}
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4">
                <div>
                  <p className="text-xs text-gray-400">Active sites</p>
                  <p className="mt-0.5 text-lg font-semibold text-gray-900">{(stats?.sites?.total || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Active users</p>
                  <p className="mt-0.5 text-lg font-semibold text-gray-900">{(stats?.users?.active || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Communications this month */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="font-semibold text-gray-900">Communications</h2>
              <Link to="/admin/usage" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                Usage
              </Link>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 text-gray-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="text-xs font-medium">SMS</span>
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
                  {(stats?.communications?.smsThisMonth || 0).toLocaleString()}
                </p>
                <p className="text-xs text-gray-400">this month</p>
              </div>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 text-gray-500">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs font-medium">Email</span>
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
                  {(stats?.communications?.emailsThisMonth || 0).toLocaleString()}
                </p>
                <p className="text-xs text-gray-400">this month</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: recent activity */}
        <div className="lg:col-span-2">
          <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="font-semibold text-gray-900">Recent activity</h2>
              <Link to="/admin/activity" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                View all
              </Link>
            </div>
            {activityList.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {activityList.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
                      {(item.superAdmin?.name || 'System').charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{item.superAdmin?.name || 'System'}</span>{' '}
                        <span className="text-gray-600">{formatAction(item.action)}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {item.targetType} · {timeAgo(item.createdAt)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${getActionColor(item.action)}`}>
                      {item.action}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                <svg className="h-10 w-10 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-3 text-sm text-gray-500">No recent activity</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-semibold text-gray-900">Quick actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            to="/admin/organizations?action=create"
            label="New organisation"
            desc="Onboard a dealership"
            primary
            icon="M12 6v6m0 0v6m0-6h6m-6 0H6"
          />
          <QuickAction
            to="/admin/plans"
            label="Manage plans"
            desc="Pricing & limits"
            icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          />
          <QuickAction
            to="/admin/usage"
            label="View usage"
            desc="Volumes & limits"
            icon="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
          <QuickAction
            to="/admin/settings"
            label="Platform settings"
            desc="Configure the platform"
            icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
        </div>
      </div>
    </div>
  )
}

// Inline 20px outline icon used in the KPI chips.
function icon(d: string) {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

function QuickAction({
  to,
  label,
  desc,
  icon: iconPath,
  primary
}: {
  to: string
  label: string
  desc: string
  icon: string
  primary?: boolean
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:border-indigo-200 hover:bg-gray-50"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          primary ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'
        }`}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block truncate text-xs text-gray-400">{desc}</span>
      </span>
    </Link>
  )
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded-lg bg-gray-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[116px] rounded-xl border border-gray-200 bg-white p-5">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="mt-4 h-8 w-20 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-72 rounded-xl border border-gray-200 bg-white lg:col-span-1" />
        <div className="h-72 rounded-xl border border-gray-200 bg-white lg:col-span-2" />
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatAction(action: string): string {
  const actions: Record<string, string> = {
    'org.created': 'created an organisation',
    'org.updated': 'updated an organisation',
    'org.suspended': 'suspended an organisation',
    'org.activated': 'activated an organisation',
    'user.created': 'created a user',
    'user.updated': 'updated a user',
    'impersonation.started': 'started impersonating',
    'impersonation.ended': 'ended impersonation',
    'view_platform_stats': 'viewed platform stats',
    'start_impersonation': 'started impersonating',
    'end_impersonation': 'ended impersonation',
    'update_plan': 'updated a plan',
    'export_admin_activity': 'exported the activity log'
  }
  return actions[action] || action.replace(/[._]/g, ' ')
}

function getActionColor(action: string): string {
  if (action.includes('created')) return 'bg-emerald-100 text-emerald-700'
  if (action.includes('suspended')) return 'bg-rose-100 text-rose-700'
  if (action.includes('activated')) return 'bg-blue-100 text-blue-700'
  if (action.includes('impersonat')) return 'bg-amber-100 text-amber-700'
  if (action.includes('update') || action.includes('updated')) return 'bg-indigo-100 text-indigo-700'
  return 'bg-gray-100 text-gray-600'
}
