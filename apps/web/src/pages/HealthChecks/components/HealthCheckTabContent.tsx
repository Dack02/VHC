/**
 * HealthCheckTabContent Component
 * RAG-grouped sections view for the advisor health check detail
 */

import { useMemo } from 'react'
import { CheckResult, RepairItem, Authorization, TemplateSection } from '../../../lib/api'
import { SectionHeader, SectionSubheader } from './SectionHeader'
import { RepairItemRow, GreenItemRow } from './RepairItemRow'
import { TyreSetDisplay } from './TyreDisplay'
import { BrakeDisplay } from './BrakeDisplay'

interface HealthCheckTabContentProps {
  healthCheckId: string
  sections: TemplateSection[]  // May be used for grouping in future
  results: CheckResult[]
  repairItems: RepairItem[]
  authorizations: Authorization[]
  onUpdate: () => void
  onPhotoClick?: (resultId: string) => void
}

export function HealthCheckTabContent({
  healthCheckId,
  sections: _sections,  // Reserved for future grouping enhancements
  results,
  repairItems,
  authorizations,
  onUpdate,
  onPhotoClick
}: HealthCheckTabContentProps) {
  // Silence unused var warning - sections may be used in future for grouping
  void _sections

  const resultsById = useMemo(() =>
    new Map(results.map(r => [r.id, r])),
    [results]
  )

  const authByRepairItemId = useMemo(() =>
    new Map(authorizations.map(a => [a.repair_item_id, a])),
    [authorizations]
  )

  // Group repair items by RAG status
  const redItems = useMemo(() =>
    repairItems.filter(item => item.rag_status === 'red'),
    [repairItems]
  )

  const amberItems = useMemo(() =>
    repairItems.filter(item => item.rag_status === 'amber'),
    [repairItems]
  )

  // Green items come from results, not repair items
  const greenResults = useMemo(() =>
    results.filter(r => r.rag_status === 'green'),
    [results]
  )

  // Authorised items (approved by customer)
  const authorisedItems = useMemo(() =>
    repairItems.filter(item => {
      const auth = authByRepairItemId.get(item.id)
      return auth?.decision === 'approved'
    }),
    [repairItems, authByRepairItemId]
  )

  // Declined items
  const declinedItems = useMemo(() =>
    repairItems.filter(item => {
      const auth = authByRepairItemId.get(item.id)
      return auth?.decision === 'declined'
    }),
    [repairItems, authByRepairItemId]
  )

  // Calculate totals
  const redTotal = redItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const amberTotal = amberItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const authorisedTotal = authorisedItems.reduce((sum, item) => sum + (item.total_price || 0), 0)
  const authorisedCompletedTotal = authorisedItems
    .filter(item => item.work_completed_at)
    .reduce((sum, item) => sum + (item.total_price || 0), 0)

  // Group green results by section
  const greenResultsBySection = useMemo(() => {
    const grouped = new Map<string, { section: TemplateSection; results: CheckResult[] }>()

    greenResults.forEach(result => {
      const section = result.template_item?.section
      if (section) {
        if (!grouped.has(section.id)) {
          grouped.set(section.id, {
            section: { ...section, items: [] } as TemplateSection,
            results: []
          })
        }
        grouped.get(section.id)!.results.push(result)
      }
    })

    // Sort by section order
    return Array.from(grouped.values()).sort(
      (a, b) => a.section.sort_order - b.section.sort_order
    )
  }, [greenResults])

  // Helper to get result for a repair item
  const getResultForRepairItem = (item: RepairItem): CheckResult | null => {
    if (item.check_result_id) {
      return resultsById.get(item.check_result_id) || null
    }
    return null
  }

  // Helper to check if an item is a tyre item
  const isTyreItem = (result: CheckResult | null): boolean => {
    return result?.template_item?.item_type === 'tyre_depth'
  }

  // Helper to check if an item is a brake item
  const isBrakeItem = (result: CheckResult | null): boolean => {
    return result?.template_item?.item_type === 'brake_measurement'
  }

  // Helper to render special displays for tyre/brake items
  const renderSpecialDisplay = (result: CheckResult | null) => {
    if (!result) return null

    if (isTyreItem(result) && result.value) {
      return (
        <div className="mt-2 px-4">
          <TyreSetDisplay data={result.value as any} ragStatus={result.rag_status} />
        </div>
      )
    }

    if (isBrakeItem(result) && result.value) {
      return (
        <div className="mt-2 px-4">
          <BrakeDisplay data={result.value as any} ragStatus={result.rag_status} />
        </div>
      )
    }

    return null
  }

  return (
    <div className="space-y-4">
      {/* Immediate Attention (Red) */}
      {redItems.length > 0 && (
        <SectionHeader
          title="Immediate Attention"
          ragStatus="red"
          itemCount={redItems.length}
          totalPrice={redTotal}
        >
          {redItems.map(item => {
            const result = getResultForRepairItem(item)
            return (
              <div key={item.id}>
                <RepairItemRow
                  healthCheckId={healthCheckId}
                  item={item}
                  result={result}
                  onUpdate={onUpdate}
                  onPhotoClick={onPhotoClick}
                />
                {renderSpecialDisplay(result)}
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Advisory (Amber) */}
      {amberItems.length > 0 && (
        <SectionHeader
          title="Advisory"
          ragStatus="amber"
          itemCount={amberItems.length}
          totalPrice={amberTotal}
        >
          {amberItems.map(item => {
            const result = getResultForRepairItem(item)
            return (
              <div key={item.id}>
                <RepairItemRow
                  healthCheckId={healthCheckId}
                  item={item}
                  result={result}
                  showFollowUp={true}
                  onUpdate={onUpdate}
                  onPhotoClick={onPhotoClick}
                />
                {renderSpecialDisplay(result)}
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Items OK (Green) - Collapsed by default */}
      {greenResults.length > 0 && (
        <SectionHeader
          title="Items OK"
          ragStatus="green"
          itemCount={greenResults.length}
          defaultExpanded={false}
          collapsible={true}
        >
          {greenResultsBySection.map(({ section, results: sectionResults }) => (
            <div key={section.id}>
              <SectionSubheader
                title={section.name}
                itemCount={sectionResults.length}
              />
              {sectionResults.map(result => {
                // Check if this is a tyre or brake item that should show details
                const showDetails = isTyreItem(result) || isBrakeItem(result)

                return (
                  <div key={result.id}>
                    <GreenItemRow
                      title={result.template_item?.name || 'Unknown Item'}
                      notes={result.notes}
                      value={result.value}
                    />
                    {showDetails && renderSpecialDisplay(result)}
                  </div>
                )
              })}
            </div>
          ))}
        </SectionHeader>
      )}

      {/* Authorised Work (Blue) */}
      {authorisedItems.length > 0 && (
        <SectionHeader
          title="Authorised Work"
          ragStatus="blue"
          itemCount={authorisedItems.length}
          totalPrice={authorisedTotal}
        >
          {/* Authorised summary */}
          <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 flex justify-between text-sm">
            <span className="text-blue-700">
              Work Completed: {authorisedItems.filter(i => i.work_completed_at).length} of {authorisedItems.length}
            </span>
            <span className="text-blue-700 font-medium">
              Completed Value: £{authorisedCompletedTotal.toFixed(2)}
            </span>
          </div>

          {authorisedItems.map(item => {
            const result = getResultForRepairItem(item)
            return (
              <div key={item.id}>
                <RepairItemRow
                  healthCheckId={healthCheckId}
                  item={item}
                  result={result}
                  showWorkComplete={true}
                  onUpdate={onUpdate}
                  onPhotoClick={onPhotoClick}
                />
              </div>
            )
          })}
        </SectionHeader>
      )}

      {/* Declined (Grey) */}
      {declinedItems.length > 0 && (
        <SectionHeader
          title="Declined"
          ragStatus="grey"
          itemCount={declinedItems.length}
          collapsible={true}
          defaultExpanded={false}
        >
          {declinedItems.map(item => (
            <div
              key={item.id}
              className="px-4 py-3 border-b border-gray-200 last:border-b-0 bg-white"
            >
              <div className="flex items-center gap-3">
                {/* Declined icon */}
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>

                {/* Item name */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-600 line-through">{item.title}</span>
                </div>

                {/* Original price */}
                <div className="text-sm text-gray-400">
                  £{(item.total_price || 0).toFixed(2)}
                </div>
              </div>
              {item.description && (
                <div className="ml-7 text-xs text-gray-400 mt-1">{item.description}</div>
              )}
            </div>
          ))}
        </SectionHeader>
      )}

      {/* No items message */}
      {redItems.length === 0 && amberItems.length === 0 && greenResults.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
          No inspection results available
        </div>
      )}
    </div>
  )
}
