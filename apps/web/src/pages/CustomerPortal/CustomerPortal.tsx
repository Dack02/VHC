/**
 * CustomerPortal - Public health check viewing and authorization
 * Mobile-first design, no authentication required
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface Vehicle {
  registration: string
  make: string | null
  model: string | null
  year: number | null
  vin: string | null
}

interface Customer {
  first_name: string
  last_name: string
}

interface OrganizationSettings {
  logoUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  legalName?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  addressLine1?: string | null
  city?: string | null
  postcode?: string | null
}

interface Site {
  name: string
  phone: string | null
  email: string | null
  organization?: {
    name: string
    settings?: OrganizationSettings
  }
}

interface HealthCheckData {
  id: string
  status: string
  sentAt: string | null
  expiresAt: string | null
  redCount: number
  amberCount: number
  greenCount: number
  technicianNotes: string | null
  mileageIn: number | null
}

interface SelectedReason {
  id: string
  reasonText: string
  customerDescription: string | null
  followUpDays: number | null
  followUpText: string | null
}

interface CheckResult {
  id: string
  rag_status: string
  notes: string | null
  value: unknown
  reasons?: SelectedReason[]
  template_item?: {
    id: string
    name: string
    item_type: string
    section?: {
      name: string
    }
  }
  media?: Array<{
    id: string
    url: string
    thumbnail_url: string | null
    caption: string | null
    annotation_data: unknown
  }>
}

interface Authorization {
  repair_item_id: string
  decision: 'approved' | 'declined'
  decided_at: string
  signature_data: string | null
}

interface RepairItem {
  id: string
  title: string
  description: string | null
  rag_status: 'red' | 'amber'
  parts_cost: number
  labor_cost: number
  total_price: number
  is_mot_failure: boolean
  follow_up_date: string | null
  check_result?: CheckResult
  authorization: Authorization | null
  reasons?: SelectedReason[]
}

// New repair items (Phase 6+) with options
interface RepairOption {
  id: string
  name: string
  description: string | null
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  isRecommended: boolean
}

interface NewRepairItem {
  id: string
  name: string
  description: string | null
  isGroup: boolean
  labourTotal: number
  partsTotal: number
  subtotal: number
  vatAmount: number
  totalIncVat: number
  labourStatus: string
  partsStatus: string
  quoteStatus: string
  customerApproved: boolean | null
  customerApprovedAt: string | null
  customerDeclinedReason: string | null
  selectedOptionId: string | null
  options: RepairOption[]
  linkedCheckResults: string[]
  children?: Array<{
    name: string
    ragStatus: 'red' | 'amber' | null
  }>
}

interface PortalData {
  healthCheck: HealthCheckData
  vehicle: Vehicle
  customer: Customer
  site: Site
  repairItems: RepairItem[]
  checkResults: CheckResult[]
  isFirstView: boolean
  // New repair items (Phase 6+)
  newRepairItems?: NewRepairItem[]
  hasNewRepairItems?: boolean
}

export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [saving, setSaving] = useState<string | null>(null) // ID of item being saved
  const [showSignature, setShowSignature] = useState(false)
  const [signatureSubmitted, setSignatureSubmitted] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; caption: string | null } | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['urgent', 'advisory', 'repairs']))
  // New repair items state
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({}) // repairItemId -> optionId
  const [savingNewRepairItem, setSavingNewRepairItem] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [decliningAll, setDecliningAll] = useState(false)

  // Fetch portal data
  useEffect(() => {
    if (!token) return

    async function fetchData() {
      try {
        const response = await fetch(`${API_URL}/api/public/vhc/${token}`)
        const result = await response.json()

        if (!response.ok) {
          if (response.status === 410) {
            setExpired(true)
          }
          throw new Error(result.error || 'Failed to load health check')
        }

        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [token])

  // Apply organization branding CSS variables
  useEffect(() => {
    if (!data?.site?.organization?.settings) return

    const settings = data.site.organization.settings
    const root = document.documentElement

    if (settings.primaryColor) {
      root.style.setProperty('--brand-primary', settings.primaryColor)
      // Calculate hover color (darken by 15%)
      const hex = settings.primaryColor.replace('#', '')
      const r = Math.max(0, parseInt(hex.substring(0, 2), 16) * 0.85)
      const g = Math.max(0, parseInt(hex.substring(2, 4), 16) * 0.85)
      const b = Math.max(0, parseInt(hex.substring(4, 6), 16) * 0.85)
      root.style.setProperty('--brand-primary-hover', `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`)
    }

    // Cleanup on unmount
    return () => {
      root.style.removeProperty('--brand-primary')
      root.style.removeProperty('--brand-primary-hover')
    }
  }, [data?.site?.organization?.settings])

  // Handle authorize (using new repair-items endpoint)
  const handleAuthorize = async (repairItemId: string) => {
    if (!token || saving) return
    setSaving(repairItemId)

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to authorize')
      }

      // Update local state - update is_approved field (maps from customer_approved)
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          repairItems: prev.repairItems.map(item =>
            item.id === repairItemId
              ? {
                  ...item,
                  is_approved: true,
                  authorization: {
                    repair_item_id: repairItemId,
                    decision: 'approved',
                    decided_at: new Date().toISOString(),
                    signature_data: null
                  }
                }
              : item
          )
        }
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  // Handle decline (using new repair-items endpoint)
  const handleDecline = async (repairItemId: string) => {
    if (!token || saving) return
    setSaving(repairItemId)

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        throw new Error('Failed to decline')
      }

      // Update local state - update is_approved field (maps from customer_approved)
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          repairItems: prev.repairItems.map(item =>
            item.id === repairItemId
              ? {
                  ...item,
                  is_approved: false,
                  authorization: {
                    repair_item_id: repairItemId,
                    decision: 'declined',
                    decided_at: new Date().toISOString(),
                    signature_data: null
                  }
                }
              : item
          )
        }
      })
    } catch (err) {
      alert('Failed to save. Please try again.')
    } finally {
      setSaving(null)
    }
  }

  // Initialize selected options when data loads (default to recommended or first option)
  useEffect(() => {
    if (!data?.newRepairItems) return

    const initialSelections: Record<string, string> = {}
    for (const item of data.newRepairItems) {
      if (item.options.length > 0) {
        // If already selected, use that
        if (item.selectedOptionId) {
          initialSelections[item.id] = item.selectedOptionId
        } else {
          // Otherwise default to recommended or first
          const recommended = item.options.find(o => o.isRecommended)
          initialSelections[item.id] = recommended?.id || item.options[0].id
        }
      }
    }
    setSelectedOptions(initialSelections)
  }, [data?.newRepairItems])

  // Handle approve new repair item
  const handleApproveNewRepairItem = async (repairItemId: string) => {
    if (!token || savingNewRepairItem) return
    setSavingNewRepairItem(repairItemId)

    const selectedOptionId = selectedOptions[repairItemId] || null

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOptionId })
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to approve')
      }

      // Update local state
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          newRepairItems: (prev.newRepairItems || []).map(item =>
            item.id === repairItemId
              ? {
                  ...item,
                  customerApproved: true,
                  customerApprovedAt: new Date().toISOString(),
                  selectedOptionId
                }
              : item
          )
        }
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setSavingNewRepairItem(null)
    }
  }

  // Handle decline new repair item
  const handleDeclineNewRepairItem = async (repairItemId: string) => {
    if (!token || savingNewRepairItem) return
    setSavingNewRepairItem(repairItemId)

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        throw new Error('Failed to decline')
      }

      // Update local state
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          newRepairItems: (prev.newRepairItems || []).map(item =>
            item.id === repairItemId
              ? {
                  ...item,
                  customerApproved: false,
                  customerApprovedAt: new Date().toISOString(),
                  selectedOptionId: null
                }
              : item
          )
        }
      })
    } catch (err) {
      alert('Failed to save. Please try again.')
    } finally {
      setSavingNewRepairItem(null)
    }
  }

  // Handle approve all new repair items
  const handleApproveAllNewRepairItems = async () => {
    if (!token || approvingAll) return
    setApprovingAll(true)

    // Build selections array
    const selections = (data?.newRepairItems || [])
      .filter(item => item.customerApproved === null)
      .map(item => ({
        repairItemId: item.id,
        selectedOptionId: selectedOptions[item.id] || null
      }))

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/approve-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections })
      })

      if (!response.ok) {
        throw new Error('Failed to approve all')
      }

      // Update local state
      setData(prev => {
        if (!prev) return prev
        const now = new Date().toISOString()
        return {
          ...prev,
          newRepairItems: (prev.newRepairItems || []).map(item =>
            item.customerApproved === null
              ? {
                  ...item,
                  customerApproved: true,
                  customerApprovedAt: now,
                  selectedOptionId: selectedOptions[item.id] || item.options[0]?.id || null
                }
              : item
          )
        }
      })
    } catch (err) {
      alert('Failed to approve all. Please try again.')
    } finally {
      setApprovingAll(false)
    }
  }

  // Handle decline all new repair items
  const handleDeclineAllNewRepairItems = async () => {
    if (!token || decliningAll) return
    setDecliningAll(true)

    try {
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/decline-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (!response.ok) {
        throw new Error('Failed to decline all')
      }

      // Update local state
      setData(prev => {
        if (!prev) return prev
        const now = new Date().toISOString()
        return {
          ...prev,
          newRepairItems: (prev.newRepairItems || []).map(item =>
            item.customerApproved === null
              ? {
                  ...item,
                  customerApproved: false,
                  customerApprovedAt: now,
                  selectedOptionId: null
                }
              : item
          )
        }
      })
    } catch (err) {
      alert('Failed to decline all. Please try again.')
    } finally {
      setDecliningAll(false)
    }
  }

  // Handle option selection
  const handleSelectOption = (repairItemId: string, optionId: string) => {
    setSelectedOptions(prev => ({
      ...prev,
      [repairItemId]: optionId
    }))
  }

  // Toggle section
  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading your health check...</p>
        </div>
      </div>
    )
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 max-w-md text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600 mb-4">
            This health check link has expired. Please contact the dealership for a new link.
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 max-w-md text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Not Found</h1>
          <p className="text-gray-600">{error || 'Health check not found'}</p>
        </div>
      </div>
    )
  }

  const { healthCheck, vehicle, customer, site, repairItems, checkResults, newRepairItems, hasNewRepairItems } = data

  // ===== LEGACY REPAIR ITEMS =====
  // Separate items by RAG status
  const urgentItems = repairItems.filter(item => item.rag_status === 'red')
  const advisoryItems = repairItems.filter(item => item.rag_status === 'amber')

  // Get all photos from check results
  const allPhotos = checkResults
    .filter(r => r.media && r.media.length > 0)
    .flatMap(r => r.media!.map(m => ({
      ...m,
      itemName: r.template_item?.name || 'Unknown',
      ragStatus: r.rag_status
    })))

  // Legacy repair items totals
  const approvedItems = repairItems.filter(item => item.authorization?.decision === 'approved')
  const approvedTotal = approvedItems.reduce((sum, item) => sum + item.total_price, 0)
  const pendingItems = repairItems.filter(item => !item.authorization)
  const allLegacyActioned = pendingItems.length === 0 && repairItems.length > 0
  const hasLegacyApprovedItems = approvedItems.length > 0

  // ===== NEW REPAIR ITEMS (Phase 6+) =====
  const approvedNewItems = (newRepairItems || []).filter(item => item.customerApproved === true)
  const declinedNewItems = (newRepairItems || []).filter(item => item.customerApproved === false)
  const pendingNewItems = (newRepairItems || []).filter(item => item.customerApproved === null)

  // Calculate totals for new repair items (using selected option price if available)
  const getNewItemPrice = (item: NewRepairItem) => {
    if (item.options.length > 0) {
      const selectedId = item.customerApproved ? item.selectedOptionId : selectedOptions[item.id]
      const selectedOption = item.options.find(o => o.id === selectedId)
      if (selectedOption) return selectedOption
    }
    return {
      subtotal: item.subtotal,
      vatAmount: item.vatAmount,
      totalIncVat: item.totalIncVat
    }
  }

  const approvedNewSubtotal = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).subtotal, 0)
  const approvedNewVat = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).vatAmount, 0)
  const approvedNewTotal = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).totalIncVat, 0)

  // Calculate pending totals (what customer is currently selecting)
  const pendingNewSubtotal = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).subtotal, 0)
  const pendingNewVat = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).vatAmount, 0)
  const pendingNewTotal = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).totalIncVat, 0)

  const allNewActioned = pendingNewItems.length === 0 && (newRepairItems || []).length > 0
  const hasNewApprovedItems = approvedNewItems.length > 0

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="text-center">
            {site?.organization?.settings?.logoUrl ? (
              <img
                src={site.organization.settings.logoUrl}
                alt={site.organization?.name || site.name}
                className="h-10 w-auto mx-auto mb-2 object-contain"
              />
            ) : (
              <p className="text-sm text-gray-500">{site?.organization?.name || site?.name}</p>
            )}
            <h1 className="text-lg font-bold text-gray-900">Vehicle Health Check</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Vehicle Info Card */}
        <div className="bg-white shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 text-blue-800 px-3 py-2 text-lg font-bold">
                {vehicle.registration}
              </div>
              <div>
                <div className="font-medium text-gray-900">
                  {vehicle.make} {vehicle.model}
                </div>
                {vehicle.year && (
                  <div className="text-sm text-gray-500">{vehicle.year}</div>
                )}
              </div>
            </div>
          </div>
          <div className="px-4 py-3 text-sm text-gray-600 bg-gray-50">
            <span>Prepared for </span>
            <span className="font-medium text-gray-900">
              {customer?.first_name} {customer?.last_name}
            </span>
            {healthCheck.mileageIn && (
              <span className="ml-3">| {healthCheck.mileageIn.toLocaleString()} miles</span>
            )}
          </div>
        </div>

        {/* RAG Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 border-2 border-green-200 p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{healthCheck.greenCount}</div>
            <div className="text-sm text-green-700 font-medium">Passed</div>
          </div>
          <div className="bg-amber-50 border-2 border-amber-200 p-4 text-center">
            <div className="text-3xl font-bold text-amber-600">{healthCheck.amberCount}</div>
            <div className="text-sm text-amber-700 font-medium">Advisory</div>
          </div>
          <div className="bg-red-50 border-2 border-red-200 p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{healthCheck.redCount}</div>
            <div className="text-sm text-red-700 font-medium">Urgent</div>
          </div>
        </div>

        {/* Urgent Items Section */}
        {urgentItems.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-200">
            <button
              onClick={() => toggleSection('urgent')}
              className="w-full px-4 py-3 flex items-center justify-between bg-red-600 text-white"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span className="font-semibold">Urgent Attention Required</span>
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{urgentItems.length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('urgent') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('urgent') && (
              <div className="divide-y divide-gray-200">
                {urgentItems.map(item => (
                  <RepairItemCard
                    key={item.id}
                    item={item}
                    photos={checkResults.find(r => r.id === item.check_result?.id)?.media || []}
                    saving={saving === item.id}
                    onAuthorize={() => handleAuthorize(item.id)}
                    onDecline={() => handleDecline(item.id)}
                    onPhotoClick={setSelectedPhoto}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Advisory Items Section */}
        {advisoryItems.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-200">
            <button
              onClick={() => toggleSection('advisory')}
              className="w-full px-4 py-3 flex items-center justify-between bg-amber-500 text-white"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span className="font-semibold">Advisory Items</span>
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{advisoryItems.length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('advisory') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('advisory') && (
              <div className="divide-y divide-gray-200">
                {advisoryItems.map(item => (
                  <RepairItemCard
                    key={item.id}
                    item={item}
                    photos={checkResults.find(r => r.id === item.check_result?.id)?.media || []}
                    saving={saving === item.id}
                    onAuthorize={() => handleAuthorize(item.id)}
                    onDecline={() => handleDecline(item.id)}
                    onPhotoClick={setSelectedPhoto}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* NEW REPAIR ITEMS SECTION (Phase 6+) */}
        {hasNewRepairItems && (newRepairItems || []).length > 0 && (
          <div className="bg-white shadow-sm border border-gray-200">
            <button
              onClick={() => toggleSection('repairs')}
              className="w-full px-4 py-3 flex items-center justify-between bg-indigo-600 text-white"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span className="font-semibold">Recommended Repairs</span>
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{(newRepairItems || []).length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('repairs') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('repairs') && (
              <div>
                {/* Approve All / Decline All buttons */}
                {pendingNewItems.length > 1 && (
                  <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex gap-3">
                      <button
                        onClick={handleApproveAllNewRepairItems}
                        disabled={approvingAll || decliningAll}
                        className="flex-1 py-2 bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {approvingAll ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Approve All ({pendingNewItems.length})
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleDeclineAllNewRepairItems}
                        disabled={approvingAll || decliningAll}
                        className="flex-1 py-2 bg-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {decliningAll ? (
                          <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Decline All
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Repair items list */}
                <div className="divide-y divide-gray-200">
                  {(newRepairItems || []).map(item => (
                    <NewRepairItemCard
                      key={item.id}
                      item={item}
                      selectedOptionId={selectedOptions[item.id]}
                      saving={savingNewRepairItem === item.id}
                      onSelectOption={(optionId) => handleSelectOption(item.id, optionId)}
                      onApprove={() => handleApproveNewRepairItem(item.id)}
                      onDecline={() => handleDeclineNewRepairItem(item.id)}
                    />
                  ))}
                </div>

                {/* Quote Summary */}
                {(newRepairItems || []).length > 0 && (
                  <div className="p-4 bg-gray-50 border-t border-gray-200">
                    <h4 className="font-semibold text-gray-900 mb-3">Quote Summary</h4>
                    <div className="space-y-2 text-sm">
                      {pendingNewItems.length > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Subtotal (ex VAT)</span>
                            <span className="font-medium">£{(pendingNewSubtotal + approvedNewSubtotal).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">VAT (20%)</span>
                            <span className="font-medium">£{(pendingNewVat + approvedNewVat).toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-base font-bold border-t pt-2 mt-2">
                            <span>Total Inc VAT</span>
                            <span>£{(pendingNewTotal + approvedNewTotal).toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      {pendingNewItems.length === 0 && approvedNewItems.length > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Items Approved</span>
                            <span className="font-medium">{approvedNewItems.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Items Declined</span>
                            <span className="font-medium">{declinedNewItems.length}</span>
                          </div>
                          <div className="flex justify-between border-t pt-2 mt-2">
                            <span className="text-gray-600">Subtotal (ex VAT)</span>
                            <span className="font-medium">£{approvedNewSubtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">VAT (20%)</span>
                            <span className="font-medium">£{approvedNewVat.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-base font-bold border-t pt-2 mt-2">
                            <span>Total to Pay</span>
                            <span className="text-green-600">£{approvedNewTotal.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Checked & All OK Section */}
        {healthCheck.greenCount > 0 && (
          <GreenItemsSection
            checkResults={checkResults}
            greenCount={healthCheck.greenCount}
            isExpanded={expandedSections.has('passed')}
            onToggle={() => toggleSection('passed')}
          />
        )}

        {/* Photo Gallery */}
        {allPhotos.length > 0 && (
          <div className="bg-white shadow-sm border border-gray-200">
            <button
              onClick={() => toggleSection('photos')}
              className="w-full px-4 py-3 flex items-center justify-between bg-gray-700 text-white"
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-semibold">Photos</span>
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{allPhotos.length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('photos') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('photos') && (
              <div className="p-4">
                <div className="grid grid-cols-3 gap-2">
                  {allPhotos.map(photo => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhoto({ url: photo.url, caption: photo.itemName })}
                      className="relative aspect-square bg-gray-100 overflow-hidden group"
                    >
                      <img
                        src={photo.thumbnail_url || photo.url}
                        alt={photo.itemName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className={`absolute top-1 left-1 w-3 h-3 rounded-full ${
                        photo.ragStatus === 'red' ? 'bg-red-500' :
                        photo.ragStatus === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                      }`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* No repair items */}
        {repairItems.length === 0 && (!hasNewRepairItems || (newRepairItems || []).length === 0) && (
          <div className="bg-white shadow-sm border border-gray-200 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">All Clear!</h2>
            <p className="text-gray-600">Your vehicle passed all inspection points.</p>
          </div>
        )}

        {/* Summary & Signature - Legacy repair items */}
        {hasLegacyApprovedItems && allLegacyActioned && !hasNewRepairItems && !signatureSubmitted && (
          <div className="bg-white shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Items Approved</span>
                  <span className="font-medium">{approvedItems.length}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total to Pay</span>
                  <span>£{approvedTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {!showSignature ? (
              <div className="p-4">
                <button
                  onClick={() => setShowSignature(true)}
                  className="w-full py-4 text-white font-semibold text-lg"
                  style={{
                    backgroundColor: 'var(--brand-primary, #3B82F6)'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--brand-primary-hover, #2563EB)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--brand-primary, #3B82F6)'}
                >
                  Sign to Confirm
                </button>
                <p className="text-center text-xs text-gray-500 mt-2">
                  By signing, you authorise the work above to be carried out
                </p>
              </div>
            ) : (
              <SignatureCapture
                token={token!}
                onComplete={() => setSignatureSubmitted(true)}
                onCancel={() => setShowSignature(false)}
              />
            )}
          </div>
        )}

        {/* Summary & Signature - New repair items */}
        {hasNewApprovedItems && allNewActioned && hasNewRepairItems && !signatureSubmitted && (
          <div className="bg-white shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-3">Final Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Items Approved</span>
                  <span className="font-medium">{approvedNewItems.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Items Declined</span>
                  <span className="font-medium">{declinedNewItems.length}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-gray-600">Subtotal (ex VAT)</span>
                  <span className="font-medium">£{approvedNewSubtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">VAT (20%)</span>
                  <span className="font-medium">£{approvedNewVat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2 mt-2">
                  <span>Total to Pay</span>
                  <span className="text-green-600">£{approvedNewTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {!showSignature ? (
              <div className="p-4">
                <button
                  onClick={() => setShowSignature(true)}
                  className="w-full py-4 text-white font-semibold text-lg"
                  style={{
                    backgroundColor: 'var(--brand-primary, #3B82F6)'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--brand-primary-hover, #2563EB)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--brand-primary, #3B82F6)'}
                >
                  Sign to Confirm
                </button>
                <p className="text-center text-xs text-gray-500 mt-2">
                  By signing, you authorise the work above to be carried out
                </p>
              </div>
            ) : (
              <SignatureCapture
                token={token!}
                onComplete={() => setSignatureSubmitted(true)}
                onCancel={() => setShowSignature(false)}
              />
            )}
          </div>
        )}

        {/* Signature Complete */}
        {signatureSubmitted && (
          <div className="bg-green-50 border-2 border-green-200 p-6 text-center">
            <svg className="w-12 h-12 text-green-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-bold text-green-800 mb-2">Authorization Complete</h3>
            <p className="text-green-700">
              Thank you for authorizing the repairs. The dealership has been notified and will be in touch shortly.
            </p>
          </div>
        )}

        {/* Contact Info */}
        <div className="text-center text-sm text-gray-500 py-4">
          <p className="font-medium text-gray-700">{site?.organization?.name || site?.name}</p>
          <p className="text-gray-600">{site?.name}</p>
          {(site?.organization?.settings?.phone || site?.phone) && (
            <p>{site?.organization?.settings?.phone || site?.phone}</p>
          )}
          {(site?.organization?.settings?.email || site?.email) && (
            <p>{site?.organization?.settings?.email || site?.email}</p>
          )}
          {site?.organization?.settings?.website && (
            <p>{site.organization.settings.website}</p>
          )}
        </div>
      </main>

      {/* Photo Lightbox */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 text-white p-2"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="max-w-4xl max-h-full" onClick={e => e.stopPropagation()}>
            <img
              src={selectedPhoto.url}
              alt={selectedPhoto.caption || ''}
              className="max-w-full max-h-[80vh] object-contain"
            />
            {selectedPhoto.caption && (
              <div className="text-center text-white mt-4 text-lg">{selectedPhoto.caption}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Helper function to format follow-up recommendation
function formatFollowUp(days?: number | null, text?: string | null): string | null {
  if (text) return text
  if (!days) return null
  if (days <= 7) return 'Recommend addressing within 1 week'
  if (days <= 30) return 'Recommend addressing within 1 month'
  if (days <= 90) return 'Recommend addressing within 3 months'
  if (days <= 180) return 'Recommend addressing within 6 months'
  return `Recommend addressing within ${Math.round(days / 30)} months`
}

// Repair Item Card Component
function RepairItemCard({
  item,
  photos,
  saving,
  onAuthorize,
  onDecline,
  onPhotoClick
}: {
  item: RepairItem
  photos: Array<{ id: string; url: string; thumbnail_url: string | null; caption: string | null }>
  saving: boolean
  onAuthorize: () => void
  onDecline: () => void
  onPhotoClick: (photo: { url: string; caption: string | null }) => void
}) {
  const isAuthorized = item.authorization?.decision === 'approved'
  const isDeclined = item.authorization?.decision === 'declined'
  const hasDecision = isAuthorized || isDeclined

  // Get reasons from the item
  const reasons = item.reasons || []
  const hasReasons = reasons.length > 0
  const followUpInfo = reasons.find(r => r.followUpDays || r.followUpText)

  return (
    <div className="p-4">
      <div className="flex justify-between items-start gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900">{item.title}</h4>
            {item.is_mot_failure && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium">
                MOT FAIL
              </span>
            )}
          </div>

          {/* Show reasons with customer descriptions */}
          {hasReasons ? (
            <div className="mt-2">
              {reasons.length > 1 && (
                <div className="text-sm text-gray-700 mb-1">
                  {item.rag_status === 'red'
                    ? 'We identified the following issues:'
                    : 'We identified the following items to monitor:'}
                </div>
              )}
              <ul className="space-y-1">
                {reasons.map((reason) => (
                  <li key={reason.id} className="text-sm text-gray-600 flex gap-2">
                    {reasons.length > 1 && (
                      <span className={item.rag_status === 'red' ? 'text-red-400' : 'text-amber-400'}>
                        &bull;
                      </span>
                    )}
                    <span>{reason.customerDescription || reason.reasonText}</span>
                  </li>
                ))}
              </ul>
              {followUpInfo && (
                <div className={`mt-2 text-sm font-medium ${
                  item.rag_status === 'red' ? 'text-red-600' : 'text-amber-600'
                }`}>
                  {formatFollowUp(followUpInfo.followUpDays, followUpInfo.followUpText)}
                </div>
              )}
            </div>
          ) : item.description && (
            <p className="text-sm text-gray-600 mt-1">{item.description}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-bold text-gray-900 text-lg">£{item.total_price.toFixed(2)}</div>
          <div className="text-xs text-gray-500">
            Parts £{item.parts_cost.toFixed(2)} + Labour £{item.labor_cost.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Photos */}
      {photos.length > 0 && (
        <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
          {photos.map(photo => (
            <button
              key={photo.id}
              onClick={() => onPhotoClick({ url: photo.url, caption: item.title })}
              className="flex-shrink-0 w-20 h-20 bg-gray-100 overflow-hidden"
            >
              <img
                src={photo.thumbnail_url || photo.url}
                alt=""
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Action Buttons or Status */}
      {hasDecision ? (
        <div className={`flex items-center gap-2 p-3 ${
          isAuthorized ? 'bg-green-50 border border-green-200' : 'bg-gray-100 border border-gray-200'
        }`}>
          {isAuthorized ? (
            <>
              <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-green-700 font-medium">Approved</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-600 font-medium">Declined</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={onAuthorize}
            disabled={saving}
            className="flex-1 py-3 bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </>
            )}
          </button>
          <button
            onClick={onDecline}
            disabled={saving}
            className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Decline
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// Signature Capture Component
function SignatureCapture({
  token,
  onComplete,
  onCancel
}: {
  token: string
  onComplete: () => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [saving, setSaving] = useState(false)

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

  const getCoordinates = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      }
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
  }, [])

  const startDrawing = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    const { x, y } = getCoordinates(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
    setHasSignature(true)
  }, [getCoordinates])

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    const { x, y } = getCoordinates(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }, [isDrawing, getCoordinates])

  const stopDrawing = useCallback(() => {
    setIsDrawing(false)
  }, [])

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }, [])

  const submitSignature = async () => {
    const canvas = canvasRef.current
    if (!canvas || !hasSignature) return

    setSaving(true)
    try {
      const signatureData = canvas.toDataURL('image/png')

      // Use new repair-items/sign endpoint
      const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData })
      })

      if (!response.ok) {
        throw new Error('Failed to save signature')
      }

      onComplete()
    } catch (err) {
      alert('Failed to save signature. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    canvas.width = canvas.offsetWidth
    canvas.height = 200

    // Configure drawing style
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  return (
    <div className="p-4">
      <p className="text-sm text-gray-600 mb-3">Please sign below to authorize the repairs:</p>

      <div className="border-2 border-gray-300 bg-gray-50 mb-3">
        <canvas
          ref={canvasRef}
          className="w-full touch-none cursor-crosshair"
          style={{ height: '200px' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={clearSignature}
          className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-100"
        >
          Clear
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={submitSignature}
          disabled={!hasSignature || saving}
          className="flex-1 py-2 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{
            backgroundColor: 'var(--brand-primary, #3B82F6)'
          }}
        >
          {saving ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            'Confirm Authorization'
          )}
        </button>
      </div>
    </div>
  )
}

// Green Items "Checked & All OK" Section Component
function GreenItemsSection({
  checkResults,
  greenCount,
  isExpanded,
  onToggle
}: {
  checkResults: CheckResult[]
  greenCount: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const INITIAL_DISPLAY_COUNT = 6

  const greenResults = checkResults.filter(r => r.rag_status === 'green')
  const hasMore = greenResults.length > INITIAL_DISPLAY_COUNT
  const displayedItems = showAll ? greenResults : greenResults.slice(0, INITIAL_DISPLAY_COUNT)

  return (
    <div className="bg-white shadow-sm border border-gray-200">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between bg-green-600 text-white"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">&#x1F7E2;</span>
          <span className="font-semibold">CHECKED & ALL OK</span>
          <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{greenCount}</span>
        </div>
        <svg className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isExpanded && (
        <div className="p-4">
          <p className="text-sm text-gray-600 mb-4">
            We've thoroughly inspected these items and they're all in good condition:
          </p>
          <div className="space-y-2">
            {displayedItems.map(result => {
              const positiveReason = result.reasons?.find(r => r.customerDescription || r.reasonText)
              return (
                <div key={result.id} className="flex items-start gap-2">
                  <span className="text-green-500 flex-shrink-0">&#x2713;</span>
                  <span className="text-sm text-gray-700">
                    <span className="font-medium">{result.template_item?.name || 'Unknown Item'}</span>
                    {positiveReason && (
                      <span className="text-green-600 ml-1">
                        — {positiveReason.customerDescription || positiveReason.reasonText}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-4 text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              See all {greenResults.length} items checked...
            </button>
          )}
          {showAll && hasMore && (
            <button
              onClick={() => setShowAll(false)}
              className="mt-4 text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// New Repair Item Card Component (Phase 6+)
function NewRepairItemCard({
  item,
  selectedOptionId,
  saving,
  onSelectOption,
  onApprove,
  onDecline
}: {
  item: NewRepairItem
  selectedOptionId: string | undefined
  saving: boolean
  onSelectOption: (optionId: string) => void
  onApprove: () => void
  onDecline: () => void
}) {
  const isApproved = item.customerApproved === true
  const hasDecision = item.customerApproved !== null
  const hasOptions = item.options.length > 0

  // Get the selected option details for display
  const selectedOption = hasOptions
    ? item.options.find(o => o.id === (isApproved ? item.selectedOptionId : selectedOptionId))
    : null

  // Get price to display (from selected option or item)
  const displayPrice = selectedOption || {
    subtotal: item.subtotal,
    vatAmount: item.vatAmount,
    totalIncVat: item.totalIncVat,
    labourTotal: item.labourTotal,
    partsTotal: item.partsTotal
  }

  return (
    <div className="p-4">
      {/* Header with name and linked check results */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="font-semibold text-gray-900">{item.name}</h4>
            {item.linkedCheckResults.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                Related to: {item.linkedCheckResults.join(', ')}
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-bold text-gray-900 text-lg">£{displayPrice.totalIncVat.toFixed(2)}</div>
            <div className="text-xs text-gray-500">
              Inc VAT
            </div>
          </div>
        </div>

        {/* Description */}
        {item.description && (
          <p className="text-sm text-gray-600 mt-2">{item.description}</p>
        )}

        {/* Group Badge and Children */}
        {item.isGroup && (
          <div className="mt-3">
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded">
              GROUP
            </span>
            {item.children && item.children.length > 0 && (
              <div className="mt-2 p-3 bg-purple-50 border-l-3 border-purple-500 rounded">
                <div className="text-xs font-semibold text-purple-700 uppercase mb-2">
                  Grouped Items ({item.children.length})
                </div>
                <div className="space-y-1">
                  {item.children.map((child, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        child.ragStatus === 'red' ? 'bg-red-500' :
                        child.ragStatus === 'amber' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      <span className="text-gray-700">{child.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Options (Radio buttons for selection) */}
      {hasOptions && !hasDecision && (
        <div className="mb-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">Choose an option:</p>
          {item.options.map(option => (
            <label
              key={option.id}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                selectedOptionId === option.id
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name={`option-${item.id}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                onChange={() => onSelectOption(option.id)}
                className="mt-1 h-4 w-4 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{option.name}</span>
                  {option.isRecommended && (
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                      Recommended
                    </span>
                  )}
                </div>
                {option.description && (
                  <p className="text-sm text-gray-500 mt-1">{option.description}</p>
                )}
                <div className="text-sm mt-1">
                  <span className="font-medium text-gray-900">£{option.totalIncVat.toFixed(2)}</span>
                  <span className="text-gray-500 ml-1">(inc VAT)</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  Parts £{option.partsTotal.toFixed(2)} + Labour £{option.labourTotal.toFixed(2)}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      {/* Show selected option if already decided */}
      {hasOptions && hasDecision && isApproved && selectedOption && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="font-medium text-green-800">{selectedOption.name}</span>
            {selectedOption.isRecommended && (
              <span className="px-2 py-0.5 bg-green-200 text-green-800 text-xs font-medium rounded">
                Recommended
              </span>
            )}
          </div>
          <div className="text-sm text-green-700 mt-1">
            £{selectedOption.totalIncVat.toFixed(2)} inc VAT
          </div>
        </div>
      )}

      {/* No options - show price breakdown */}
      {!hasOptions && !hasDecision && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Parts</span>
              <span>£{item.partsTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Labour</span>
              <span>£{item.labourTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 border-t pt-1 mt-1">
              <span>Subtotal (ex VAT)</span>
              <span>£{item.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>VAT</span>
              <span>£{item.vatAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons or Status */}
      {hasDecision ? (
        <div className={`flex items-center gap-2 p-3 rounded-lg ${
          isApproved ? 'bg-green-50 border border-green-200' : 'bg-gray-100 border border-gray-200'
        }`}>
          {isApproved ? (
            <>
              <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-green-700 font-medium">Approved</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-600 font-medium">Declined</span>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={onApprove}
            disabled={saving}
            className="flex-1 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </>
            )}
          </button>
          <button
            onClick={onDecline}
            disabled={saving}
            className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Decline
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
