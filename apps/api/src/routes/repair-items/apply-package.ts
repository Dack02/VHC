import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import { verifyRepairItemAccess, updateRepairItemWorkflowStatus } from './helpers.js'
import { logAudit } from '../../services/audit.js'
import { applyServicePackageToRepairItem } from '../../services/apply-service-package.js'

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

      // Apply the service package using shared service
      const result = await applyServicePackageToRepairItem(
        id,
        service_package_id,
        auth.orgId,
        auth.user.id
      )

      if (!result) {
        return c.json({ error: 'Service package not found' }, 404)
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
          service_package_id,
          service_package_name: result.packageName,
          labour_inserted: result.labourInserted,
          parts_inserted: result.partsInserted
        }
      })

      return c.json({
        success: true,
        labourInserted: result.labourInserted,
        partsInserted: result.partsInserted,
        packageName: result.packageName
      })
    } catch (error) {
      console.error('Apply service package error:', error)
      return c.json({ error: 'Failed to apply service package' }, 500)
    }
  }
)

export default applyPackageRouter
