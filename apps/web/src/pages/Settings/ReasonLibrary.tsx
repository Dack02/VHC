/**
 * ReasonLibrary - Admin page for managing reasons
 * Shows grouped (by reason_type) and individual items views
 */

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Template {
  id: string
  name: string
}

interface ReasonTypeStats {
  reasonType: string
  displayName: string
  itemCount: number
  itemNames: string[]
  reasonCount: number
  totalUsage: number
  approvalRate: number | null
  unreviewedCount: number
}

interface UniqueItemStats {
  templateItemId: string
  name: string
  reasonCount: number
  totalUsage: number
  approvalRate: number | null
  unreviewedCount: number
}

interface ReasonsSummary {
  templateId: string
  templateName: string
  reasonTypes: ReasonTypeStats[]
  uniqueItems: UniqueItemStats[]
}

type ViewMode = 'grouped' | 'individual'

export default function ReasonLibrary() {
  const { user, session } = useAuth()
  const navigate = useNavigate()
  const orgId = user?.organization?.id

  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [summary, setSummary] = useState<ReasonsSummary | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('grouped')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [tone, setTone] = useState<'friendly' | 'premium'>('friendly')
  const [savingTone, setSavingTone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch templates on mount
  useEffect(() => {
    if (!session?.accessToken) return
    fetchTemplates()
    fetchPendingCount()
    fetchTone()
  }, [session?.accessToken])

  // Fetch summary when template changes
  useEffect(() => {
    if (selectedTemplateId) {
      fetchSummary()
    }
  }, [selectedTemplateId, search])

  const fetchTemplates = async () => {
    try {
      const data = await api<{ templates: Template[] }>('/api/v1/templates', {
        token: session?.accessToken
      })
      setTemplates(data.templates || [])
      if (data.templates?.length > 0) {
        setSelectedTemplateId(data.templates[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  const fetchSummary = async () => {
    if (!selectedTemplateId) return
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const data = await api<ReasonsSummary>(
        `/api/v1/templates/${selectedTemplateId}/reasons-summary?${params}`,
        { token: session?.accessToken }
      )
      setSummary(data)
    } catch (err) {
      console.error('Failed to fetch summary:', err)
    }
  }

  const fetchPendingCount = async () => {
    if (!orgId) return
    try {
      const data = await api<{ count: number }>(
        `/api/v1/organizations/${orgId}/reason-submissions/count?status=pending`,
        { token: session?.accessToken }
      )
      setPendingCount(data.count)
    } catch (err) {
      console.error('Failed to fetch pending count:', err)
    }
  }

  const fetchTone = async () => {
    if (!orgId) return
    try {
      const data = await api<{ tone: 'friendly' | 'premium' }>(
        `/api/v1/organizations/${orgId}/settings/reason-tone`,
        { token: session?.accessToken }
      )
      setTone(data.tone)
    } catch (err) {
      console.error('Failed to fetch tone:', err)
    }
  }

  const handleGenerateAll = async () => {
    if (!selectedTemplateId || generating) return
    setGenerating(true)
    try {
      const result = await api<{
        success: boolean
        reasonsCreated: number
        itemsProcessed: number
        typesProcessed: number
        errors?: string[]
      }>(`/api/v1/templates/${selectedTemplateId}/generate-all-reasons`, {
        method: 'POST',
        token: session?.accessToken
      })

      if (result.success) {
        alert(`Generated ${result.reasonsCreated} reasons for ${result.itemsProcessed} items and ${result.typesProcessed} types`)
        fetchSummary()
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate reasons')
    } finally {
      setGenerating(false)
    }
  }

  const handleToneChange = async (newTone: 'friendly' | 'premium') => {
    if (!orgId || savingTone) return
    setSavingTone(true)
    try {
      await api(`/api/v1/organizations/${orgId}/settings/reason-tone`, {
        method: 'PATCH',
        body: { tone: newTone },
        token: session?.accessToken
      })
      setTone(newTone)
    } catch (err) {
      console.error('Failed to update tone:', err)
    } finally {
      setSavingTone(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <SettingsBackLink />
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reason Library</h1>
        <p className="text-gray-600">Manage predefined reasons for inspection items</p>
      </div>

      {/* Controls */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          {/* Template Selector */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* View Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">View By</label>
            <div className="flex border border-gray-300 rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-4 py-2 text-sm font-medium ${
                  viewMode === 'grouped'
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Reason Types
              </button>
              <button
                onClick={() => setViewMode('individual')}
                className={`px-4 py-2 text-sm font-medium ${
                  viewMode === 'individual'
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Individual Items
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter items/types..."
              className="w-full border border-gray-300 rounded-md px-3 py-2"
            />
          </div>
        </div>

        {/* Actions Row */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleGenerateAll}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate All Missing
                </>
              )}
            </button>

            <Link
              to="/settings/reason-types"
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Manage Types
            </Link>

            {pendingCount > 0 && (
              <Link
                to="/settings/reason-submissions"
                className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-md hover:bg-amber-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Pending Submissions: {pendingCount}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'grouped' ? (
        <GroupedView
          reasonTypes={summary?.reasonTypes || []}
          onEdit={(type) => navigate(`/settings/reasons/type/${type}`)}
        />
      ) : (
        <IndividualView
          items={summary?.uniqueItems || []}
          onEdit={(id) => navigate(`/settings/reasons/item/${id}`)}
        />
      )}

      {/* Tone Setting */}
      <div className="bg-white shadow rounded-lg p-4 mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900">Organisation Tone</h3>
            <p className="text-sm text-gray-500">Used for AI-generated descriptions</p>
          </div>
          <select
            value={tone}
            onChange={(e) => handleToneChange(e.target.value as 'friendly' | 'premium')}
            disabled={savingTone}
            className="border border-gray-300 rounded-md px-3 py-2"
          >
            <option value="friendly">Friendly</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      </div>
    </div>
  )
}

// Grouped View Component
function GroupedView({
  reasonTypes,
  onEdit
}: {
  reasonTypes: ReasonTypeStats[]
  onEdit: (type: string) => void
}) {
  if (reasonTypes.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
        No reason types found. Items without a reason_type will appear in Individual Items view.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium text-gray-900">
        Grouped by Type (reasons apply to all items of this type)
      </h2>
      {reasonTypes.map((type) => (
        <div
          key={type.reasonType}
          className="bg-white shadow rounded-lg p-4 flex items-center justify-between"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-500 rounded-full" />
              <span className="font-medium text-gray-900">{type.displayName}</span>
              <span className="text-sm text-gray-500">({type.itemCount} items)</span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {type.itemNames.slice(0, 4).join(', ')}
              {type.itemNames.length > 4 && `, +${type.itemNames.length - 4} more`}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">{type.reasonCount}</div>
              <div className="text-xs text-gray-500">reasons</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">{type.totalUsage}</div>
              <div className="text-xs text-gray-500">uses</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">
                {type.approvalRate !== null ? `${type.approvalRate}%` : '-'}
              </div>
              <div className="text-xs text-gray-500">approval</div>
            </div>
            {type.unreviewedCount > 0 && (
              <div className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded">
                {type.unreviewedCount} unreviewed
              </div>
            )}
            <button
              onClick={() => onEdit(type.reasonType)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Edit
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Individual Items View Component
function IndividualView({
  items,
  onEdit
}: {
  items: UniqueItemStats[]
  onEdit: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
        No unique items found. Items with a reason_type will appear in Grouped view.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium text-gray-900">
        Unique Items (have their own specific reasons)
      </h2>
      {items.map((item) => (
        <div
          key={item.templateItemId}
          className="bg-white shadow rounded-lg p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-gray-400 rounded-full" />
            <span className="font-medium text-gray-900">{item.name}</span>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">{item.reasonCount}</div>
              <div className="text-xs text-gray-500">reasons</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">{item.totalUsage}</div>
              <div className="text-xs text-gray-500">uses</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-gray-900">
                {item.approvalRate !== null ? `${item.approvalRate}%` : '-'}
              </div>
              <div className="text-xs text-gray-500">approval</div>
            </div>
            {item.unreviewedCount > 0 && (
              <div className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded">
                {item.unreviewedCount} unreviewed
              </div>
            )}
            <button
              onClick={() => onEdit(item.templateItemId)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Edit
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
