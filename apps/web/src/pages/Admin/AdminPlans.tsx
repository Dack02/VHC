import { useState, useEffect } from 'react'
import { useSuperAdmin } from '../../contexts/SuperAdminContext'
import { api } from '../../lib/api'

interface Plan {
  id: string
  name: string
  description: string
  maxSites: number | null
  maxUsers: number | null
  maxHealthChecksPerMonth: number | null
  maxStorageGb: number | null
  features: Record<string, boolean> | null
  priceMonthly: number | null
  priceAnnual: number | null
  currency: string
  isActive: boolean
  sortOrder: number
  subscriberCount: number
}

export default function AdminPlans() {
  const { session } = useSuperAdmin()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchPlans()
  }, [session])

  const fetchPlans = async () => {
    if (!session?.accessToken) return

    try {
      const data = await api<{ plans: Plan[] }>('/api/v1/admin/plans', { token: session.accessToken })
      setPlans(data.plans)
    } catch (error) {
      console.error('Failed to fetch plans:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSavePlan = async () => {
    if (!session?.accessToken || !editingPlan) return

    setSaving(true)
    try {
      await api(`/api/v1/admin/plans/${editingPlan.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          name: editingPlan.name,
          description: editingPlan.description,
          maxSites: editingPlan.maxSites,
          maxUsers: editingPlan.maxUsers,
          maxHealthChecksPerMonth: editingPlan.maxHealthChecksPerMonth,
          maxStorageGb: editingPlan.maxStorageGb,
          priceMonthly: editingPlan.priceMonthly,
          priceAnnual: editingPlan.priceAnnual,
          isActive: editingPlan.isActive
        }
      })
      setEditingPlan(null)
      fetchPlans()
    } catch (error) {
      console.error('Failed to save plan:', error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading plans...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
        <p className="text-gray-500 mt-1">Manage subscription plans and pricing</p>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl shadow-sm border ${
              plan.isActive ? 'border-gray-200' : 'border-gray-200 opacity-60'
            } overflow-hidden`}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                {!plan.isActive && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500 mb-4">{plan.description}</p>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Sites</span>
                  <span className="font-medium">{plan.maxSites ?? 'Unlimited'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Users</span>
                  <span className="font-medium">{plan.maxUsers ?? 'Unlimited'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Checks / Month</span>
                  <span className="font-medium">{plan.maxHealthChecksPerMonth?.toLocaleString() ?? 'Unlimited'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Storage</span>
                  <span className="font-medium">{plan.maxStorageGb != null ? `${plan.maxStorageGb} GB` : 'Unlimited'}</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-baseline">
                  <div>
                    <span className="text-2xl font-bold text-gray-900">
                      {plan.currency === 'GBP' ? '£' : '$'}{plan.priceMonthly}
                    </span>
                    <span className="text-gray-500 text-sm">/month</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {plan.currency === 'GBP' ? '£' : '$'}{plan.priceAnnual}/year
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setEditingPlan(plan)}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Edit Plan
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Plan Modal */}
      {editingPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Edit Plan: {editingPlan.name}</h2>
              <button onClick={() => setEditingPlan(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan Name</label>
                <input
                  type="text"
                  value={editingPlan.name}
                  onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editingPlan.description}
                  onChange={(e) => setEditingPlan({ ...editingPlan, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Sites</label>
                  <input
                    type="number"
                    value={editingPlan.maxSites ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, maxSites: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Leave empty for unlimited"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Users</label>
                  <input
                    type="number"
                    value={editingPlan.maxUsers ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, maxUsers: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Leave empty for unlimited"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Checks / Month</label>
                  <input
                    type="number"
                    value={editingPlan.maxHealthChecksPerMonth ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, maxHealthChecksPerMonth: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Leave empty for unlimited"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Storage (GB)</label>
                  <input
                    type="number"
                    value={editingPlan.maxStorageGb ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, maxStorageGb: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Leave empty for unlimited"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Price ({editingPlan.currency === 'GBP' ? '£' : '$'})</label>
                  <input
                    type="number"
                    value={editingPlan.priceMonthly ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, priceMonthly: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Yearly Price ({editingPlan.currency === 'GBP' ? '£' : '$'})</label>
                  <input
                    type="number"
                    value={editingPlan.priceAnnual ?? ''}
                    onChange={(e) => setEditingPlan({ ...editingPlan, priceAnnual: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editingPlan.isActive}
                  onChange={(e) => setEditingPlan({ ...editingPlan, isActive: e.target.checked })}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="isActive" className="ml-2 text-sm text-gray-700">
                  Plan is active and available for new organizations
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setEditingPlan(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePlan}
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
