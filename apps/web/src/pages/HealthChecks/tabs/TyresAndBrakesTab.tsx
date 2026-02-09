import { useMemo } from 'react'
import { CheckResult } from '../../../lib/api'
import { TyreSetDisplay } from '../components/TyreDisplay'
import type { TyreData, TyreSetData } from '../components/TyreDisplay'
import { BrakeDisplay } from '../components/BrakeDisplay'
import type { BrakeData } from '../components/BrakeDisplay'

interface TyresAndBrakesTabProps {
  results: CheckResult[]
}

// Position key names used in multi-position tyre data
const POSITION_KEYS = [
  'ns_front', 'os_front', 'ns_rear', 'os_rear',
  'front_left', 'front_right', 'rear_left', 'rear_right'
] as const

/**
 * Check if tyre data is multi-position (has named position keys)
 */
function isMultiPosition(value: Record<string, unknown>): boolean {
  return POSITION_KEYS.some(key => value[key] !== undefined)
}

/**
 * Check if tyre data is single-position (flat outer/middle/inner)
 */
function isSinglePosition(value: Record<string, unknown>): boolean {
  return !isMultiPosition(value) && (
    value.outer !== undefined || value.middle !== undefined || value.inner !== undefined
  )
}

export function TyresAndBrakesTab({ results }: TyresAndBrakesTabProps) {
  const { tyreResults, brakeResults, hasTyreData, hasBrakeData } = useMemo(() => {
    const tyreDepth = results.filter(r => r.template_item?.item_type === 'tyre_depth')
    const tyreDetails = results.filter(r => r.template_item?.item_type === 'tyre_details')
    const brakes = results.filter(r => r.template_item?.item_type === 'brake_measurement')

    return {
      tyreResults: { depth: tyreDepth, details: tyreDetails },
      brakeResults: brakes,
      hasTyreData: tyreDepth.length > 0 || tyreDetails.length > 0,
      hasBrakeData: brakes.length > 0,
    }
  }, [results])

  // Merge tyre depth + details results into per-position data
  const mergedTyreData = useMemo(() => {
    const { depth: depthResults, details: detailsResults } = tyreResults

    // If we have multi-position depth data, merge with details
    // If we only have single-position, render each result separately
    // If we only have details without depth, still show specs

    // Collect all multi-position depth data
    const multiPositionDepth = depthResults.filter(r => {
      const val = r.value as Record<string, unknown> | null
      return val && isMultiPosition(val)
    })

    const singlePositionDepth = depthResults.filter(r => {
      const val = r.value as Record<string, unknown> | null
      return val && isSinglePosition(val)
    })

    // Collect multi-position details data
    const multiPositionDetails = detailsResults.filter(r => {
      const val = r.value as Record<string, unknown> | null
      return val && isMultiPosition(val)
    })

    const singlePositionDetails = detailsResults.filter(r => {
      const val = r.value as Record<string, unknown> | null
      return val && isSinglePosition(val)
    })

    // Strategy: If we have multi-position data, merge depth + details into one set
    // Otherwise fall back to rendering individual results via TyreSetDisplay
    if (multiPositionDepth.length > 0 || multiPositionDetails.length > 0) {
      // Merge multi-position depth and details into a combined TyreSetData
      // Start with depth data as the base
      const merged: Record<string, TyreData> = {}
      const ragStatuses: Record<string, 'green' | 'amber' | 'red' | null> = {}

      // Process depth results - extract per-position data
      for (const result of multiPositionDepth) {
        const val = result.value as Record<string, unknown>
        for (const key of POSITION_KEYS) {
          if (val[key]) {
            const posKey = normalizePositionKey(key)
            merged[posKey] = { ...(merged[posKey] || {}), ...(val[key] as TyreData) }
            // Track worst RAG status per position
            if (result.rag_status === 'red' || ragStatuses[posKey] === 'red') {
              ragStatuses[posKey] = 'red'
            } else if (result.rag_status === 'amber' || ragStatuses[posKey] === 'amber') {
              ragStatuses[posKey] = 'amber'
            } else {
              ragStatuses[posKey] = result.rag_status
            }
          }
        }
      }

      // Overlay details data (specs like manufacturer, size, etc.)
      for (const result of multiPositionDetails) {
        const val = result.value as Record<string, unknown>
        for (const key of POSITION_KEYS) {
          if (val[key]) {
            const posKey = normalizePositionKey(key)
            merged[posKey] = { ...(merged[posKey] || {}), ...(val[key] as TyreData) }
          }
        }
      }

      // Build a TyreSetData from merged positions
      const tyreSetData: TyreSetData = {
        ns_front: merged['ns_front'] || null,
        os_front: merged['os_front'] || null,
        ns_rear: merged['ns_rear'] || null,
        os_rear: merged['os_rear'] || null,
      }

      // Overall RAG status = worst of all positions
      const allStatuses = Object.values(ragStatuses)
      let overallRag: 'green' | 'amber' | 'red' | null = null
      if (allStatuses.includes('red')) overallRag = 'red'
      else if (allStatuses.includes('amber')) overallRag = 'amber'
      else if (allStatuses.includes('green')) overallRag = 'green'

      return {
        type: 'merged' as const,
        tyreSetData,
        overallRag,
        singleResults: singlePositionDepth,
        singleDetailsResults: singlePositionDetails,
      }
    }

    // No multi-position data - render individual results directly
    return {
      type: 'individual' as const,
      tyreSetData: null,
      overallRag: null,
      singleResults: [...depthResults, ...singlePositionDetails],
      singleDetailsResults: [] as CheckResult[],
    }
  }, [tyreResults])

  // Count red/amber items for display
  const attentionCount = useMemo(() => {
    const tyreAndBrakeResults = results.filter(r => {
      const type = r.template_item?.item_type
      return type === 'tyre_depth' || type === 'tyre_details' || type === 'brake_measurement'
    })
    return tyreAndBrakeResults.filter(r => r.rag_status === 'red' || r.rag_status === 'amber').length
  }, [results])

  if (!hasTyreData && !hasBrakeData) {
    return (
      <div className="text-center py-12 text-gray-500">
        No tyre or brake data recorded for this health check.
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Tyres Section */}
      {hasTyreData && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            Tyres
            {attentionCount > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                {attentionCount} item{attentionCount !== 1 ? 's' : ''} need attention
              </span>
            )}
          </h3>

          {mergedTyreData.type === 'merged' && mergedTyreData.tyreSetData && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <TyreSetDisplay data={mergedTyreData.tyreSetData} ragStatus={mergedTyreData.overallRag} />
            </div>
          )}

          {/* Render any single-position results that weren't merged */}
          {mergedTyreData.singleResults.length > 0 && (
            <div className={`${mergedTyreData.type === 'merged' ? 'mt-4' : ''} space-y-4`}>
              {mergedTyreData.singleResults.map(result => (
                <div key={result.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="text-sm font-medium text-gray-600 mb-2">
                    {result.template_item?.name || 'Tyre'}
                  </div>
                  <TyreSetDisplay
                    data={result.value as TyreSetData}
                    ragStatus={result.rag_status}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Single-position details results (specs only, no depth) */}
          {mergedTyreData.singleDetailsResults.length > 0 && (
            <div className="mt-4 space-y-4">
              {mergedTyreData.singleDetailsResults.map(result => (
                <div key={result.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                  <div className="text-sm font-medium text-gray-600 mb-2">
                    {result.template_item?.name || 'Tyre Details'}
                  </div>
                  <TyreSetDisplay
                    data={result.value as TyreSetData}
                    ragStatus={result.rag_status}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Brakes Section */}
      {hasBrakeData && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Brakes</h3>
          <div className="space-y-4">
            {brakeResults.map(result => (
              <div key={result.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="text-sm font-medium text-gray-600 mb-2">
                  {result.template_item?.name || 'Brake Measurement'}
                </div>
                <BrakeDisplay
                  data={result.value as BrakeData}
                  ragStatus={result.rag_status}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Normalize position keys to consistent ns_front/os_front/ns_rear/os_rear format
 */
function normalizePositionKey(key: string): string {
  switch (key) {
    case 'front_left': return 'ns_front'
    case 'front_right': return 'os_front'
    case 'rear_left': return 'ns_rear'
    case 'rear_right': return 'os_rear'
    default: return key
  }
}

/**
 * Compute whether the tab should be shown and badge info.
 * Exported for use by HealthCheckDetail.
 */
export function computeTyresBrakesTabInfo(results: CheckResult[]): {
  hasData: boolean
  attentionCount: number
  hasRed: boolean
} {
  const relevant = results.filter(r => {
    const type = r.template_item?.item_type
    return type === 'tyre_depth' || type === 'tyre_details' || type === 'brake_measurement'
  })

  const redAmber = relevant.filter(r => r.rag_status === 'red' || r.rag_status === 'amber')
  const hasRed = redAmber.some(r => r.rag_status === 'red')

  return {
    hasData: relevant.length > 0,
    attentionCount: redAmber.length,
    hasRed,
  }
}
