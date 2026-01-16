import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const media = new Hono()

media.use('*', authMiddleware)

const BUCKET_NAME = 'vhc-photos'

// Helper to verify health check and result access
async function verifyAccess(healthCheckId: string, resultId: string, orgId: string) {
  const { data: healthCheck } = await supabaseAdmin
    .from('health_checks')
    .select('id')
    .eq('id', healthCheckId)
    .eq('organization_id', orgId)
    .single()

  if (!healthCheck) return null

  const { data: result } = await supabaseAdmin
    .from('check_results')
    .select('id')
    .eq('id', resultId)
    .eq('health_check_id', healthCheckId)
    .single()

  return result
}

// POST /api/v1/health-checks/:id/results/:resultId/media/upload-url - Get signed upload URL
media.post('/health-checks/:id/results/:resultId/media/upload-url', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()
    const body = await c.req.json()
    const { filename, contentType } = body

    if (!filename || !contentType) {
      return c.json({ error: 'Filename and content type are required' }, 400)
    }

    const result = await verifyAccess(id, resultId, auth.orgId)
    if (!result) {
      return c.json({ error: 'Result not found' }, 404)
    }

    // Generate unique path
    const ext = filename.split('.').pop() || 'jpg'
    const path = `${auth.orgId}/${id}/${resultId}/${Date.now()}.${ext}`

    // Create signed upload URL
    const { data: signedUrl, error: signError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUploadUrl(path)

    if (signError) {
      return c.json({ error: signError.message }, 500)
    }

    return c.json({
      uploadUrl: signedUrl.signedUrl,
      path,
      token: signedUrl.token
    })
  } catch (error) {
    console.error('Get upload URL error:', error)
    return c.json({ error: 'Failed to get upload URL' }, 500)
  }
})

// POST /api/v1/health-checks/:id/results/:resultId/media - Upload media directly or create record
media.post('/health-checks/:id/results/:resultId/media', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()

    const result = await verifyAccess(id, resultId, auth.orgId)
    if (!result) {
      return c.json({ error: 'Result not found' }, 404)
    }

    const contentType = c.req.header('content-type') || ''
    let path: string
    let caption: string | undefined

    if (contentType.includes('multipart/form-data')) {
      // Direct file upload via FormData
      const formData = await c.req.formData()
      const file = formData.get('file') as File | null
      caption = formData.get('caption') as string | undefined

      if (!file) {
        return c.json({ error: 'File is required' }, 400)
      }

      // Generate unique path
      const ext = file.name.split('.').pop() || 'jpg'
      path = `${auth.orgId}/${id}/${resultId}/${Date.now()}.${ext}`

      // Upload to Supabase storage
      const buffer = await file.arrayBuffer()
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(path, buffer, {
          contentType: file.type || 'image/jpeg',
          upsert: false
        })

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        return c.json({ error: 'Failed to upload file: ' + uploadError.message }, 500)
      }
    } else {
      // JSON body with pre-uploaded path
      const body = await c.req.json()
      path = body.path
      caption = body.caption

      if (!path) {
        return c.json({ error: 'Path is required' }, 400)
      }
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(path)

    // Create media record
    const { data: mediaRecord, error } = await supabaseAdmin
      .from('result_media')
      .insert({
        check_result_id: resultId,
        media_type: 'photo',
        storage_path: path,
        thumbnail_path: path, // Use same path, Supabase transforms handle thumbnails
        caption
      })
      .select()
      .single()

    if (error) {
      console.error('DB insert error:', error)
      return c.json({ error: error.message }, 500)
    }

    // Build URLs from storage path
    const url = urlData.publicUrl
    const thumbnailUrl = url + '?width=200&height=200'

    return c.json({
      id: mediaRecord.id,
      url,
      thumbnailUrl,
      caption: mediaRecord.caption,
      createdAt: mediaRecord.created_at
    }, 201)
  } catch (error) {
    console.error('Create media record error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to create media record' }, 500)
  }
})

// PATCH /api/v1/media/:mediaId - Update media (include_in_report)
media.patch('/media/:mediaId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { mediaId } = c.req.param()
    const body = await c.req.json()

    // Get media record with health check verification
    const { data: mediaRecord, error: fetchError } = await supabaseAdmin
      .from('result_media')
      .select(`
        id,
        check_result:check_results(
          health_check:health_checks(organization_id)
        )
      `)
      .eq('id', mediaId)
      .single()

    if (fetchError || !mediaRecord) {
      return c.json({ error: 'Media not found' }, 404)
    }

    // Verify org access - Supabase returns nested arrays for joins
    const checkResult = mediaRecord.check_result as unknown as { health_check: { organization_id: string } } | undefined
    const healthCheck = checkResult?.health_check
    if (healthCheck?.organization_id !== auth.orgId) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    // Build update data
    const updateData: Record<string, unknown> = {}
    if (body.include_in_report !== undefined) {
      updateData.include_in_report = body.include_in_report
    }

    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400)
    }

    // Update media record
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('result_media')
      .update(updateData)
      .eq('id', mediaId)
      .select()
      .single()

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      id: updated.id,
      include_in_report: updated.include_in_report
    })
  } catch (error) {
    console.error('Update media error:', error)
    return c.json({ error: 'Failed to update media' }, 500)
  }
})

// PATCH /api/v1/health-checks/:id/media/selection - Bulk update include_in_report
media.patch('/health-checks/:id/media/selection', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id: healthCheckId } = c.req.param()
    const body = await c.req.json()
    const { include_in_report, media_ids } = body

    if (include_in_report === undefined) {
      return c.json({ error: 'include_in_report is required' }, 400)
    }

    // Verify health check belongs to org
    const { data: healthCheck } = await supabaseAdmin
      .from('health_checks')
      .select('id')
      .eq('id', healthCheckId)
      .eq('organization_id', auth.orgId)
      .single()

    if (!healthCheck) {
      return c.json({ error: 'Health check not found' }, 404)
    }

    // Get all check result IDs for this health check
    const { data: checkResults } = await supabaseAdmin
      .from('check_results')
      .select('id')
      .eq('health_check_id', healthCheckId)

    if (!checkResults || checkResults.length === 0) {
      return c.json({ updated: 0 })
    }

    const resultIds = checkResults.map(r => r.id)

    // Build update query
    let query = supabaseAdmin
      .from('result_media')
      .update({ include_in_report })
      .in('check_result_id', resultIds)

    // If specific media IDs provided, filter to those
    if (media_ids && Array.isArray(media_ids) && media_ids.length > 0) {
      query = query.in('id', media_ids)
    }

    const { error: updateError, count } = await query

    if (updateError) {
      return c.json({ error: updateError.message }, 500)
    }

    return c.json({
      updated: count || 0,
      include_in_report
    })
  } catch (error) {
    console.error('Bulk update media selection error:', error)
    return c.json({ error: 'Failed to update media selection' }, 500)
  }
})

// DELETE /api/v1/media/:mediaId - Delete media
media.delete('/media/:mediaId', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { mediaId } = c.req.param()

    // Get media record with health check verification
    const { data: mediaRecord, error: fetchError } = await supabaseAdmin
      .from('result_media')
      .select(`
        id,
        storage_path,
        check_result:check_results(
          health_check:health_checks(organization_id)
        )
      `)
      .eq('id', mediaId)
      .single()

    if (fetchError || !mediaRecord) {
      return c.json({ error: 'Media not found' }, 404)
    }

    // Verify org access - Supabase returns nested arrays for joins
    const checkResult = mediaRecord.check_result as unknown as { health_check: { organization_id: string } } | undefined
    const healthCheck = checkResult?.health_check
    if (healthCheck?.organization_id !== auth.orgId) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    // Delete from storage using storage_path
    if (mediaRecord.storage_path) {
      await supabaseAdmin.storage.from(BUCKET_NAME).remove([mediaRecord.storage_path])
    }

    // Delete media record
    const { error: deleteError } = await supabaseAdmin
      .from('result_media')
      .delete()
      .eq('id', mediaId)

    if (deleteError) {
      return c.json({ error: deleteError.message }, 500)
    }

    return c.json({ message: 'Media deleted' })
  } catch (error) {
    console.error('Delete media error:', error)
    return c.json({ error: 'Failed to delete media' }, 500)
  }
})

export default media
