/**
 * Reusable service to apply a service package's labour and parts to a repair item.
 * Used by both the manual "Apply Service Package" route and MRI auto-creation.
 */

import { supabaseAdmin } from '../lib/supabase.js'

interface ApplyResult {
  labourInserted: number
  partsInserted: number
  packageName: string
}

/**
 * Apply a service package's labour and parts to a repair item.
 * Returns null if the package is not found or inactive (silent skip).
 * Does NOT handle HC status transitions or audit logging — caller responsibility.
 */
export async function applyServicePackageToRepairItem(
  repairItemId: string,
  servicePackageId: string,
  organizationId: string,
  createdByUserId: string | null
): Promise<ApplyResult | null> {
  // Fetch service package with labour + parts
  const { data: pkg, error: pkgError } = await supabaseAdmin
    .from('service_packages')
    .select(`
      id, name, organization_id,
      labour:service_package_labour(
        labour_code_id, hours, discount_percent, is_vat_exempt, notes, rate
      ),
      parts:service_package_parts(
        part_number, description, quantity, supplier_id, supplier_name, cost_price, sell_price, notes
      )
    `)
    .eq('id', servicePackageId)
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single()

  if (pkgError || !pkg) {
    return null
  }

  let labourInserted = 0
  let partsInserted = 0

  // Insert labour entries — use stored rate from package, fall back to labour_codes rate
  if (pkg.labour && Array.isArray(pkg.labour) && pkg.labour.length > 0) {
    for (const l of pkg.labour as Array<Record<string, unknown>>) {
      const { data: labourCode } = await supabaseAdmin
        .from('labour_codes')
        .select('id, hourly_rate, is_vat_exempt')
        .eq('id', l.labour_code_id as string)
        .eq('organization_id', organizationId)
        .single()

      if (!labourCode) continue // skip if labour code no longer exists

      // Prefer stored package rate; fall back to current labour code rate for legacy packages
      const storedRate = l.rate != null ? parseFloat(l.rate as string) : null
      const rate = storedRate != null && !isNaN(storedRate) ? storedRate : parseFloat(labourCode.hourly_rate)
      const hours = isNaN(parseFloat(l.hours as string)) ? 1 : parseFloat(l.hours as string)
      const discountPct = parseFloat(l.discount_percent as string) || 0
      const subtotal = rate * hours
      const total = subtotal * (1 - discountPct / 100)

      const { error: insertError } = await supabaseAdmin
        .from('repair_labour')
        .insert({
          repair_item_id: repairItemId,
          labour_code_id: l.labour_code_id,
          hours,
          rate,
          discount_percent: discountPct,
          total,
          is_vat_exempt: labourCode.is_vat_exempt,
          notes: (l.notes as string)?.trim() || null,
          created_by: createdByUserId
        })

      if (!insertError) labourInserted++
    }
  }

  // Insert parts entries
  if (pkg.parts && Array.isArray(pkg.parts) && pkg.parts.length > 0) {
    for (const p of pkg.parts as Array<Record<string, unknown>>) {
      const qty = parseFloat(p.quantity as string) || 1
      const costPrice = parseFloat(p.cost_price as string) || 0
      const sellPrice = parseFloat(p.sell_price as string) || 0
      const lineTotal = qty * sellPrice
      const marginPercent = sellPrice > 0 ? ((sellPrice - costPrice) / sellPrice) * 100 : 0
      const markupPercent = costPrice > 0 ? ((sellPrice - costPrice) / costPrice) * 100 : 0

      const { error: insertError } = await supabaseAdmin
        .from('repair_parts')
        .insert({
          repair_item_id: repairItemId,
          part_number: (p.part_number as string)?.trim() || null,
          description: (p.description as string)?.trim(),
          quantity: qty,
          supplier_id: p.supplier_id || null,
          supplier_name: (p.supplier_name as string) || null,
          cost_price: costPrice,
          sell_price: sellPrice,
          line_total: lineTotal,
          margin_percent: marginPercent,
          markup_percent: markupPercent,
          notes: (p.notes as string)?.trim() || null,
          allocation_type: 'direct',
          created_by: createdByUserId
        })

      if (!insertError) partsInserted++
    }
  }

  return { labourInserted, partsInserted, packageName: pkg.name }
}
