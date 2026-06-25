/**
 * Message Templates API Routes
 * Manages per-organization SMS and email templates for customer notifications
 */

import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, requireOrgAdmin } from '../middleware/auth.js'
import { sendSms } from '../services/sms.js'
import { sendEmail } from '../services/email.js'
import {
  getOrganizationTemplate,
  renderTemplate,
  renderEmailHtml,
  renderEmailText,
  SAMPLE_CONTEXT,
  MessageTemplate,
  TemplateContext
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

interface PreviewBranding {
  primaryColor: string
  organizationName: string
  logoUrl: string | null
}

/**
 * Resolve org branding + a sample render context, shared by the preview and
 * test-send routes so both render identically.
 */
async function resolvePreviewContext(
  organizationId: string
): Promise<{ branding: PreviewBranding; context: TemplateContext }> {
  let branding: PreviewBranding = {
    primaryColor: '#3B82F6',
    organizationName: SAMPLE_CONTEXT.dealershipName,
    logoUrl: null
  }

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

  return {
    branding,
    context: {
      ...SAMPLE_CONTEXT,
      dealershipName: branding.organizationName || SAMPLE_CONTEXT.dealershipName
    }
  }
}

/**
 * Render a draft template (from the request body) against the sample context.
 * Returns the SMS body, or the email subject/html/text, ready to preview or send.
 */
function renderDraft(
  templateType: TemplateType,
  channel: 'sms' | 'email',
  body: Record<string, unknown>,
  branding: PreviewBranding,
  context: TemplateContext
): { sms?: string; subject?: string; html?: string; text?: string } {
  if (channel === 'sms') {
    return { sms: renderTemplate((body.smsContent as string) || '', context) }
  }

  const template: MessageTemplate = {
    templateType,
    channel: 'email',
    isCustom: true,
    emailSubject: (body.emailSubject as string) || '',
    emailGreeting: (body.emailGreeting as string) || '',
    emailBody: (body.emailBody as string) || '',
    emailClosing: (body.emailClosing as string) || '',
    emailSignature: (body.emailSignature as string) || '',
    emailCtaText: (body.emailCtaText as string) || ''
  }

  // health_check_ready shows the system-generated RAG summary + repair items block
  const showRich = templateType === 'health_check_ready'
  const sampleRepairItems = showRich
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

  const headerBackgroundColor =
    templateType === 'reminder_urgent' ? '#dc2626' : undefined

  const html = renderEmailHtml({
    template,
    context,
    branding,
    showRagSummary: showRich,
    repairItems: sampleRepairItems,
    quoteTotalIncVat: showRich ? 214.0 : undefined,
    headerBackgroundColor
  })

  const text = renderEmailText({
    template,
    context,
    branding,
    showRagSummary: showRich,
    repairItems: sampleRepairItems,
    quoteTotalIncVat: showRich ? 214.0 : undefined
  })

  return {
    subject: renderTemplate(template.emailSubject || '', context),
    html,
    text
  }
}

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

  // Resolve where a "send test" would go (the logged-in admin's own account)
  const { data: me } = await supabaseAdmin
    .from('users')
    .select('phone')
    .eq('id', auth.user.id)
    .maybeSingle()

  return c.json({
    templates,
    placeholders: AVAILABLE_PLACEHOLDERS,
    testRecipients: {
      email: auth.user.email,
      phone: me?.phone || null
    }
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

    const { branding, context } = await resolvePreviewContext(organizationId)
    const rendered = renderDraft(templateType, channel, body, branding, context)

    if (channel === 'sms') {
      const preview = rendered.sms || ''
      const characterCount = preview.length
      return c.json({
        preview,
        characterCount,
        segmentCount: Math.ceil(characterCount / 160),
        warning:
          characterCount > 160
            ? 'Message exceeds 160 characters and will be split into multiple SMS'
            : null
      })
    }

    return c.json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    })
  }
)

/**
 * POST /api/v1/organizations/:id/message-templates/:templateType/:channel/test-send
 * Render the draft (from the request body) with sample data and send it to the
 * logged-in admin's own account — email to their account email, SMS to the mobile
 * on their user profile. Lets admins verify a template end-to-end before saving.
 */
messageTemplatesRoutes.post(
  '/:id/message-templates/:templateType/:channel/test-send',
  requireOrgAdmin(),
  async c => {
    const auth = c.get('auth')
    const organizationId = c.req.param('id')
    const templateType = c.req.param('templateType') as TemplateType
    const channel = c.req.param('channel') as 'sms' | 'email'

    if (auth.orgId !== organizationId) {
      return c.json({ error: 'Access denied' }, 403)
    }
    if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
      return c.json({ error: 'Invalid template type' }, 400)
    }
    if (!VALID_CHANNELS.includes(channel)) {
      return c.json({ error: 'Invalid channel' }, 400)
    }

    const body = await c.req.json().catch(() => ({}))
    const { branding, context } = await resolvePreviewContext(organizationId)
    const rendered = renderDraft(templateType, channel, body, branding, context)

    if (channel === 'sms') {
      // Resolve the admin's own mobile from their profile.
      const { data: me } = await supabaseAdmin
        .from('users')
        .select('phone')
        .eq('id', auth.user.id)
        .maybeSingle()

      const to = me?.phone?.trim()
      if (!to) {
        return c.json(
          {
            success: false,
            error:
              'No mobile number on your profile. Add one to your account before sending an SMS test.'
          },
          400
        )
      }

      const message = `[TEST] ${rendered.sms || ''}`
      const result = await sendSms(to, message, organizationId)
      // Return 200 even on failure so the api() client doesn't retry (and re-send).
      return result.success
        ? c.json({ success: true, to, channel, source: result.source })
        : c.json({ success: false, error: result.error || 'Failed to send test SMS' })
    }

    // Email — send to the admin's own account email.
    const to = auth.user.email
    if (!to) {
      return c.json({ success: false, error: 'No email on your account' }, 400)
    }

    const result = await sendEmail({
      to,
      subject: `[TEST] ${rendered.subject || 'Message template test'}`,
      html: rendered.html || '',
      text: rendered.text || '',
      organizationId
    })
    // Return 200 even on failure so the api() client doesn't retry (and re-send).
    return result.success
      ? c.json({ success: true, to, channel, source: result.source })
      : c.json({ success: false, error: result.error || 'Failed to send test email' })
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
