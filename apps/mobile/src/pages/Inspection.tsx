import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck, TemplateSection, TemplateItem, CheckResult, CheckinSettings } from '../lib/api'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { RAGSelector, RAGIndicator } from '../components/RAGSelector'
import { Input, TextArea } from '../components/Input'
import { PhotoCapture } from '../components/PhotoCapture'
import { TyreDepthInput } from '../components/TyreDepthInput'
import { TyreDetailsInput } from '../components/TyreDetailsInput'
import { BrakeMeasurementInput } from '../components/BrakeMeasurementInput'
import { BrakeFluidSelector } from '../components/BrakeFluidSelector'
import { MeasurementInput } from '../components/MeasurementInput'
import { SelectInput } from '../components/SelectInput'
import { MultiSelectInput } from '../components/MultiSelectInput'
import { Badge } from '../components/Badge'
import { db } from '../lib/db'
import { ReasonSelector } from '../components/ReasonSelector'
import { LocationPicker } from '../components/LocationPicker'
import { MriScanTab } from './MriScanTab'
import type { VehicleLocation } from '../lib/api'

// State for tracking which item has ReasonSelector open
interface ReasonSelectorState {
  itemKey: string
  templateItemId: string
  templateItemName: string
  checkResultId?: string
  currentRag: 'red' | 'amber' | 'green' | null
}

// State for tracking which item has LocationPicker open
interface LocationPickerState {
  templateItemId: string
  templateItemName: string
  ragStatus: 'red' | 'amber' | 'green'
  value?: unknown
  notes?: string | null
}

export function Inspection() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkinEnabled, setCheckinEnabled] = useState(false)

  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  // Key format: `${templateItemId}-${instanceNumber}` to support duplicates
  const [results, setResults] = useState<Map<string, Partial<CheckResult>>>(new Map())
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [photoItemId, setPhotoItemId] = useState<string | null>(null)
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; caption?: string } | null>(null)
  const [creatingDuplicate, setCreatingDuplicate] = useState(false)
  const [reasonSelectorItem, setReasonSelectorItem] = useState<ReasonSelectorState | null>(null)
  // Track reason counts per check result (keyed by check result ID)
  const [reasonCounts, setReasonCounts] = useState<Map<string, number>>(new Map())
  // Vehicle locations for location-required items
  const [vehicleLocations, setVehicleLocations] = useState<VehicleLocation[]>([])
  const [locationPickerState, setLocationPickerState] = useState<LocationPickerState | null>(null)
  const [pendingLocationReasons, setPendingLocationReasons] = useState<ReasonSelectorState[]>([])

  // Helper to generate result key
  // For location-based results, we use templateItemId-loc-locationId format
  const getResultKey = (templateItemId: string, instanceNumber: number = 1, vehicleLocationId?: string) =>
    vehicleLocationId
      ? `${templateItemId}-loc-${vehicleLocationId}`
      : `${templateItemId}-${instanceNumber}`

  useEffect(() => {
    fetchJob()
  }, [id])

  // Set MRI Scan as default tab when check-in is enabled (MRI is at index 0)
  useEffect(() => {
    if (checkinEnabled && sections.length > 0) {
      setCurrentSectionIndex(0)
    }
  }, [checkinEnabled, sections.length])

  const fetchJob = async () => {
    if (!session || !id) return

    try {
      // Phase 1: Fetch health check (needed for org_id and template_id)
      const { healthCheck } = await api<{ healthCheck: HealthCheck }>(
        `/api/v1/health-checks/${id}`,
        { token: session.access_token }
      )
      setJob(healthCheck)

      // Phase 2: Fetch settings, locations, template, and results in parallel
      const [checkinSettings, locationsResp, templateResp, resultsResp] = await Promise.all([
        api<CheckinSettings>(
          `/api/v1/organizations/${healthCheck.organization_id}/checkin-settings`,
          { token: session.access_token }
        ).catch(() => ({ checkinEnabled: false }) as CheckinSettings),

        api<{ locations: VehicleLocation[] }>(
          `/api/v1/organizations/${healthCheck.organization_id}/vehicle-locations`,
          { token: session.access_token }
        ).catch(() => ({ locations: [] as VehicleLocation[] })),

        healthCheck.template_id
          ? api<{ sections?: TemplateSection[] }>(
              `/api/v1/templates/${healthCheck.template_id}`,
              { token: session.access_token }
            )
          : Promise.resolve({ sections: [] as TemplateSection[] }),

        api<{ results: CheckResult[] }>(
          `/api/v1/health-checks/${id}/results`,
          { token: session.access_token }
        )
      ])

      setCheckinEnabled(checkinSettings.checkinEnabled)

      const fetchedLocations = locationsResp.locations || []
      setVehicleLocations(fetchedLocations)

      const templateSections = templateResp.sections || []
      setSections(templateSections)

      const apiResults = resultsResp.results

      const resultsMap = new Map<string, Partial<CheckResult>>()
      apiResults.forEach((r) => {
        // Handle both camelCase (API) and snake_case (offline storage) formats
        const itemId = r.templateItemId || r.template_item_id
        const instanceNum = r.instanceNumber || r.instance_number || 1
        const locId = r.vehicleLocationId || r.vehicle_location_id
        if (itemId) {
          const key = getResultKey(itemId, instanceNum, locId || undefined)
          resultsMap.set(key, {
            ...r,
            // Normalize to have both formats for compatibility
            templateItemId: itemId,
            template_item_id: itemId,
            instanceNumber: instanceNum,
            instance_number: instanceNum,
            vehicleLocationId: locId || undefined,
            vehicle_location_id: locId || undefined,
            vehicleLocationName: r.vehicleLocationName || r.vehicle_location_name || undefined,
            vehicle_location_name: r.vehicleLocationName || r.vehicle_location_name || undefined,
            rag_status: r.status || r.rag_status,
            status: r.status || r.rag_status
          })
        }
      })

      const offlineResults = await db.getResults(id)
      offlineResults.forEach((r) => {
        // Type cast to handle both snake_case and camelCase fields
        const result = r as any
        // Now offline DB properly stores template_item_id and instance_number separately
        const itemId = result.template_item_id
        const instanceNum = result.instance_number || 1
        if (itemId) {
          const key = getResultKey(itemId, instanceNum)
          const existing = resultsMap.get(key)
          if (!existing || result.updated_at > (existing as any)?.updated_at) {
            resultsMap.set(key, {
              ...r,
              templateItemId: itemId,
              template_item_id: itemId,
              instanceNumber: instanceNum,
              instance_number: instanceNum,
              rag_status: result.status || result.rag_status,
              status: result.status || result.rag_status
            })
          }
        }
      })

      // Default non-mandatory items to green so techs only interact with issues
      if (templateSections.length > 0) {
        for (const section of templateSections) {
          for (const item of (section.items || [])) {
            if (item.isRequired) continue // Mandatory items must be explicitly set
            const key = getResultKey(item.id, 1)
            if (!resultsMap.has(key) && !resultsMap.has(item.id)) {
              resultsMap.set(key, {
                templateItemId: item.id,
                template_item_id: item.id,
                instanceNumber: 1,
                instance_number: 1,
                status: 'green',
                rag_status: 'green',
                _isDefault: true // Track that this is an auto-default
              } as Partial<CheckResult> & { _isDefault?: boolean })
            }
          }
        }
      }

      setResults(resultsMap)

      // Fetch reason counts via batch endpoint (single request instead of N)
      const countsMap = new Map<string, number>()
      const checkResultIds = apiResults.filter(r => r.id).map(r => r.id)
      if (checkResultIds.length > 0) {
        try {
          const { reasonsByCheckResult } = await api<{ reasonsByCheckResult: Record<string, Array<{ id: string }>> }>(
            `/api/v1/check-results/batch-reasons`,
            {
              method: 'POST',
              token: session.access_token,
              body: JSON.stringify({ checkResultIds })
            }
          )
          Object.entries(reasonsByCheckResult).forEach(([crId, reasons]) => {
            if (reasons.length > 0) {
              countsMap.set(crId, reasons.length)
            }
          })
        } catch {
          // Silently ignore errors
        }
      }
      setReasonCounts(countsMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inspection')
    } finally {
      setLoading(false)
    }
  }

  const currentSection = sections[currentSectionIndex]

  // Get all instances for a template item
  const getItemInstances = (templateItemId: string) => {
    const instances: Array<{ instanceNumber: number; result: Partial<CheckResult>; mapKey: string }> = []
    results.forEach((result, key) => {
      if (key.startsWith(`${templateItemId}-`) && !key.includes('-loc-')) {
        // Parse instanceNumber from the MAP KEY, not from result object
        // This is more reliable as the result object might have corrupted values
        const lastHyphen = key.lastIndexOf('-')
        const instanceNumber = parseInt(key.substring(lastHyphen + 1), 10) || 1
        instances.push({ instanceNumber, result, mapKey: key })
      }
    })
    // Sort by instance number
    return instances.sort((a, b) => a.instanceNumber - b.instanceNumber)
  }

  // Calculate totals (including duplicates)
  const totalItems = [...results.values()].length || sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
  const completedItems = [...results.values()].filter((r) => {
    const status = r.status || r.rag_status
    return status !== null && status !== undefined
  }).length

  // Memoised section stats - only recompute when results, sections, or locations change
  const sectionStats = useMemo(() => {
    return sections.map((section) => {
      // Completed count
      let completed = 0
      ;(section.items || []).forEach((item) => {
        if (item.requiresLocation && vehicleLocations.length > 0) {
          let hasAnyLocResult = false
          vehicleLocations.forEach(loc => {
            const key = getResultKey(item.id, 1, loc.id)
            const r = results.get(key)
            if (r?.status || r?.rag_status) hasAnyLocResult = true
          })
          if (hasAnyLocResult) {
            completed++
            return
          }
          const stdKey = getResultKey(item.id, 1)
          const stdResult = results.get(stdKey) || results.get(item.id)
          if (stdResult?.status || stdResult?.rag_status) completed++
          return
        }

        const instances = getItemInstances(item.id)
        if (instances.length === 0) {
          const r = results.get(item.id) || results.get(getResultKey(item.id, 1))
          if (r?.status || r?.rag_status) completed++
        } else {
          instances.forEach(({ result }) => {
            if (result?.status || result?.rag_status) completed++
          })
        }
      })

      // Mandatory incomplete count
      let mandatoryIncomplete = 0
      ;(section.items || []).forEach((item) => {
        if (!item.isRequired) return

        if (item.requiresLocation && vehicleLocations.length > 0) {
          let hasAnyLocResult = false
          vehicleLocations.forEach(loc => {
            const key = getResultKey(item.id, 1, loc.id)
            const r = results.get(key)
            if (r?.status || r?.rag_status) hasAnyLocResult = true
          })
          // Also check the standard (non-location) key as fallback - item is complete
          // if measurements were entered even before location assignment
          if (!hasAnyLocResult) {
            const stdKey = getResultKey(item.id, 1)
            const stdResult = results.get(stdKey) || results.get(item.id)
            if (!stdResult?.status && !stdResult?.rag_status) mandatoryIncomplete++
          }
          return
        }

        const instances = getItemInstances(item.id)
        if (instances.length === 0) {
          const r = results.get(item.id) || results.get(getResultKey(item.id, 1))
          if (!r?.status && !r?.rag_status) mandatoryIncomplete++
        } else {
          const firstInstance = instances[0]
          if (!firstInstance?.result?.status && !firstInstance?.result?.rag_status) mandatoryIncomplete++
        }
      })

      return { completed, mandatoryIncomplete }
    })
  }, [sections, results, vehicleLocations])

  // Save result (itemKey is the composite key: `${templateItemId}-${instanceNumber}` or `${templateItemId}-loc-${locationId}`)
  const saveResult = useCallback(async (itemKey: string, data: Partial<CheckResult>) => {
    const existingResult = results.get(itemKey)
    const newStatus = data.status || data.rag_status || existingResult?.status || existingResult?.rag_status

    // Parse itemKey to get templateItemId, instanceNumber, and optionally vehicleLocationId
    let templateItemId: string
    let instanceNumber: number
    let vehicleLocationId: string | undefined
    let vehicleLocationName: string | undefined

    if (itemKey.includes('-loc-')) {
      // Location-based key: templateItemId-loc-locationId
      const locIndex = itemKey.indexOf('-loc-')
      templateItemId = itemKey.substring(0, locIndex)
      vehicleLocationId = itemKey.substring(locIndex + 5) // After '-loc-'
      instanceNumber = 1
      // Get location name from existing result or vehicleLocations
      vehicleLocationName = existingResult?.vehicleLocationName || existingResult?.vehicle_location_name ||
        vehicleLocations.find(l => l.id === vehicleLocationId)?.name
    } else {
      // Standard key: templateItemId-instanceNumber
      const parts = itemKey.split('-')
      instanceNumber = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) || 1 : 1
      templateItemId = parts.length > 1 ? parts.slice(0, -1).join('-') : itemKey
    }

    const result = {
      ...existingResult,
      ...data,
      templateItemId,
      template_item_id: templateItemId,
      instanceNumber,
      instance_number: instanceNumber,
      vehicleLocationId,
      vehicle_location_id: vehicleLocationId,
      vehicleLocationName,
      vehicle_location_name: vehicleLocationName,
      health_check_id: id!,
      status: newStatus,
      rag_status: newStatus,
      updated_at: new Date().toISOString(),
      _isDefault: undefined // Clear default flag on explicit interaction
    }

    setResults((prev) => {
      const newResults = new Map(prev)
      newResults.set(itemKey, result)
      return newResults
    })

    await db.saveResult(id!, itemKey, result)

    try {
      await api(`/api/v1/health-checks/${id}/results`, {
        method: 'POST',
        token: session?.access_token,
        body: JSON.stringify({
          templateItemId,
          instanceNumber,
          vehicleLocationId,
          vehicleLocationName,
          status: result.rag_status,
          value: result.value,
          notes: result.notes,
          is_mot_failure: result.is_mot_failure
        })
      })
    } catch {
      await db.addToSyncQueue({
        type: 'result',
        health_check_id: id!,
        item_id: itemKey,
        data: result
      })
    }
  }, [results, session, id, vehicleLocations])

  // Create a duplicate of an item
  const createDuplicate = useCallback(async (templateItemId: string) => {
    if (!session || !id || creatingDuplicate) return

    setCreatingDuplicate(true)
    try {
      const newResult = await api<{
        id: string
        templateItemId: string
        instanceNumber: number
        instance_number: number
      }>(`/api/v1/health-checks/${id}/results/duplicate`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({ templateItemId })
      })

      const instanceNum = newResult.instanceNumber || newResult.instance_number
      const key = getResultKey(templateItemId, instanceNum)

      setResults((prev) => {
        const newResults = new Map(prev)
        newResults.set(key, {
          ...newResult,
          templateItemId,
          template_item_id: templateItemId,
          instanceNumber: instanceNum,
          instance_number: instanceNum,
          status: null,
          rag_status: null
        })
        return newResults
      })

      // Expand the new duplicate
      setExpandedItem(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create duplicate')
    } finally {
      setCreatingDuplicate(false)
    }
  }, [session, id, creatingDuplicate])

  // Delete a duplicate item (only works for instance_number > 1)
  const deleteDuplicate = useCallback(async (itemKey: string, resultId: string) => {
    if (!session || !id) return

    try {
      await api(`/api/v1/health-checks/${id}/results/${resultId}`, {
        method: 'DELETE',
        token: session.access_token
      })

      setResults((prev) => {
        const newResults = new Map(prev)
        newResults.delete(itemKey)
        return newResults
      })

      setExpandedItem(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete duplicate')
    }
  }, [session, id])

  // Stable toggle handler for InspectionItem
  const handleToggle = useCallback((itemKey: string) => {
    setExpandedItem(prev => prev === itemKey ? null : itemKey)
  }, [])

  // Handle saving selected reasons for a check result
  const handleSaveReasons = async (data: {
    selectedReasonIds: string[]
    followUpDays?: number
    followUpText?: string
    customNote?: string
  }) => {
    if (!reasonSelectorItem || !session || !id) return

    const { itemKey, checkResultId } = reasonSelectorItem

    try {
      // First ensure we have a check result ID
      let resultId = checkResultId
      const result = results.get(itemKey)

      if (!resultId && result?.id) {
        resultId = result.id
      }

      // If still no result ID, we need to create the check result first
      if (!resultId) {
        const parts = itemKey.split('-')
        const instanceNumber = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) || 1 : 1
        const templateItemId = parts.length > 1 ? parts.slice(0, -1).join('-') : itemKey

        const savedResult = await api<{ id: string }>(
          `/api/v1/health-checks/${id}/results`,
          {
            method: 'POST',
            token: session.access_token,
            body: JSON.stringify({
              templateItemId,
              instanceNumber,
              status: result?.status || result?.rag_status || null
            })
          }
        )
        resultId = savedResult.id

        // Update local state with the new check result ID
        setResults((prev) => {
          const newResults = new Map(prev)
          const existingResult = newResults.get(itemKey) || {}
          newResults.set(itemKey, {
            ...existingResult,
            id: resultId,
            templateItemId,
            template_item_id: templateItemId,
            instanceNumber,
            instance_number: instanceNumber
          })
          return newResults
        })
      }

      // Now save the reasons to the check result
      await api(`/api/v1/check-results/${resultId}/reasons`, {
        method: 'PUT',
        token: session.access_token,
        body: JSON.stringify({
          reasonIds: data.selectedReasonIds,
          followUpDays: data.followUpDays,
          followUpText: data.followUpText,
          notes: data.customNote
        })
      })

      // Update reason count for this check result
      setReasonCounts((prev) => {
        const newCounts = new Map(prev)
        if (data.selectedReasonIds.length > 0) {
          newCounts.set(resultId!, data.selectedReasonIds.length)
        } else {
          newCounts.delete(resultId!)
        }
        return newCounts
      })

      // Update local state with follow-up info if provided
      if (data.followUpDays || data.followUpText) {
        setResults((prev) => {
          const newResults = new Map(prev)
          const existingResult = newResults.get(itemKey)
          if (existingResult) {
            newResults.set(itemKey, {
              ...existingResult,
              // Store follow-up info in notes or a dedicated field
              notes: data.customNote || existingResult.notes
            })
          }
          return newResults
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reasons')
    }
  }

  // Handle RAG change from ReasonSelector
  const handleReasonSelectorRagChange = (rag: 'red' | 'amber' | 'green') => {
    if (!reasonSelectorItem) return

    const { itemKey } = reasonSelectorItem
    saveResult(itemKey, { status: rag, rag_status: rag })

    // Update the reasonSelectorItem state with new RAG
    setReasonSelectorItem((prev) => prev ? { ...prev, currentRag: rag } : null)
  }

  // Handle location picker save - creates one result per selected location
  const handleLocationPickerSave = async (selectedLocations: { id: string; name: string; shortName: string }[]) => {
    if (!locationPickerState || !session || !id) return

    const { templateItemId, templateItemName, ragStatus, value, notes } = locationPickerState
    setLocationPickerState(null)

    try {
      // Create batch results - one per location
      const batchResults = selectedLocations.map(loc => ({
        templateItemId,
        status: ragStatus,
        value,
        notes,
        instanceNumber: 1,
        vehicleLocationId: loc.id,
        vehicleLocationName: loc.name
      }))

      const response = await api<{ results: Array<{ id: string; templateItemId: string; instanceNumber: number; vehicleLocationId: string; vehicleLocationName: string; status: string }> }>(
        `/api/v1/health-checks/${id}/results/batch`,
        {
          method: 'POST',
          token: session.access_token,
          body: JSON.stringify({ results: batchResults })
        }
      )

      // Update local results map with each saved result
      setResults(prev => {
        const newResults = new Map(prev)
        for (const r of (response.results || [])) {
          const key = getResultKey(r.templateItemId, 1, r.vehicleLocationId)
          newResults.set(key, {
            id: r.id,
            templateItemId: r.templateItemId,
            template_item_id: r.templateItemId,
            instanceNumber: 1,
            instance_number: 1,
            vehicleLocationId: r.vehicleLocationId,
            vehicle_location_id: r.vehicleLocationId,
            vehicleLocationName: r.vehicleLocationName,
            vehicle_location_name: r.vehicleLocationName,
            status: ragStatus,
            rag_status: ragStatus,
            value
          })
        }
        // Remove the standard (non-location) entry for this item now that we have
        // location-specific results. This includes both auto-default entries and entries
        // created by the initial measurement save before location assignment.
        const defaultKey = getResultKey(templateItemId, 1)
        if (newResults.has(defaultKey)) {
          newResults.delete(defaultKey)
        }
        return newResults
      })

      // Build queue entries for ALL saved location results
      const savedResults = response.results || []
      const queue: ReasonSelectorState[] = savedResults.map(r => {
        const loc = selectedLocations.find(l => l.id === r.vehicleLocationId)
        return {
          itemKey: getResultKey(r.templateItemId, 1, r.vehicleLocationId),
          templateItemId: r.templateItemId,
          templateItemName: loc ? `[${loc.shortName}] ${templateItemName}` : templateItemName,
          checkResultId: r.id,
          currentRag: ragStatus
        }
      })

      // Open first, queue the rest
      if (queue.length > 0) {
        setReasonSelectorItem(queue[0])
        setPendingLocationReasons(queue.slice(1))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location results')
    }
  }

  const handlePhotoCapture = async (photoData: string) => {
    if (!photoItemId || !session) return

    // photoItemId is now a composite key: templateItemId-instanceNumber
    // Must handle UUIDs which contain hyphens - take last part as instance, rest as templateId
    const parts = photoItemId.split('-')
    const instanceNumber = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) || 1 : 1
    const templateItemId = parts.length > 1 ? parts.slice(0, -1).join('-') : photoItemId

    setPhotoItemId(null)

    try {
      const result = results.get(photoItemId)
      let resultId = result?.id

      if (!resultId) {
        const savedResult = await api<{ id: string }>(
          `/api/v1/health-checks/${id}/results`,
          {
            method: 'POST',
            token: session.access_token,
            body: JSON.stringify({
              templateItemId,
              instanceNumber,
              status: result?.status || result?.rag_status || null
            })
          }
        )
        resultId = savedResult.id
      }

      const response = await fetch(photoData)
      const blob = await response.blob()
      const formData = new FormData()
      formData.append('file', blob, `photo_${Date.now()}.jpg`)

      await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/health-checks/${id}/results/${resultId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData
        }
      )

      fetchJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo')
    }
  }

  const handleComplete = async () => {
    // Persist default-green items that the tech didn't interact with
    const savePromises: Promise<void>[] = []
    results.forEach((result, key) => {
      if ((result as any)._isDefault) {
        savePromises.push(saveResult(key, { status: 'green', rag_status: 'green' }))
      }
    })
    if (savePromises.length > 0) {
      await Promise.all(savePromises)
    }
    navigate(`/job/${id}/summary`)
  }

  const handlePause = async () => {
    if (!session || !id) return

    try {
      // Clock out with complete=false to pause (this also changes status to 'paused')
      await api(`/api/v1/health-checks/${id}/clock-out`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({ complete: false })
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause inspection')
    }
  }

  if (loading) {
    return (
      <div className="min-h-full bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!job || sections.length === 0) {
    return (
      <div className="h-full bg-gray-100 flex flex-col">
        <header className="bg-primary text-white px-4 py-3 sticky top-0 z-10">
          <h1 className="text-lg font-bold">Error</h1>
        </header>
        <main className="flex-1 p-4">
          <Card padding="lg">
            <p className="text-gray-600">{error || 'Unable to load inspection'}</p>
            <Button onClick={() => navigate('/')} className="mt-4" fullWidth>
              Back to Jobs
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white safe-area-inset-top sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              {job.vhc_reference && (
                <span className="text-xs font-medium text-blue-200 bg-blue-800 px-2 py-0.5 rounded">
                  {job.vhc_reference}
                </span>
              )}
              {job.jobsheet_number && (
                <span className="text-xs font-medium text-blue-200 bg-blue-800 px-2 py-0.5 rounded">
                  Job #{job.jobsheet_number}
                </span>
              )}
              <p className="text-lg font-bold">{job.vehicle?.registration}</p>
            </div>
            <p className="text-sm text-blue-200">
              {completedItems}/{totalItems} items completed
            </p>
          </div>
          <button onClick={handlePause} className="text-sm text-blue-200 underline">
            Pause
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-blue-800">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${(completedItems / totalItems) * 100}%` }}
          />
        </div>
      </header>

      {/* Section tabs */}
      <div className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="flex">
          {/* MRI Scan tab - FIRST when check-in is enabled (index 0) */}
          {checkinEnabled && (
            <button
              onClick={() => setCurrentSectionIndex(0)}
              className={`
                flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${currentSectionIndex === 0
                  ? 'border-primary text-primary bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                }
              `}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">🔍</span>
                <span className="whitespace-nowrap">MRI Scan</span>
              </div>
            </button>
          )}

          {/* Template section tabs (offset by 1 when checkin enabled) */}
          {sections.map((section, idx) => {
            const tabIndex = checkinEnabled ? idx + 1 : idx
            const stats = sectionStats[idx]
            const completed = stats?.completed ?? 0
            const total = section.items?.length || 0
            const getStatus = (itemId: string) => {
              const r = results.get(itemId)
              return r?.status || r?.rag_status
            }
            const hasRed = section.items?.some((i) => getStatus(i.id) === 'red')
            const hasAmber = section.items?.some((i) => getStatus(i.id) === 'amber')

            const mandatoryIncomplete = stats?.mandatoryIncomplete ?? 0

            return (
              <button
                key={section.id}
                onClick={() => setCurrentSectionIndex(tabIndex)}
                className={`
                  flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${tabIndex === currentSectionIndex
                    ? 'border-primary text-primary bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  {completed === total && total > 0 ? (
                    <span className={`w-2 h-2 rounded-full ${hasRed ? 'bg-rag-red' : hasAmber ? 'bg-rag-amber' : 'bg-rag-green'}`} />
                  ) : (
                    <span className="text-xs text-gray-400">{completed}/{total}</span>
                  )}
                  <span className="whitespace-nowrap">{section.name}</span>
                  {mandatoryIncomplete > 0 && (
                    <span className="w-5 h-5 rounded-full bg-rag-red text-white text-xs flex items-center justify-center font-bold">
                      {mandatoryIncomplete}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Section items or MRI Scan tab */}
      <main className="flex-1 p-4 space-y-3 overflow-auto pb-24">
        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4 mb-4">{error}</div>
        )}

        {/* Show MRI Scan tab content when it's selected (index 0 when checkin enabled) */}
        {checkinEnabled && currentSectionIndex === 0 ? (
          <MriScanTab
            healthCheckId={id!}
            vehicle={job?.vehicle}
            advisor={job?.advisor}
            bookedRepairs={job?.booked_repairs}
            bookingNotes={job?.notes}
            jobsheetNumber={job?.jobsheet_number}
          />
        ) : (checkinEnabled ? sections[currentSectionIndex - 1] : currentSection)?.items?.map((item) => {
          const instances = getItemInstances(item.id)
          const hasInstances = instances.length > 0

          // For location-required items, show location-based results
          if (item.requiresLocation && vehicleLocations.length > 0) {
            // Get all location-based results for this item
            const locationResults: Array<{ loc: VehicleLocation; result: Partial<CheckResult>; mapKey: string }> = []
            vehicleLocations.forEach(loc => {
              const key = getResultKey(item.id, 1, loc.id)
              const result = results.get(key)
              if (result) {
                locationResults.push({ loc, result, mapKey: key })
              }
            })

            // Determine if the item has any location results saved
            const hasLocationResults = locationResults.length > 0

            // Use the standard key result (which may have the default green) when no location results yet
            const standardKey = getResultKey(item.id, 1)
            const standardResult = results.get(standardKey) || results.get(item.id)

            return (
              <div key={item.id} className="space-y-2">
                {/* Main item with location picker trigger */}
                {!hasLocationResults && (
                  <InspectionItem
                    item={item}
                    itemKey={standardKey}
                    instanceNumber={1}
                    totalInstances={1}
                    result={standardResult}
                    expanded={expandedItem === standardKey}
                    isMandatory={item.isRequired}
                    onToggle={() => handleToggle(standardKey)}
                    onSave={(data) => {
                      // Always save the result immediately so rag_status is set
                      // This ensures the item is marked complete even before location assignment
                      saveResult(standardKey, data)
                      const rag = data.status || data.rag_status
                      if (rag && (rag === 'red' || rag === 'amber' || rag === 'green')) {
                        setLocationPickerState({
                          templateItemId: item.id,
                          templateItemName: item.name,
                          ragStatus: rag,
                          value: data.value,
                          notes: data.notes
                        })
                      }
                    }}
                    onAddPhoto={() => {}}
                    onViewPhoto={() => {}}
                    onDuplicate={() => {}}
                    onOpenReasons={() => {}}
                  />
                )}
                {/* Show individual location results */}
                {locationResults.map(({ loc, result, mapKey }) => (
                  <InspectionItem
                    key={mapKey}
                    item={{ ...item, name: `[${loc.shortName}] ${item.name}` }}
                    itemKey={mapKey}
                    instanceNumber={1}
                    totalInstances={locationResults.length}
                    result={result}
                    expanded={expandedItem === mapKey}
                    isMandatory={false}
                    onToggle={() => handleToggle(mapKey)}
                    onSave={(data) => saveResult(mapKey, data)}
                    onAddPhoto={() => setPhotoItemId(mapKey)}
                    onViewPhoto={(url, caption) => setViewingPhoto({ url, caption })}
                    onDuplicate={() => {}}
                    onOpenReasons={() => setReasonSelectorItem({
                      itemKey: mapKey,
                      templateItemId: item.id,
                      templateItemName: `[${loc.shortName}] ${item.name}`,
                      checkResultId: result?.id,
                      currentRag: (result?.status || result?.rag_status) as 'red' | 'amber' | 'green' | null
                    })}
                    onOpenLocationPicker={() => {
                      const existingRag = result?.status || result?.rag_status
                      setLocationPickerState({
                        templateItemId: item.id,
                        templateItemName: item.name,
                        ragStatus: (existingRag as 'red' | 'amber' | 'green') || 'green',
                      })
                    }}
                    reasonCount={result?.id ? reasonCounts.get(result.id) : undefined}
                  />
                ))}
                {/* Add more locations button when some already exist */}
                {hasLocationResults && (
                  <button
                    onClick={() => {
                      const existingRag = locationResults[0]?.result?.status || locationResults[0]?.result?.rag_status
                      setLocationPickerState({
                        templateItemId: item.id,
                        templateItemName: item.name,
                        ragStatus: (existingRag as 'red' | 'amber' | 'green') || 'green',
                      })
                    }}
                    className="w-full py-2 text-sm text-primary font-medium border border-dashed border-primary/30 bg-primary/5 active:bg-primary/10"
                  >
                    + Add more locations for {item.name}
                  </button>
                )}
              </div>
            )
          }

          // If no instances exist yet, show the primary (instance 1)
          if (!hasInstances) {
            const key = getResultKey(item.id, 1)
            const result = results.get(key) || results.get(item.id) // Backward compatibility
            return (
              <div key={item.id} className="space-y-2">
                <InspectionItem
                  item={item}
                  itemKey={key}
                  instanceNumber={1}
                  totalInstances={1}
                  result={result}
                  expanded={expandedItem === key || expandedItem === item.id}
                  isMandatory={item.isRequired}
                  onToggle={() => handleToggle(key)}
                  onSave={(data) => saveResult(key, data)}
                  onAddPhoto={() => setPhotoItemId(key)}
                  onViewPhoto={(url, caption) => setViewingPhoto({ url, caption })}
                  onDuplicate={() => createDuplicate(item.id)}
                  onOpenReasons={() => setReasonSelectorItem({
                    itemKey: key,
                    templateItemId: item.id,
                    templateItemName: item.name,
                    checkResultId: result?.id,
                    currentRag: (result?.status || result?.rag_status) as 'red' | 'amber' | 'green' | null
                  })}
                  reasonCount={result?.id ? reasonCounts.get(result.id) : undefined}
                />
              </div>
            )
          }

          // Render all instances
          return (
            <div key={item.id} className="space-y-2">
              {instances.map(({ result, mapKey }, displayIndex) => {
                // Use mapKey from the Map directly - this is the authoritative key
                // Use displayIndex + 1 for display (1, 2, 3...) rather than raw instanceNumber
                // This ensures sequential display even if database instance_numbers are non-sequential
                const displayNumber = displayIndex + 1
                // Only first instance of mandatory items is required
                const isMandatoryInstance = item.isRequired && displayIndex === 0
                return (
                  <InspectionItem
                    key={mapKey}
                    item={item}
                    itemKey={mapKey}
                    instanceNumber={displayNumber}
                    totalInstances={instances.length}
                    result={result}
                    expanded={expandedItem === mapKey}
                    isMandatory={isMandatoryInstance}
                    onToggle={() => handleToggle(mapKey)}
                    onSave={(data) => saveResult(mapKey, data)}
                    onAddPhoto={() => setPhotoItemId(mapKey)}
                    onViewPhoto={(url, caption) => setViewingPhoto({ url, caption })}
                    onDuplicate={() => createDuplicate(item.id)}
                    onDeleteDuplicate={displayIndex > 0 && result?.id ? () => deleteDuplicate(mapKey, result.id!) : undefined}
                    onOpenReasons={() => setReasonSelectorItem({
                      itemKey: mapKey,
                      templateItemId: item.id,
                      templateItemName: item.name,
                      checkResultId: result?.id,
                      currentRag: (result?.status || result?.rag_status) as 'red' | 'amber' | 'green' | null
                    })}
                    reasonCount={result?.id ? reasonCounts.get(result.id) : undefined}
                  />
                )
              })}
            </div>
          )
        })}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom">
        <div className="flex gap-2 p-4">
          {currentSectionIndex > 0 && (
            <Button
              variant="secondary"
              onClick={() => setCurrentSectionIndex(currentSectionIndex - 1)}
              className="flex-1"
            >
              Previous Section
            </Button>
          )}

          {/* Determine total tabs: sections + MRI (if enabled) */}
          {(() => {
            const totalTabs = sections.length + (checkinEnabled ? 1 : 0)
            const isLastTab = currentSectionIndex >= totalTabs - 1
            const isOnMriTab = checkinEnabled && currentSectionIndex === 0

            if (isOnMriTab) {
              // On MRI tab (first tab) - show Next Section to go to inspection sections
              return (
                <Button
                  onClick={() => setCurrentSectionIndex(1)}
                  className="flex-1"
                >
                  Next Section
                </Button>
              )
            } else if (isLastTab) {
              // Last section - show Review & Complete
              return (
                <Button onClick={handleComplete} className="flex-1">
                  Review & Complete
                </Button>
              )
            } else {
              // Not on last tab - show Next Section
              return (
                <Button
                  onClick={() => setCurrentSectionIndex(currentSectionIndex + 1)}
                  className="flex-1"
                >
                  Next Section
                </Button>
              )
            }
          })()}
        </div>
      </footer>

      {/* Photo capture modal */}
      {photoItemId && (
        <PhotoCapture
          onCapture={handlePhotoCapture}
          onClose={() => setPhotoItemId(null)}
        />
      )}

      {/* Photo viewer modal */}
      {viewingPhoto && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 safe-area-inset-top">
            <button
              onClick={() => setViewingPhoto(null)}
              className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {viewingPhoto.caption && (
              <span className="text-white text-sm">{viewingPhoto.caption}</span>
            )}
            <div className="w-10" /> {/* Spacer for balance */}
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={viewingPhoto.url}
              alt="Full size"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Reason Selector modal */}
      {reasonSelectorItem && id && (
        <ReasonSelector
          templateItemId={reasonSelectorItem.templateItemId}
          templateItemName={reasonSelectorItem.templateItemName}
          healthCheckId={id}
          checkResultId={reasonSelectorItem.checkResultId}
          currentRag={reasonSelectorItem.currentRag}
          onRagChange={handleReasonSelectorRagChange}
          onClose={() => {
            if (pendingLocationReasons.length > 0) {
              setReasonSelectorItem(pendingLocationReasons[0])
              setPendingLocationReasons(prev => prev.slice(1))
            } else {
              setReasonSelectorItem(null)
            }
          }}
          onSave={handleSaveReasons}
          vehicleRegistration={job?.vehicle?.registration}
        />
      )}

      {/* Location Picker modal */}
      {locationPickerState && vehicleLocations.length > 0 && (
        <LocationPicker
          locations={vehicleLocations}
          templateItemName={locationPickerState.templateItemName}
          onSave={handleLocationPickerSave}
          onClose={() => setLocationPickerState(null)}
        />
      )}
    </div>
  )
}

// Individual inspection item component
interface InspectionItemProps {
  item: TemplateItem
  itemKey: string
  instanceNumber: number
  totalInstances: number
  result: Partial<CheckResult> | undefined
  expanded: boolean
  isMandatory?: boolean
  onToggle: () => void
  onSave: (data: Partial<CheckResult>) => void
  onAddPhoto: () => void
  onViewPhoto: (url: string, caption?: string) => void
  onDuplicate: () => void
  onDeleteDuplicate?: () => void
  onOpenReasons: () => void
  onOpenLocationPicker?: () => void
  reasonCount?: number
}

const InspectionItem = memo(function InspectionItem({
  item,
  itemKey: _itemKey,
  instanceNumber,
  totalInstances,
  result,
  expanded,
  isMandatory,
  onToggle,
  onSave,
  onAddPhoto,
  onViewPhoto,
  onDuplicate,
  onDeleteDuplicate,
  onOpenReasons,
  onOpenLocationPicker,
  reasonCount
}: InspectionItemProps) {
  void _itemKey // Suppress unused variable warning
  const handleRAGChange = (newStatus: 'green' | 'amber' | 'red' | null) => {
    if ('vibrate' in navigator) navigator.vibrate(50)
    // Clear MOT failure flag if status changes away from red
    const updateData: Partial<CheckResult> = {
      status: newStatus,
      rag_status: newStatus
    }
    if (newStatus !== 'red') {
      updateData.is_mot_failure = false
    }
    onSave(updateData)
  }

  const handleMOTFailureChange = (isMOTFailure: boolean) => {
    onSave({ is_mot_failure: isMOTFailure })
  }

  const handleNotesChange = (notes: string) => {
    onSave({ notes: notes || null })
  }

  const handleValueChange = (value: unknown) => {
    onSave({ value })
  }

  const ragStatus = result?.status || result?.rag_status
  const isMandatoryIncomplete = isMandatory && !ragStatus

  // Display name with instance number if there are multiple instances
  const displayName = totalInstances > 1 ? `${item.name} (${instanceNumber})` : item.name

  return (
    <Card padding="none" className={`overflow-hidden ${isMandatoryIncomplete ? 'ring-2 ring-rag-red' : ''}`}>
      {/* Item header - always visible */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <RAGIndicator status={ragStatus || null} />
          <span className="font-medium truncate">{displayName}</span>
          {isMandatory && (
            <span className={`text-xs px-1.5 py-0.5 font-medium ${isMandatoryIncomplete ? 'bg-rag-red text-white' : 'bg-gray-200 text-gray-600'}`}>
              Required
            </span>
          )}
          {instanceNumber > 1 && (
            <Badge variant="gray" size="sm">Duplicate</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {reasonCount && reasonCount > 0 && (
            <Badge variant="primary" size="sm">{reasonCount} 📋</Badge>
          )}
          {result?.media && result.media.length > 0 && (
            <Badge variant="gray" size="sm">{result.media.length} 📷</Badge>
          )}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Quick RAG buttons - always visible for RAG type */}
      {!expanded && item.itemType === 'rag' && (
        <div className="px-4 pb-4 flex gap-2">
          {([
            { status: 'green' as const, label: 'PASS', icon: '✓' },
            { status: 'amber' as const, label: 'ADVISORY', icon: '⚠' },
            { status: 'red' as const, label: 'URGENT', icon: '✕' }
          ]).map(({ status, label, icon }) => (
            <button
              key={status}
              onClick={(e) => {
                e.stopPropagation()
                handleRAGChange(status)
                // Auto-expand when selecting a concern (amber/red) to show Select Reasons button
                if (status === 'amber' || status === 'red') {
                  onToggle()
                }
              }}
              className={`
                flex-1 py-3 font-medium text-sm transition-colors flex flex-col items-center justify-center
                ${ragStatus === status
                  ? status === 'green'
                    ? 'bg-rag-green text-white'
                    : status === 'amber'
                      ? 'bg-rag-amber text-white'
                      : 'bg-rag-red text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              <span className="text-lg">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {item.description && (
            <p className="text-sm text-gray-600">{item.description}</p>
          )}

          {/* Item type specific input */}
          {item.itemType === 'rag' && (
            <RAGSelector value={ragStatus || null} onChange={handleRAGChange} />
          )}

          {item.itemType === 'tyre_depth' && (
            <TyreDepthInput
              value={result?.value as any}
              onChange={(value, ragStatus) => {
                onSave({
                  value,
                  status: ragStatus,
                  rag_status: ragStatus,
                  is_mot_failure: ragStatus !== 'red' ? false : result?.is_mot_failure
                })
              }}
              config={item.config}
            />
          )}

          {item.itemType === 'tyre_details' && (
            <TyreDetailsInput
              value={result?.value as any}
              onChange={(value, ragStatus) => {
                onSave({
                  value,
                  status: ragStatus,
                  rag_status: ragStatus,
                  is_mot_failure: ragStatus !== 'red' ? false : result?.is_mot_failure
                })
              }}
              config={item.config}
            />
          )}

          {item.itemType === 'brake_measurement' && (
            <BrakeMeasurementInput
              value={result?.value as any}
              onChange={(value, ragStatus) => {
                onSave({
                  value,
                  status: ragStatus,
                  rag_status: ragStatus,
                  is_mot_failure: ragStatus !== 'red' ? false : result?.is_mot_failure
                })
              }}
              config={item.config}
            />
          )}

          {item.itemType === 'fluid_level' && (
            <FluidLevelInput
              value={result?.value as string}
              onChange={(level, ragStatus) => {
                // Combined update with both value and RAG status in single save
                onSave({
                  value: level,
                  status: ragStatus,
                  rag_status: ragStatus,
                  is_mot_failure: ragStatus !== 'red' ? false : result?.is_mot_failure
                })
              }}
              config={item.config as { levels?: string[] }}
            />
          )}

          {item.itemType === 'brake_fluid' && (
            <BrakeFluidSelector
              value={result?.value as string}
              onChange={(val, ragStatus) => {
                onSave({
                  value: val,
                  status: ragStatus,
                  rag_status: ragStatus,
                  is_mot_failure: ragStatus !== 'red' ? false : result?.is_mot_failure
                })
              }}
            />
          )}

          {item.itemType === 'yes_no' && (
            <YesNoInput
              value={result?.value as boolean}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
            />
          )}

          {item.itemType === 'measurement' && (
            <MeasurementInput
              value={result?.value as number}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
              config={item.config as any}
            />
          )}

          {item.itemType === 'select' && (
            <SelectInput
              value={result?.value as string}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
              config={item.config as any}
            />
          )}

          {item.itemType === 'text' && (
            <Input
              value={(result?.value as string) || ''}
              onChange={(e) => handleValueChange(e.target.value)}
              placeholder="Enter text"
            />
          )}

          {item.itemType === 'number' && (
            <Input
              type="number"
              inputMode="decimal"
              value={(result?.value as string) || ''}
              onChange={(e) => handleValueChange(e.target.value ? parseFloat(e.target.value) : null)}
              placeholder="Enter number"
            />
          )}

          {item.itemType === 'multi_select' && (
            <MultiSelectInput
              value={result?.value as string[]}
              onChange={handleValueChange}
              config={item.config as any}
            />
          )}

          {/* MOT Failure checkbox - only shown when status is red/urgent */}
          {ragStatus === 'red' && (
            <label className="flex items-center gap-3 p-3 bg-rag-red-bg border border-rag-red rounded cursor-pointer">
              <div className={`
                w-6 h-6 flex-shrink-0 border-2 rounded flex items-center justify-center
                ${result?.is_mot_failure
                  ? 'bg-rag-red border-rag-red'
                  : 'bg-white border-gray-400'
                }
              `}>
                {result?.is_mot_failure && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={result?.is_mot_failure || false}
                onChange={(e) => handleMOTFailureChange(e.target.checked)}
                className="sr-only"
              />
              <span className="text-sm font-medium text-rag-red">
                Possible MOT Failure
              </span>
            </label>
          )}

          {/* Notes */}
          <TextArea
            placeholder="Add notes (optional)"
            value={result?.notes || ''}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={2}
          />

          {/* Photos */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Photos</span>
            <Button variant="secondary" size="sm" onClick={onAddPhoto}>
              + Add Photo
            </Button>
          </div>

          {result?.media && result.media.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1">
              {result.media.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onViewPhoto(m.url, m.caption || undefined)}
                  className="w-16 h-16 flex-shrink-0 rounded overflow-hidden border-2 border-gray-200 hover:border-primary focus:border-primary transition-colors"
                >
                  <img
                    src={m.thumbnail_url || m.thumbnailUrl || m.url}
                    alt="Capture"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Select Reasons button - always available */}
          <div className="pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onOpenReasons()
              }}
              fullWidth
              className="flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Select Reasons
            </Button>
          </div>

          {/* Change Location button - only for location-based items */}
          {onOpenLocationPicker && (
            <div className="pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenLocationPicker()
                }}
                fullWidth
                className="flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Change Location
              </Button>
            </div>
          )}

          {/* Duplicate/Delete actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-100 mt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDuplicate()
              }}
              className="flex-1"
            >
              <span className="flex items-center justify-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Add Another {item.name}
              </span>
            </Button>
            {onDeleteDuplicate && (
              <Button
                variant="danger"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete this duplicate of "${item.name}"?`)) {
                    onDeleteDuplicate()
                  }
                }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
})

// Fluid level input
interface FluidLevelInputProps {
  value: string | undefined
  onChange: (value: string, ragStatus: 'green' | 'amber' | 'red') => void
  onRAGChange?: (status: 'green' | 'amber' | 'red' | null) => void // Optional for backward compatibility
  config?: { levels?: string[] }
}

function FluidLevelInput({ value, onChange, config }: FluidLevelInputProps) {
  const levels = config?.levels || ['OK', 'Low', 'Very Low', 'Overfilled']

  const getRAG = (level: string): 'green' | 'amber' | 'red' => {
    const lower = level.toLowerCase()
    if (lower === 'ok') return 'green'
    if (lower === 'very low' || lower === 'empty') return 'red'
    return 'amber'
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {levels.map((level) => {
        const rag = getRAG(level)
        const isSelected = value === level
        return (
          <button
            key={level}
            className={`
              p-3 border-2 font-medium text-sm transition-colors
              ${isSelected
                ? rag === 'green'
                  ? 'border-rag-green bg-rag-green-bg text-rag-green'
                  : rag === 'amber'
                    ? 'border-rag-amber bg-rag-amber-bg text-rag-amber'
                    : 'border-rag-red bg-rag-red-bg text-rag-red'
                : 'border-gray-200 hover:border-gray-300'
              }
            `}
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(50)
              // Call combined onChange with both value and RAG status
              onChange(level, rag)
            }}
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}

// Yes/No input
interface YesNoInputProps {
  value: boolean | undefined
  onChange: (value: boolean) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
}

function YesNoInput({ value, onChange, onRAGChange }: YesNoInputProps) {
  const handleSelect = (val: boolean) => {
    onChange(val)
    onRAGChange(val ? 'green' : 'red')
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        className={`
          p-4 border-2 font-medium transition-colors
          ${value === true
            ? 'border-rag-green bg-rag-green-bg text-rag-green'
            : 'border-gray-200 hover:border-gray-300'
          }
        `}
        onClick={() => handleSelect(true)}
      >
        Yes
      </button>
      <button
        className={`
          p-4 border-2 font-medium transition-colors
          ${value === false
            ? 'border-rag-red bg-rag-red-bg text-rag-red'
            : 'border-gray-200 hover:border-gray-300'
          }
        `}
        onClick={() => handleSelect(false)}
      >
        No
      </button>
    </div>
  )
}
