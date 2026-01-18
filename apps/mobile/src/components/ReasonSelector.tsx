/**
 * ReasonSelector Component
 *
 * Shows predefined reasons for inspection items, grouped by category.
 * Supports multiple selection, auto-RAG, follow-up intervals, and custom notes.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { Button } from './Button'
import { TextArea, Input } from './Input'
import { RAGIndicator } from './RAGSelector'

// Types
export interface ItemReason {
  id: string
  reasonText: string
  technicalDescription?: string
  customerDescription?: string
  defaultRag: 'red' | 'amber' | 'green'
  categoryId: string
  categoryName: string
  categoryColor?: string
  suggestedFollowUpDays?: number
  suggestedFollowUpText?: string
  usageCount?: number
  approvalRate?: number
  source?: 'specific' | 'type'
}

export interface ReasonCategory {
  id: string
  name: string
  color?: string
  typicalRag?: string
}

export interface SelectedReason {
  id: string
  itemReasonId: string
  reasonText: string
  defaultRag: 'red' | 'amber' | 'green'
  followUpDays?: number
  followUpText?: string
}

interface ReasonSelectorProps {
  templateItemId: string
  templateItemName: string
  healthCheckId: string
  checkResultId?: string
  currentRag: 'red' | 'amber' | 'green' | null
  onRagChange: (rag: 'red' | 'amber' | 'green') => void
  onClose: () => void
  onSave: (data: {
    selectedReasonIds: string[]
    followUpDays?: number
    followUpText?: string
    customNote?: string
    submitAsReason?: boolean
  }) => void
  initialSelectedReasons?: string[]
  vehicleRegistration?: string
}

// Follow-up presets
const FOLLOW_UP_PRESETS = [
  { label: 'None', days: null },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: 'Next MOT', days: 365 },
]

// Category display order
const CATEGORY_ORDER = ['safety', 'wear', 'maintenance', 'advisory', 'positive']

export function ReasonSelector({
  templateItemId,
  templateItemName,
  healthCheckId,
  checkResultId,
  currentRag,
  onRagChange,
  onClose,
  onSave,
  initialSelectedReasons = [],
  vehicleRegistration
}: ReasonSelectorProps) {
  const { session } = useAuth()
  const toast = useToast()

  // State
  const [loading, setLoading] = useState(true)
  const [reasons, setReasons] = useState<ItemReason[]>([])
  const [recentlyUsed, setRecentlyUsed] = useState<ItemReason[]>([])
  const [categories, setCategories] = useState<ReasonCategory[]>([])
  const [selectedReasonIds, setSelectedReasonIds] = useState<Set<string>>(
    new Set(initialSelectedReasons)
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [followUpDays, setFollowUpDays] = useState<number | null>(null)
  const [followUpText, setFollowUpText] = useState('')
  const [customNote, setCustomNote] = useState('')
  const [submitAsReason, setSubmitAsReason] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reasonType, setReasonType] = useState<string | null>(null)

  // Fetch reasons and existing selections on mount
  useEffect(() => {
    if (session?.access_token) {
      fetchReasons()
      fetchRecentlyUsed()
      // Fetch existing selected reasons if we have a checkResultId
      if (checkResultId) {
        fetchExistingSelections()
      }
    }
  }, [session?.access_token, templateItemId, checkResultId])

  const fetchReasons = async () => {
    try {
      const response = await api<{
        reasons: ItemReason[]
        categories: ReasonCategory[]
        reasonType: string | null
      }>(`/api/v1/template-items/${templateItemId}/reasons`, {
        token: session?.access_token
      })

      setReasons(response.reasons || [])
      setCategories(response.categories || [])
      setReasonType(response.reasonType)
    } catch (err) {
      console.error('Failed to fetch reasons:', err)
      toast.error('Failed to load reasons')
    } finally {
      setLoading(false)
    }
  }

  // Fetch existing selected reasons for this check result
  const fetchExistingSelections = async () => {
    if (!checkResultId) return

    try {
      const response = await api<{
        selectedReasons: Array<{
          id: string
          itemReasonId: string
          reasonText: string
          followUpDays?: number | null
          followUpText?: string | null
        }>
      }>(`/api/v1/check-results/${checkResultId}/reasons`, {
        token: session?.access_token
      })

      if (response.selectedReasons && response.selectedReasons.length > 0) {
        // Set the selected reason IDs from existing selections
        const existingReasonIds = new Set(response.selectedReasons.map(r => r.itemReasonId))
        setSelectedReasonIds(existingReasonIds)

        // Also load follow-up data from the first reason that has it
        const reasonWithFollowUp = response.selectedReasons.find(r => r.followUpDays)
        if (reasonWithFollowUp) {
          setFollowUpDays(reasonWithFollowUp.followUpDays || null)
          setFollowUpText(reasonWithFollowUp.followUpText || '')
        }
      }
    } catch (err) {
      console.error('Failed to fetch existing selections:', err)
      // Don't show error toast - just continue with empty selections
    }
  }

  const fetchRecentlyUsed = async () => {
    try {
      const response = await api<{ reasons: ItemReason[] }>(
        '/api/v1/reasons/recently-used?limit=5',
        { token: session?.access_token }
      )
      setRecentlyUsed(response.reasons || [])
    } catch (err) {
      console.error('Failed to fetch recently used:', err)
    }
  }

  // Filter reasons by search query
  const filteredReasons = useMemo(() => {
    if (!searchQuery.trim()) return reasons

    const query = searchQuery.toLowerCase()
    return reasons.filter(
      (r) =>
        r.reasonText.toLowerCase().includes(query) ||
        r.categoryName?.toLowerCase().includes(query)
    )
  }, [reasons, searchQuery])

  // Group reasons by category
  const groupedReasons = useMemo(() => {
    const groups: Record<string, ItemReason[]> = {}

    filteredReasons.forEach((reason) => {
      const categoryId = reason.categoryId || 'other'
      if (!groups[categoryId]) {
        groups[categoryId] = []
      }
      groups[categoryId].push(reason)
    })

    // Sort groups by category order
    const sortedGroups: Array<{ categoryId: string; categoryName: string; color?: string; reasons: ItemReason[] }> = []

    CATEGORY_ORDER.forEach((catId) => {
      if (groups[catId]) {
        const cat = categories.find((c) => c.id === catId)
        sortedGroups.push({
          categoryId: catId,
          categoryName: cat?.name || catId,
          color: cat?.color,
          reasons: groups[catId]
        })
        delete groups[catId]
      }
    })

    // Add any remaining categories
    Object.keys(groups).forEach((catId) => {
      const cat = categories.find((c) => c.id === catId)
      sortedGroups.push({
        categoryId: catId,
        categoryName: cat?.name || catId,
        color: cat?.color,
        reasons: groups[catId]
      })
    })

    return sortedGroups
  }, [filteredReasons, categories])

  // Get highest RAG from selected reasons
  const getHighestRag = useCallback((reasonIds: Set<string>): 'red' | 'amber' | 'green' | null => {
    if (reasonIds.size === 0) return null

    const selectedReasons = reasons.filter((r) => reasonIds.has(r.id))
    if (selectedReasons.some((r) => r.defaultRag === 'red')) return 'red'
    if (selectedReasons.some((r) => r.defaultRag === 'amber')) return 'amber'
    if (selectedReasons.some((r) => r.defaultRag === 'green')) return 'green'
    return null
  }, [reasons])

  // Handle reason selection
  const handleReasonToggle = (reason: ItemReason) => {
    // Haptic feedback
    if ('vibrate' in navigator) navigator.vibrate(30)

    // Calculate the new selected set
    const newSet = new Set(selectedReasonIds)

    if (newSet.has(reason.id)) {
      // Deselecting
      newSet.delete(reason.id)
    } else {
      // Selecting
      newSet.add(reason.id)

      // Auto-populate follow-up if reason has suggestion and no follow-up set
      if (reason.suggestedFollowUpDays && followUpDays === null) {
        setFollowUpDays(reason.suggestedFollowUpDays)
        if (reason.suggestedFollowUpText) {
          setFollowUpText(reason.suggestedFollowUpText)
        }
      }
    }

    // Update selected reasons state
    setSelectedReasonIds(newSet)

    // Auto-set RAG based on highest severity AFTER state update
    const newHighestRag = getHighestRag(newSet)
    if (newHighestRag && newHighestRag !== currentRag) {
      // Call onRagChange to update parent state - this will flow back as a new currentRag prop
      onRagChange(newHighestRag)
      toast.info(`Status auto-set to ${newHighestRag.toUpperCase()} based on selected reason`)
    }
  }

  // Handle follow-up preset selection
  const handleFollowUpPreset = (days: number | null) => {
    setFollowUpDays(days)
    if (days === null) {
      setFollowUpText('')
    }
  }

  // Handle save
  const handleSave = async () => {
    setSaving(true)

    try {
      // Submit custom reason if checked
      if (submitAsReason && customNote.trim()) {
        await api('/api/v1/reason-submissions', {
          method: 'POST',
          token: session?.access_token,
          body: JSON.stringify({
            templateItemId,
            reasonType,
            reasonText: customNote.trim(),
            notes: `Submitted during inspection of ${vehicleRegistration || 'unknown vehicle'}`,
            healthCheckId,
            checkResultId
          })
        })
        toast.success('Reason submitted for manager review')
      }

      // Call onSave with selected data
      onSave({
        selectedReasonIds: Array.from(selectedReasonIds),
        followUpDays: followUpDays ?? undefined,
        followUpText: followUpText || undefined,
        customNote: customNote || undefined,
        submitAsReason
      })

      onClose()
    } catch (err) {
      console.error('Failed to save:', err)
      toast.error('Failed to save reasons')
    } finally {
      setSaving(false)
    }
  }

  // Show search if more than 10 reasons
  const showSearch = reasons.length > 10

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
        <div className="bg-white w-full rounded-t-2xl max-h-[90vh] flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <div className="bg-white w-full rounded-t-2xl max-h-[90vh] flex flex-col">
        {/* Header - min 44px touch targets for mobile */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold flex-1 pr-2">{templateItemName}</h2>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-gray-500 hover:text-gray-700 -mr-2"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Current Status - min 44px touch targets */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Status:</span>
            <div className="flex gap-2">
              {(['green', 'amber', 'red'] as const).map((rag) => (
                <button
                  key={rag}
                  onClick={() => onRagChange(rag)}
                  className={`
                    min-h-[44px] px-4 py-2.5 text-sm font-medium rounded-full transition-colors
                    ${currentRag === rag
                      ? rag === 'green'
                        ? 'bg-rag-green text-white'
                        : rag === 'amber'
                          ? 'bg-rag-amber text-white'
                          : 'bg-rag-red text-white'
                      : 'bg-gray-100 text-gray-600'
                    }
                  `}
                >
                  {rag === 'green' ? '✓ Pass' : rag === 'amber' ? '⚠ Advisory' : '✕ Urgent'}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          {showSearch && (
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search reasons..."
                className="pl-10"
              />
            </div>
          )}

          {/* Recently Used */}
          {recentlyUsed.length > 0 && !searchQuery && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Recently Used
              </h3>
              <div className="space-y-2">
                {recentlyUsed.slice(0, 3).map((reason) => (
                  <ReasonItem
                    key={`recent-${reason.id}`}
                    reason={reason}
                    selected={selectedReasonIds.has(reason.id)}
                    onToggle={() => handleReasonToggle(reason)}
                    showBadge="recent"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Grouped Reasons */}
          {groupedReasons.length > 0 ? (
            groupedReasons.map((group) => (
              <div key={group.categoryId} className="space-y-2">
                <h3
                  className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2"
                  style={{ color: group.color || '#6B7280' }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: group.color || '#6B7280' }}
                  />
                  {group.categoryName}
                </h3>
                <div className="space-y-2">
                  {group.reasons.map((reason) => (
                    <ReasonItem
                      key={reason.id}
                      reason={reason}
                      selected={selectedReasonIds.has(reason.id)}
                      onToggle={() => handleReasonToggle(reason)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              {searchQuery ? (
                <p className="text-gray-500">No reasons match your search</p>
              ) : (
                <div className="space-y-2">
                  <div className="w-12 h-12 mx-auto bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-gray-600 font-medium">No reasons configured</p>
                  <p className="text-gray-400 text-sm">Ask your manager to add reasons for this item</p>
                </div>
              )}
            </div>
          )}

          {/* Divider */}
          <hr className="border-gray-200" />

          {/* Follow-up Section - min 44px touch targets */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">Follow-up Recommendation</h3>
            <div className="flex flex-wrap gap-2">
              {FOLLOW_UP_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleFollowUpPreset(preset.days)}
                  className={`
                    min-h-[44px] px-4 py-2.5 text-sm rounded-full border transition-colors
                    ${followUpDays === preset.days
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                    }
                  `}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {followUpDays !== null && (
              <Input
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                placeholder="Add follow-up message (optional)"
              />
            )}
          </div>

          {/* Custom Note Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">📝 Additional Notes</h3>
            <TextArea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Type additional observations..."
              rows={3}
            />
            {customNote.trim() && (
              <label className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                <div
                  className={`
                    w-5 h-5 flex-shrink-0 border-2 rounded flex items-center justify-center transition-colors
                    ${submitAsReason
                      ? 'bg-primary border-primary'
                      : 'bg-white border-gray-400'
                    }
                  `}
                >
                  {submitAsReason && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={submitAsReason}
                  onChange={(e) => setSubmitAsReason(e.target.checked)}
                  className="sr-only"
                />
                <span className="text-sm text-blue-800">
                  Submit as new reason for manager review
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 safe-area-inset-bottom">
          <Button onClick={handleSave} fullWidth disabled={saving}>
            {saving ? 'Saving...' : 'Save & Continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Individual reason item
interface ReasonItemProps {
  reason: ItemReason
  selected: boolean
  onToggle: () => void
  showBadge?: 'recent'
}

function ReasonItem({ reason, selected, onToggle, showBadge }: ReasonItemProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        w-full min-h-[56px] p-3 rounded-lg border-2 text-left transition-colors active:scale-[0.98]
        ${selected
          ? 'border-primary bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 bg-white'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <div
          className={`
            w-5 h-5 flex-shrink-0 mt-0.5 border-2 rounded flex items-center justify-center transition-colors
            ${selected
              ? 'bg-primary border-primary'
              : 'bg-white border-gray-400'
            }
          `}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{reason.reasonText}</span>
            {showBadge === 'recent' && (
              <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                Recent
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span>→ Auto:</span>
              <RAGIndicator status={reason.defaultRag} size="sm" />
              <span className="capitalize">{reason.defaultRag}</span>
            </span>
            {reason.suggestedFollowUpDays && (
              <span className="flex items-center gap-1">
                <span>|</span>
                <span>Follow-up: {formatFollowUp(reason.suggestedFollowUpDays)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// Format follow-up days to human-readable text
function formatFollowUp(days: number): string {
  if (days <= 0) return 'Immediate'
  if (days <= 7) return `${days} days`
  if (days <= 30) return `${Math.round(days / 7)} week${days > 7 ? 's' : ''}`
  if (days <= 90) return `${Math.round(days / 30)} month${days > 30 ? 's' : ''}`
  if (days <= 180) return '6 months'
  if (days <= 365) return 'Next MOT'
  return `${Math.round(days / 365)} year${days > 365 ? 's' : ''}`
}

export default ReasonSelector
