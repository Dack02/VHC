import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface AIUsageData {
  currentPeriodGenerations: number
  limit: number
  percentageUsed: number
  periodStart: string
  periodEnd: string
  recentGenerations: RecentGeneration[]
}

interface RecentGeneration {
  id: string
  action: string
  context: {
    itemName?: string
    templateName?: string
    reasonsCount?: number
    itemsCount?: number
  }
  createdAt: string
  userName: string
}

export default function AIUsage() {
  const { user, session } = useAuth()
  const [usage, setUsage] = useState<AIUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = user?.organization?.id

  useEffect(() => {
    if (orgId) {
      fetchUsage()
    }
  }, [orgId])

  const fetchUsage = async () => {
    if (!orgId || !session?.accessToken) return

    try {
      const data = await api<AIUsageData>(
        `/api/v1/organizations/${orgId}/ai-usage`,
        { token: session.accessToken }
      )
      setUsage(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI usage data')
    } finally {
      setLoading(false)
    }
  }

  const formatResetDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long'
    })
  }

  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = date.toDateString() === yesterday.toDateString()

    const time = date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    })

    if (isToday) return `Today, ${time}`
    if (isYesterday) return `Yesterday, ${time}`
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatActionDescription = (gen: RecentGeneration) => {
    const { action, context, userName } = gen

    switch (action) {
      case 'generate_reasons':
        return `${userName} generated reasons for ${context.itemName || 'item'} (${context.reasonsCount || 0} reasons)`
      case 'generate_bulk':
        return `${userName} bulk generated for ${context.templateName || 'template'} (${context.reasonsCount || 0} reasons)`
      case 'regenerate_descriptions':
        return `${userName} regenerated descriptions for ${context.itemsCount || 1} reason${(context.itemsCount || 1) !== 1 ? 's' : ''}`
      case 'generate_single':
        return `${userName} generated reason for ${context.itemName || 'item'}`
      default:
        return `${userName} performed AI generation`
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading AI usage...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
        {error}
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">AI usage data not available</p>
      </div>
    )
  }

  const remaining = usage.limit - usage.currentPeriodGenerations
  const isNearLimit = usage.percentageUsed >= 80
  const isAtLimit = usage.percentageUsed >= 100

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Usage</h1>
        <p className="text-gray-500 mt-1">Monitor your organization's AI generation usage</p>
      </div>

      {/* Usage Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">This Month's Usage</h2>

        <div className="space-y-4">
          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">AI Generations</span>
              <span className={`font-medium ${isAtLimit ? 'text-red-600' : isNearLimit ? 'text-amber-600' : 'text-gray-900'}`}>
                {usage.currentPeriodGenerations} / {usage.limit}
              </span>
            </div>
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isAtLimit ? 'bg-red-500' :
                  isNearLimit ? 'bg-amber-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${Math.min(usage.percentageUsed, 100)}%` }}
              />
            </div>
          </div>

          {/* Usage Text */}
          <div className="text-center py-2">
            <p className="text-gray-700">
              You've used <span className="font-semibold">{usage.currentPeriodGenerations}</span> of{' '}
              <span className="font-semibold">{usage.limit}</span> AI generations this month
            </p>
            <p className="text-sm text-gray-500 mt-1">
              <span className={isNearLimit ? 'text-amber-600 font-medium' : ''}>
                {remaining > 0 ? `${remaining} remaining` : 'No generations remaining'}
              </span>
              {' '}&bull;{' '}
              Resets on {formatResetDate(usage.periodEnd)}
            </p>
          </div>

          {/* Warning for near limit */}
          {isNearLimit && !isAtLimit && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              You're approaching your monthly limit. Contact support if you need more AI generations.
            </div>
          )}

          {/* Error for at limit */}
          {isAtLimit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              You've reached your monthly limit. Your limit will reset on {formatResetDate(usage.periodEnd)}.
            </div>
          )}
        </div>
      </div>

      {/* Recent Generations */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent AI Generations</h2>
        </div>

        <div className="divide-y divide-gray-100">
          {usage.recentGenerations.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-500">
              No AI generations yet this month
            </div>
          ) : (
            usage.recentGenerations.slice(0, 10).map((gen) => (
              <div key={gen.id} className="px-6 py-4">
                <p className="text-xs text-gray-500">{formatTimestamp(gen.createdAt)}</p>
                <p className="text-sm text-gray-900 mt-0.5">{formatActionDescription(gen)}</p>
              </div>
            ))
          )}
        </div>

        {usage.recentGenerations.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200">
            <Link
              to="/settings/ai-usage/history"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View Full History
            </Link>
          </div>
        )}
      </div>

      {/* Tips Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
          <span className="mr-2">💡</span>
          Tips to reduce AI usage:
        </h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start">
            <span className="mr-2">&bull;</span>
            <span>Use the Starter Template when setting up new templates</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">&bull;</span>
            <span>Review and edit generated reasons before regenerating</span>
          </li>
          <li className="flex items-start">
            <span className="mr-2">&bull;</span>
            <span>Copy reasons between similar templates instead of generating new ones</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
