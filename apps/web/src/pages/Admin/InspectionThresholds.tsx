import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface Thresholds {
  tyreRedBelowMm: number
  tyreAmberBelowMm: number
  brakePadRedBelowMm: number
  brakePadAmberBelowMm: number
  updatedAt?: string
}

const DEFAULT_THRESHOLDS: Thresholds = {
  tyreRedBelowMm: 1.6,
  tyreAmberBelowMm: 3.0,
  brakePadRedBelowMm: 3.0,
  brakePadAmberBelowMm: 5.0
}

export default function InspectionThresholds() {
  const { session, user } = useAuth()
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchThresholds()
  }, [])

  const fetchThresholds = async () => {
    if (!user?.organization?.id) return

    try {
      setLoading(true)
      const data = await api<Thresholds>(`/api/v1/organizations/${user.organization.id}/thresholds`, {
        token: session?.accessToken
      })
      setThresholds(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thresholds')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!user?.organization?.id) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const data = await api<Thresholds>(`/api/v1/organizations/${user.organization.id}/thresholds`, {
        method: 'PATCH',
        body: thresholds,
        token: session?.accessToken
      })

      setThresholds(data)
      setSuccess('Thresholds saved successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save thresholds')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!user?.organization?.id) return
    if (!confirm('Are you sure you want to reset all thresholds to default values?')) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const data = await api<Thresholds>(`/api/v1/organizations/${user.organization.id}/thresholds`, {
        method: 'PATCH',
        body: { resetToDefaults: true },
        token: session?.accessToken
      })

      setThresholds(data)
      setSuccess('Thresholds reset to defaults')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset thresholds')
    } finally {
      setSaving(false)
    }
  }

  const updateThreshold = (key: keyof Thresholds, value: string) => {
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0) {
      setThresholds(prev => ({ ...prev, [key]: numValue }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inspection Thresholds</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure RAG status thresholds for tyre and brake inspections
          </p>
        </div>
        <button
          onClick={handleReset}
          disabled={saving}
          className="px-4 py-2 text-gray-700 border border-gray-300 font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Reset to Defaults
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
          <button onClick={() => setError('')} className="float-right text-red-700">&times;</button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 mb-6">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Tyre Depth Thresholds */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Tyre Tread Depth</h2>
            <p className="text-sm text-gray-500 mt-1">
              Set the minimum tread depth thresholds (UK legal minimum is 1.6mm)
            </p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThresholdInput
              label="Red (Urgent) - Below"
              value={thresholds.tyreRedBelowMm}
              onChange={(v) => updateThreshold('tyreRedBelowMm', v)}
              unit="mm"
              description="Items will show as RED when tread depth is below this value"
              color="red"
            />
            <ThresholdInput
              label="Amber (Advisory) - Below"
              value={thresholds.tyreAmberBelowMm}
              onChange={(v) => updateThreshold('tyreAmberBelowMm', v)}
              unit="mm"
              description="Items will show as AMBER when tread depth is below this value (but above red)"
              color="amber"
            />
          </div>
        </div>

        {/* Brake Pad Thresholds */}
        <div className="bg-white border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Brake Pad Thickness</h2>
            <p className="text-sm text-gray-500 mt-1">
              Set the minimum brake pad thickness thresholds
            </p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <ThresholdInput
              label="Red (Urgent) - Below"
              value={thresholds.brakePadRedBelowMm}
              onChange={(v) => updateThreshold('brakePadRedBelowMm', v)}
              unit="mm"
              description="Items will show as RED when pad thickness is below this value"
              color="red"
            />
            <ThresholdInput
              label="Amber (Advisory) - Below"
              value={thresholds.brakePadAmberBelowMm}
              onChange={(v) => updateThreshold('brakePadAmberBelowMm', v)}
              unit="mm"
              description="Items will show as AMBER when pad thickness is below this value (but above red)"
              color="amber"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-white px-6 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Thresholds'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ThresholdInputProps {
  label: string
  value: number
  onChange: (value: string) => void
  unit: string
  description: string
  color: 'red' | 'amber'
}

function ThresholdInput({ label, value, onChange, unit, description, color }: ThresholdInputProps) {
  const colorClasses = color === 'red'
    ? 'border-l-4 border-l-rag-red'
    : 'border-l-4 border-l-rag-amber'

  return (
    <div className={`p-4 bg-gray-50 ${colorClasses}`}>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step="0.1"
          min="0"
          className="w-24 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary text-lg font-medium"
        />
        <span className="text-gray-600 font-medium">{unit}</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">{description}</p>
    </div>
  )
}
