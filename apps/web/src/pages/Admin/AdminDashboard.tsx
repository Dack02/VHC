import { useState, useEffect } from 'react'
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

  useEffect(() => {
    const fetchData = async () => {
      if (!session?.accessToken) return

      try {
        const [statsData, activityData] = await Promise.all([
          api<PlatformStats>('/api/v1/admin/stats', { token: session.accessToken }),
          api<{ activity: ActivityItem[] }>('/api/v1/admin/activity?limit=10', { token: session.accessToken })
        ])
        setStats(statsData)
        setActivity(activityData.activity || [])
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    )
  }

  const statCards = [
    {
      label: 'Total Organizations',
      value: stats?.organizations?.total || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      color: 'bg-blue-500'
    },
    {
      label: 'Active Organizations',
      value: stats?.organizations?.active || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-green-500'
    },
    {
      label: 'Total Users',
      value: stats?.users?.total || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      color: 'bg-indigo-500'
    },
    {
      label: 'Health Checks This Month',
      value: stats?.healthChecks?.thisMonth || 0,
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      color: 'bg-purple-500'
    }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Platform overview and recent activity</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, index) => (
          <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value.toLocaleString()}</p>
              </div>
              <div className={`${stat.color} p-3 rounded-lg text-white`}>
                {stat.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Summary */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Platform Summary</h2>
            <Link to="/admin/organizations" className="text-sm text-indigo-600 hover:text-indigo-700">
              View organizations →
            </Link>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Active Organizations</span>
              <span className="font-semibold text-green-600">{stats?.organizations?.active || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Pending Organizations</span>
              <span className="font-semibold text-yellow-600">{stats?.organizations?.pending || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Suspended Organizations</span>
              <span className="font-semibold text-red-600">{stats?.organizations?.suspended || 0}</span>
            </div>
            <div className="flex justify-between items-center pt-4 border-t">
              <span className="text-gray-600">Total Sites</span>
              <span className="font-semibold">{stats?.sites?.total || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Active Users</span>
              <span className="font-semibold">{stats?.users?.active || 0}</span>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Recent Activity</h2>
            <Link to="/admin/activity" className="text-sm text-indigo-600 hover:text-indigo-700">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-gray-100">
            {(activity.length > 0 || (stats?.recentActivity?.length || 0) > 0) ? (
              (activity.length > 0 ? activity : stats?.recentActivity || []).map((item) => (
                <div key={item.id} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">{item.superAdmin?.name || 'System'}</span>
                        {' '}{formatAction(item.action)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {item.targetType} • {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      getActionColor(item.action)
                    }`}>
                      {item.action}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center text-gray-500">
                No recent activity
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/admin/organizations?action=create"
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            New Organization
          </Link>
          <Link
            to="/admin/plans"
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Manage Plans
          </Link>
          <Link
            to="/admin/settings"
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Platform Settings
          </Link>
        </div>
      </div>
    </div>
  )
}

function formatAction(action: string): string {
  const actions: Record<string, string> = {
    'org.created': 'created an organization',
    'org.updated': 'updated an organization',
    'org.suspended': 'suspended an organization',
    'org.activated': 'activated an organization',
    'user.created': 'created a user',
    'user.updated': 'updated a user',
    'impersonation.started': 'started impersonating',
    'impersonation.ended': 'ended impersonation'
  }
  return actions[action] || action
}

function getActionColor(action: string): string {
  if (action.includes('created')) return 'bg-green-100 text-green-800'
  if (action.includes('suspended')) return 'bg-red-100 text-red-800'
  if (action.includes('activated')) return 'bg-blue-100 text-blue-800'
  if (action.includes('impersonation')) return 'bg-yellow-100 text-yellow-800'
  return 'bg-gray-100 text-gray-800'
}
