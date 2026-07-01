import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useModules } from '../../contexts/ModulesContext'
import type { ModuleKey } from '../../lib/modules'

interface SocialTab {
  to: string
  label: string
  /** The Overview lives at the index route, so it needs exact matching. */
  end?: boolean
  /** When set, the tab only shows if the module is enabled. */
  module?: ModuleKey
}

const TABS: SocialTab[] = [
  { to: '/social', label: 'Overview', end: true },
  { to: '/social/profiles', label: 'Profiles' },
  // Future sub-tabs slot in here (Content, Ads, ROI, Inbox) — see GMS/SOCIAL_MEDIA.md §16.5.
]

/**
 * Section shell for the Social Media module. Renders the sub-pages (Overview,
 * Profiles) under a horizontal underline tab bar — mirrors PartsLayout so new
 * capabilities are a tab + a route, never a re-home. The inner Suspense keeps
 * the tabs mounted while a lazy sub-page chunk loads.
 */
export default function SocialMediaLayout() {
  const { isEnabled } = useModules()
  const tabs = TABS.filter(t => !t.module || isEnabled(t.module))

  return (
    <div className="max-w-7xl mx-auto">
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map(tab => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `relative px-1 py-4 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  )
}
