import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

type UserRole = 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'

interface SettingsCard {
  to: string
  title: string
  description: string
  icon: React.ReactNode
  roles: UserRole[]
  badge?: number
  condition?: boolean
}

export default function SettingsHub() {
  const { user, session } = useAuth()
  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState(0)
  const [isAiEnabled, setIsAiEnabled] = useState(false)

  const userRole = (user?.role || 'technician') as UserRole
  const isOrgAdmin = user?.isOrgAdmin || user?.role === 'org_admin'
  const isSiteAdmin = user?.isSiteAdmin || user?.role === 'site_admin'
  const orgId = user?.organization?.id

  useEffect(() => {
    const fetchPendingCount = async () => {
      if (!orgId || !session?.accessToken) return
      if (!isOrgAdmin && !isSiteAdmin) return

      try {
        const data = await api<{ count: number }>(
          `/api/v1/organizations/${orgId}/reason-submissions/count?status=pending`,
          { token: session.accessToken }
        )
        setPendingSubmissionsCount(data.count)
      } catch {
        // Silently fail
      }
    }

    fetchPendingCount()
    const interval = setInterval(fetchPendingCount, 60000)
    return () => clearInterval(interval)
  }, [orgId, session?.accessToken, isOrgAdmin, isSiteAdmin])

  useEffect(() => {
    const fetchAiStatus = async () => {
      if (!orgId || !session?.accessToken || (!isOrgAdmin && !isSiteAdmin)) return

      try {
        const data = await api<{ aiEnabled: boolean }>(
          `/api/v1/organizations/${orgId}/ai-usage/can-generate`,
          { token: session.accessToken }
        )
        setIsAiEnabled(data.aiEnabled !== false)
      } catch {
        setIsAiEnabled(false)
      }
    }

    fetchAiStatus()
  }, [orgId, session?.accessToken, isOrgAdmin, isSiteAdmin])

  const generalCards: SettingsCard[] = [
    {
      to: '/settings/organization',
      title: 'Organisation',
      description: 'Branding, business details, and preferences',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/sites',
      title: 'Sites',
      description: 'Manage branches and locations',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/subscription',
      title: 'Subscription',
      description: 'View your current plan and usage',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/workflow',
      title: 'Workflow',
      description: 'Check-in procedures and MRI scan settings',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/labour-codes',
      title: 'Labour Codes',
      description: 'Manage labour code definitions',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/suppliers',
      title: 'Suppliers',
      description: 'Manage parts suppliers',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/supplier-types',
      title: 'Supplier Types',
      description: 'Manage supplier type categories',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/pricing',
      title: 'Pricing',
      description: 'Configure pricing rules and margins',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/vehicle-locations',
      title: 'Vehicle Locations',
      description: 'Manage location labels for inspection items',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/thresholds',
      title: 'Inspection Thresholds',
      description: 'Set tyre and brake pad thresholds',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/tyre-manufacturers',
      title: 'Tyre Manufacturers',
      description: 'Manage tyre manufacturer options',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/tyre-sizes',
      title: 'Tyre Sizes',
      description: 'Manage tyre size options',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/mri-items',
      title: 'MRI Items',
      description: 'Manage MRI inspection items',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/reasons',
      title: 'Reason Library',
      description: 'Manage reason templates for repairs',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/reason-types',
      title: 'Reason Types',
      description: 'Configure reason type categories',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/reason-submissions',
      title: 'Reason Submissions',
      description: 'Review pending reason submissions',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin'],
      badge: pendingSubmissionsCount
    },
    {
      to: '/settings/reason-analytics',
      title: 'Reason Analytics',
      description: 'View reason usage statistics',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/declined-reasons',
      title: 'Declined Reasons',
      description: 'Manage customer decline reasons',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/deleted-reasons',
      title: 'Repair Line Deletion Reasons',
      description: 'Manage repair line deletion reasons',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/vhc-deletion-reasons',
      title: 'VHC Deletion Reasons',
      description: 'Manage health check deletion reasons',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    }
  ]

  const systemCards: SettingsCard[] = [
    {
      to: '/settings/integrations',
      title: 'DMS Integration',
      description: 'Configure dealer management system connection',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/notifications',
      title: 'Notifications',
      description: 'Configure notification preferences',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/message-templates',
      title: 'Message Templates',
      description: 'Manage email and SMS templates',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/ai-usage',
      title: 'AI Usage',
      description: 'Monitor AI generation usage and limits',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin'],
      condition: isAiEnabled
    }
  ]

  const visibleGeneral = generalCards.filter(card =>
    card.roles.includes(userRole) && (card.condition === undefined || card.condition)
  )
  const visibleSystem = systemCards.filter(card =>
    card.roles.includes(userRole) && (card.condition === undefined || card.condition)
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your organisation configuration and preferences.</p>
      </div>

      {visibleGeneral.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">General Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleGeneral.map(card => (
              <Link
                key={card.to}
                to={card.to}
                className="relative block bg-white border border-gray-200 rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
              >
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0 text-gray-400">{card.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{card.description}</p>
                  </div>
                  {card.badge !== undefined && card.badge > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                      {card.badge}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {visibleSystem.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">System Settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleSystem.map(card => (
              <Link
                key={card.to}
                to={card.to}
                className="block bg-white border border-gray-200 rounded-xl p-5 hover:border-primary hover:shadow-sm transition-all"
              >
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0 text-gray-400">{card.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900">{card.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{card.description}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
