/**
 * MRI Scan Results API Routes
 * Manages MRI (Manufacturer Recommended Items) scan results for health checks
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'

const mriResults = new Hono()

interface MriResultInput {
  mriItemId: string
  nextDueDate?: string | null
  nextDueMileage?: number | null
  dueIfNotReplaced?: boolean
  recommendedThisVisit?: boolean
  notDueYet?: boolean
  yesNoValue?: boolean | null
  notes?: string | null
  dateNa?: boolean
  mileageNa?: boolean
}

/**
 * GET /:id/mri-results
 * Get MRI scan results for a health check
 */
mriResults.get('/:id/mri-results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check exists and belongs to org
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, organization_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all enabled MRI items for the org
    const { data: mriItems, error: itemsError } = await supabaseAdmin
      .from('mri_items')
      .select('*')
      .eq('organization_id', auth.orgId)
      .eq('enabled', true)
      .order('category')
      .order('sort_order')

    if (itemsError) {
      return c.json({ error: itemsError.message }, 500)
    }

    // Get existing results for this health check with MRI item info (including deleted items)
    const { data: existingResults, error: resultsError } = await supabaseAdmin
      .from('mri_scan_results')
      .select(`
        *,
        mri_item:mri_items(id, name, description, item_type, category, severity_when_due, severity_when_yes, severity_when_no, is_informational, enabled, deleted_at)
      `)
      .eq('health_check_id', id)

    if (resultsError) {
      return c.json({ error: resultsError.message }, 500)
    }

    // Create a map of existing results by mri_item_id
    const resultsMap = new Map(existingResults?.map(r => [r.mri_item_id, r]) || [])

    // Find orphaned results (results for deleted/disabled MRI items)
    const orphanedResults = (existingResults || []).filter(r => {
      const item = r.mri_item as { enabled?: boolean; deleted_at?: string | null } | null
      // Result is orphaned if item doesn't exist, is deleted, or is disabled
      return !item || item.deleted_at || !item.enabled
    })

    // Group items by category and merge with results
    const grouped: Record<string, Array<{
      id: string
      name: string
      description: string | null
      itemType: string
      severityWhenDue: string | null
      severityWhenYes: string | null
      severityWhenNo: string | null
      isInformational: boolean
      sortOrder: number
      isDeleted?: boolean  // Flag for deleted/disabled items
      result: {
        id?: string
        nextDueDate: string | null
        nextDueMileage: number | null
        dueIfNotReplaced: boolean
        recommendedThisVisit: boolean
        notDueYet: boolean
        yesNoValue: boolean | null
        notes: string | null
        ragStatus: string | null
        completedAt: string | null
        dateNa: boolean
        mileageNa: boolean
      } | null
    }>> = {}

    let completedCount = 0
    const totalCount = mriItems?.length || 0

    for (const item of mriItems || []) {
      const category = item.category || 'Other'
      if (!grouped[category]) {
        grouped[category] = []
      }

      const existingResult = resultsMap.get(item.id)
      // An item is considered "complete" if it has any meaningful data:
      // - For date_mileage: date, mileage, dateNa, mileageNa, or any status flag (notDueYet, due, recommended)
      // - For yes_no: yesNoValue is set
      const hasResult = !!existingResult && (
        existingResult.next_due_date ||
        existingResult.next_due_mileage ||
        existingResult.date_na ||
        existingResult.mileage_na ||
        existingResult.due_if_not_replaced ||
        existingResult.recommended_this_visit ||
        existingResult.not_due_yet ||
        existingResult.yes_no_value !== null
      )

      if (hasResult) {
        completedCount++
      }

      grouped[category].push({
        id: item.id,
        name: item.name,
        description: item.description,
        itemType: item.item_type,
        severityWhenDue: item.severity_when_due,
        severityWhenYes: item.severity_when_yes,
        severityWhenNo: item.severity_when_no,
        isInformational: item.is_informational,
        sortOrder: item.sort_order,
        result: existingResult ? {
          id: existingResult.id,
          nextDueDate: existingResult.next_due_date,
          nextDueMileage: existingResult.next_due_mileage,
          dueIfNotReplaced: existingResult.due_if_not_replaced || false,
          recommendedThisVisit: existingResult.recommended_this_visit || false,
          notDueYet: existingResult.not_due_yet || false,
          yesNoValue: existingResult.yes_no_value,
          notes: existingResult.notes,
          ragStatus: existingResult.rag_status,
          completedAt: existingResult.completed_at,
          dateNa: existingResult.date_na || false,
          mileageNa: existingResult.mileage_na || false
        } : null
      })
    }

    // Add orphaned results to a special "Archived Items" category
    // These are results for MRI items that have been deleted or disabled
    if (orphanedResults.length > 0) {
      const archivedCategory = 'Archived Items'
      if (!grouped[archivedCategory]) {
        grouped[archivedCategory] = []
      }

      for (const result of orphanedResults) {
        const mriItem = result.mri_item as {
          id?: string
          name?: string
          description?: string | null
          item_type?: string
          category?: string
          severity_when_due?: string | null
          severity_when_yes?: string | null
          severity_when_no?: string | null
          is_informational?: boolean
          deleted_at?: string | null
        } | null

        grouped[archivedCategory].push({
          id: result.mri_item_id,
          name: mriItem?.name || 'Deleted Item',
          description: mriItem?.description || null,
          itemType: mriItem?.item_type || 'unknown',
          severityWhenDue: mriItem?.severity_when_due || null,
          severityWhenYes: mriItem?.severity_when_yes || null,
          severityWhenNo: mriItem?.severity_when_no || null,
          isInformational: mriItem?.is_informational || false,
          sortOrder: 999,
          isDeleted: true,
          result: {
            id: result.id,
            nextDueDate: result.next_due_date,
            nextDueMileage: result.next_due_mileage,
            dueIfNotReplaced: result.due_if_not_replaced || false,
            recommendedThisVisit: result.recommended_this_visit || false,
            notDueYet: result.not_due_yet || false,
            yesNoValue: result.yes_no_value,
            notes: result.notes,
            ragStatus: result.rag_status,
            completedAt: result.completed_at,
            dateNa: result.date_na || false,
            mileageNa: result.mileage_na || false
          }
        })
      }
    }

    // Check if MRI scan is complete (has a completion timestamp on any result)
    const isMriComplete = existingResults?.some(r => r.completed_at) || false

    return c.json({
      healthCheckId: id,
      items: grouped,
      progress: {
        completed: completedCount,
        total: totalCount
      },
      isMriComplete,
      hasArchivedItems: orphanedResults.length > 0
    })
  } catch (error) {
    console.error('Get MRI results error:', error)
    return c.json({ error: 'Failed to get MRI results' }, 500)
  }
})

/**
 * POST /:id/mri-results
 * Save or update MRI scan results (partial save supported)
 */
mriResults.post('/:id/mri-results', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()
    const body = await c.req.json()

    // Verify health check exists and belongs to org
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, organization_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const results: MriResultInput[] = body.results || []

    if (!Array.isArray(results) || results.length === 0) {
      return c.json({ error: 'Results array is required' }, 400)
    }

    const savedResults = []

    for (const result of results) {
      // Verify MRI item belongs to org
      const { data: mriItem } = await supabaseAdmin
        .from('mri_items')
        .select('id, item_type, severity_when_due, severity_when_yes, severity_when_no, is_informational')
        .eq('id', result.mriItemId)
        .eq('organization_id', auth.orgId)
        .single()

      if (!mriItem) {
        continue // Skip invalid items
      }

      // Calculate RAG status based on item type and input
      let ragStatus: string | null = null

      if (!mriItem.is_informational) {
        if (mriItem.item_type === 'date_mileage') {
          // For date/mileage items:
          // - "Due if not replaced" OR "Recommended this visit" = severity_when_due (red/amber)
          // - Neither flagged (i.e., "Not due yet") = green if has data, null if no data
          if (result.dueIfNotReplaced || result.recommendedThisVisit) {
            ragStatus = mriItem.severity_when_due || 'amber'
          } else if (result.nextDueDate || result.nextDueMileage) {
            ragStatus = 'green' // Has a future due date/mileage, so OK for now
          }
        } else if (mriItem.item_type === 'yes_no') {
          // For yes/no items, RAG is based on the answer
          if (result.yesNoValue === true) {
            ragStatus = mriItem.severity_when_yes || null
          } else if (result.yesNoValue === false) {
            ragStatus = mriItem.severity_when_no || null
          }
        }
      }

      // Upsert result
      const { data: savedResult, error: saveError } = await supabaseAdmin
        .from('mri_scan_results')
        .upsert({
          health_check_id: id,
          mri_item_id: result.mriItemId,
          organization_id: auth.orgId,
          next_due_date: result.nextDueDate || null,
          next_due_mileage: result.nextDueMileage || null,
          due_if_not_replaced: result.dueIfNotReplaced || false,
          recommended_this_visit: result.recommendedThisVisit || false,
          not_due_yet: result.notDueYet || false,
          yes_no_value: result.yesNoValue ?? null,
          notes: result.notes || null,
          rag_status: ragStatus,
          date_na: result.dateNa || false,
          mileage_na: result.mileageNa || false,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'health_check_id,mri_item_id'
        })
        .select()
        .single()

      if (saveError) {
        console.error('Save MRI result error:', saveError)
        continue
      }

      savedResults.push({
        id: savedResult.id,
        mriItemId: savedResult.mri_item_id,
        ragStatus: savedResult.rag_status
      })
    }

    return c.json({
      success: true,
      savedCount: savedResults.length,
      results: savedResults
    })
  } catch (error) {
    console.error('Save MRI results error:', error)
    return c.json({ error: 'Failed to save MRI results' }, 500)
  }
})

/**
 * POST /:id/mri-results/complete
 * Mark MRI scan as complete
 */
mriResults.post('/:id/mri-results/complete', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id } = c.req.param()

    // Verify health check exists and belongs to org
    const { data: healthCheck, error: hcError } = await supabaseAdmin
      .from('health_checks')
      .select('id, organization_id')
      .eq('id', id)
      .eq('organization_id', auth.orgId)
      .single()

    if (hcError || !healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    const now = new Date().toISOString()

    // Update all results for this health check with completion timestamp
    const { error: updateError } = await supabaseAdmin
      .from('mri_scan_results')
      .update({
        completed_at: now,
        completed_by: auth.user.id
      })
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      success: true,
      completedAt: now,
      completedBy: auth.user.id
    })
  } catch (error) {
    console.error('Complete MRI scan error:', error)
    return c.json({ error: 'Failed to complete MRI scan' }, 500)
  }
})

/**
 * PATCH /:id/mri-results/:resultId
 * Update a single MRI scan result (auto-save)
 */
mriResults.patch('/:id/mri-results/:resultId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()
    const body = await c.req.json()

    // For new results, resultId might be the mri_item_id
    // Check if result exists first
    let { data: existingResult } = await supabaseAdmin
      .from('mri_scan_results')
      .select('id, mri_item_id, next_due_date, next_due_mileage, due_if_not_replaced, recommended_this_visit, not_due_yet, yes_no_value')
      .eq('id', resultId)
      .eq('health_check_id', id)
      .eq('organization_id', auth.orgId)
      .single()

    // If not found by resultId, try by mri_item_id
    if (!existingResult) {
      const { data: resultByItem } = await supabaseAdmin
        .from('mri_scan_results')
        .select('id, mri_item_id, next_due_date, next_due_mileage, due_if_not_replaced, recommended_this_visit, not_due_yet, yes_no_value')
        .eq('mri_item_id', resultId)
        .eq('health_check_id', id)
        .eq('organization_id', auth.orgId)
        .single()
      existingResult = resultByItem
    }

    // Get MRI item for RAG calculation
    const mriItemId = existingResult?.mri_item_id || resultId
    const { data: mriItem } = await supabaseAdmin
      .from('mri_items')
      .select('id, item_type, severity_when_due, severity_when_yes, severity_when_no, is_informational')
      .eq('id', mriItemId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!mriItem) {
      return c.json({ error: 'MRI item not found' }, 404)
    }

    // Calculate RAG status
    let ragStatus: string | null = null
    const nextDueDate = body.nextDueDate ?? existingResult?.next_due_date
    const nextDueMileage = body.nextDueMileage ?? existingResult?.next_due_mileage
    const dueIfNotReplaced = body.dueIfNotReplaced ?? existingResult?.due_if_not_replaced
    const recommendedThisVisit = body.recommendedThisVisit ?? existingResult?.recommended_this_visit
    const yesNoValue = body.yesNoValue ?? existingResult?.yes_no_value

    if (!mriItem.is_informational) {
      if (mriItem.item_type === 'date_mileage') {
        // "Due if not replaced" OR "Recommended this visit" = severity_when_due
        // Neither flagged (i.e., "Not due yet") = green if has data, null if no data
        if (dueIfNotReplaced || recommendedThisVisit) {
          ragStatus = mriItem.severity_when_due || 'amber'
        } else if (nextDueDate || nextDueMileage) {
          ragStatus = 'green'
        }
      } else if (mriItem.item_type === 'yes_no') {
        if (yesNoValue === true) {
          ragStatus = mriItem.severity_when_yes || null
        } else if (yesNoValue === false) {
          ragStatus = mriItem.severity_when_no || null
        }
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      rag_status: ragStatus
    }

    if (body.nextDueDate !== undefined) updateData.next_due_date = body.nextDueDate
    if (body.nextDueMileage !== undefined) updateData.next_due_mileage = body.nextDueMileage
    if (body.dueIfNotReplaced !== undefined) updateData.due_if_not_replaced = body.dueIfNotReplaced
    if (body.recommendedThisVisit !== undefined) updateData.recommended_this_visit = body.recommendedThisVisit
    if (body.notDueYet !== undefined) updateData.not_due_yet = body.notDueYet
    if (body.yesNoValue !== undefined) updateData.yes_no_value = body.yesNoValue
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.dateNa !== undefined) updateData.date_na = body.dateNa
    if (body.mileageNa !== undefined) updateData.mileage_na = body.mileageNa

    let savedResult

    if (existingResult) {
      // Update existing
      const { data, error } = await supabaseAdmin
        .from('mri_scan_results')
        .update(updateData)
        .eq('id', existingResult.id)
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      savedResult = data
    } else {
      // Create new
      const { data, error } = await supabaseAdmin
        .from('mri_scan_results')
        .insert({
          health_check_id: id,
          mri_item_id: mriItemId,
          organization_id: auth.orgId,
          ...updateData
        })
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }
      savedResult = data
    }

    return c.json({
      success: true,
      result: {
        id: savedResult.id,
        mriItemId: savedResult.mri_item_id,
        nextDueDate: savedResult.next_due_date,
        nextDueMileage: savedResult.next_due_mileage,
        dueIfNotReplaced: savedResult.due_if_not_replaced,
        recommendedThisVisit: savedResult.recommended_this_visit,
        notDueYet: savedResult.not_due_yet,
        yesNoValue: savedResult.yes_no_value,
        notes: savedResult.notes,
        ragStatus: savedResult.rag_status,
        dateNa: savedResult.date_na,
        mileageNa: savedResult.mileage_na
      }
    })
  } catch (error) {
    console.error('Update MRI result error:', error)
    return c.json({ error: 'Failed to update MRI result' }, 500)
  }
})

export default mriResults
