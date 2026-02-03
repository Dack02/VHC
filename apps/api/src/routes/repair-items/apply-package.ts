import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, updateRepairItemWorkflowStatus } from './helpers.js'
import { logAudit } from '../../services/audit.js'

const applyPackageRouter = new Hono()

// POST /repair-items/:id/apply-service-package - Apply a service package to a repair item
applyPackageRouter.post(
  '/repair-items/:id/apply-service-package',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { id } = c.req.param()
      const body = await c.req.json()
      const { service_package_id } = body

      if (!service_package_id) {
        return c.json({ error: 'service_package_id is required' }, 400)
      }

      // Verify repair item access
      const existing = await verifyRepairItemAccess(id, auth.orgId)
      if (!existing) {
        return c.json({ error: 'Repair item not found' }, 404)
      }

      // Fetch service package with labour + parts
      const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('service_packages')
        .select(`
          id, name, organization_id,
          labour:service_package_labour(
            labour_code_id, hours, discount_percent, is_vat_exempt, notes
          ),
          parts:service_package_parts(
            part_number, description, quantity, supplier_id, supplier_name, cost_price, sell_price, notes
          )
        `)
        .eq('id', service_package_id)
        .eq('organization_id', auth.orgId)
        .eq('is_active', true)
        .single()

      if (pkgError || !pkg) {
        return c.json({ error: 'Service package not found' }, 404)
      }

      let labourInserted = 0
      let partsInserted = 0

      // Insert labour entries - look up current rates from labour_codes
      if (pkg.labour && Array.isArray(pkg.labour) && pkg.labour.length > 0) {
        for (const l of pkg.labour as Array<Record<string, unknown>>) {
          // Get current rate from labour_codes
          const { data: labourCode } = await supabaseAdmin
            .from('labour_codes')
            .select('id, hourly_rate, is_vat_exempt')
            .eq('id', l.labour_code_id as string)
            .eq('organization_id', auth.orgId)
            .single()

          if (!labourCode) continue // skip if labour code no longer exists

          const rate = parseFloat(labourCode.hourly_rate)
          const hours = parseFloat(l.hours as string) || 1
          const discountPct = parseFloat(l.discount_percent as string) || 0
          const subtotal = rate * hours
          const total = subtotal * (1 - discountPct / 100)

          const { error: insertError } = await supabaseAdmin
            .from('repair_labour')
            .insert({
              repair_item_id: id,
              labour_code_id: l.labour_code_id,
              hours,
              rate,
              discount_percent: discountPct,
              total,
              is_vat_exempt: labourCode.is_vat_exempt,
              notes: (l.notes as string)?.trim() || null,
              created_by: auth.user.id
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
              repair_item_id: id,
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
              created_by: auth.user.id
            })

          if (!insertError) partsInserted++
        }
      }

      // Auto-update workflow status
      await updateRepairItemWorkflowStatus(id, null)

      // Auto-transition health check from tech_completed -> awaiting_pricing
      if (existing.health_check_id) {
        const { data: hc } = await supabaseAdmin
          .from('health_checks')
          .select('id, status')
          .eq('id', existing.health_check_id)
          .single()

        if (hc?.status === 'tech_completed') {
          await supabaseAdmin
            .from('health_checks')
            .update({ status: 'awaiting_pricing', updated_at: new Date().toISOString() })
            .eq('id', hc.id)
        }
      }

      // Audit log
      logAudit({
        action: 'service_package.apply',
        actorId: auth.user.id,
        actorType: 'user',
        organizationId: auth.orgId,
        resourceType: 'repair_item',
        resourceId: id,
        metadata: {
          repair_item_id: id,
          health_check_id: existing.health_check_id,
          item_name: existing.name,
          service_package_id: pkg.id,
          service_package_name: pkg.name,
          labour_inserted: labourInserted,
          parts_inserted: partsInserted
        }
      })

      return c.json({
        success: true,
        labourInserted,
        partsInserted,
        packageName: pkg.name
      })
    } catch (error) {
      console.error('Apply service package error:', error)
      return c.json({ error: 'Failed to apply service package' }, 500)
    }
  }
)

export default applyPackageRouter
