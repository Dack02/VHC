import { supabaseAdmin } from './supabase.js'

/**
 * Universal list search for documents that carry a `customer_id` + `vehicle_id`
 * (jobsheets, estimates). PostgREST can't OR across embedded tables from the
 * parent query, so we resolve matching customer/vehicle ids first, then build a
 * single `.or()` over base-table columns (reference + customer_id + vehicle_id).
 *
 * Returns a PostgREST `.or()` filter string, or null when the term is empty.
 * Matches: document reference, customer first/last/contact name, vehicle reg.
 */
export async function buildDocumentSearchOr(orgId: string, q: string): Promise<string | null> {
  const term = q.trim()
  if (!term) return null
  const like = `%${term}%`
  // Also match the reg with spaces stripped, so "LR68 KZT" is found by "LR68" or "LR68 K".
  const noSpace = term.replace(/\s+/g, '')
  const regLike = `%${noSpace}%`

  const [custRes, vehRes] = await Promise.all([
    supabaseAdmin
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .or(`first_name.ilike.${like},last_name.ilike.${like},contact_name.ilike.${like}`)
      .limit(300),
    supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('organization_id', orgId)
      .or(`registration.ilike.${like},registration.ilike.${regLike}`)
      .limit(300)
  ])

  const custIds = (custRes.data || []).map((r) => r.id)
  const vehIds = (vehRes.data || []).map((r) => r.id)

  const ors = [`reference.ilike.${like}`]
  if (custIds.length) ors.push(`customer_id.in.(${custIds.join(',')})`)
  if (vehIds.length) ors.push(`vehicle_id.in.(${vehIds.join(',')})`)
  return ors.join(',')
}
