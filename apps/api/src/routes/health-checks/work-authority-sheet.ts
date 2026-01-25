/**
 * Work Authority Sheet Routes
 *
 * POST /:id/work-authority-sheet - Generate a Work Authority Sheet PDF
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { authorize } from '../../middleware/auth.js'
import {
  fetchWorkAuthorityData,
  generateWorkAuthoritySheetPDF,
  type WorkAuthorityVariant
} from '../../services/pdf-generator/index.js'

const workAuthoritySheetRouter = new Hono()

// POST /:id/work-authority-sheet - Generate Work Authority Sheet PDF
workAuthoritySheetRouter.post(
  '/:id/work-authority-sheet',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']),
  async (c) => {
    try {
      const { id } = c.req.param()
      const auth = c.get('auth')
      const body = await c.req.json().catch(() => ({}))

      // Parse request options
      const variant = (body.variant || 'technician') as WorkAuthorityVariant
      const includePreBooked = body.includePreBooked !== false
      const includeVhcWork = body.includeVhcWork !== false
      const assignedTechnicianId = body.assignedTechnician || null

      // Role-based access control
      // Technicians can only generate technician variant
      const userRole = auth.user?.role || 'technician'
      if (userRole === 'technician' && variant === 'service_advisor') {
        return c.json({
          error: 'Unauthorized',
          message: 'Technicians cannot access the Service Advisor variant'
        }, 403)
      }

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

      console.log('Work Authority Sheet Route: Starting fetch', {
        healthCheckId: id,
        variant,
        includePreBooked,
        includeVhcWork,
        orgId: auth.orgId,
        userId: auth.user.id
      })

      // Fetch all data needed for the PDF
      const data = await fetchWorkAuthorityData({
        healthCheckId: id,
        variant,
        generatedByUserId: auth.user.id,
        organizationId: auth.orgId,
        includePreBooked,
        includeVhcWork,
        assignedTechnicianId
      })

      console.log('Work Authority Sheet Route: Data fetched', {
        preBookedWorkCount: data.preBookedWork.length,
        authorizedVhcWorkCount: data.authorizedVhcWork.length,
        preBookedWork: data.preBookedWork.map(w => w.title),
        authorizedVhcWork: data.authorizedVhcWork.map(w => w.title)
      })

      // Validate - must have at least one work item
      const hasWork = data.preBookedWork.length > 0 || data.authorizedVhcWork.length > 0
      if (!hasWork) {
        console.log('Work Authority Sheet Route: No work items found!')
        return c.json({
          error: 'No work items',
          message: 'No pre-booked work or authorized VHC items found to include in the Work Authority Sheet'
        }, 400)
      }

      // Service advisor variant requires pricing data
      if (variant === 'service_advisor' && !data.totals) {
        return c.json({
          error: 'Missing pricing data',
          message: 'Service Advisor variant requires complete pricing information'
        }, 400)
      }

      // Generate the PDF
      const pdfBuffer = await generateWorkAuthoritySheetPDF(data)

      // Record the generation in the database
      await supabaseAdmin.from('work_authority_sheets').insert({
        organization_id: auth.orgId,
        health_check_id: id,
        document_number: data.documentNumber,
        variant,
        generated_by: auth.user.id,
        generated_at: data.generatedAt,
        pre_booked_count: data.preBookedWork.length,
        vhc_work_count: data.authorizedVhcWork.length,
        total_labour_hours: data.totals?.totalLabourHours || null,
        total_value: data.totals?.grandTotal || null
      })

      // Generate filename
      const vrm = data.vehicle.vrm.replace(/\s+/g, '')
      const filename = `WorkAuthority-${vrm}-${data.documentNumber}.pdf`

      // Return the PDF
      c.header('Content-Type', 'application/pdf')
      c.header('Content-Disposition', `attachment; filename="${filename}"`)
      c.header('Content-Length', pdfBuffer.length.toString())
      c.header('X-Document-Number', data.documentNumber)

      return c.body(new Uint8Array(pdfBuffer))
    } catch (error) {
      console.error('Error generating Work Authority Sheet:', error)
      return c.json({
        error: 'Generation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  }
)

// GET /:id/work-authority-sheets - List generated Work Authority Sheets for a health check
workAuthoritySheetRouter.get(
  '/:id/work-authority-sheets',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']),
  async (c) => {
    try {
      const { id } = c.req.param()
      const auth = c.get('auth')

      const { data: sheets, error } = await supabaseAdmin
        .from('work_authority_sheets')
        .select(`
          id,
          document_number,
          variant,
          generated_at,
          pre_booked_count,
          vhc_work_count,
          total_labour_hours,
          total_value,
          generated_by_user:users!work_authority_sheets_generated_by_fkey(
            first_name,
            last_name
          )
        `)
        .eq('health_check_id', id)
        .eq('organization_id', auth.orgId)
        .order('generated_at', { ascending: false })

      if (error) {
        console.error('Error fetching work authority sheets:', error)
        return c.json({ error: 'Failed to fetch documents' }, 500)
      }

      // Transform response - cast through unknown for Supabase relation types
      type UserRelation = { first_name: string; last_name: string } | null

      return c.json({
        success: true,
        data: sheets?.map(sheet => {
          const user = sheet.generated_by_user as unknown as UserRelation
          return {
            id: sheet.id,
            documentNumber: sheet.document_number,
            variant: sheet.variant,
            generatedAt: sheet.generated_at,
            preBookedCount: sheet.pre_booked_count,
            vhcWorkCount: sheet.vhc_work_count,
            totalLabourHours: sheet.total_labour_hours,
            totalValue: sheet.total_value,
            generatedBy: user ? `${user.first_name} ${user.last_name}` : 'Unknown'
          }
        }) || []
      })
    } catch (error) {
      console.error('Error fetching work authority sheets:', error)
      return c.json({ error: 'Failed to fetch documents' }, 500)
    }
  }
)

export default workAuthoritySheetRouter
