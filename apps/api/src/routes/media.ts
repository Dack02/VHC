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

// POST /api/v1/health-checks/:id/results/:resultId/media - Create media record after upload
media.post('/health-checks/:id/results/:resultId/media', authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']), async (c) => {
  try {
    const auth = c.get('auth')
    const { id, resultId } = c.req.param()
    const body = await c.req.json()
    const { path, caption } = body

    if (!path) {
      return c.json({ error: 'Path is required' }, 400)
    }

    const result = await verifyAccess(id, resultId, auth.orgId)
    if (!result) {
      return c.json({ error: 'Result not found' }, 404)
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(path)

    // Create thumbnail URL (Supabase image transforms)
    const thumbnailUrl = urlData.publicUrl + '?width=200&height=200'

    // Create media record
    const { data: mediaRecord, error } = await supabaseAdmin
      .from('result_media')
      .insert({
        check_result_id: resultId,
        url: urlData.publicUrl,
        thumbnail_url: thumbnailUrl,
        caption,
        uploaded_by: auth.user.id
      })
      .select()
      .single()

    if (error) {
      return c.json({ error: error.message }, 500)
    }

    return c.json({
      id: mediaRecord.id,
      url: mediaRecord.url,
      thumbnailUrl: mediaRecord.thumbnail_url,
      caption: mediaRecord.caption,
      createdAt: mediaRecord.created_at
    }, 201)
  } catch (error) {
    console.error('Create media record error:', error)
    return c.json({ error: 'Failed to create media record' }, 500)
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
        url,
        check_result:check_results(
          health_check:health_checks(organization_id)
        )
      `)
      .eq('id', mediaId)
      .single()

    if (fetchError || !mediaRecord) {
      return c.json({ error: 'Media not found' }, 404)
    }

    // Verify org access
    const healthCheck = (mediaRecord.check_result as { health_check: { organization_id: string } })?.health_check
    if (healthCheck?.organization_id !== auth.orgId) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    // Extract path from URL and delete from storage
    const url = new URL(mediaRecord.url)
    const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/)
    if (pathMatch) {
      const filePath = pathMatch[1]
      await supabaseAdmin.storage.from(BUCKET_NAME).remove([filePath])
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
