import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface AIUsageStatus {
  currentPeriodGenerations: number
  limit: number
  percentageUsed: number
  aiEnabled: boolean
}

const DISMISS_KEY = 'vhc_ai_limit_warning_dismissed'

export default function AILimitWarningBanner() {
  const { user, session } = useAuth()
  const [usage, setUsage] = useState<AIUsageStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const orgId = user?.organization?.id
  const isOrgAdmin = user?.isOrgAdmin || user?.role === 'org_admin'

  useEffect(() => {
    // Check if already dismissed this session
    const dismissedSession = sessionStorage.getItem(DISMISS_KEY)
    if (dismissedSession) {
      setDismissed(true)
      return
    }

    if (orgId && session?.accessToken && isOrgAdmin) {
      fetchUsage()
    }
  }, [orgId, session?.accessToken, isOrgAdmin])

  const fetchUsage = async () => {
    if (!orgId || !session?.accessToken) return

    try {
      const data = await api<AIUsageStatus>(
        `/api/v1/organizations/${orgId}/ai-usage`,
        { token: session.accessToken }
      )
      setUsage(data)
    } catch (err) {
      // Silently fail - don't show banner if we can't fetch usage
    }
  }

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true')
    setDismissed(true)
  }

  // Don't show if:
  // - Not an org admin
  // - Already dismissed this session
  // - No usage data
  // - AI not enabled
  // - Below 80% threshold
  if (!isOrgAdmin || dismissed || !usage || !usage.aiEnabled || usage.percentageUsed < 80) {
    return null
  }

  const remaining = usage.limit - usage.currentPeriodGenerations

  return (
    <div className="bg-amber-500 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center">
          <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            You've used <span className="font-semibold">{usage.currentPeriodGenerations}</span> of{' '}
            <span className="font-semibold">{usage.limit}</span> AI generations this month
            {remaining > 0 && ` (${remaining} remaining)`}.
            {' '}Contact support if you need a higher limit.
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="ml-4 p-1 hover:bg-amber-600 rounded transition-colors flex-shrink-0"
          aria-label="Dismiss warning"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
