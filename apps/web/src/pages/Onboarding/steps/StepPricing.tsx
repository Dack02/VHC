import { useState } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  onNext: () => void
  onBack: () => void
}

export default function StepPricing({ token, onNext, onBack }: Props) {
  const [labourRate, setLabourRate] = useState('85')
  const [vatRate, setVatRate] = useState('20')
  const [marginPercent, setMarginPercent] = useState('40')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async (withValues: boolean) => {
    setSaving(true); setError('')
    try {
      const body = withValues
        ? {
            labourRate: parseFloat(labourRate) || 0,
            vatRate: parseFloat(vatRate) || 0,
            marginPercent: parseFloat(marginPercent) || 0
          }
        : {}
      await api('/api/v1/onboarding/pricing', { method: 'POST', token, body })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save pricing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Pricing defaults</h2>
        <p className="text-gray-500 mt-1">
          These power your health-check quotes out of the box. You can refine labour codes, margins and VAT later in Settings → Pricing.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">{error}</div>}

      <div className="space-y-5 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Standard labour rate (per hour)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
            <input type="number" min="0" step="1" value={labourRate} onChange={e => setLabourRate(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
          </div>
          <p className="text-sm text-gray-500 mt-1">Your default hourly charge for labour.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">VAT rate</label>
          <div className="relative">
            <input type="number" min="0" max="100" step="0.5" value={vatRate} onChange={e => setVatRate(e.target.value)}
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Standard UK VAT is 20%.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Default parts margin</label>
          <div className="relative">
            <input type="number" min="0" max="100" step="1" value={marginPercent} onChange={e => setMarginPercent(e.target.value)}
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">%</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Applied when pricing parts on a repair.</p>
        </div>
      </div>

      <div className="flex justify-between pt-6 mt-6 border-t">
        <button type="button" onClick={onBack} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Back</button>
        <div className="flex space-x-3">
          <button type="button" onClick={() => save(false)} disabled={saving} className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors">Skip for now</button>
          <button type="button" onClick={() => save(true)} disabled={saving} className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors">{saving ? 'Saving...' : 'Continue'}</button>
        </div>
      </div>
    </div>
  )
}
