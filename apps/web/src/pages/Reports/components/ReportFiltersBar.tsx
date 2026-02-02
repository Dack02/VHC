import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { DatePreset, GroupBy } from '../hooks/useReportFilters'

interface ReportFiltersBarProps {
  datePreset: DatePreset
  groupBy: GroupBy
  siteId: string | null
  technicianId?: string | null
  advisorId?: string | null
  onDatePresetChange: (preset: DatePreset) => void
  onCustomDateRange?: (from: string, to: string) => void
  onGroupByChange: (groupBy: GroupBy) => void
  onSiteChange: (siteId: string | null) => void
  onTechnicianChange?: (id: string | null) => void
  onAdvisorChange?: (id: string | null) => void
  showTechnicianFilter?: boolean
  showAdvisorFilter?: boolean
}

interface SiteOption { id: string; name: string }
interface UserOption { id: string; firstName: string; lastName: string }

export default function ReportFiltersBar({
  datePreset,
  groupBy,
  siteId,
  technicianId,
  advisorId,
  onDatePresetChange,
  onGroupByChange,
  onSiteChange,
  onTechnicianChange,
  onAdvisorChange,
  showTechnicianFilter = false,
  showAdvisorFilter = false,
}: ReportFiltersBarProps) {
  const { session, user } = useAuth()
  const [sites, setSites] = useState<SiteOption[]>([])
  const [technicians, setTechnicians] = useState<UserOption[]>([])
  const [advisors, setAdvisors] = useState<UserOption[]>([])

  const hasMultiSite = user?.isOrgAdmin || user?.role === 'super_admin' || user?.role === 'org_admin'

  useEffect(() => {
    if (!session?.accessToken) return
    const token = session.accessToken

    // Fetch sites for multi-site users
    if (hasMultiSite) {
      api<SiteOption[]>('/api/v1/sites', { token }).then(setSites).catch(() => {})
    }

    // Fetch technicians
    if (showTechnicianFilter) {
      api<{ users: UserOption[] }>('/api/v1/users?role=technician', { token })
        .then(d => setTechnicians(d.users || []))
        .catch(() => {})
    }

    // Fetch advisors
    if (showAdvisorFilter) {
      api<{ users: UserOption[] }>('/api/v1/users?role=service_advisor', { token })
        .then(d => setAdvisors(d.users || []))
        .catch(() => {})
    }
  }, [session?.accessToken, hasMultiSite, showTechnicianFilter, showAdvisorFilter])

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date Preset */}
      <select
        value={datePreset}
        onChange={e => onDatePresetChange(e.target.value as DatePreset)}
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      >
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
        <option value="ytd">Year to Date</option>
      </select>

      {/* Group By */}
      <div className="flex rounded-lg border border-gray-300 overflow-hidden">
        {(['day', 'week', 'month'] as GroupBy[]).map(g => (
          <button
            key={g}
            onClick={() => onGroupByChange(g)}
            className={`px-3 py-2 text-sm capitalize ${
              groupBy === g
                ? 'bg-primary text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Site Filter */}
      {hasMultiSite && sites.length > 0 && (
        <select
          value={siteId || ''}
          onChange={e => onSiteChange(e.target.value || null)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Sites</option>
          {sites.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}

      {/* Technician Filter */}
      {showTechnicianFilter && onTechnicianChange && technicians.length > 0 && (
        <select
          value={technicianId || ''}
          onChange={e => onTechnicianChange(e.target.value || null)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Technicians</option>
          {technicians.map(t => (
            <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
          ))}
        </select>
      )}

      {/* Advisor Filter */}
      {showAdvisorFilter && onAdvisorChange && advisors.length > 0 && (
        <select
          value={advisorId || ''}
          onChange={e => onAdvisorChange(e.target.value || null)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Advisors</option>
          {advisors.map(a => (
            <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
          ))}
        </select>
      )}
    </div>
  )
}
