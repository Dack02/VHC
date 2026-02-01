/**
 * Message Templates API Routes
 * Manages per-organization SMS and email templates for customer notifications
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import {
  getOrganizationTemplate,
  renderTemplate,
  renderEmailHtml,
  renderEmailText,
  SAMPLE_CONTEXT,
  MessageTemplate
} from '../services/template-renderer.js'
import {
  DEFAULT_TEMPLATES,
  AVAILABLE_PLACEHOLDERS,
  TemplateType
} from '../services/default-templates.js'

const messageTemplatesRoutes = new Hono()

// All routes require authentication
messageTemplatesRoutes.use('*', authMiddleware)

// Valid template types
const VALID_TEMPLATE_TYPES: TemplateType[] = [
  'health_check_ready',
  'reminder',
  'reminder_urgent',
  'authorization_confirmation'
]

const VALID_CHANNELS = ['sms', 'email'] as const

/**
 * GET /api/v1/organizations/:id/message-templates
 * Get all message templates for organization (merged with defaults)
 */
messageTemplatesRoutes.get('/:id/message-templates', async c => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Fetch all custom templates for this organization
  const { data: customTemplates, error } = await supabaseAdmin
    .from('organization_message_templates')
    .select('*')
    .eq('organization_id', organizationId)

  if (error) {
    return c.json({ error: error.message }, 500)
  }

  // Build response: merge custom templates with defaults
  const templates: Record<
    string,
    {
      sms: MessageTemplate
      email: MessageTemplate
    }
  > = {}

  for (const templateType of VALID_TEMPLATE_TYPES) {
    const defaults = DEFAULT_TEMPLATES[templateType]

    // Find custom templates for this type
    const customSms = customTemplates?.find(
      t => t.template_type === templateType && t.channel === 'sms'
    )
    const customEmail = customTemplates?.find(
      t => t.template_type === templateType && t.channel === 'email'
    )

    templates[templateType] = {
      sms: {
        id: customSms?.id,
        templateType,
        channel: 'sms',
        isCustom: customSms?.is_custom ?? false,
        smsContent: customSms?.sms_content || defaults.sms.smsContent
      },
      email: {
        id: customEmail?.id,
        templateType,
        channel: 'email',
        isCustom: customEmail?.is_custom ?? false,
        emailSubject: customEmail?.email_subject || defaults.email.emailSubject,
        emailGreeting: customEmail?.email_greeting || defaults.email.emailGreeting,
        emailBody: customEmail?.email_body || defaults.email.emailBody,
        emailClosing: customEmail?.email_closing || defaults.email.emailClosing,
        emailSignature: customEmail?.email_signature || defaults.email.emailSignature,
        emailCtaText: customEmail?.email_cta_text || defaults.email.emailCtaText
      }
    }
  }

  return c.json({
    templates,
    placeholders: AVAILABLE_PLACEHOLDERS
  })
})

/**
 * GET /api/v1/organizations/:id/message-templates/:templateType/:channel
 * Get specific template
 */
messageTemplatesRoutes.get('/:id/message-templates/:templateType/:channel', async c => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')
  const templateType = c.req.param('templateType') as TemplateType
  const channel = c.req.param('channel') as 'sms' | 'email'

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  // Validate template type and channel
  if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
    return c.json({ error: 'Invalid template type' }, 400)
  }
  if (!VALID_CHANNELS.includes(channel)) {
    return c.json({ error: 'Invalid channel' }, 400)
  }

  const template = await getOrganizationTemplate(organizationId, templateType, channel)

  return c.json({
    template,
    placeholders: AVAILABLE_PLACEHOLDERS
  })
})

/**
 * PATCH /api/v1/organizations/:id/message-templates/:templateType/:channel
 * Update specific template
 */
messageTemplatesRoutes.patch(
  '/:id/message-templates/:templateType/:channel',
  requireOrgAdmin(),
  async c => {
    const auth = c.get('auth')
    const organizationId = c.req.param('id')
    const templateType = c.req.param('templateType') as TemplateType
    const channel = c.req.param('channel') as 'sms' | 'email'

    // Verify user belongs to this organization
    if (auth.orgId !== organizationId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Validate template type and channel
    if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
      return c.json({ error: 'Invalid template type' }, 400)
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return c.json({ error: 'Invalid channel' }, 400)
    }

    const body = await c.req.json()

    // Build update data based on channel
    const updateData: Record<string, unknown> = {
      organization_id: organizationId,
      template_type: templateType,
      channel: channel,
      is_custom: true,
      updated_at: new Date().toISOString()
    }

    if (channel === 'sms') {
      if (body.smsContent !== undefined) {
        updateData.sms_content = body.smsContent
      }
    } else {
      if (body.emailSubject !== undefined) {
        updateData.email_subject = body.emailSubject
      }
      if (body.emailGreeting !== undefined) {
        updateData.email_greeting = body.emailGreeting
      }
      if (body.emailBody !== undefined) {
        updateData.email_body = body.emailBody
      }
      if (body.emailClosing !== undefined) {
        updateData.email_closing = body.emailClosing
      }
      if (body.emailSignature !== undefined) {
        updateData.email_signature = body.emailSignature
      }
      if (body.emailCtaText !== undefined) {
        updateData.email_cta_text = body.emailCtaText
      }
    }

    // Upsert the template
    const { error } = await supabaseAdmin
      .from('organization_message_templates')
      .upsert(updateData, {
        onConflict: 'organization_id,template_type,channel'
      })
      .select()
      .single()

    if (error) {
      console.error('Error updating template:', error)
      return c.json({ error: error.message }, 500)
    }

    // Return updated template
    const template = await getOrganizationTemplate(organizationId, templateType, channel)

    return c.json({
      message: 'Template updated successfully',
      template
    })
  }
)

/**
 * POST /api/v1/organizations/:id/message-templates/:templateType/:channel/reset
 * Reset template to default
 */
messageTemplatesRoutes.post(
  '/:id/message-templates/:templateType/:channel/reset',
  requireOrgAdmin(),
  async c => {
    const auth = c.get('auth')
    const organizationId = c.req.param('id')
    const templateType = c.req.param('templateType') as TemplateType
    const channel = c.req.param('channel') as 'sms' | 'email'

    // Verify user belongs to this organization
    if (auth.orgId !== organizationId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Validate template type and channel
    if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
      return c.json({ error: 'Invalid template type' }, 400)
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return c.json({ error: 'Invalid channel' }, 400)
    }

    // Delete custom template to reset to defaults
    const { error } = await supabaseAdmin
      .from('organization_message_templates')
      .delete()
      .eq('organization_id', organizationId)
      .eq('template_type', templateType)
      .eq('channel', channel)

    if (error) {
      console.error('Error resetting template:', error)
      return c.json({ error: error.message }, 500)
    }

    // Return default template
    const template = await getOrganizationTemplate(organizationId, templateType, channel)

    return c.json({
      message: 'Template reset to default',
      template
    })
  }
)

/**
 * POST /api/v1/organizations/:id/message-templates/:templateType/:channel/preview
 * Generate preview with sample data
 */
messageTemplatesRoutes.post(
  '/:id/message-templates/:templateType/:channel/preview',
  async c => {
    const auth = c.get('auth')
    const organizationId = c.req.param('id')
    const templateType = c.req.param('templateType') as TemplateType
    const channel = c.req.param('channel') as 'sms' | 'email'

    // Verify user belongs to this organization
    if (auth.orgId !== organizationId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Validate template type and channel
    if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
      return c.json({ error: 'Invalid template type' }, 400)
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return c.json({ error: 'Invalid channel' }, 400)
    }

    const body = await c.req.json()

    // Get organization branding for email preview
    let branding = {
      primaryColor: '#3B82F6',
      organizationName: SAMPLE_CONTEXT.dealershipName,
      logoUrl: null as string | null
    }

    if (organizationId) {
      const { data: settings } = await supabaseAdmin
        .from('organization_settings')
        .select('logo_url, primary_color')
        .eq('organization_id', organizationId)
        .single()

      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .single()

      if (settings || org) {
        branding = {
          logoUrl: settings?.logo_url || null,
          primaryColor: settings?.primary_color || '#3B82F6',
          organizationName: org?.name || SAMPLE_CONTEXT.dealershipName
        }
      }
    }

    // Update sample context with org name
    const previewContext = {
      ...SAMPLE_CONTEXT,
      dealershipName: branding.organizationName || SAMPLE_CONTEXT.dealershipName
    }

    if (channel === 'sms') {
      // Preview SMS
      const smsContent = body.smsContent || ''
      const preview = renderTemplate(smsContent, previewContext)
      const characterCount = preview.length

      return c.json({
        preview,
        characterCount,
        segmentCount: Math.ceil(characterCount / 160),
        warning: characterCount > 160 ? 'Message exceeds 160 characters and will be split into multiple SMS' : null
      })
    } else {
      // Preview Email - build a template from request body
      const template: MessageTemplate = {
        templateType,
        channel: 'email',
        isCustom: true,
        emailSubject: body.emailSubject || '',
        emailGreeting: body.emailGreeting || '',
        emailBody: body.emailBody || '',
        emailClosing: body.emailClosing || '',
        emailSignature: body.emailSignature || '',
        emailCtaText: body.emailCtaText || ''
      }

      // Determine what to show based on template type
      const showRagSummary = templateType === 'health_check_ready'
      const showRepairItems = templateType === 'health_check_ready'

      // Sample repair items for preview
      const sampleRepairItems = showRepairItems
        ? [
            {
              id: '1',
              name: 'Front Brake Pads',
              description: 'Replace worn brake pads',
              totalIncVat: 125.0,
              options: [],
              linkedCheckResults: ['Front Brakes']
            },
            {
              id: '2',
              name: 'Oil Service',
              description: 'Full oil and filter change',
              totalIncVat: 89.0,
              options: [
                { id: '1', name: 'Standard Oil', totalIncVat: 89.0, isRecommended: true },
                { id: '2', name: 'Premium Oil', totalIncVat: 129.0, isRecommended: false }
              ],
              linkedCheckResults: []
            }
          ]
        : undefined

      // Determine header color based on template type
      let headerBackgroundColor: string | undefined
      if (templateType === 'reminder_urgent') {
        headerBackgroundColor = '#dc2626' // Red for urgent
      }

      const htmlPreview = renderEmailHtml({
        template,
        context: previewContext,
        branding,
        showRagSummary,
        repairItems: sampleRepairItems,
        quoteTotalIncVat: showRepairItems ? 214.0 : undefined,
        headerBackgroundColor
      })

      const textPreview = renderEmailText({
        template,
        context: previewContext,
        branding,
        showRagSummary,
        repairItems: sampleRepairItems,
        quoteTotalIncVat: showRepairItems ? 214.0 : undefined
      })

      const subjectPreview = renderTemplate(template.emailSubject || '', previewContext)

      return c.json({
        subject: subjectPreview,
        html: htmlPreview,
        text: textPreview
      })
    }
  }
)

/**
 * GET /api/v1/organizations/:id/message-templates/placeholders
 * Get list of available placeholders
 */
messageTemplatesRoutes.get('/:id/message-templates/placeholders', async c => {
  const auth = c.get('auth')
  const organizationId = c.req.param('id')

  // Verify user belongs to this organization
  if (auth.orgId !== organizationId) {
    return c.json({ error: 'Access denied' }, 403)
  }

  return c.json({
    placeholders: AVAILABLE_PLACEHOLDERS
  })
})

export default messageTemplatesRoutes
