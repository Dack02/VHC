import { useState, useEffect, useRef, Suspense, type ReactNode } from 'react'
import { Link, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useSuperAdmin } from '../contexts/SuperAdminContext'
import { api } from '../lib/api'

const ADMIN_NAV_COLLAPSED_KEY = 'vhc-admin-nav-collapsed'

// ---------------------------------------------------------------------------
// Nav model — single source of truth for the sidebar. Keeping the items as
// data (rather than hand-written JSX per link) keeps the markup tiny and makes
// grouping / page-title lookups trivial.
// ---------------------------------------------------------------------------
type NavItem = {
  to: string
  label: string
  /** Match exactly (no sub-route prefix). Used for the index route. */
  end?: boolean
  /** Shows the unacknowledged-alert badge. */
  alertBadge?: boolean
  icon: ReactNode
}
type NavGroup = { label?: string; items: NavItem[] }

// Small helper so each icon definition is just its path data.
const p = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        to: '/admin',
        label: 'Dashboard',
        end: true,
        icon: p('M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'),
      },
    ],
  },
  {
    label: 'Tenants',
    items: [
      {
        to: '/admin/organizations',
        label: 'Organisations',
        icon: p('M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4'),
      },
      {
        to: '/admin/plans',
        label: 'Plans',
        icon: p('M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'),
      },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      {
        to: '/admin/activity',
        label: 'Activity Log',
        icon: p('M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'),
      },
      {
        to: '/admin/usage',
        label: 'Usage',
        icon: p('M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'),
      },
      {
        to: '/admin/communications',
        label: 'Communications',
        icon: p('M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'),
      },
      {
        to: '/admin/ai-usage',
        label: 'AI Usage',
        alertBadge: true,
        icon: p('M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'),
      },
      {
        to: '/admin/alerts',
        label: 'Alerts',
        icon: p('M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9'),
      },
      {
        to: '/admin/system',
        label: 'System Health',
        icon: p('M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'),
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        to: '/admin/super-admins',
        label: 'Super Admins',
        icon: p('M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'),
      },
      {
        to: '/admin/settings',
        label: 'Platform Settings',
        icon: (
          <>
            {p('M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z')}
            {p('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}
          </>
        ),
      },
      {
        to: '/admin/ai-configuration',
        label: 'AI Configuration',
        icon: p('M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'),
      },
      {
        to: '/admin/starter-template',
        label: 'Starter Reasons',
        icon: p('M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z'),
      },
      {
        to: '/admin/starter-templates',
        label: 'Starter Template',
        icon: p('M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2'),
      },
      {
        to: '/admin/reason-types',
        label: 'Reason Types',
        icon: p('M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z'),
      },
    ],
  },
]

// Content-area loader for the inner Suspense boundary. Lives below the sidebar
// so route chunks load without unmounting the nav (the old flicker source).
function AdminContentLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

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
  }, [isCollapsed])

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
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  if (!isSuperAdmin) {
    return <Navigate to="/admin/login" replace />
  }

  // Active when on the exact path, or (for non-`end` items) on a true sub-route
  // — `path + '/'`, never a bare string prefix, so '/admin/starter-template'
  // and '/admin/starter-templates' don't both light up.
  const isActive = (path: string, end?: boolean) => {
    if (end) return location.pathname === path
    return location.pathname === path || location.pathname.startsWith(path + '/')
  }

  const pageTitle =
    NAV_GROUPS.flatMap(g => g.items).find(i => isActive(i.to, i.end))?.label ?? 'Dashboard'

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.to, item.end)
    const showBadge = item.alertBadge && alertCount > 0

    return (
      <div key={item.to} className="group relative">
        <Link
          to={item.to}
          aria-current={active ? 'page' : undefined}
          className={[
            'relative flex items-center rounded-lg text-sm font-medium transition-colors duration-150',
            isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2',
            active
              ? 'bg-slate-800 text-white'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-white',
          ].join(' ')}
        >
          <span
            className={
              active ? 'text-indigo-400' : 'text-slate-500 transition-colors group-hover:text-slate-300'
            }
          >
            <svg
              className="h-[18px] w-[18px] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              {item.icon}
            </svg>
          </span>

          {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}

          {!isCollapsed && showBadge && (
            <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rag-red px-1.5 text-[11px] font-semibold text-white">
              {alertCount}
            </span>
          )}

          {isCollapsed && showBadge && (
            <span className="absolute right-1 top-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rag-red opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rag-red ring-2 ring-slate-900" />
            </span>
          )}
        </Link>

        {/* Tooltip (collapsed only) */}
        {isCollapsed && (
          <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-slate-700/60 transition-opacity duration-150 group-hover:opacity-100">
            {item.label}
            {showBadge && <span className="ml-1.5 text-rag-red">({alertCount})</span>}
          </div>
        )}
      </div>
    )
  }

  const sidebarWidth = isCollapsed ? 'w-[68px]' : 'w-64'
  const mainMargin = isCollapsed ? 'md:ml-[68px]' : 'md:ml-64'

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-full flex-col border-r border-slate-800 bg-slate-900
          shadow-xl transition-[width,transform] duration-200 ease-in-out md:shadow-none
          ${sidebarWidth}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Brand / header */}
        <div
          className={`flex h-16 shrink-0 items-center border-b border-slate-800/80 ${
            isCollapsed ? 'justify-center px-2' : 'px-4'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-600/25">
              <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            {!isCollapsed && (
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight text-white">VHC Admin</div>
                <div className="text-[11px] text-slate-500">Super Admin Portal</div>
              </div>
            )}
          </div>

          {/* Mobile close button */}
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation with scroll fade */}
        <div className="relative min-h-0 flex-1">
          <nav
            ref={navRef}
            className={`h-full overflow-y-auto py-4 ${isCollapsed ? 'px-2' : 'px-3'}`}
          >
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label ?? `group-${gi}`} className={gi > 0 ? 'mt-6' : ''}>
                {group.label && !isCollapsed && (
                  <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </p>
                )}
                {group.label && isCollapsed && gi > 0 && (
                  <div className="mx-2 mb-2 border-t border-slate-800" />
                )}
                <div className="space-y-0.5">{group.items.map(renderNavItem)}</div>
              </div>
            ))}
          </nav>

          {/* Scroll fade indicator */}
          {showScrollFade && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-slate-900 to-transparent" />
          )}
        </div>

        {/* User section */}
        <div className={`shrink-0 border-t border-slate-800/80 ${isCollapsed ? 'p-2' : 'p-3'}`}>
          {isCollapsed ? (
            <div className="group relative mb-1 flex justify-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-semibold text-white">
                {superAdmin?.name?.charAt(0) || 'A'}
              </div>
              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-slate-700/60 transition-opacity duration-150 group-hover:opacity-100">
                {superAdmin?.name || 'Admin'}
              </div>
            </div>
          ) : (
            <div className="mb-1 flex items-center gap-3 px-2 py-1.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-sm font-semibold text-white">
                {superAdmin?.name?.charAt(0) || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{superAdmin?.name}</div>
                <div className="truncate text-xs text-slate-500">{superAdmin?.email}</div>
              </div>
            </div>
          )}

          <div className="group relative">
            <button
              onClick={handleLogout}
              className={`flex w-full items-center rounded-lg text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800/60 hover:text-white ${
                isCollapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2'
              }`}
            >
              <svg className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!isCollapsed && 'Sign out'}
            </button>
            {isCollapsed && (
              <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-slate-700/60 transition-opacity duration-150 group-hover:opacity-100">
                Sign out
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className={`hidden shrink-0 items-center border-t border-slate-800/80 py-3 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-800/40 hover:text-slate-300 md:flex ${
            isCollapsed ? 'justify-center px-2' : 'gap-2 px-4'
          }`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </aside>

      {/* Main content */}
      <main className={`flex min-h-screen flex-col transition-[margin] duration-200 ${mainMargin}`}>
        <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="-ml-1 rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="text-base font-semibold text-gray-900">{pageTitle}</h1>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Super Admin
            </span>
          </div>
        </header>

        {/* Inner Suspense keeps the sidebar mounted while a lazy route chunk
            loads — without it, route chunks suspend against the app-level
            boundary and the whole layout (sidebar included) flashes out. */}
        <div className="flex-1 overflow-auto p-6">
          <Suspense fallback={<AdminContentLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}
