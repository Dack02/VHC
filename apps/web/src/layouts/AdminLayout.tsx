import { useState, useEffect, useRef } from 'react'
import { Link, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useSuperAdmin } from '../contexts/SuperAdminContext'
import { api } from '../lib/api'

const ADMIN_NAV_COLLAPSED_KEY = 'vhc-admin-nav-collapsed'

export default function AdminLayout() {
  const { superAdmin, session, logout, loading, isSuperAdmin } = useSuperAdmin()
  const navigate = useNavigate()
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

  const [alertCount, setAlertCount] = useState(0)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(ADMIN_NAV_COLLAPSED_KEY) === 'true'
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
      localStorage.setItem(ADMIN_NAV_COLLAPSED_KEY, String(newValue))
      return newValue
    })
  }

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  // Fetch unacknowledged alert count
  useEffect(() => {
    const fetchAlertCount = async () => {
      if (!session?.accessToken) return
      try {
        const data = await api<{ count: number }>('/api/v1/admin/ai-usage/alerts/count', {
          token: session.accessToken
        })
        setAlertCount(data.count || 0)
      } catch (err) {
        // Silently fail
      }
    }

    fetchAlertCount()
    // Refresh every 60 seconds
    const interval = setInterval(fetchAlertCount, 60000)
    return () => clearInterval(interval)
  }, [session?.accessToken])

  const handleLogout = async () => {
    await logout()
    navigate('/admin/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  if (!isSuperAdmin) {
    return <Navigate to="/admin/login" replace />
  }

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin'
    }
    return location.pathname.startsWith(path)
  }

  const navLinkClass = (path: string) => {
    const active = isActive(path)
    const base = 'flex items-center py-2.5 text-sm font-medium rounded-lg transition-all duration-150'

    if (isCollapsed) {
      return `${base} justify-center px-2 ${
        active
          ? 'bg-indigo-600 text-white border-l-4 border-indigo-400'
          : 'text-gray-300 hover:bg-gray-800 hover:text-white border-l-4 border-transparent'
      }`
    }

    return `${base} px-4 ${
      active
        ? 'bg-indigo-600 text-white border-l-4 border-indigo-400 -ml-1 pl-5'
        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
    }`
  }

  // Tooltip component for collapsed nav
  const NavTooltip = ({ children, label }: { children: React.ReactNode; label: string }) => (
    <div className="group relative">
      {children}
      {isCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-700 text-white text-sm rounded opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50">
          {label}
        </div>
      )}
    </div>
  )

  // Sidebar width classes
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-64'
  const mainMargin = isCollapsed ? 'md:ml-16' : 'md:ml-64'

  return (
    <div className="min-h-screen bg-gray-100">
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
        className="fixed top-4 left-4 z-30 p-2 bg-gray-800 rounded-lg shadow-md md:hidden"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-gray-900 shadow-lg
          flex flex-col z-50 transition-all duration-200 ease-in-out
          ${sidebarWidth}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Logo/Header area */}
        <div className={`p-4 border-b border-gray-800 ${isCollapsed ? 'flex justify-center' : ''}`}>
          {isCollapsed ? (
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">VHC Admin</h1>
                <p className="text-xs text-gray-500">Super Admin Portal</p>
              </div>
            </div>
          )}
        </div>

        {/* Mobile close button */}
        <button
          onClick={() => setIsMobileMenuOpen(false)}
          className="absolute top-4 right-4 p-1 rounded hover:bg-gray-800 md:hidden"
          aria-label="Close menu"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Navigation with scroll fade */}
        <div className="relative flex-1 overflow-hidden">
          <nav ref={navRef} className={`h-full overflow-y-auto ${isCollapsed ? 'p-2' : 'p-4'} space-y-1`}>
            <NavTooltip label="Dashboard">
              <Link to="/admin" className={navLinkClass('/admin')}>
                <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {!isCollapsed && 'Dashboard'}
              </Link>
            </NavTooltip>

            <NavTooltip label="Organisations">
              <Link to="/admin/organizations" className={navLinkClass('/admin/organizations')}>
                <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                {!isCollapsed && 'Organisations'}
              </Link>
            </NavTooltip>

            <NavTooltip label="Plans">
              <Link to="/admin/plans" className={navLinkClass('/admin/plans')}>
                <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                {!isCollapsed && 'Plans'}
              </Link>
            </NavTooltip>

            <NavTooltip label="Activity Log">
              <Link to="/admin/activity" className={navLinkClass('/admin/activity')}>
                <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {!isCollapsed && 'Activity Log'}
              </Link>
            </NavTooltip>

            <NavTooltip label="AI Usage">
              <Link to="/admin/ai-usage" className={navLinkClass('/admin/ai-usage')}>
                <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {!isCollapsed && <span className="flex-1">AI Usage</span>}
                {alertCount > 0 && (
                  <span className={`px-1.5 py-0.5 bg-red-500 text-white text-xs font-medium rounded-full ${isCollapsed ? 'absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center' : 'ml-2'}`}>
                    {alertCount}
                  </span>
                )}
              </Link>
            </NavTooltip>

            <div className="pt-4 mt-4 border-t border-gray-800">
              {!isCollapsed && (
                <p className="px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  Settings
                </p>
              )}
              <NavTooltip label="Platform Settings">
                <Link to="/admin/settings" className={navLinkClass('/admin/settings')}>
                  <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {!isCollapsed && 'Platform Settings'}
                </Link>
              </NavTooltip>
              <NavTooltip label="AI Configuration">
                <Link to="/admin/ai-configuration" className={navLinkClass('/admin/ai-configuration')}>
                  <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {!isCollapsed && 'AI Configuration'}
                </Link>
              </NavTooltip>
              <NavTooltip label="Starter Template">
                <Link to="/admin/starter-template" className={navLinkClass('/admin/starter-template')}>
                  <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                  </svg>
                  {!isCollapsed && 'Starter Template'}
                </Link>
              </NavTooltip>
              <NavTooltip label="Reason Types">
                <Link to="/admin/reason-types" className={navLinkClass('/admin/reason-types')}>
                  <svg className={`w-5 h-5 ${isCollapsed ? '' : 'mr-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {!isCollapsed && 'Reason Types'}
                </Link>
              </NavTooltip>
            </div>
          </nav>

          {/* Scroll fade indicator */}
          {showScrollFade && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none" />
          )}
        </div>

        {/* User Section */}
        <div className={`border-t border-gray-800 ${isCollapsed ? 'p-2' : 'p-4'}`}>
          {isCollapsed ? (
            <NavTooltip label={superAdmin?.name || 'Admin'}>
              <div className="flex justify-center mb-2">
                <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-medium">
                    {superAdmin?.name?.charAt(0) || 'A'}
                  </span>
                </div>
              </div>
            </NavTooltip>
          ) : (
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-medium">
                  {superAdmin?.name?.charAt(0) || 'A'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{superAdmin?.name}</div>
                <div className="text-xs text-gray-500 truncate">{superAdmin?.email}</div>
              </div>
            </div>
          )}
          <NavTooltip label="Sign out">
            <button
              onClick={handleLogout}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center' : ''} px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all duration-150`}
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
          className="hidden md:flex items-center justify-center p-2 border-t border-gray-800 text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all duration-150"
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
        <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {/* Spacer for mobile hamburger button */}
              <div className="w-10 md:hidden" />
              <span className="text-sm text-gray-500">Super Admin Portal</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                Super Admin
              </span>
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
