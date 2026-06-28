import { useState, useEffect, useRef, Suspense } from 'react'
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useModules } from '../contexts/ModulesContext'
import { useBranding } from '../contexts/BrandingContext'
import type { ModuleKey } from '../lib/modules'
import NotificationBell from '../components/NotificationBell'
import AILimitWarningBanner from '../components/AILimitWarningBanner'
import OrgSwitcher from '../components/OrgSwitcher'
import FeedbackButton from '../components/feedback/FeedbackButton'
import { useUnreadSmsCount } from '../hooks/useUnreadSmsCount'
import { useAttentionNotesCount } from '../hooks/useAttentionNotesCount'
import { useFollowUpDueCount } from '../hooks/useFollowUpDueCount'

type UserRole = 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  roles: UserRole[]
  badge?: number
  module?: ModuleKey
  /** When present, this is an expandable group; `to` points at the group's hub. */
  children?: NavItem[]
  /** A pure section header — the label toggles the group instead of navigating
   *  (avoids a parent that duplicates one of its children). `to` is just the key. */
  sectionOnly?: boolean
}

const NAV_GROUPS_KEY = 'vhc-nav-expanded-groups'

const NAV_COLLAPSED_KEY = 'vhc-nav-collapsed'

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const { isEnabled } = useModules()
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
  const { count: attentionNotesCount } = useAttentionNotesCount()
  const { count: followUpDueCount } = useFollowUpDueCount()

  // Define navigation items with role-based access
  const mainNavItems: NavItem[] = [
    {
      to: '/tiles',
      label: 'Tiles',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'workshop_board'
    },
    {
      to: '/diary',
      label: 'Booking Diary',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'booking_diary'
    },
    {
      to: '/dashboard',
      label: 'Dashboard',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']
    },
    {
      to: '/jobsheets',
      label: 'Jobsheets',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'jobsheets'
    },
    {
      to: '/estimates',
      label: 'Estimates',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'estimates'
    },
    {
      // Arrivals hub also hosts the Upcoming tab. Not module-gated: when jobsheets is off the
      // hub shows Upcoming only, so the item stays visible (labelled "Upcoming") for those tenants.
      to: '/arrivals',
      label: isEnabled('jobsheets') ? 'Arrivals' : 'Upcoming',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h13m0 0l-4-4m4 4l-4 4M21 4v16" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/health-checks',
      label: 'Health Checks',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']
    },
    {
      to: '/workshop-board',
      label: 'Workshop',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'workshop_board'
    },
    {
      to: '/notes',
      label: 'Notes',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      badge: attentionNotesCount
    },
    {
      to: '/customers',
      label: 'Customers',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/vehicles',
      label: 'Vehicles',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13m-14 0h14m-14 0v4a1 1 0 001 1h1a1 1 0 001-1v-1m10 1v-1a1 1 0 011-1h0a1 1 0 011 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1zm-12 0a1 1 0 01-1-1v-3h14v3a1 1 0 01-1 1M7 16h.01M17 16h.01" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'vehicles'
    },
    {
      to: '/follow-ups',
      label: 'Follow-Ups',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      badge: followUpDueCount,
      module: 'follow_up'
    },
    {
      to: '/messages',
      label: 'Messages',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      badge: unreadSmsCount,
      module: 'customer_comms'
    },
    {
      to: '/parts',
      label: 'Parts',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      sectionOnly: true,
      children: [
        {
          to: '/parts',
          label: 'Catalogue',
          icon: (
            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          ),
          roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
        },
        {
          to: '/parts/stock',
          label: 'Stock',
          module: 'parts_stock',
          icon: (
            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          ),
          roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
        },
        {
          to: '/parts/purchase-orders',
          label: 'Purchase Orders',
          module: 'parts_stock',
          icon: (
            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ),
          roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
        },
        {
          to: '/parts/returns',
          label: 'Returns',
          module: 'parts_stock',
          icon: (
            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          ),
          roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
        },
        {
          to: '/parts/stocktake',
          label: 'Stocktake',
          module: 'parts_stock',
          icon: (
            <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          ),
          roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
        }
      ]
    },
    {
      to: '/reports',
      label: 'Reports',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor'],
      module: 'reports'
    },
    {
      to: '/service-packages',
      label: 'Packages',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin', 'service_advisor']
    },
    {
      to: '/settings',
      label: 'Settings',
      icon: (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      roles: ['super_admin', 'org_admin', 'site_admin']
    }
  ]

  // Filter nav items based on user role + module. For groups, filter the children and
  // drop the whole group if none remain visible.
  const visibleMainNav = mainNavItems
    .filter(item => item.roles.includes(userRole))
    .map(item => item.children
      ? { ...item, children: item.children.filter(ch => ch.roles.includes(userRole) && (!ch.module || isEnabled(ch.module))) }
      : item)
    .filter(item => item.children ? item.children.length > 0 : (!item.module || isEnabled(item.module)))

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  // A group is active when its hub or any child route is active.
  const groupActive = (item: NavItem) =>
    isActive(item.to) || (item.children?.some(ch => isActive(ch.to)) ?? false)

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try { return new Set(JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || '[]')) } catch { /* ignore */ }
    }
    return new Set()
  })
  const toggleGroup = (key: string) => setExpandedGroups(s => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify([...n]))
    return n
  })

  const navLinkClass = (path: string) => {
    const active = isActive(path)
    const base = 'flex items-center text-[13.5px] rounded-[9px] transition-colors duration-150'
    const tone = active
      ? 'bg-primary/10 text-primary font-semibold'
      : 'text-[#5f636c] font-medium hover:bg-[#f3f3f1]'

    if (isCollapsed) {
      return `${base} justify-center px-2 py-[9px] ${tone}`
    }

    return `${base} gap-[11px] px-[11px] py-[9px] ${tone}`
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

  // Expandable nav group (e.g. Documents → Jobsheets, Estimates). Collapsed sidebar
  // shows the group icon only (atomic, links to the hub); expanded shows children.
  const NavGroup = ({ item }: { item: NavItem }) => {
    const active = groupActive(item)
    const open = expandedGroups.has(item.to) || active
    const tone = active ? 'bg-primary/10 text-primary font-semibold' : 'text-[#5f636c] font-medium hover:bg-[#f3f3f1]'

    // A section-only header navigates nowhere itself; its first child is the
    // collapsed-rail fallback target.
    const headerTarget = item.sectionOnly ? (item.children?.[0]?.to ?? item.to) : item.to

    if (isCollapsed) {
      return (
        <NavTooltip label={item.label}>
          <Link to={headerTarget} className={`flex items-center justify-center text-[13.5px] rounded-[9px] px-2 py-[9px] transition-colors duration-150 ${tone}`}>
            {item.icon}
          </Link>
        </NavTooltip>
      )
    }

    return (
      <div>
        <div className={`flex items-center rounded-[9px] pr-1 transition-colors duration-150 ${tone}`}>
          {item.sectionOnly ? (
            <button onClick={() => toggleGroup(item.to)} className="flex items-center gap-[11px] flex-1 min-w-0 text-[13.5px] px-[11px] py-[9px] text-left">
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
            </button>
          ) : (
            <Link to={item.to} className="flex items-center gap-[11px] flex-1 min-w-0 text-[13.5px] px-[11px] py-[9px]">
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
            </Link>
          )}
          <button onClick={() => toggleGroup(item.to)} className="p-1 text-[#a4a8b0] hover:text-[#5f636c]" aria-label={open ? 'Collapse section' : 'Expand section'}>
            <svg className={`w-4 h-4 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        {open && (
          <div className="mt-0.5 ml-[22px] space-y-0.5 border-l border-[#ededeb] pl-2">
            {(item.children || []).map(ch => (
              <Link key={ch.to} to={ch.to}
                className={`flex items-center text-[13px] rounded-[8px] px-[10px] py-[7px] transition-colors duration-150 ${
                  isActive(ch.to) ? 'bg-primary/10 text-primary font-semibold' : 'text-[#5f636c] font-medium hover:bg-[#f3f3f1]'
                }`}>
                {ch.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Sidebar width classes
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-[234px]'
  const mainMargin = isCollapsed ? 'md:ml-16' : 'md:ml-[234px]'

  // Brand monogram initials, e.g. "Central Garage" -> "CG"
  const orgName = branding?.organizationName || user?.organization?.name || 'VHC'
  const orgInitials =
    orgName.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'V'
  const userInitials =
    `${user?.firstName?.charAt(0) || ''}${user?.lastName?.charAt(0) || ''}`.toUpperCase() || 'U'

  return (
    <div className="min-h-screen bg-[#f4f4f2]">
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
          fixed top-0 left-0 h-full bg-white border-r border-[#ededeb]
          flex flex-col z-50 transition-all duration-200 ease-in-out
          ${sidebarWidth}
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Brand area */}
        <div className={`pt-5 pb-4 ${isCollapsed ? 'px-2 flex justify-center' : 'px-4'}`}>
          {isCollapsed ? (
            <div className="w-8 h-8 rounded-[9px] bg-[#16181d] text-white flex items-center justify-center font-extrabold text-[13px]">
              {orgInitials.charAt(0)}
            </div>
          ) : branding?.logoUrl ? (
            <>
              <img
                src={branding.logoUrl}
                alt={orgName}
                className="h-10 w-auto max-w-full object-contain"
              />
              <OrgSwitcher />
            </>
          ) : (
            <>
              <div className="flex items-center gap-[11px] px-[7px]">
                <div className="w-8 h-8 rounded-[9px] bg-[#16181d] text-white flex items-center justify-center font-extrabold text-[13px] tracking-wide flex-none">
                  {orgInitials}
                </div>
                <div className="leading-tight min-w-0">
                  <div className="text-[14px] font-bold text-[#16181d] truncate">{orgName}</div>
                  <div className="text-[11px] font-medium text-[#a4a8b0]">Ollo Inspect</div>
                </div>
              </div>
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
          <nav ref={navRef} className={`h-full overflow-y-auto ${isCollapsed ? 'p-2 space-y-1' : 'px-3 py-2 space-y-0.5'}`}>
            {/* Main Navigation */}
            {visibleMainNav.map(item => item.children ? (
              <NavGroup key={item.to} item={item} />
            ) : (
              <NavTooltip key={item.to} label={item.label}>
                <Link to={item.to} className={navLinkClass(item.to)}>
                  <span className="relative flex items-center justify-center">
                    {item.icon}
                    {isCollapsed && item.badge != null && item.badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-[#cf4a45] rounded-full h-2.5 w-2.5" />
                    )}
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span className={`text-[11px] font-semibold rounded-full min-w-[21px] text-center px-2 py-px ${
                          isActive(item.to)
                            ? 'bg-primary/15 text-primary'
                            : 'bg-[#f0f0ee] text-[#7b7f88]'
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
        <div className={`border-t border-[#f0f0ee] ${isCollapsed ? 'p-2' : 'px-3 py-3'}`}>
          {isCollapsed ? (
            <NavTooltip label={`${user?.firstName} ${user?.lastName}`}>
              <div className="flex justify-center mb-2">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[13px] font-bold">
                  {userInitials}
                </div>
              </div>
            </NavTooltip>
          ) : (
            <div className="flex items-center gap-[11px] px-[6px] mb-1.5">
              <div className="w-[34px] h-[34px] rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[13px] flex-none">
                {userInitials}
              </div>
              <div className="leading-tight min-w-0">
                <div className="text-[13px] font-semibold text-[#16181d] truncate">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-[11px] text-[#a4a8b0] capitalize">
                  {user?.role?.replace('_', ' ')}
                </div>
              </div>
            </div>
          )}
          <NavTooltip label="Sign out">
            <button
              onClick={handleLogout}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-[11px]'} px-[11px] py-2 text-[13px] text-[#7b7f88] hover:bg-[#f3f3f1] rounded-[9px] transition-colors duration-150`}
            >
              <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {!isCollapsed && 'Sign out'}
            </button>
          </NavTooltip>
        </div>

        {/* Collapse toggle button */}
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex items-center justify-center p-2 border-t border-[#f0f0ee] text-[#a4a8b0] hover:text-[#5f636c] hover:bg-[#f7f7f5] transition-colors duration-150"
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

        <header className="bg-white border-b border-[#ededeb] h-[60px] flex items-center px-4 md:px-10 sticky top-0 z-20">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              {/* Spacer for mobile hamburger button */}
              <div className="w-10 md:hidden" />
              <span className="text-[13px] font-medium text-[#a4a8b0]">
                {user?.site?.name ?? `${orgName} workspace`}
              </span>
            </div>
            <div className="flex items-center gap-3.5">
              {/* Role badge */}
              {isOrgAdmin && (
                <span className="inline-flex items-center px-3 py-[5px] rounded-full text-[12px] font-semibold text-primary bg-primary/10">
                  Org Admin
                </span>
              )}
              {isSiteAdmin && !isOrgAdmin && (
                <span className="inline-flex items-center px-3 py-[5px] rounded-full text-[12px] font-semibold text-[#3f7fd1] bg-[#3f7fd1]/10">
                  Site Admin
                </span>
              )}
              {/* Notification bell */}
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* Inner Suspense keeps the sidebar/header mounted while a lazy route
            chunk loads — without it, route chunks suspend against the app-level
            boundary and the whole layout flashes out on navigation. */}
        <div className="flex-1 overflow-auto">
          <div className="px-4 md:px-10 pt-6 md:pt-[34px] pb-10 md:pb-11 w-full">
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </div>
      </main>

      {/* Floating in-app feedback / bug reporter (pushed to Ollo Dev) */}
      <FeedbackButton />
    </div>
  )
}
