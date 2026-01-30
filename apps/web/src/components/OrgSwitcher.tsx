import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function OrgSwitcher() {
  const { user, organizations, activeOrgId, switchOrganization } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Don't render if user only belongs to one org
  if (organizations.length <= 1) {
    return (
      <p className="text-xs text-gray-400 mt-1 truncate">{user?.organization?.name}</p>
    )
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentOrg = organizations.find(o => o.id === activeOrgId) || organizations[0]

  const handleSwitch = async (orgId: string) => {
    if (orgId === activeOrgId || switching) return
    setSwitching(true)
    try {
      await switchOrganization(orgId)
      // Page will reload after switch, so no need to reset state
    } catch (err) {
      console.error('Failed to switch organization:', err)
      setSwitching(false)
    }
  }

  const roleLabel = (role: string) => {
    return role.replace(/_/g, ' ')
  }

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'org_admin': return 'bg-purple-100 text-purple-700'
      case 'site_admin': return 'bg-blue-100 text-blue-700'
      case 'service_advisor': return 'bg-green-100 text-green-700'
      case 'technician': return 'bg-gray-100 text-gray-600'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1 max-w-full transition-colors"
        disabled={switching}
      >
        <span className="truncate">{currentOrg?.name || user?.organization?.name}</span>
        <svg
          className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-gray-200 shadow-lg z-50 rounded-none">
          <div className="py-1">
            <div className="px-3 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wider">
              Switch Organization
            </div>
            {organizations.map(org => (
              <button
                key={org.id}
                onClick={() => handleSwitch(org.id)}
                disabled={switching}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                  org.id === activeOrgId ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                } ${switching ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {org.id === activeOrgId && (
                    <svg className="w-4 h-4 flex-shrink-0 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  <span className="truncate">{org.name}</span>
                </div>
                <span className={`text-xs px-1.5 py-0.5 capitalize flex-shrink-0 rounded-none ${roleBadgeColor(org.role)}`}>
                  {roleLabel(org.role)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
