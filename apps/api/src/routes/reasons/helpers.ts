/**
 * Shared helpers for VHC Reasons API Routes
 *
 * Contains common utilities, response formatters, and type coercions
 * used across the reasons sub-routers.
 */

import { supabaseAdmin } from '../../lib/supabase.js'

// =============================================================================
// TYPE HELPERS
// =============================================================================

/**
 * Helper to safely extract nested Supabase relation data
 * Supabase returns single relations as objects but sometimes as arrays
 */
export function extractRelation<T>(data: T | T[] | null): T | null {
  if (!data) return null
  return Array.isArray(data) ? data[0] : data
}

// =============================================================================
// RESPONSE FORMATTERS
// =============================================================================

/**
 * Format a reason category for API response
 */
export function formatCategoryResponse(cat: {
  id: string
  name: string
  description?: string | null
  display_order?: number
  color?: string | null
  typical_rag?: string | null
}) {
  return {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    displayOrder: cat.display_order,
    color: cat.color,
    typicalRag: cat.typical_rag
  }
}

/**
 * Format an item reason for API response (basic version)
 */
export function formatReasonResponse(r: {
  id: string
  reason_text: string
  technical_description?: string | null
  customer_description?: string | null
  default_rag: string
  category_id?: string | null
  category?: { id?: string; name?: string; color?: string } | null
  suggested_follow_up_days?: number | null
  suggested_follow_up_text?: string | null
  usage_count?: number | null
  times_approved?: number | null
  times_declined?: number | null
  ai_generated?: boolean | null
  ai_reviewed?: boolean | null
  is_active?: boolean
  sort_order?: number | null
  source?: string
}) {
  const category = extractRelation(r.category as { name?: string; color?: string } | { name?: string; color?: string }[] | null)
  return {
    id: r.id,
    reasonText: r.reason_text,
    technicalDescription: r.technical_description,
    customerDescription: r.customer_description,
    defaultRag: r.default_rag,
    categoryId: r.category_id,
    categoryName: category?.name || null,
    categoryColor: category?.color || null,
    suggestedFollowUpDays: r.suggested_follow_up_days,
    suggestedFollowUpText: r.suggested_follow_up_text,
    usageCount: r.usage_count || 0,
    timesApproved: r.times_approved || 0,
    timesDeclined: r.times_declined || 0,
    aiGenerated: r.ai_generated || false,
    aiReviewed: r.ai_reviewed || false,
    isActive: r.is_active,
    sortOrder: r.sort_order || 0,
    source: r.source
  }
}

/**
 * Format an item reason for detailed API response (includes audit fields)
 */
export function formatReasonDetailResponse(reason: {
  id: string
  template_item_id?: string | null
  reason_type?: string | null
  reason_text: string
  technical_description?: string | null
  customer_description?: string | null
  default_rag: string
  category_id?: string | null
  category?: { name?: string; color?: string } | null
  suggested_follow_up_days?: number | null
  suggested_follow_up_text?: string | null
  ai_generated?: boolean
  ai_reviewed?: boolean
  reviewed_by?: string | null
  reviewed_at?: string | null
  reviewed_by_user?: { first_name?: string; last_name?: string } | null
  usage_count?: number | null
  last_used_at?: string | null
  times_approved?: number | null
  times_declined?: number | null
  is_starter_template?: boolean
  is_active?: boolean
  sort_order?: number | null
  created_at?: string
  created_by?: string | null
  created_by_user?: { first_name?: string; last_name?: string } | null
}) {
  const category = extractRelation(reason.category)
  const reviewedByUser = extractRelation(reason.reviewed_by_user)
  const createdByUser = extractRelation(reason.created_by_user)

  return {
    id: reason.id,
    templateItemId: reason.template_item_id,
    reasonType: reason.reason_type,
    reasonText: reason.reason_text,
    technicalDescription: reason.technical_description,
    customerDescription: reason.customer_description,
    defaultRag: reason.default_rag,
    categoryId: reason.category_id,
    categoryName: category?.name,
    categoryColor: category?.color,
    suggestedFollowUpDays: reason.suggested_follow_up_days,
    suggestedFollowUpText: reason.suggested_follow_up_text,
    aiGenerated: reason.ai_generated,
    aiReviewed: reason.ai_reviewed,
    reviewedBy: reviewedByUser ? `${reviewedByUser.first_name} ${reviewedByUser.last_name}` : null,
    reviewedAt: reason.reviewed_at,
    usageCount: reason.usage_count,
    lastUsedAt: reason.last_used_at,
    timesApproved: reason.times_approved,
    timesDeclined: reason.times_declined,
    isStarterTemplate: reason.is_starter_template,
    isActive: reason.is_active,
    sortOrder: reason.sort_order,
    createdAt: reason.created_at,
    createdBy: createdByUser ? `${createdByUser.first_name} ${createdByUser.last_name}` : null
  }
}

// Type for nested reason in check_result_reasons
type NestedReason = {
  id?: string
  reason_text?: string
  technical_description?: string | null
  customer_description?: string | null
  default_rag?: string
  category_id?: string | null
  suggested_follow_up_days?: number | null
  suggested_follow_up_text?: string | null
  category?: { id?: string; name?: string; color?: string } | { id?: string; name?: string; color?: string }[] | null
}

/**
 * Format a check result reason for API response
 */
export function formatCheckResultReasonResponse(sr: {
  id: string
  item_reason_id: string
  technical_description_override?: string | null
  customer_description_override?: string | null
  follow_up_days?: number | null
  follow_up_text?: string | null
  rag_overridden?: boolean
  customer_approved?: boolean | null
  approved_at?: string | null
  reason?: NestedReason | NestedReason[] | null
}) {
  const reason = extractRelation(sr.reason)
  const category = reason ? extractRelation(reason.category) : null

  return {
    id: sr.id,
    itemReasonId: sr.item_reason_id,
    reasonText: reason?.reason_text || '',
    technicalDescription: sr.technical_description_override || reason?.technical_description || null,
    customerDescription: sr.customer_description_override || reason?.customer_description || null,
    defaultRag: reason?.default_rag || 'green',
    categoryId: reason?.category_id || null,
    categoryName: category?.name || null,
    categoryColor: category?.color || null,
    followUpDays: sr.follow_up_days,
    followUpText: sr.follow_up_text,
    ragOverridden: sr.rag_overridden || false,
    customerApproved: sr.customer_approved,
    approvedAt: sr.approved_at,
    hasOverrides: !!(sr.technical_description_override || sr.customer_description_override)
  }
}

/**
 * Format a reason type for API response
 */
export function formatReasonTypeResponse(rt: {
  id: string
  name: string
  description?: string | null
  organization_id?: string | null
  is_system?: boolean
  created_at?: string
  updated_at?: string
}, counts?: { itemCount?: number; reasonCount?: number }) {
  return {
    id: rt.id,
    name: rt.name,
    description: rt.description,
    organizationId: rt.organization_id,
    isSystem: rt.is_system,
    isCustom: rt.organization_id !== null,
    itemCount: counts?.itemCount || 0,
    reasonCount: counts?.reasonCount || 0,
    createdAt: rt.created_at,
    updatedAt: rt.updated_at
  }
}

// =============================================================================
// ACCESS VERIFICATION
// =============================================================================

/**
 * Verify that a template item belongs to the organization
 */
export async function verifyTemplateItemAccess(templateItemId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('template_items')
    .select(`
      id,
      name,
      reason_type,
      section:template_sections!inner(
        template:check_templates!inner(organization_id)
      )
    `)
    .eq('id', templateItemId)
    .single()

  if (!data) return null

  const section = extractRelation(data.section)
  const template = section ? extractRelation((section as { template?: { organization_id?: string } }).template) : null

  if (template?.organization_id !== orgId) return null

  return {
    id: data.id,
    name: data.name,
    reasonType: data.reason_type
  }
}

/**
 * Verify that a reason belongs to the organization
 */
export async function verifyReasonAccess(reasonId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('item_reasons')
    .select('id, reason_text, organization_id')
    .eq('id', reasonId)
    .eq('organization_id', orgId)
    .single()

  return data
}

/**
 * Verify that a check result belongs to the organization
 */
export async function verifyCheckResultAccess(checkResultId: string, orgId: string) {
  const { data } = await supabaseAdmin
    .from('check_results')
    .select(`
      id,
      template_item_id,
      health_check:health_checks!inner(organization_id)
    `)
    .eq('id', checkResultId)
    .single()

  if (!data) return null

  const healthCheck = extractRelation(data.health_check)
  if ((healthCheck as { organization_id?: string })?.organization_id !== orgId) return null

  return {
    id: data.id,
    templateItemId: data.template_item_id
  }
}

/**
 * Get organization ID from a health check via check result
 */
export function getOrgIdFromCheckResult(checkResult: {
  health_check?: { organization_id?: string } | { organization_id?: string }[] | null
}): string | null {
  const healthCheck = extractRelation(checkResult.health_check)
  return (healthCheck as { organization_id?: string })?.organization_id || null
}

// =============================================================================
// SORTING HELPERS
// =============================================================================

/**
 * Sort reasons by RAG status (red first) then by usage count
 */
export function sortReasonsByRagAndUsage<T extends { default_rag?: string; usage_count?: number | null }>(
  reasons: T[]
): T[] {
  const ragOrder: Record<string, number> = { red: 0, amber: 1, green: 2 }
  return [...reasons].sort((a, b) => {
    const ragDiff = (ragOrder[a.default_rag as string] || 2) - (ragOrder[b.default_rag as string] || 2)
    if (ragDiff !== 0) return ragDiff
    return ((b.usage_count as number) || 0) - ((a.usage_count as number) || 0)
  })
}
