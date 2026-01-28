/**
 * Default Message Templates
 *
 * These templates are used when an organization hasn't customized their messages.
 * Placeholders use {{placeholder}} syntax and are replaced at render time.
 *
 * Available placeholders:
 * - {{customerName}} - Full name (e.g., "John Smith")
 * - {{customerFirstName}} - First name only (e.g., "John")
 * - {{vehicleReg}} - Vehicle registration (e.g., "AB21 XYZ")
 * - {{vehicleMakeModel}} - Make and model (e.g., "BMW 3 Series")
 * - {{publicUrl}} - Customer link to view health check
 * - {{dealershipName}} - Organization/site name
 * - {{redCount}} - Number of red (urgent) items
 * - {{amberCount}} - Number of amber (advisory) items
 * - {{greenCount}} - Number of green (passed) items
 * - {{quoteTotalIncVat}} - Total quote formatted with currency (e.g., "£245.00")
 * - {{repairItemsCount}} - Number of recommended repair items
 * - {{hoursRemaining}} - Hours until link expires (for urgent reminders)
 * - {{approvedCount}} - Number of approved items (for confirmation)
 * - {{authorizedTotal}} - Total authorized amount (for confirmation)
 */

export interface SmsTemplate {
  smsContent: string
}

export interface EmailTemplate {
  emailSubject: string
  emailGreeting: string
  emailBody: string
  emailClosing: string
  emailSignature: string
  emailCtaText: string
}

export interface DefaultTemplates {
  sms: SmsTemplate
  email: EmailTemplate
}

export type TemplateType =
  | 'health_check_ready'
  | 'reminder'
  | 'reminder_urgent'
  | 'authorization_confirmation'

export const DEFAULT_TEMPLATES: Record<TemplateType, DefaultTemplates> = {
  health_check_ready: {
    sms: {
      smsContent:
        'Hi {{customerFirstName}}, your vehicle health check for {{vehicleReg}} is ready. {{repairItemsCount}} item(s) recommended ({{quoteTotalIncVat}} inc VAT). Review & authorize: {{publicUrl}} - {{dealershipName}}'
    },
    email: {
      emailSubject: 'Your Vehicle Health Check is Ready - {{vehicleReg}}',
      emailGreeting: 'Hi {{customerName}},',
      emailBody:
        'Your vehicle health check for {{vehicleReg}} ({{vehicleMakeModel}}) is now ready for your review.\n\nPlease take a moment to review the findings and authorize any necessary repairs. Our team has highlighted items that need attention to keep your vehicle running safely and efficiently.',
      emailClosing:
        "If you have any questions about the health check or recommended repairs, please don't hesitate to contact us.",
      emailSignature: '{{dealershipName}}',
      emailCtaText: 'View Health Check'
    }
  },

  reminder: {
    sms: {
      smsContent:
        'Hi {{customerFirstName}}, reminder: Your health check for {{vehicleReg}} is awaiting your response. View it here: {{publicUrl}}'
    },
    email: {
      emailSubject: 'Reminder: Your Vehicle Health Check Awaits - {{vehicleReg}}',
      emailGreeting: 'Hi {{customerName}},',
      emailBody:
        "We noticed you haven't had a chance to review your vehicle health check for {{vehicleReg}} yet.\n\nPlease take a moment to review the findings at your earliest convenience. Our team is ready to help with any repairs you authorize.",
      emailClosing: 'Thank you for your prompt attention to this matter.',
      emailSignature: '{{dealershipName}}',
      emailCtaText: 'View Health Check Now'
    }
  },

  reminder_urgent: {
    sms: {
      smsContent:
        'Hi {{customerFirstName}}, urgent: Your health check for {{vehicleReg}} expires in {{hoursRemaining}} hours. Please respond: {{publicUrl}}'
    },
    email: {
      emailSubject: 'Urgent: Your Health Check Link Expires Soon - {{vehicleReg}}',
      emailGreeting: 'Hi {{customerName}},',
      emailBody:
        'Your vehicle health check for {{vehicleReg}} will expire in {{hoursRemaining}} hours.\n\nPlease review and respond before the link expires. If you need more time, contact us and we can send a new link.',
      emailClosing: "Don't miss out - review your health check now before it expires.",
      emailSignature: '{{dealershipName}}',
      emailCtaText: 'View Health Check Now'
    }
  },

  authorization_confirmation: {
    sms: {
      smsContent:
        "Thank you {{customerFirstName}}! You've authorized {{approvedCount}} item(s) ({{authorizedTotal}}) on {{vehicleReg}}. {{dealershipName}} will be in touch shortly."
    },
    email: {
      emailSubject: 'Work Authorized - {{vehicleReg}}',
      emailGreeting: 'Hi {{customerName}},',
      emailBody:
        "Thank you for authorizing the following work on your vehicle {{vehicleReg}}.\n\nWe will begin work shortly and keep you updated on progress. Our team will contact you when your vehicle is ready for collection.",
      emailClosing:
        "If you have any questions about the work or need to make changes, please don't hesitate to contact us.",
      emailSignature: '{{dealershipName}}',
      emailCtaText: ''
    }
  }
}

/**
 * Get the default template for a specific type and channel
 */
export function getDefaultTemplate(
  templateType: TemplateType,
  channel: 'sms' | 'email'
): SmsTemplate | EmailTemplate {
  const templates = DEFAULT_TEMPLATES[templateType]
  if (!templates) {
    throw new Error(`Unknown template type: ${templateType}`)
  }
  return templates[channel]
}

/**
 * Get all available placeholder names
 */
export const AVAILABLE_PLACEHOLDERS = [
  { key: 'customerName', label: 'Customer Name', description: 'Full name (e.g., John Smith)' },
  { key: 'customerFirstName', label: 'First Name', description: 'First name only (e.g., John)' },
  { key: 'vehicleReg', label: 'Registration', description: 'Vehicle registration (e.g., AB21 XYZ)' },
  {
    key: 'vehicleMakeModel',
    label: 'Make/Model',
    description: 'Vehicle make and model (e.g., BMW 3 Series)'
  },
  { key: 'publicUrl', label: 'Link', description: 'Customer link to view health check' },
  { key: 'dealershipName', label: 'Dealership', description: 'Organization name' },
  { key: 'redCount', label: 'Red Items', description: 'Number of urgent items' },
  { key: 'amberCount', label: 'Amber Items', description: 'Number of advisory items' },
  { key: 'greenCount', label: 'Green Items', description: 'Number of passed items' },
  { key: 'quoteTotalIncVat', label: 'Quote Total', description: 'Total quote with VAT' },
  { key: 'repairItemsCount', label: 'Item Count', description: 'Number of recommended items' },
  { key: 'hoursRemaining', label: 'Hours Left', description: 'Hours until link expires' },
  { key: 'approvedCount', label: 'Approved Count', description: 'Number of approved items' },
  { key: 'authorizedTotal', label: 'Authorized Total', description: 'Total authorized amount' }
] as const
