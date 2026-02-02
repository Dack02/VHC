import { useState, useEffect, useRef } from 'react'
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useBranding } from '../contexts/BrandingContext'
import NotificationBell from '../components/NotificationBell'
import AILimitWarningBanner from '../components/AILimitWarningBanner'
import OrgSwitcher from '../components/OrgSwitcher'
import { useUnreadSmsCount } from '../hooks/useUnreadSmsCount'

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
  const { user, logout } = useAuth()
  const { branding } = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

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
  const { count: unreadSmsCount } = useUnreadSmsCount()

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
      to: '/upcoming',
      label: 'Upcoming',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
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
      to: '/messages',
      label: 'Messages',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      badge: unreadSmsCount
    },
    {
      to: '/parts',
      label: 'Parts',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/reports',
      label: 'Reports',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    }
  ]

  // Filter nav items based on user role
  const visibleMainNav = mainNavItems.filter(item => item.roles.includes(userRole))

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
          ? 'bg-primary text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`
    }

    return `${base} px-3 ${
      active
        ? 'bg-primary text-white'
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
              <OrgSwitcher />
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
                  <span className={`relative ${isCollapsed ? '' : 'mr-3'}`}>
                    {item.icon}
                    {isCollapsed && item.badge != null && item.badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-500 rounded-full h-2.5 w-2.5" />
                    )}
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span className={`ml-auto text-xs font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1 ${
                          isActive(item.to)
                            ? 'bg-white/20 text-white'
                            : 'bg-red-500 text-white'
                        }`}>
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              </NavTooltip>
            ))}
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
