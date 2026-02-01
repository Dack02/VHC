import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface PricingSettingsData {
  defaultMarginPercent: number
  vatRate: number
}

export default function PricingSettings() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [settings, setSettings] = useState<PricingSettingsData>({
    defaultMarginPercent: 40.00,
    vatRate: 20.00,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalSettings, setOriginalSettings] = useState<PricingSettingsData | null>(null)

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchSettings()
    }
  }, [organizationId])

  useEffect(() => {
    if (originalSettings) {
      const changed =
        settings.defaultMarginPercent !== originalSettings.defaultMarginPercent ||
        settings.vatRate !== originalSettings.vatRate
      setHasChanges(changed)
    }
  }, [settings, originalSettings])

  const fetchSettings = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<{ settings: PricingSettingsData }>(
        `/api/v1/organizations/${organizationId}/pricing-settings`,
        { token: session?.accessToken }
      )
      const fetchedSettings = {
        defaultMarginPercent: data.settings?.defaultMarginPercent ?? 40.00,
        vatRate: data.settings?.vatRate ?? 20.00,
      }
      setSettings(fetchedSettings)
      setOriginalSettings(fetchedSettings)
    } catch (err) {
      // If endpoint doesn't exist yet, use defaults
      console.error('Failed to load pricing settings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!organizationId) return

    try {
      setSaving(true)
      await api(
        `/api/v1/organizations/${organizationId}/pricing-settings`,
        {
          method: 'PATCH',
          body: {
            default_margin_percent: settings.defaultMarginPercent,
            vat_rate: settings.vatRate,
          },
          token: session?.accessToken
        }
      )
      toast.success('Pricing settings saved')
      setOriginalSettings(settings)
      setHasChanges(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  // Example calculation
  const exampleCost = 25.00
  const exampleSellPrice = exampleCost / (1 - settings.defaultMarginPercent / 100)
  const exampleMarkup = ((exampleSellPrice - exampleCost) / exampleCost) * 100
  const exampleProfit = exampleSellPrice - exampleCost

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Settings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure default margin and VAT rate for repair quotes
          </p>
        </div>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Default Margin */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Default Margin</h2>
            <p className="text-sm text-gray-500 mt-1">
              Pre-filled margin percentage when adding parts
            </p>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.defaultMarginPercent}
                onChange={(e) => setSettings({
                  ...settings,
                  defaultMarginPercent: parseFloat(e.target.value) || 0
                })}
                className="w-24 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary text-right"
              />
              <span className="text-gray-700 font-medium">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Used in the margin calculator when adding parts to repair quotes.
              This will be the default value but can be changed per part.
            </p>

            {/* Margin Calculator Example */}
            <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">Example Calculation:</p>
              <div className="text-sm text-gray-600 space-y-1">
                <p>Cost Price: <span className="font-mono">£{exampleCost.toFixed(2)}</span></p>
                <p>Margin: <span className="font-mono">{settings.defaultMarginPercent.toFixed(1)}%</span></p>
                <div className="border-t border-gray-300 my-2" />
                <p>Sell Price: <span className="font-mono font-semibold text-gray-900">£{exampleSellPrice.toFixed(2)}</span></p>
                <p>Markup: <span className="font-mono">{exampleMarkup.toFixed(1)}%</span></p>
                <p>Profit: <span className="font-mono text-green-600">£{exampleProfit.toFixed(2)}</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* VAT Rate */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">VAT Rate</h2>
            <p className="text-sm text-gray-500 mt-1">
              Applied to labour (except VAT-exempt codes) and parts
            </p>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={settings.vatRate}
                onChange={(e) => setSettings({
                  ...settings,
                  vatRate: parseFloat(e.target.value) || 0
                })}
                className="w-24 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary text-right"
              />
              <span className="text-gray-700 font-medium">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Standard UK VAT rate is 20%. This is applied when calculating repair totals.
            </p>

            {/* VAT Example */}
            <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-2">Example:</p>
              <div className="text-sm text-gray-600 space-y-1">
                <p>Labour: <span className="font-mono">£85.00</span></p>
                <p>Parts: <span className="font-mono">£150.00</span></p>
                <p>Subtotal (ex VAT): <span className="font-mono">£235.00</span></p>
                <p>VAT ({settings.vatRate}%): <span className="font-mono">£{(235 * settings.vatRate / 100).toFixed(2)}</span></p>
                <div className="border-t border-gray-300 my-2" />
                <p>Total (inc VAT): <span className="font-mono font-semibold text-gray-900">£{(235 + 235 * settings.vatRate / 100).toFixed(2)}</span></p>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Note: MOT labour marked as VAT-exempt will not have VAT applied.
              </p>
            </div>
          </div>
        </div>

        {/* Formula Reference */}
        <div className="bg-blue-50 border border-blue-200 p-4 rounded">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">Formula Reference</h3>
          <div className="text-sm text-blue-700 space-y-2 font-mono">
            <p>Margin % = (Sell - Cost) / Sell × 100</p>
            <p>Markup % = (Sell - Cost) / Cost × 100</p>
            <p>Sell Price = Cost / (1 - Margin% / 100)</p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          {hasChanges && (
            <button
              onClick={() => {
                if (originalSettings) {
                  setSettings(originalSettings)
                }
              }}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="bg-primary text-white px-6 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
