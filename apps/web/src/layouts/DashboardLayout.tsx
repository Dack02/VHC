import { useState, useEffect, useRef } from 'react'
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useBranding } from '../contexts/BrandingContext'
import NotificationBell from '../components/NotificationBell'
import AILimitWarningBanner from '../components/AILimitWarningBanner'
import { api } from '../lib/api'

type UserRole = 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  roles: UserRole[]
  badge?: number
}

const NAV_COLLAPSED_KEY = 'vhc-nav-collapsed'

export default function DashboardLayout() {
  const { user, logout, session } = useAuth()
  const { branding } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState(0)
  const [isAiEnabled, setIsAiEnabled] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === 'true'
    }
    return false
  })
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showScrollFade, setShowScrollFade] = useState(false)

  // Handle nav scroll fade indicator
  useEffect(() => {
    const navEl = navRef.current
    if (!navEl) return

    const checkScroll = () => {
      const hasMoreContent = navEl.scrollHeight > navEl.clientHeight + navEl.scrollTop + 20
      setShowScrollFade(hasMoreContent)
    }

    checkScroll()
    navEl.addEventListener('scroll', checkScroll)
    window.addEventListener('resize', checkScroll)

    return () => {
      navEl.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [])

  // Toggle collapsed state and persist to localStorage
  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem(NAV_COLLAPSED_KEY, String(newValue))
      return newValue
    })
  }

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const userRole = (user?.role || 'technician') as UserRole
  const isOrgAdmin = user?.isOrgAdmin || user?.role === 'org_admin'
  const isSiteAdmin = user?.isSiteAdmin || user?.role === 'site_admin'
  const orgId = user?.organization?.id

  // Fetch pending submissions count for the badge
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
      } catch (err) {
        // Silently fail
      }
    }

    fetchPendingCount()
    // Refresh every 60 seconds
    const interval = setInterval(fetchPendingCount, 60000)
    return () => clearInterval(interval)
  }, [orgId, session?.accessToken, isOrgAdmin, isSiteAdmin])

  // Fetch AI enabled status for the organization
  useEffect(() => {
    const fetchAiStatus = async () => {
      if (!orgId || !session?.accessToken || !isOrgAdmin) return

      try {
        const data = await api<{ aiEnabled: boolean }>(
          `/api/v1/organizations/${orgId}/ai-usage/can-generate`,
          { token: session.accessToken }
        )
        setIsAiEnabled(data.aiEnabled !== false)
      } catch (err) {
        // Silently fail - assume AI is not enabled
        setIsAiEnabled(false)
      }
    }

    fetchAiStatus()
  }, [orgId, session?.accessToken, isOrgAdmin])

  // Define navigation items with role-based access
  const mainNavItems: NavItem[] = [
    {
      to: '/',
      label: 'Dashboard',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']
    },
    {
      to: '/health-checks',
      label: 'Health Checks',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']
    },
    {
      to: '/customers',
      label: 'Customers',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/templates',
      label: 'Templates',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/users',
      label: 'Users',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    }
  ]

  const settingsNavItems: NavItem[] = [
    {
      to: '/settings/workflow',
      label: 'Workflow',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin']
    },
    {
      to: '/settings/labour-codes',
      label: 'Labour Codes',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/suppliers',
      label: 'Suppliers',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/supplier-types',
      label: 'Supplier Types',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/pricing',
      label: 'Pricing',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/admin/tyre-manufacturers',
      label: 'Tyre Manufacturers',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/admin/tyre-sizes',
      label: 'Tyre Sizes',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/thresholds',
      label: 'Inspection Thresholds',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/integrations',
      label: 'DMS Integration',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin']
    },
    {
      to: '/settings/notifications',
      label: 'Notifications',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin']
    },
    {
      to: '/settings/reasons',
      label: 'Reason Library',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/reason-types',
      label: 'Reason Types',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/declined-reasons',
      label: 'Declined Reasons',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    },
    {
      to: '/settings/deleted-reasons',
      label: 'Deleted Reasons',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    }
  ]

  // Filter nav items based on user role
  const visibleMainNav = mainNavItems.filter(item => item.roles.includes(userRole))
  const visibleSettingsNav = settingsNavItems.filter(item => item.roles.includes(userRole))

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  const navLinkClass = (path: string) => {
    const active = isActive(path)
    const base = 'flex items-center py-2 text-sm font-medium rounded-lg transition-all duration-150'

    if (isCollapsed) {
      return `${base} justify-center px-2 ${
        active
          ? 'bg-blue-50 text-primary border-l-4 border-primary'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border-l-4 border-transparent'
      }`
    }

    return `${base} px-3 ${
      active
        ? 'bg-blue-50 text-primary border-l-4 border-primary -ml-1 pl-4'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`
  }

  // Tooltip component for collapsed nav
  const NavTooltip = ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div className="group relative">
      {children}
      {isCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50">
          {label}
        </div>
      )}
    </div>
  )

  // Sidebar width classes
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-64'
  const mainMargin = isCollapsed ? 'md:ml-16' : 'md:ml-64'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile hamburger button */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="fixed top-4 left-4 z-30 p-2 bg-white rounded-lg shadow-md md:hidden"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-white border-r border-gray-200 shadow-sm
          flex flex-col z-50 transition-all duration-200 ease-in-out
          ${sidebarWidth}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Logo/Header area */}
        <div className={`p-4 border-b border-gray-100 ${isCollapsed ? 'flex justify-center' : ''}`}>
          {isCollapsed ? (
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {(branding?.organizationName || user?.organization?.name || 'V').charAt(0)}
              </span>
            </div>
          ) : (
            <>
              {branding?.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={branding.organizationName}
                  className="h-8 w-auto max-w-full object-contain"
                />
              ) : (
                <h1 className="text-xl font-bold text-primary">
                  {branding?.organizationName || user?.organization?.name || 'VHC'}
                </h1>
              )}
              <p className="text-xs text-gray-400 mt-1 truncate">{user?.organization?.name}</p>
            </>
          )}
        </div>

        {/* Mobile close button */}
        <button
          onClick={() => setIsMobileMenuOpen(false)}
          className="absolute top-4 right-4 p-1 rounded hover:bg-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Navigation with scroll fade */}
        <div className="relative flex-1 overflow-hidden">
          <nav ref={navRef} className={`h-full overflow-y-auto ${isCollapsed ? 'p-2' : 'p-4'} space-y-1`}>
            {/* Main Navigation */}
            {visibleMainNav.map(item => (
              <NavTooltip key={item.to} label={item.label}>
                <Link to={item.to} className={navLinkClass(item.to)}>
                  <span className={isCollapsed ? '' : 'mr-3'}>{item.icon}</span>
                  {!isCollapsed && item.label}
                </Link>
              </NavTooltip>
            ))}

            {/* Settings Section - Only for admins */}
            {visibleSettingsNav.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                {!isCollapsed && (
                  <p className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Settings
                  </p>
                )}
                {visibleSettingsNav.map(item => (
                  <NavTooltip key={item.to} label={item.label}>
                    <Link to={item.to} className={navLinkClass(item.to)}>
                      <span className={isCollapsed ? '' : 'mr-3'}>{item.icon}</span>
                      {!isCollapsed && item.label}
                    </Link>
                  </NavTooltip>
                ))}
                {/* Reason Submissions with badge */}
                {(isOrgAdmin || isSiteAdmin) && (
                  <>
                    <NavTooltip label="Reason Submissions">
                      <Link to="/settings/reason-submissions" className={navLinkClass('/settings/reason-submissions')}>
                        <span className={isCollapsed ? '' : 'mr-3'}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </span>
                        {!isCollapsed && <span className="flex-1">Reason Submissions</span>}
                        {pendingSubmissionsCount > 0 && (
                          <span className={`px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full ${isCollapsed ? 'absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center' : 'ml-2'}`}>
                            {pendingSubmissionsCount}
                          </span>
                        )}
                      </Link>
                    </NavTooltip>
                    <NavTooltip label="Reason Analytics">
                      <Link to="/settings/reason-analytics" className={navLinkClass('/settings/reason-analytics')}>
                        <span className={isCollapsed ? '' : 'mr-3'}>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </span>
                        {!isCollapsed && 'Reason Analytics'}
                      </Link>
                    </NavTooltip>
                  </>
                )}
              </div>
            )}

            {/* Org Admin specific links */}
            {isOrgAdmin && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                {!isCollapsed && (
                  <p className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Organization
                  </p>
                )}
                <NavTooltip label="Organization Settings">
                  <Link to="/settings/organization" className={navLinkClass('/settings/organization')}>
                    <span className={isCollapsed ? '' : 'mr-3'}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </span>
                    {!isCollapsed && 'Organization Settings'}
                  </Link>
                </NavTooltip>
                <NavTooltip label="Subscription">
                  <Link to="/settings/subscription" className={navLinkClass('/settings/subscription')}>
                    <span className={isCollapsed ? '' : 'mr-3'}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </span>
                    {!isCollapsed && 'Subscription'}
                  </Link>
                </NavTooltip>
                {isAiEnabled && (
                  <NavTooltip label="AI Usage">
                    <Link to="/settings/ai-usage" className={navLinkClass('/settings/ai-usage')}>
                      <span className={isCollapsed ? '' : 'mr-3'}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </span>
                      {!isCollapsed && 'AI Usage'}
                    </Link>
                  </NavTooltip>
                )}
              </div>
            )}
          </nav>

          {/* Scroll fade indicator */}
          {showScrollFade && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
          )}
        </div>

        {/* User Section */}
        <div className={`border-t border-gray-100 ${isCollapsed ? 'p-2' : 'p-4'}`}>
          {isCollapsed ? (
            <NavTooltip label={`${user?.firstName} ${user?.lastName}`}>
              <div className="flex justify-center mb-2">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {user?.firstName?.charAt(0) || 'U'}
                  </span>
                </div>
              </div>
            </NavTooltip>
          ) : (
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-medium">
                  {user?.firstName?.charAt(0) || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-xs text-gray-400 capitalize">
                  {user?.role?.replace('_', ' ')}
                </div>
              </div>
            </div>
          )}
          <NavTooltip label="Sign out">
            <button
              onClick={handleLogout}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center' : ''} px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded-lg transition-all duration-150`}
            >
              <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!isCollapsed && 'Sign out'}
            </button>
          </NavTooltip>
        </div>

        {/* Collapse toggle button */}
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex items-center justify-center p-2 border-t border-gray-100 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all duration-150"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </aside>

      {/* Main content */}
      <main className={`min-h-screen flex flex-col transition-all duration-200 ${mainMargin}`}>
        {/* AI Limit Warning Banner */}
        <AILimitWarningBanner />

        <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {/* Spacer for mobile hamburger button */}
              <div className="w-10 md:hidden" />
              {user?.site && (
                <span className="text-sm text-gray-500">{user.site.name}</span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {/* Role badge */}
              {isOrgAdmin && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  Org Admin
                </span>
              )}
              {isSiteAdmin && !isOrgAdmin && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  Site Admin
                </span>
              )}
              {/* Notification bell */}
              <NotificationBell />
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
