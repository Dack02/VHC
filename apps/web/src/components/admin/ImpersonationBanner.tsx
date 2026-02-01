import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

interface ImpersonationData {
  originalSuperAdminId: string
  originalSuperAdminEmail: string
  reason: string
  startedAt: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    organization: {
      id: string
      name: string
      slug: string
    }
  }
}

export default function ImpersonationBanner() {
  const [impersonation, setImpersonation] = useState<ImpersonationData | null>(null)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('vhc_impersonation')
    if (stored) {
      try {
        setImpersonation(JSON.parse(stored))
      } catch {
        localStorage.removeItem('vhc_impersonation')
      }
    }

    // Listen for storage changes (in case impersonation is started from another tab)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'vhc_impersonation') {
        if (e.newValue) {
          try {
            setImpersonation(JSON.parse(e.newValue))
          } catch {
            setImpersonation(null)
          }
        } else {
          setImpersonation(null)
        }
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const handleEndImpersonation = async () => {
    if (!impersonation) return

    setEnding(true)
    try {
      // Get super admin session
      const superAdminSession = localStorage.getItem('vhc_super_admin_session')
      if (superAdminSession) {
        const session = JSON.parse(superAdminSession)
        await api('/api/v1/admin/impersonate', {
          method: 'DELETE',
          token: session.accessToken
        })
      }
    } catch (error) {
      console.error('Failed to end impersonation:', error)
    }

    // Clear impersonation data
    localStorage.removeItem('vhc_impersonation')
    localStorage.removeItem('vhc_session')
    localStorage.removeItem('vhc_user')

    // Redirect back to admin
    window.location.href = '/admin'
  }

  if (!impersonation) return null

  const userName = `${impersonation.user.firstName} ${impersonation.user.lastName}`
  const orgName = impersonation.user.organization?.name || 'Unknown Organisation'

  return (
    <div className="bg-amber-500 text-amber-900">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-8 h-8 bg-amber-600 rounded-full">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div>
              <span className="font-semibold">Viewing as:</span>
              <span className="ml-2 font-bold">{userName}</span>
              <span className="mx-2">|</span>
              <span className="text-amber-800">{orgName}</span>
              <span className="mx-2">|</span>
              <span className="text-amber-800 capitalize">{impersonation.user.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-amber-800">
              <span className="hidden sm:inline">Reason: </span>
              <span className="font-medium">{impersonation.reason}</span>
            </div>
            <button
              onClick={handleEndImpersonation}
              disabled={ending}
              className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center"
            >
              {ending ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Ending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  End Impersonation
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
