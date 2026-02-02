/**
 * SummaryTab Component - Redesigned for Repair Groups & Pricing
 * Shows workflow badges, repair items, unassigned check results, and quote totals
 */

import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api, NewRepairItem, CheckResult, PricingSettings } from '../../../lib/api'
import {
  WorkflowBadges,
  BadgeStatus,
  RepairItemBadges,
  useWorkflowStatus,
  calculateAuthorisationInfo
} from '../../../components/WorkflowBadges'

interface SummaryTabProps {
  healthCheckId: string
  sentAt: string | null
  bookedRepairs?: Array<{ code?: string; description?: string; notes?: string; labourItems?: Array<{ description: string; price?: number; units?: number; fitter?: string }> }>
  bookingNotes?: string | null
  onUpdate: () => void
}

export function SummaryTab({ healthCheckId, sentAt, bookedRepairs, bookingNotes, onUpdate }: SummaryTabProps) {
  const { session, user } = useAuth()
  const [repairItems, setRepairItems] = useState<NewRepairItem[]>([])
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const [unassignedResults, setUnassignedResults] = useState<CheckResult[]>([])
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingItem, setEditingItem] = useState<NewRepairItem | null>(null)
  const [preselectedCheckResultId, setPreselectedCheckResultId] = useState<string | null>(null)

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      if (!session?.accessToken || !user?.organization?.id) return

      setLoading(true)
      setError(null)

      try {
        const [itemsRes, unassignedRes, pricingRes] = await Promise.all([
          api<{ repairItems: NewRepairItem[] }>(
            `/api/v1/health-checks/${healthCheckId}/repair-items`,
            { token: session.accessToken }
          ),
          api<{ checkResults: CheckResult[] }>(
            `/api/v1/health-checks/${healthCheckId}/unassigned-check-results`,
            { token: session.accessToken }
          ),
          api<{ settings: PricingSettings }>(
            `/api/v1/organizations/${user.organization.id}/pricing-settings`,
            { token: session.accessToken }
          )
        ])

        setRepairItems(itemsRes.repairItems || [])
        setUnassignedResults(unassignedRes.checkResults || [])
        setPricingSettings(pricingRes.settings || null)

        // Also fetch all check results for the create modal
        const allResultsRes = await api<{ results: CheckResult[] }>(
          `/api/v1/health-checks/${healthCheckId}/results`,
          { token: session.accessToken }
        )
        setCheckResults(allResultsRes.results || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session?.accessToken, healthCheckId, user?.organization?.id])

  // Calculate overall workflow status using shared hook
  const workflowStatus = useWorkflowStatus(repairItems, sentAt)

  // Calculate authorisation info for A badge tooltip
  const authorisationInfo = useMemo(() => calculateAuthorisationInfo(repairItems), [repairItems])

  // Calculate quote totals
  const quoteTotals = useMemo(() => {
    let labourTotal = 0
    let partsTotal = 0
    let vatAmount = 0
    const vatRate = pricingSettings?.vatRate || 20

    repairItems.forEach(item => {
      // Use selected option totals if available, otherwise use item totals
      if (item.selectedOptionId && item.options) {
        const selectedOption = item.options.find(o => o.id === item.selectedOptionId)
        if (selectedOption) {
          labourTotal += selectedOption.labourTotal
          partsTotal += selectedOption.partsTotal
          vatAmount += selectedOption.vatAmount
          return
        }
      }
      labourTotal += item.labourTotal
      partsTotal += item.partsTotal
      vatAmount += item.vatAmount
    })

    const subtotal = labourTotal + partsTotal
    const totalIncVat = subtotal + vatAmount

    return { labourTotal, partsTotal, subtotal, vatAmount, totalIncVat, vatRate }
  }, [repairItems, pricingSettings])

  // Get highest RAG status from check results
  const getRepairItemRag = (item: NewRepairItem): 'red' | 'amber' | 'green' | 'grey' => {
    if (!item.checkResults || item.checkResults.length === 0) return 'grey'
    const hasRed = item.checkResults.some(cr => cr.ragStatus === 'red')
    const hasAmber = item.checkResults.some(cr => cr.ragStatus === 'amber')
    if (hasRed) return 'red'
    if (hasAmber) return 'amber'
    return 'green'
  }

  const handleCreateRepair = (checkResultId?: string) => {
    setPreselectedCheckResultId(checkResultId || null)
    setShowCreateModal(true)
  }

  const handleEditRepair = (item: NewRepairItem) => {
    setEditingItem(item)
    setShowEditModal(true)
  }

  const handleUngroup = async (itemId: string) => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to ungroup these items? They will become individual repair items again.')) return

    try {
      await api(`/api/v1/repair-items/${itemId}/ungroup`, {
        method: 'POST',
        token: session.accessToken
      })
      refreshData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ungroup')
    }
  }

  const refreshData = async () => {
    if (!session?.accessToken) return
    try {
      const [itemsRes, unassignedRes] = await Promise.all([
        api<{ repairItems: NewRepairItem[] }>(
          `/api/v1/health-checks/${healthCheckId}/repair-items`,
          { token: session.accessToken }
        ),
        api<{ checkResults: CheckResult[] }>(
          `/api/v1/health-checks/${healthCheckId}/unassigned-check-results`,
          { token: session.accessToken }
        )
      ])
      setRepairItems(itemsRes.repairItems || [])
      setUnassignedResults(unassignedRes.checkResults || [])
      onUpdate()
    } catch (err) {
      // Silent refresh error
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Workflow Status Badges */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 mr-2">Status:</span>
        <WorkflowBadges status={workflowStatus} authorisationInfo={authorisationInfo} />
      </div>

      {/* Pre-Booked Work Section */}
      {(bookedRepairs && bookedRepairs.length > 0 || bookingNotes) && (() => {
        // Check if any repair has labour items (new format)
        const hasLabourItems = bookedRepairs?.some(r => r.labourItems && r.labourItems.length > 0) ?? false
        // Flatten all labour items across all repairs
        const allLabourItems = hasLabourItems
          ? bookedRepairs!.flatMap(r => r.labourItems || [])
          : []

        return (
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-200 bg-blue-50">
              <h3 className="font-semibold text-gray-900">PRE-BOOKED WORK</h3>
              <p className="text-xs text-gray-500 mt-1">
                Work booked in the DMS before vehicle arrival
              </p>
            </div>

            {/* Booking-level notes header */}
            {bookingNotes && (
              <div className="px-4 py-3 bg-blue-50/50 border-b border-gray-200">
                <div className="text-sm font-medium text-gray-900">{bookingNotes}</div>
              </div>
            )}

            {hasLabourItems ? (
              /* New format: labour line items */
              <div className="divide-y divide-gray-200">
                {allLabourItems.map((item, index) => (
                  <div key={index} className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-primary">•</span>
                      <span className="text-sm font-medium text-gray-900">{item.description}</span>
                    </div>
                    {item.price != null && item.price > 0 && (
                      <span className="text-sm text-gray-500">£{item.price.toFixed(2)}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : bookedRepairs && bookedRepairs.length > 0 ? (
              /* Fallback: old format (code + description + notes) */
              <div className="divide-y divide-gray-200">
                {bookedRepairs.map((repair, index) => (
                  <div key={index} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      {repair.code && (
                        <span className="px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-700 rounded">
                          {repair.code}
                        </span>
                      )}
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {repair.description || 'No description'}
                        </div>
                        {repair.notes && (
                          <div className="text-sm text-gray-500 mt-1">{repair.notes}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })()}

      {/* Repair Groups & Items Section */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">REPAIR GROUPS & ITEMS</h3>
          <button
            onClick={() => handleCreateRepair()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-primary rounded hover:bg-primary-dark"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Repair
          </button>
        </div>

        <div className="divide-y divide-gray-200">
          {repairItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              No repair items created yet. Click "Create Repair" to add one.
            </div>
          ) : (
            repairItems.map(item => (
              <RepairItemCard
                key={item.id}
                item={item}
                ragStatus={getRepairItemRag(item)}
                onEdit={() => handleEditRepair(item)}
                onUngroup={() => handleUngroup(item.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Unassigned Check Results Section */}
      {unassignedResults.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">UNASSIGNED CHECK RESULTS</h3>
            <p className="text-xs text-gray-500 mt-1">
              These items need to be added to a repair group or individual repair
            </p>
          </div>

          <div className="divide-y divide-gray-200">
            {unassignedResults.map(result => (
              <div key={result.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RagIndicator status={result.rag_status} />
                  <div>
                    <div className="font-medium text-gray-900">
                      {result.template_item?.name || 'Unknown Item'}
                    </div>
                    {result.notes && (
                      <div className="text-sm text-gray-500">{result.notes}</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleCreateRepair(result.id)}
                  className="px-3 py-1.5 text-sm font-medium text-primary border border-primary rounded hover:bg-primary hover:text-white"
                >
                  Create Repair
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quote Total Section */}
      {repairItems.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-4">QUOTE TOTAL</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Labour:</span>
              <span className="font-medium">£{quoteTotals.labourTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Parts:</span>
              <span className="font-medium">£{quoteTotals.partsTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
              <span className="text-gray-500">Subtotal:</span>
              <span className="font-medium">£{quoteTotals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">VAT ({quoteTotals.vatRate}%):</span>
              <span className="font-medium">£{quoteTotals.vatAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t border-gray-200 pt-2">
              <span>TOTAL:</span>
              <span>£{quoteTotals.totalIncVat.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateRepairModal
          healthCheckId={healthCheckId}
          checkResults={checkResults}
          preselectedCheckResultId={preselectedCheckResultId}
          onClose={() => {
            setShowCreateModal(false)
            setPreselectedCheckResultId(null)
          }}
          onCreated={refreshData}
        />
      )}

      {showEditModal && editingItem && (
        <EditRepairModal
          repairItem={editingItem}
          checkResults={checkResults}
          onClose={() => {
            setShowEditModal(false)
            setEditingItem(null)
          }}
          onSaved={refreshData}
        />
      )}

    </div>
  )
}

// ============================================================================
// RAG INDICATOR COMPONENT
// ============================================================================

function RagIndicator({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    green: 'bg-green-500',
    grey: 'bg-gray-400'
  }

  return (
    <span className={`w-3 h-3 rounded-full ${status ? colors[status] : colors.grey}`} />
  )
}

// ============================================================================
// REPAIR ITEM CARD COMPONENT
// ============================================================================

interface RepairItemCardProps {
  item: NewRepairItem
  ragStatus: 'red' | 'amber' | 'green' | 'grey'
  onEdit: () => void
  onUngroup?: () => void
}

function RepairItemCard({ item, ragStatus, onEdit, onUngroup }: RepairItemCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasOptions = item.options && item.options.length > 0
  const hasChildren = item.children && item.children.length > 0

  // Get linked check result names
  const linkedNames = item.checkResults?.map(cr => cr.templateItem?.name || 'Unknown').join(', ') || ''

  // Calculate item-level workflow status
  const labourBadgeStatus: BadgeStatus = item.labourStatus === 'complete' ? 'complete' : item.labourStatus === 'in_progress' ? 'in_progress' : 'pending'
  const partsBadgeStatus: BadgeStatus = item.partsStatus === 'complete' ? 'complete' : item.partsStatus === 'in_progress' ? 'in_progress' : 'pending'

  const ragColors: Record<string, string> = {
    red: 'border-l-red-500',
    amber: 'border-l-amber-500',
    green: 'border-l-green-500',
    grey: 'border-l-gray-400'
  }

  // Get RAG status for a child item from its check results
  const getChildRagStatus = (child: NonNullable<typeof item.children>[0]): 'red' | 'amber' | 'green' | 'grey' => {
    if (!child.checkResults || child.checkResults.length === 0) return 'grey'
    const hasRed = child.checkResults.some(cr => cr.ragStatus === 'red')
    const hasAmber = child.checkResults.some(cr => cr.ragStatus === 'amber')
    if (hasRed) return 'red'
    if (hasAmber) return 'amber'
    return 'green'
  }

  return (
    <div className={`px-4 py-4 border-l-4 ${ragColors[ragStatus]}`}>
      {/* Header row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Expand/collapse toggle for groups with children */}
          {hasChildren && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-0.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          <RagIndicator status={ragStatus} />
          <span className="font-semibold text-gray-900">{item.name}</span>
          {item.isGroup && (
            <span className="px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded">
              GROUP{hasChildren ? ` (${item.children!.length})` : ''}
            </span>
          )}
        </div>
        <RepairItemBadges labourStatus={labourBadgeStatus} partsStatus={partsBadgeStatus} />
      </div>

      {/* Expandable children list */}
      {hasChildren && isExpanded && (
        <div className="ml-6 mb-3 border-l-2 border-gray-200 pl-3 space-y-2">
          <div className="text-xs font-medium text-gray-500 uppercase">Grouped Items:</div>
          {item.children!.map(child => {
            const childRag = getChildRagStatus(child)
            const childName = child.checkResults?.[0]?.templateItem?.name || child.name
            return (
              <div key={child.id} className="flex items-center gap-2 text-sm">
                <RagIndicator status={childRag} />
                <span className="text-gray-700">{childName}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Linked check results (only show if no children or not expanded) */}
      {linkedNames && !hasChildren && (
        <div className="text-sm text-gray-500 mb-3 ml-5">
          Linked: {linkedNames}
        </div>
      )}

      {/* Pricing display (read-only) */}
      {hasOptions ? (
        <div className="ml-5 mb-3 text-sm text-gray-600 space-y-1">
          {item.options!.map(option => (
            <div
              key={option.id}
              className={`flex items-center justify-between ${
                item.selectedOptionId === option.id ? 'text-gray-900 font-medium' : 'text-gray-400'
              }`}
            >
              <span>
                {item.selectedOptionId === option.id && 'Selected: '}
                {option.name}
                {option.isRecommended && ' (Recommended)'}
              </span>
              <span>£{option.totalIncVat.toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ml-5 mb-3 text-sm text-gray-600 space-y-1">
          {item.labourTotal > 0 && (
            <div>Labour: £{item.labourTotal.toFixed(2)}</div>
          )}
          {item.partsTotal > 0 && (
            <div>Parts: £{item.partsTotal.toFixed(2)}</div>
          )}
          {(item.labourTotal > 0 || item.partsTotal > 0) && (
            <div className="pt-1 border-t border-gray-100">
              <span className="font-medium">Subtotal: £{item.subtotal.toFixed(2)}</span>
              <span className="text-gray-500"> + VAT = £{item.totalIncVat.toFixed(2)}</span>
            </div>
          )}
          {item.labourTotal === 0 && item.partsTotal === 0 && (
            <div className="text-gray-400 italic">No labour or parts added yet</div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="ml-5 flex gap-2">
        <button
          onClick={onEdit}
          className="px-3 py-1 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
        >
          Edit
        </button>
        {/* Ungroup button for groups with children */}
        {item.isGroup && hasChildren && onUngroup && (
          <button
            onClick={onUngroup}
            className="px-3 py-1 text-sm text-amber-600 border border-amber-300 rounded hover:bg-amber-50"
          >
            Ungroup
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// CREATE REPAIR MODAL
// ============================================================================

interface CreateRepairModalProps {
  healthCheckId: string
  checkResults: CheckResult[]
  preselectedCheckResultId: string | null
  onClose: () => void
  onCreated: () => void
}

function CreateRepairModal({
  healthCheckId,
  checkResults,
  preselectedCheckResultId,
  onClose,
  onCreated
}: CreateRepairModalProps) {
  const { session } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isGroup, setIsGroup] = useState(false)
  const [selectedCheckResultIds, setSelectedCheckResultIds] = useState<Set<string>>(
    preselectedCheckResultId ? new Set([preselectedCheckResultId]) : new Set()
  )
  const [addOptions, setAddOptions] = useState(false)

  // Pre-fill name from preselected check result
  useEffect(() => {
    if (preselectedCheckResultId) {
      const result = checkResults.find(r => r.id === preselectedCheckResultId)
      if (result?.template_item?.name) {
        setName(result.template_item.name)
      }
    }
  }, [preselectedCheckResultId, checkResults])

  const toggleCheckResult = (id: string) => {
    const newSet = new Set(selectedCheckResultIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedCheckResultIds(newSet)

    // Auto-set to group if multiple selected
    if (newSet.size > 1) {
      setIsGroup(true)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken || !name.trim()) return

    setSaving(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        is_group: isGroup,
        check_result_ids: Array.from(selectedCheckResultIds)
      }

      await api<{ id: string }>(
        `/api/v1/health-checks/${healthCheckId}/repair-items`,
        {
          method: 'POST',
          token: session.accessToken,
          body
        }
      )

      // If addOptions is checked, open add option modal for the new item
      // For now, just close and refresh
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repair')
    } finally {
      setSaving(false)
    }
  }

  // Filter to red/amber results (and green if preselected)
  const availableResults = checkResults.filter(r =>
    r.rag_status === 'red' || r.rag_status === 'amber' || selectedCheckResultIds.has(r.id)
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Create Repair</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repair Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Front Brake Overhaul"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Complete front brake service including pads and discs"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!isGroup}
                  onChange={() => setIsGroup(false)}
                  className="text-primary focus:ring-primary"
                />
                <span>Individual Repair (single item)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={isGroup}
                  onChange={() => setIsGroup(true)}
                  className="text-primary focus:ring-primary"
                />
                <span>Repair Group (bundle multiple items)</span>
              </label>
            </div>
          </div>

          {/* Link Check Results */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Link Check Results
            </label>
            <div className="border border-gray-200 rounded max-h-48 overflow-y-auto">
              {availableResults.length === 0 ? (
                <div className="px-3 py-4 text-center text-gray-500 text-sm">
                  No red or amber check results available
                </div>
              ) : (
                availableResults.map(result => (
                  <label
                    key={result.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCheckResultIds.has(result.id)}
                      onChange={() => toggleCheckResult(result.id)}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <RagIndicator status={result.rag_status} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {result.template_item?.name || 'Unknown'}
                      </div>
                      {result.notes && (
                        <div className="text-xs text-gray-500 truncate">{result.notes}</div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Add Options checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={addOptions}
              onChange={e => setAddOptions(e.target.checked)}
              className="rounded text-primary focus:ring-primary"
            />
            <span className="text-sm text-gray-700">Add repair options (e.g., Standard vs Premium)</span>
          </label>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Repair'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// EDIT REPAIR MODAL
// ============================================================================

interface EditRepairModalProps {
  repairItem: NewRepairItem
  checkResults: CheckResult[]
  onClose: () => void
  onSaved: () => void
}

function EditRepairModal({ repairItem, checkResults, onClose, onSaved }: EditRepairModalProps) {
  const { session } = useAuth()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState(repairItem.name)
  const [description, setDescription] = useState(repairItem.description || '')
  const [priceOverride, setPriceOverride] = useState(repairItem.priceOverride?.toString() || '')
  const [priceOverrideReason, setPriceOverrideReason] = useState(repairItem.priceOverrideReason || '')
  const [linkedIds, setLinkedIds] = useState<Set<string>>(
    new Set(repairItem.checkResults?.map(cr => cr.id) || [])
  )

  const toggleCheckResult = async (crId: string) => {
    if (!session?.accessToken) return

    const isCurrentlyLinked = linkedIds.has(crId)
    try {
      if (isCurrentlyLinked) {
        // Unlink
        await api(`/api/v1/repair-items/${repairItem.id}/check-results/${crId}`, {
          method: 'DELETE',
          token: session.accessToken
        })
        const newSet = new Set(linkedIds)
        newSet.delete(crId)
        setLinkedIds(newSet)
      } else {
        // Link
        await api(`/api/v1/repair-items/${repairItem.id}/check-results`, {
          method: 'POST',
          token: session.accessToken,
          body: { check_result_id: crId }
        })
        const newSet = new Set(linkedIds)
        newSet.add(crId)
        setLinkedIds(newSet)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update link')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken) return

    // Validate: if price override is set, reason is required
    if (priceOverride && !priceOverrideReason.trim()) {
      setError('Please provide a reason for the price override')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await api(`/api/v1/repair-items/${repairItem.id}`, {
        method: 'PATCH',
        token: session.accessToken,
        body: {
          name: name.trim(),
          description: description.trim() || null,
          price_override: priceOverride ? parseFloat(priceOverride) : null,
          price_override_reason: priceOverrideReason.trim() || null
        }
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update repair')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!session?.accessToken) return
    if (!confirm('Are you sure you want to delete this repair item? This will also delete all linked labour and parts.')) return

    setDeleting(true)
    try {
      await api(`/api/v1/repair-items/${repairItem.id}`, {
        method: 'DELETE',
        token: session.accessToken
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete repair')
    } finally {
      setDeleting(false)
    }
  }

  const availableResults = checkResults.filter(r =>
    r.rag_status === 'red' || r.rag_status === 'amber' || linkedIds.has(r.id)
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Edit Repair</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repair Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Linked Check Results */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Linked Check Results</label>
            <div className="border border-gray-200 rounded max-h-40 overflow-y-auto">
              {availableResults.map(result => (
                <label
                  key={result.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={linkedIds.has(result.id)}
                    onChange={() => toggleCheckResult(result.id)}
                    className="rounded text-primary focus:ring-primary"
                  />
                  <RagIndicator status={result.rag_status} />
                  <span className="text-sm">{result.template_item?.name || 'Unknown'}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Price Override */}
          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Override (optional)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2 text-gray-500">£</span>
                <input
                  type="number"
                  step="0.01"
                  value={priceOverride}
                  onChange={e => setPriceOverride(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Calculated automatically"
                />
              </div>
            </div>
            {priceOverride && (
              <div className="mt-2">
                <label className="block text-sm text-gray-500 mb-1">
                  Reason for override <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={priceOverrideReason}
                  onChange={e => setPriceOverrideReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., Customer discount"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

