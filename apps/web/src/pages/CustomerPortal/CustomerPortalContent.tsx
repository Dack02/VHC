/**
 * CustomerPortalContent - Reusable rendering component for the customer portal view.
 * Used by both CustomerPortal (live) and CustomerPreviewModal (preview).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { PortalData, NewRepairItem, CheckResult } from './types'

interface CustomerPortalContentProps {
  data: PortalData
  previewMode?: boolean
  onApproveItem?: (repairItemId: string, selectedOptionId: string | null) => Promise<void>
  onDeclineItem?: (repairItemId: string) => Promise<void>
  onApproveAll?: (selections: Array<{ repairItemId: string; selectedOptionId: string | null }>) => Promise<void>
  onDeclineAll?: () => Promise<void>
  onSign?: (signatureData: string) => Promise<void>
}

export default function CustomerPortalContent({
  data,
  previewMode = false,
  onApproveItem,
  onDeclineItem,
  onApproveAll,
  onDeclineAll,
  onSign
}: CustomerPortalContentProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['urgent', 'advisory', 'repairs', 'photos']))
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({})
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; caption: string | null } | null>(null)
  const [showSignature, setShowSignature] = useState(false)
  const [signatureSubmitted, setSignatureSubmitted] = useState(false)
  const [savingNewRepairItem, setSavingNewRepairItem] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [decliningAll, setDecliningAll] = useState(false)

  // Apply branding CSS variables scoped to container (preview) or document root (live)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data?.site?.organization?.settings) return

    const settings = data.site.organization.settings
    const target = previewMode ? containerRef.current : document.documentElement
    if (!target) return

    if (settings.primaryColor) {
      target.style.setProperty('--brand-primary', settings.primaryColor)
      const hex = settings.primaryColor.replace('#', '')
      const r = Math.max(0, parseInt(hex.substring(0, 2), 16) * 0.85)
      const g = Math.max(0, parseInt(hex.substring(2, 4), 16) * 0.85)
      const b = Math.max(0, parseInt(hex.substring(4, 6), 16) * 0.85)
      target.style.setProperty('--brand-primary-hover', `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`)
    }

    return () => {
      if (!previewMode) {
        document.documentElement.style.removeProperty('--brand-primary')
        document.documentElement.style.removeProperty('--brand-primary-hover')
      }
    }
  }, [data?.site?.organization?.settings, previewMode])

  // Initialize selected options when data loads
  useEffect(() => {
    if (!data?.newRepairItems) return

    const initialSelections: Record<string, string> = {}
    for (const item of data.newRepairItems) {
      if (item.options.length > 0) {
        if (item.selectedOptionId) {
          initialSelections[item.id] = item.selectedOptionId
        } else {
          const recommended = item.options.find(o => o.isRecommended)
          initialSelections[item.id] = recommended?.id || item.options[0].id
        }
      }
    }
    setSelectedOptions(initialSelections)
  }, [data?.newRepairItems])

  const handleApproveNewRepairItem = async (repairItemId: string) => {
    if (isReadOnly || savingNewRepairItem || !onApproveItem) return
    setSavingNewRepairItem(repairItemId)
    try {
      await onApproveItem(repairItemId, selectedOptions[repairItemId] || null)
    } finally {
      setSavingNewRepairItem(null)
    }
  }

  const handleDeclineNewRepairItem = async (repairItemId: string) => {
    if (isReadOnly || savingNewRepairItem || !onDeclineItem) return
    setSavingNewRepairItem(repairItemId)
    try {
      await onDeclineItem(repairItemId)
    } finally {
      setSavingNewRepairItem(null)
    }
  }

  const handleApproveAllNewRepairItems = async () => {
    if (isReadOnly || approvingAll || !onApproveAll) return
    setApprovingAll(true)
    try {
      const selections = (data?.newRepairItems || [])
        .filter(item => item.customerApproved === null)
        .map(item => ({
          repairItemId: item.id,
          selectedOptionId: selectedOptions[item.id] || null
        }))
      await onApproveAll(selections)
    } finally {
      setApprovingAll(false)
    }
  }

  const handleDeclineAllNewRepairItems = async () => {
    if (isReadOnly || decliningAll || !onDeclineAll) return
    setDecliningAll(true)
    try {
      await onDeclineAll()
    } finally {
      setDecliningAll(false)
    }
  }

  const handleSelectOption = (repairItemId: string, optionId: string) => {
    if (isReadOnly) return
    setSelectedOptions(prev => ({
      ...prev,
      [repairItemId]: optionId
    }))
  }

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

  const handleSignComplete = async (signatureData: string) => {
    if (isReadOnly || !onSign) return
    await onSign(signatureData)
    setSignatureSubmitted(true)
  }

  const { healthCheck, vehicle, customer, site, checkResults, newRepairItems, hasNewRepairItems } = data

  // Check if health check is in a terminal state (completed/cancelled)
  const isCompleted = healthCheck.status === 'completed' || healthCheck.status === 'cancelled'
  const isReadOnly = previewMode || isCompleted

  // Get all photos from check results
  const allPhotos = useMemo(() =>
    checkResults
      .filter(r => r.media && r.media.length > 0)
      .flatMap(r => r.media!.map(m => ({
        ...m,
        itemName: r.template_item?.name || 'Unknown',
        ragStatus: r.rag_status
      }))),
    [checkResults]
  )

  // Categorize new repair items by RAG status
  const urgentNewItems = useMemo(() => (newRepairItems || []).filter(item => item.ragStatus === 'red'), [newRepairItems])
  const advisoryNewItems = useMemo(() => (newRepairItems || []).filter(item => item.ragStatus === 'amber'), [newRepairItems])

  const approvedNewItems = useMemo(() => (newRepairItems || []).filter(item => item.customerApproved === true), [newRepairItems])
  const declinedNewItems = useMemo(() => (newRepairItems || []).filter(item => item.customerApproved === false), [newRepairItems])
  const pendingNewItems = useMemo(() => (newRepairItems || []).filter(item => item.customerApproved === null), [newRepairItems])

  const getNewItemPrice = useCallback((item: NewRepairItem) => {
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
  }, [selectedOptions])

  const approvedNewSubtotal = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).subtotal, 0)
  const approvedNewVat = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).vatAmount, 0)
  const approvedNewTotal = approvedNewItems.reduce((sum, item) => sum + getNewItemPrice(item).totalIncVat, 0)

  const pendingNewSubtotal = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).subtotal, 0)
  const pendingNewVat = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).vatAmount, 0)
  const pendingNewTotal = pendingNewItems.reduce((sum, item) => sum + getNewItemPrice(item).totalIncVat, 0)

  const allNewActioned = pendingNewItems.length === 0 && (newRepairItems || []).length > 0
  const hasNewApprovedItems = approvedNewItems.length > 0

  return (
    <div ref={containerRef} className={previewMode ? 'bg-gray-100' : 'min-h-screen bg-gray-100'}>
      {/* Preview Banner */}
      {previewMode && (
        <div className="text-center text-sm text-gray-500 bg-yellow-50 p-2 border border-yellow-200">
          This is how the customer will see their health check report
        </div>
      )}

      {/* Completed Banner */}
      {isCompleted && !previewMode && (
        <div className="text-center text-sm text-gray-700 bg-blue-50 p-3 border-b border-blue-200">
          This health check has been completed. You can review the details below but no further changes can be made.
        </div>
      )}

      {/* Header */}
      <header className={`bg-white border-b border-gray-200 ${previewMode ? '' : 'sticky top-0 z-10'}`}>
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
        {urgentNewItems.length > 0 && (
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
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{urgentNewItems.length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('urgent') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('urgent') && (
              <div className="divide-y divide-gray-200">
                {urgentNewItems.map(item => (
                  <NewRepairItemCard
                    key={item.id}
                    item={item}
                    selectedOptionId={selectedOptions[item.id]}
                    saving={savingNewRepairItem === item.id}
                    disabled={isReadOnly}
                    onSelectOption={(optionId) => handleSelectOption(item.id, optionId)}
                    onApprove={() => handleApproveNewRepairItem(item.id)}
                    onDecline={() => handleDeclineNewRepairItem(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Advisory Items Section */}
        {advisoryNewItems.length > 0 && (
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
                <span className="bg-white bg-opacity-20 px-2 py-0.5 text-sm">{advisoryNewItems.length}</span>
              </div>
              <svg className={`w-5 h-5 transition-transform ${expandedSections.has('advisory') ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.has('advisory') && (
              <div className="divide-y divide-gray-200">
                {advisoryNewItems.map(item => (
                  <NewRepairItemCard
                    key={item.id}
                    item={item}
                    selectedOptionId={selectedOptions[item.id]}
                    saving={savingNewRepairItem === item.id}
                    disabled={isReadOnly}
                    onSelectOption={(optionId) => handleSelectOption(item.id, optionId)}
                    onApprove={() => handleApproveNewRepairItem(item.id)}
                    onDecline={() => handleDeclineNewRepairItem(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Approve All / Decline All Section */}
        {pendingNewItems.length > 1 && !isCompleted && (
          <div className="bg-white shadow-sm border border-gray-200 p-4">
            <div className="flex gap-3">
              <button
                onClick={handleApproveAllNewRepairItems}
                disabled={isReadOnly || approvingAll || decliningAll}
                className={`flex-1 py-2 bg-green-600 text-white font-medium text-sm hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
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
                disabled={isReadOnly || approvingAll || decliningAll}
                className={`flex-1 py-2 bg-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center gap-2 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
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

        {/* Quote Summary */}
        {(newRepairItems || []).length > 0 && (
          <div className="bg-white shadow-sm border border-gray-200 p-4">
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
        {(!hasNewRepairItems || (newRepairItems || []).length === 0) && (
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

        {/* Summary & Signature - New repair items */}
        {hasNewApprovedItems && allNewActioned && hasNewRepairItems && !signatureSubmitted && !isReadOnly && (
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
                onComplete={handleSignComplete}
                onCancel={() => setShowSignature(false)}
              />
            )}
          </div>
        )}

        {/* Signature Complete */}
        {signatureSubmitted && !isReadOnly && (
          <div className="bg-green-50 border-2 border-green-200 p-6 text-center">
            <svg className="w-12 h-12 text-green-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-lg font-bold text-green-800 mb-2">Authorisation Complete</h3>
            <p className="text-green-700">
              Thank you for authorising the repairs. The dealership has been notified and will be in touch shortly.
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

// Signature Capture Component (no token needed - parent handles API call)
function SignatureCapture({
  onComplete,
  onCancel
}: {
  onComplete: (signatureData: string) => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [saving, setSaving] = useState(false)

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
      onComplete(signatureData)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = canvas.offsetWidth
    canvas.height = 200

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
            'Confirm Authorisation'
          )}
        </button>
      </div>
    </div>
  )
}

// Green Items Section Component
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

// New Repair Item Card Component
function NewRepairItemCard({
  item,
  selectedOptionId,
  saving,
  disabled,
  onSelectOption,
  onApprove,
  onDecline
}: {
  item: NewRepairItem
  selectedOptionId: string | undefined
  saving: boolean
  disabled?: boolean
  onSelectOption: (optionId: string) => void
  onApprove: () => void
  onDecline: () => void
}) {
  const isApproved = item.customerApproved === true
  const hasDecision = item.customerApproved !== null
  const hasOptions = item.options.length > 0

  const selectedOption = hasOptions
    ? item.options.find(o => o.id === (isApproved ? item.selectedOptionId : selectedOptionId))
    : null

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

        {/* Deferred Status */}
        {item.outcomeStatus === 'deferred' && (
          <div className="mt-2 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Deferred{item.deferredUntil ? ` until ${new Date(item.deferredUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
            </span>
          </div>
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
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                        child.ragStatus === 'red' ? 'bg-red-500' :
                        child.ragStatus === 'amber' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      <div>
                        <span className="text-gray-700">{child.name}</span>
                        {child.vhcReason && (
                          <span className="text-gray-500 ml-1">- {child.vhcReason}</span>
                        )}
                      </div>
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
              className={`flex items-start gap-3 p-3 border rounded-lg transition-colors ${
                disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
              } ${
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
                disabled={disabled}
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
            disabled={saving || disabled}
            className={`flex-1 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2 ${disabled ? 'cursor-not-allowed' : ''}`}
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
            disabled={saving || disabled}
            className={`flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center gap-2 ${disabled ? 'cursor-not-allowed' : ''}`}
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
