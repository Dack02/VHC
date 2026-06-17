import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  onNext: () => void
}

interface Plan {
  id: string
  name: string
  description: string | null
  priceMonthly: number | null
  priceAnnual: number | null
  currency: string
  maxSites: number | null
  maxUsers: number | null
  maxHealthChecksPerMonth: number | null
  maxStorageGb: number | null
  isPopular: boolean
}

interface PlansResponse {
  plans: Plan[]
  currentPlanId: string | null
  status: string | null
  trialEndsAt: string | null
}

function formatLimit(value: number | null): string {
  if (value === null || value === undefined || value < 0) return 'Unlimited'
  return value.toLocaleString()
}

export default function StepPlan({ token, onNext }: Props) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await api<PlansResponse>('/api/v1/onboarding/plans', { token })
        if (!active) return
        setPlans(data.plans)
        setTrialEndsAt(data.trialEndsAt)
        setSelected(data.currentPlanId || data.plans.find(p => p.isPopular)?.id || data.plans[0]?.id || null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load plans')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [token])

  const handleContinue = async () => {
    if (!selected) {
      setError('Please choose a plan to continue')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api('/api/v1/onboarding/plan', { method: 'POST', token, body: { planId: selected } })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save your plan')
    } finally {
      setSaving(false)
    }
  }

  const trialDate = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Choose your plan to try</h2>
        <p className="text-gray-500 mt-1">Your free trial is already active — just pick the plan you'd like to explore. You won't be charged, and you can change it anytime in Settings.</p>
      </div>

      {/* Free-trial banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-start space-x-3">
        <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <div className="text-sm text-green-800">
          <p className="font-medium">1-month free trial — no credit card required</p>
          <p className="mt-0.5">
            You won't be charged{trialDate ? <> — your free trial runs until <strong>{trialDate}</strong></> : ' today'}.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-500">Loading plans...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map(plan => {
            const isSelected = selected === plan.id
            return (
              <button
                type="button"
                key={plan.id}
                onClick={() => setSelected(plan.id)}
                className={`relative text-left border rounded-xl p-5 transition-all ${
                  isSelected ? 'border-primary ring-2 ring-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {plan.isPopular && (
                  <span className="absolute -top-2 right-4 px-2 py-0.5 rounded-full text-xs font-medium bg-primary text-white">
                    Most popular
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${isSelected ? 'border-primary bg-primary' : 'border-gray-300'}`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </div>
                {plan.description && <p className="text-sm text-gray-500 mt-1">{plan.description}</p>}
                <div className="mt-3">
                  <span className="text-lg font-semibold text-green-700">Free for 1 month</span>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm text-gray-600">
                  <li className="flex justify-between"><span>Sites</span><span className="font-medium text-gray-900">{formatLimit(plan.maxSites)}</span></li>
                  <li className="flex justify-between"><span>Users</span><span className="font-medium text-gray-900">{formatLimit(plan.maxUsers)}</span></li>
                  <li className="flex justify-between"><span>Health checks / mo</span><span className="font-medium text-gray-900">{formatLimit(plan.maxHealthChecksPerMonth)}</span></li>
                  <li className="flex justify-between"><span>Storage</span><span className="font-medium text-gray-900">{plan.maxStorageGb !== null && plan.maxStorageGb >= 0 ? `${plan.maxStorageGb} GB` : 'Unlimited'}</span></li>
                </ul>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex justify-end pt-6 mt-6 border-t">
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || loading || !selected}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">No credit card required. You can change or cancel anytime from Settings → Subscription.</p>
    </div>
  )
}
