import { useState, useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useBranding } from '../../contexts/BrandingContext'
import { HealthCheck, CheckResult, api, NewRepairItem } from '../../lib/api'
import CustomerPortalContent from '../CustomerPortal/CustomerPortalContent'
import type { PortalData, SelectedReason, CheckResult as PortalCheckResult } from '../CustomerPortal/types'

interface CustomerPreviewModalProps {
  healthCheck: HealthCheck
  newRepairItems?: NewRepairItem[]
  checkResults?: CheckResult[]
  onClose: () => void
  onSend: () => void
}

// Derive RAG status for an item (groups get highest severity from children)
function deriveRagStatus(item: NewRepairItem): 'red' | 'amber' | null {
  if (item.isGroup && item.children && item.children.length > 0) {
    let highestSeverity: 'red' | 'amber' | null = null
    for (const child of item.children) {
      const childRag = child.checkResults?.[0]?.ragStatus as 'red' | 'amber' | null
      if (childRag === 'red') return 'red'
      if (childRag === 'amber') highestSeverity = 'amber'
    }
    return highestSeverity
  }

  if (item.ragStatus) return item.ragStatus as 'red' | 'amber' | null
  return item.checkResults?.[0]?.ragStatus as 'red' | 'amber' | null
}

export function CustomerPreviewModal({ healthCheck, newRepairItems, checkResults, onClose, onSend }: CustomerPreviewModalProps) {
  const { user, session } = useAuth()
  const { branding } = useBranding()

  // Track reasons for each check result (same batch-fetch logic as before)
  const [reasonsByCheckResult, setReasonsByCheckResult] = useState<Record<string, SelectedReason[]>>({})
  const [loadingReasons, setLoadingReasons] = useState(false)
  const fetchedRef = useRef(false)

  // Filter top-level new repair items
  const topLevelNewRepairItems = useMemo(() =>
    (newRepairItems || []).filter(item => !item.parentRepairItemId),
    [newRepairItems]
  )

  // Green results for reasons fetch
  const greenResults = useMemo(() => checkResults?.filter(r => r.rag_status === 'green') || [], [checkResults])

  // Memoize check result IDs for batch reasons fetch
  const checkResultIdsKey = useMemo(() => {
    const ids: string[] = []
    for (const item of topLevelNewRepairItems) {
      if (item.children) {
        for (const child of item.children) {
          if (child.checkResults) {
            for (const cr of child.checkResults) {
              ids.push(cr.id)
            }
          }
        }
      }
      if (item.checkResults) {
        for (const cr of item.checkResults) {
          ids.push(cr.id)
        }
      }
    }
    greenResults.forEach(r => ids.push(r.id))
    return [...new Set(ids)].sort().join(',')
  }, [topLevelNewRepairItems, greenResults])

  // Fetch reasons ONCE when modal opens
  useEffect(() => {
    if (fetchedRef.current || !session?.accessToken || !checkResultIdsKey) return

    const uniqueIds = checkResultIdsKey.split(',').filter(Boolean)
    if (uniqueIds.length === 0) {
      setReasonsByCheckResult({})
      return
    }

    fetchedRef.current = true
    setLoadingReasons(true)

    const fetchReasons = async () => {
      try {
        const data = await api<{ reasonsByCheckResult: Record<string, SelectedReason[]> }>(
          `/api/v1/check-results/batch-reasons`,
          {
            token: session.accessToken,
            method: 'POST',
            body: { checkResultIds: uniqueIds }
          }
        )
        setReasonsByCheckResult(data.reasonsByCheckResult || {})
      } catch {
        setReasonsByCheckResult({})
      }
      setLoadingReasons(false)
    }

    fetchReasons()
  }, [session?.accessToken, checkResultIdsKey])

  // Transform internal data into PortalData format
  const portalData = useMemo((): PortalData | null => {
    const vehicle = healthCheck.vehicle
    const customer = healthCheck.vehicle?.customer || healthCheck.customer

    if (!vehicle || !customer) return null

    // Build site from branding context
    const site = {
      name: user?.site?.name || branding?.organizationName || 'Dealership',
      phone: branding?.phone || null,
      email: branding?.email || null,
      organization: {
        name: branding?.organizationName || user?.organization?.name || '',
        settings: branding ? {
          logoUrl: branding.logoUrl,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          legalName: branding.legalName,
          phone: branding.phone,
          email: branding.email,
          website: branding.website,
          addressLine1: branding.addressLine1,
          city: branding.city,
          postcode: branding.postcode
        } : undefined
      }
    }

    // Transform check results to portal format (attach reasons)
    const portalCheckResults: PortalCheckResult[] = (checkResults || []).map(cr => ({
      id: cr.id,
      rag_status: cr.rag_status || '',
      notes: cr.notes,
      value: cr.value,
      reasons: (reasonsByCheckResult[cr.id] || []).map(r => ({
        id: r.id,
        reasonText: r.reasonText,
        customerDescription: r.customerDescription ?? null,
        followUpDays: r.followUpDays ?? null,
        followUpText: r.followUpText ?? null,
      })),
      template_item: cr.template_item ? {
        id: cr.template_item.id,
        name: cr.template_item.name,
        item_type: cr.template_item.item_type,
        section: cr.template_item.section ? { name: cr.template_item.section.name } : undefined
      } : undefined,
      media: (cr.media || [])
        .filter(m => m.include_in_report !== false)
        .map(m => ({
          id: m.id,
          url: m.url,
          thumbnail_url: m.thumbnail_url,
          caption: m.caption || null
        }))
    }))

    // Transform new repair items to portal format
    const portalNewRepairItems = topLevelNewRepairItems.map(item => {
      const ragStatus = deriveRagStatus(item)

      // Build linkedCheckResults string[]
      const linkedCheckResults: string[] = []
      if (item.checkResults) {
        for (const cr of item.checkResults) {
          if (cr.templateItem?.name) linkedCheckResults.push(cr.templateItem.name)
        }
      }

      // Build children
      const children = (item.children || []).map(child => {
        const childRag = child.checkResults?.[0]?.ragStatus as 'red' | 'amber' | null
        // Get VHC reason from child's check results
        const childReasons = (child.checkResults || []).flatMap(cr =>
          reasonsByCheckResult[cr.id] || []
        )
        const vhcReason = childReasons[0]?.customerDescription || childReasons[0]?.reasonText || null

        return {
          name: child.name,
          ragStatus: childRag,
          vhcReason
        }
      })

      // Build options
      const options = (item.options || []).map(opt => ({
        id: opt.id,
        name: opt.name,
        description: opt.description,
        labourTotal: opt.labourTotal,
        partsTotal: opt.partsTotal,
        subtotal: opt.subtotal,
        vatAmount: opt.vatAmount,
        totalIncVat: opt.totalIncVat,
        isRecommended: opt.isRecommended
      }))

      // Derive customer description from linked check result reasons (sales library)
      let customerDescription = item.description || null
      if (!customerDescription && item.checkResults) {
        for (const cr of item.checkResults) {
          const reasons = reasonsByCheckResult[cr.id]
          if (reasons && reasons.length > 0) {
            const desc = reasons[0].customerDescription || reasons[0].reasonText
            if (desc) {
              customerDescription = desc
              break
            }
          }
        }
      }

      return {
        id: item.id,
        name: item.name,
        description: customerDescription,
        isGroup: item.isGroup,
        ragStatus,
        labourTotal: item.labourTotal,
        partsTotal: item.partsTotal,
        subtotal: item.subtotal,
        vatAmount: item.vatAmount,
        totalIncVat: item.totalIncVat,
        labourStatus: item.labourStatus,
        partsStatus: item.partsStatus,
        quoteStatus: item.quoteStatus,
        customerApproved: item.customerApproved,
        customerApprovedAt: item.customerApprovedAt,
        customerDeclinedReason: item.customerDeclinedReason,
        selectedOptionId: item.selectedOptionId,
        outcomeStatus: item.outcomeStatus || null,
        deferredUntil: null,
        deferredNotes: null,
        options,
        linkedCheckResults,
        children: children.length > 0 ? children : undefined
      }
    })

    return {
      healthCheck: {
        id: healthCheck.id,
        status: healthCheck.status,
        sentAt: healthCheck.sent_at,
        expiresAt: healthCheck.public_expires_at,
        redCount: healthCheck.red_count,
        amberCount: healthCheck.amber_count,
        greenCount: healthCheck.green_count,
        technicianNotes: healthCheck.technician_notes,
        mileageIn: healthCheck.mileage_in
      },
      vehicle: {
        registration: vehicle.registration,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        vin: vehicle.vin
      },
      customer: {
        first_name: customer.first_name,
        last_name: customer.last_name
      },
      site,
      repairItems: [],
      checkResults: portalCheckResults,
      isFirstView: false,
      newRepairItems: portalNewRepairItems,
      hasNewRepairItems: portalNewRepairItems.length > 0
    }
  }, [healthCheck, newRepairItems, checkResults, topLevelNewRepairItems, reasonsByCheckResult, branding, user])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Customer Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto">
          {loadingReasons && (
            <div className="text-center py-2 text-sm text-gray-500">
              Loading details...
            </div>
          )}
          {portalData ? (
            <CustomerPortalContent data={portalData} previewMode={true} />
          ) : (
            <div className="p-6 text-center text-gray-500">
              Missing vehicle or customer data for preview.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between flex-shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-100"
          >
            Close Preview
          </button>
          <button
            onClick={onSend}
            className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
          >
            Send to Customer
          </button>
        </div>
      </div>
    </div>
  )
}
