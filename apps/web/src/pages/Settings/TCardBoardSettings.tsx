import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface BoardConfig {
  id?: string
  defaultTechHours: number
  showCompletedColumn: boolean
  autoCompleteStatuses: string[]
}

export default function TCardBoardSettings() {
  const { user, session } = useAuth()
  const toast = useToast()

  const siteId = user?.site?.id
  const [config, setConfig] = useState<BoardConfig>({
    defaultTechHours: 8.0,
    showCompletedColumn: true,
    autoCompleteStatuses: ['completed'],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const fetchConfig = async () => {
      if (!session?.accessToken || !siteId) return
      try {
        const data = await api<{ config: BoardConfig }>(`/api/v1/tcard/config?siteId=${siteId}`, {
          token: session.accessToken,
        })
        setConfig(data.config)
      } catch {
        // Use defaults
      } finally {
        setLoading(false)
      }
    }
    fetchConfig()
  }, [session?.accessToken, siteId])

  const handleSave = async () => {
    if (!session?.accessToken || !siteId) return
    setSaving(true)
    try {
      await api('/api/v1/tcard/config', {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          siteId,
          defaultTechHours: config.defaultTechHours,
          showCompletedColumn: config.showCompletedColumn,
          autoCompleteStatuses: config.autoCompleteStatuses,
        },
      })
      toast.success('Board settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!siteId) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">&larr; Back to Settings</Link>
        <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl p-4 text-sm">
          No site assigned to your account. Board settings are configured per-site.
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">&larr; Back to Settings</Link>
        <h1 className="text-xl font-bold text-gray-900">Workshop Board — Settings</h1>
        <p className="text-sm text-gray-600 mt-1">Configure the workshop board for your site.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
          {/* Default tech hours */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Default Technician Hours Per Day</label>
            <p className="text-xs text-gray-500 mb-2">This is the default available hours when adding a new technician column.</p>
            <input
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={config.defaultTechHours}
              onChange={(e) => setConfig({ ...config, defaultTechHours: parseFloat(e.target.value) || 8.0 })}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Show completed column */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.showCompletedColumn}
                onChange={(e) => setConfig({ ...config, showCompletedColumn: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Show Completed Column</span>
                <p className="text-xs text-gray-500">Display the completed column on the board.</p>
              </div>
            </label>
          </div>

          {/* Auto-complete statuses */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Auto-Complete Health Check Statuses</label>
            <p className="text-xs text-gray-500 mb-2">
              When a health check reaches one of these statuses, its card automatically moves to the Completed column.
            </p>
            <input
              type="text"
              value={config.autoCompleteStatuses.join(', ')}
              onChange={(e) => setConfig({
                ...config,
                autoCompleteStatuses: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              placeholder="completed, closed, archived"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
