import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'

interface StoredImpersonation {
  impersonation: {
    reason: string
    startedAt: string
    sessionId?: string | null
    expiresAt?: string | null
  }
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    organization?: { id: string; name: string; slug: string }
  }
}

export default function ImpersonationBanner() {
  const [data, setData] = useState<StoredImpersonation | null>(null)
  const [ending, setEnding] = useState(false)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  useEffect(() => {
    const load = (raw: string | null) => {
      if (!raw) { setData(null); return }
      try { setData(JSON.parse(raw)) } catch { setData(null); localStorage.removeItem('vhc_impersonation') }
    }
    load(localStorage.getItem('vhc_impersonation'))
    const handleStorage = (e: StorageEvent) => { if (e.key === 'vhc_impersonation') load(e.newValue) }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const handleEndImpersonation = useCallback(async () => {
    setEnding(true)
    try {
      const superAdminSession = localStorage.getItem('vhc_super_admin_session')
      if (superAdminSession) {
        const session = JSON.parse(superAdminSession)
        await api('/api/v1/admin/impersonate', {
          method: 'DELETE',
          token: session.accessToken,
          body: { sessionId: data?.impersonation?.sessionId || undefined }
        })
      }
    } catch (error) {
      console.error('Failed to end impersonation:', error)
    }
    localStorage.removeItem('vhc_impersonation')
    localStorage.removeItem('vhc_session')
    localStorage.removeItem('vhc_user')
    window.location.href = '/admin'
  }, [data])

  // Countdown to expiry; auto-end when it elapses.
  useEffect(() => {
    const expiresAt = data?.impersonation?.expiresAt
    if (!expiresAt) { setRemainingMs(null); return }
    const tick = () => {
      const ms = new Date(expiresAt).getTime() - Date.now()
      setRemainingMs(ms)
      if (ms <= 0) handleEndImpersonation()
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [data, handleEndImpersonation])

  if (!data) return null

  const userName = `${data.user.firstName} ${data.user.lastName}`
  const orgName = data.user.organization?.name || 'Unknown Organisation'
  const reason = data.impersonation?.reason
  const countdown = remainingMs != null && remainingMs > 0
    ? `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`
    : null

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
              <span className="text-amber-800 capitalize">{data.user.role?.replace('_', ' ')}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {countdown && (
              <span className="text-sm text-amber-800" title="Session auto-ends at expiry">
                ⏱ {countdown}
              </span>
            )}
            {reason && (
              <div className="text-sm text-amber-800">
                <span className="hidden sm:inline">Reason: </span>
                <span className="font-medium">{reason}</span>
              </div>
            )}
            <button
              onClick={handleEndImpersonation}
              disabled={ending}
              className="bg-amber-700 hover:bg-amber-800 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center"
            >
              {ending ? 'Ending...' : (
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
