import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface SubscriptionPlan {
  id: string
  name: string
  description: string | null
  priceMonthly: number | null
  priceAnnual: number | null
  currency: string
  maxSites: number
  maxUsers: number
  maxHealthChecksPerMonth: number
  maxStorageGb: number
  features: string[]
}

interface SubscriptionData {
  id: string
  status: string
  plan: SubscriptionPlan | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
}

interface UsageData {
  sites: { current: number; limit: number; percentUsed: number }
  users: { current: number; limit: number; percentUsed: number }
  healthChecks: { current: number; limit: number; percentUsed: number; periodLabel: string }
  storage: { currentGb: string; limitGb: string; percentUsed: number }
}

export default function Subscription() {
  const { user, session } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const orgId = user?.organization?.id

  useEffect(() => {
    if (orgId) {
      fetchData()
    }
  }, [orgId])

  const fetchData = async () => {
    if (!orgId) return

    try {
      const [subData, usageData] = await Promise.allSettled([
        api<SubscriptionData>(`/api/v1/organizations/${orgId}/subscription`, {
          token: session?.accessToken
        }),
        api<UsageData>(`/api/v1/organizations/${orgId}/usage`, {
          token: session?.accessToken
        })
      ])

      if (subData.status === 'fulfilled') {
        setSubscription(subData.value)
      }

      if (usageData.status === 'fulfilled') {
        setUsage(usageData.value)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription data')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatCurrency = (amount: number | null, currency: string) => {
    if (amount === null) return 'N/A'
    const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }
    return `${symbols[currency] || currency}${amount.toFixed(2)}`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800'
      case 'trialing':
        return 'bg-blue-100 text-blue-800'
      case 'past_due':
        return 'bg-yellow-100 text-yellow-800'
      case 'canceled':
      case 'suspended':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 75) return 'bg-yellow-500'
    return 'bg-primary'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <SettingsBackLink />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Subscription</h1>
        <p className="text-gray-600 mt-1">
          View your current plan and usage.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Current Plan */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
            {subscription?.plan ? (
              <div className="mt-2">
                <p className="text-2xl font-bold text-gray-900">{subscription.plan.name}</p>
                {subscription.plan.description && (
                  <p className="text-gray-600 mt-1">{subscription.plan.description}</p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 mt-2">No plan information available</p>
            )}
          </div>
          {subscription && (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(subscription.status)}`}>
              {subscription.status.replace('_', ' ')}
            </span>
          )}
        </div>

        {subscription?.plan && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">Monthly Price</p>
                <p className="text-lg font-semibold">{formatCurrency(subscription.plan.priceMonthly, subscription.plan.currency)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Annual Price</p>
                <p className="text-lg font-semibold">{formatCurrency(subscription.plan.priceAnnual, subscription.plan.currency)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Period Start</p>
                <p className="text-lg font-semibold">{formatDate(subscription.currentPeriodStart)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Period End</p>
                <p className="text-lg font-semibold">{formatDate(subscription.currentPeriodEnd)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Plan Limits */}
      {subscription?.plan && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan Limits</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">
                {subscription.plan.maxSites === -1 ? '∞' : subscription.plan.maxSites}
              </p>
              <p className="text-sm text-gray-500">Sites</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">
                {subscription.plan.maxUsers === -1 ? '∞' : subscription.plan.maxUsers}
              </p>
              <p className="text-sm text-gray-500">Users</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">
                {subscription.plan.maxHealthChecksPerMonth === -1 ? '∞' : subscription.plan.maxHealthChecksPerMonth.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">Health Checks/Month</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">
                {subscription.plan.maxStorageGb === -1 ? '∞' : `${subscription.plan.maxStorageGb}GB`}
              </p>
              <p className="text-sm text-gray-500">Storage</p>
            </div>
          </div>

          {/* Features */}
          {subscription.plan.features && subscription.plan.features.length > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Included Features</h3>
              <div className="flex flex-wrap gap-2">
                {subscription.plan.features.map((feature, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary/10 text-primary"
                  >
                    <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Usage */}
      {usage && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Usage</h2>
          <div className="space-y-6">
            {/* Sites Usage */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">Sites</span>
                <span className="text-gray-500">
                  {usage.sites.current} / {usage.sites.limit === -1 ? '∞' : usage.sites.limit}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(usage.sites.percentUsed)} transition-all`}
                  style={{ width: `${Math.min(usage.sites.percentUsed, 100)}%` }}
                />
              </div>
            </div>

            {/* Users Usage */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">Users</span>
                <span className="text-gray-500">
                  {usage.users.current} / {usage.users.limit === -1 ? '∞' : usage.users.limit}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(usage.users.percentUsed)} transition-all`}
                  style={{ width: `${Math.min(usage.users.percentUsed, 100)}%` }}
                />
              </div>
            </div>

            {/* Health Checks Usage */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">Health Checks ({usage.healthChecks.periodLabel})</span>
                <span className="text-gray-500">
                  {usage.healthChecks.current} / {usage.healthChecks.limit === -1 ? '∞' : usage.healthChecks.limit.toLocaleString()}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(usage.healthChecks.percentUsed)} transition-all`}
                  style={{ width: `${Math.min(usage.healthChecks.percentUsed, 100)}%` }}
                />
              </div>
            </div>

            {/* Storage Usage */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">Storage</span>
                <span className="text-gray-500">
                  {usage.storage.currentGb} GB / {parseFloat(usage.storage.limitGb) === -1 ? '∞' : `${usage.storage.limitGb} GB`}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getProgressColor(usage.storage.percentUsed)} transition-all`}
                  style={{ width: `${Math.min(usage.storage.percentUsed, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade CTA */}
      <div className="mt-6 p-6 bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Need more capacity?</h3>
            <p className="text-gray-600 mt-1">Contact us to discuss upgrading your plan.</p>
          </div>
          <a
            href="mailto:support@ollosoft.co.uk"
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  )
}
