/**
 * Estimate send service — renders + dispatches the "estimate ready" SMS/email to the
 * customer and logs each send to communication_logs. Reuses the existing comms stack
 * (getOrganizationTemplate / renderEmailHtml / renderSmsMessage / sendEmail / sendSms /
 * getOrganizationBranding) exactly as the VHC "health check ready" flow does — only the
 * template type ('estimate_ready'), the public URL (/estimate/:token) and the context
 * differ. Sent INLINE (not via the BullMQ worker) so it doesn't depend on the worker
 * running, matching how other dev-safe sends behave.
 */
import { supabaseAdmin } from '../lib/supabase.js'
import { sendEmail, getOrganizationBranding, EmailRepairItem } from './email.js'
import { sendSms } from './sms.js'
import {
  getOrganizationTemplate,
  renderEmailHtml,
  renderEmailText,
  renderSmsMessage,
  renderTemplate,
  TemplateContext
} from './template-renderer.js'

interface SendEstimateResult {
  email: { success: boolean; error?: string } | null
  sms: { success: boolean; error?: string } | null
}

// Log a single send to communication_logs (estimate-scoped).
async function logComm(params: {
  estimateId: string; orgId: string; channel: 'email' | 'sms'
  recipient: string; subject: string | null; body: string
  success: boolean; externalId?: string; error?: string
}) {
  await supabaseAdmin.from('communication_logs').insert({
    estimate_id: params.estimateId,
    organization_id: params.orgId,
    channel: params.channel,
    recipient: params.recipient,
    subject: params.subject,
    message_body: params.body,
    status: params.success ? 'sent' : 'failed',
    external_id: params.externalId || null,
    error_message: params.error || null
  })
}

/**
 * Send the estimate to its customer. The estimate must already have a public_token
 * (the /send endpoint mints it before calling this).
 */
export async function sendEstimateToCustomer(params: {
  estimateId: string
  orgId: string
  sendEmail: boolean
  sendSms: boolean
  customMessage?: string
}): Promise<SendEstimateResult> {
  const { estimateId, orgId } = params

  // 1. Load the estimate + customer + vehicle + the public token.
  const { data: est } = await supabaseAdmin
    .from('estimates')
    .select(`
      id, reference, public_token, valid_until,
      customer:customers(id, first_name, last_name, email, mobile),
      vehicle:vehicles(registration, make, model)
    `)
    .eq('id', estimateId)
    .eq('organization_id', orgId)
    .single()

  if (!est || !est.public_token) {
    return { email: null, sms: null }
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const customer = est.customer as any
  const vehicle = est.vehicle as any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 2. Quote lines → totals + an itemised list for the email.
  const { data: lines } = await supabaseAdmin
    .from('repair_items')
    .select('id, name, description, total_inc_vat')
    .eq('estimate_id', estimateId)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  const repairItems: EmailRepairItem[] = (lines || []).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    totalIncVat: parseFloat(l.total_inc_vat) || 0,
    options: [],
    linkedCheckResults: []
  }))
  const total = repairItems.reduce((s, r) => s + r.totalIncVat, 0)

  // 3. Branding + context.
  const branding = await getOrganizationBranding(orgId)
  const publicUrl = `${process.env.PUBLIC_APP_URL || 'http://localhost:5183'}/estimate/${est.public_token}`
  const customerName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'there'
  const context: TemplateContext = {
    customerName,
    customerFirstName: customer?.first_name || 'there',
    vehicleReg: vehicle?.registration || '',
    vehicleMakeModel: [vehicle?.make, vehicle?.model].filter(Boolean).join(' '),
    publicUrl,
    dealershipName: branding.organizationName || 'your garage',
    dealershipPhone: branding.phone,
    quoteTotalIncVat: total,
    repairItemsCount: repairItems.length,
    estimateNumber: est.reference || 'Estimate',
    expiryDate: est.valid_until
      ? new Date(`${est.valid_until}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      : undefined
  }

  const result: SendEstimateResult = { email: null, sms: null }

  // 4. Email.
  if (params.sendEmail && customer?.email) {
    const template = await getOrganizationTemplate(orgId, 'estimate_ready', 'email')
    const html = renderEmailHtml({
      template, context, branding, repairItems, quoteTotalIncVat: total,
      customMessage: params.customMessage,
      expiryText: est.valid_until ? `This estimate is valid until ${context.expiryDate}.` : 'Please respond at your earliest convenience.'
    })
    const text = renderEmailText({ template, context, branding, repairItems, quoteTotalIncVat: total })
    const subject = renderTemplate(template.emailSubject || 'Your estimate is ready', context)
    const sent = await sendEmail({ to: customer.email, subject, html, text, organizationId: orgId })
    await logComm({ estimateId, orgId, channel: 'email', recipient: customer.email, subject, body: text, success: sent.success, externalId: sent.messageId, error: sent.error })
    result.email = { success: sent.success, error: sent.error }
  }

  // 5. SMS.
  if (params.sendSms && customer?.mobile) {
    const template = await getOrganizationTemplate(orgId, 'estimate_ready', 'sms')
    const messageBody = renderSmsMessage(template, context)
    const sent = await sendSms(customer.mobile, messageBody, orgId)
    await logComm({ estimateId, orgId, channel: 'sms', recipient: customer.mobile, subject: null, body: messageBody, success: sent.success, externalId: sent.messageId, error: sent.error })
    result.sms = { success: sent.success, error: sent.error }
  }

  return result
}

// Total inc-VAT of an estimate's quote lines (used for the confirmation message).
export async function estimateApprovedTotal(estimateId: string): Promise<{ approvedCount: number; approvedTotal: number }> {
  const { data: lines } = await supabaseAdmin
    .from('repair_items')
    .select('total_inc_vat, customer_approved')
    .eq('estimate_id', estimateId)
    .is('parent_repair_item_id', null)
    .is('deleted_at', null)
  const approved = (lines || []).filter((l) => l.customer_approved === true)
  return {
    approvedCount: approved.length,
    approvedTotal: approved.reduce((s, l) => s + (parseFloat(l.total_inc_vat) || 0), 0)
  }
}
