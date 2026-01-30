import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { debounce } from '../../lib/utils'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Placeholder {
  key: string
  label: string
  description: string
}

interface MessageTemplate {
  id?: string
  templateType: string
  channel: 'sms' | 'email'
  isCustom: boolean
  smsContent?: string
  emailSubject?: string
  emailGreeting?: string
  emailBody?: string
  emailClosing?: string
  emailSignature?: string
  emailCtaText?: string
}

interface TemplatesResponse {
  templates: Record<
    string,
    {
      sms: MessageTemplate
      email: MessageTemplate
    }
  >
  placeholders: Placeholder[]
}

interface SmsPreviewResponse {
  preview: string
  characterCount: number
  segmentCount: number
  warning: string | null
}

interface EmailPreviewResponse {
  subject: string
  html: string
  text: string
}

interface NotificationSettings {
  defaultReminderEnabled: boolean
}

type TemplateType =
  | 'health_check_ready'
  | 'reminder'
  | 'reminder_urgent'
  | 'authorization_confirmation'

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  health_check_ready: 'Health Check Ready',
  reminder: 'Reminder',
  reminder_urgent: 'Urgent Reminder',
  authorization_confirmation: 'Authorization Confirmation'
}

const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  health_check_ready: 'Sent when a health check is published to the customer',
  reminder: 'Sent at intervals to remind customers to view their health check',
  reminder_urgent: 'Sent when less than 24 hours remain before link expiry',
  authorization_confirmation: 'Sent after customer authorizes work'
}

export default function MessageTemplates() {
  const { session, user } = useAuth()
  const [templates, setTemplates] = useState<TemplatesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Selected template type
  const [activeTab, setActiveTab] = useState<TemplateType>('health_check_ready')

  // Current editing state
  const [smsContent, setSmsContent] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailGreeting, setEmailGreeting] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailClosing, setEmailClosing] = useState('')
  const [emailSignature, setEmailSignature] = useState('')
  const [emailCtaText, setEmailCtaText] = useState('')

  // Preview state
  const [smsPreview, setSmsPreview] = useState<SmsPreviewResponse | null>(null)
  const [emailPreview, setEmailPreview] = useState<EmailPreviewResponse | null>(null)
  const [_previewLoading, setPreviewLoading] = useState(false)

  // Track if there are unsaved changes (can be used for navigation warning)
  const [_hasChanges, setHasChanges] = useState(false)

  // Reminder settings
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [savingReminders, setSavingReminders] = useState(false)

  // Refs for textarea cursor position
  const smsTextareaRef = useRef<HTMLTextAreaElement>(null)

  const organizationId = user?.organization?.id

  // Load templates on mount
  useEffect(() => {
    if (organizationId) {
      fetchTemplates()
      fetchReminderSettings()
    }
  }, [organizationId])

  // Load template content when tab changes
  useEffect(() => {
    if (templates) {
      loadTemplateContent(activeTab)
    }
  }, [activeTab, templates])

  const fetchTemplates = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<TemplatesResponse>(
        `/api/v1/organizations/${organizationId}/message-templates`,
        { token: session?.accessToken }
      )
      setTemplates(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  const fetchReminderSettings = async () => {
    if (!organizationId) return

    try {
      const data = await api<NotificationSettings>(
        `/api/v1/organizations/${organizationId}/notification-settings`,
        { token: session?.accessToken }
      )
      setRemindersEnabled(data.defaultReminderEnabled)
    } catch (err) {
      // Silently fail - default to enabled
    }
  }

  const handleToggleReminders = async () => {
    if (!organizationId) return

    const newValue = !remindersEnabled

    try {
      setSavingReminders(true)
      setError('')

      await api(
        `/api/v1/organizations/${organizationId}/notification-settings`,
        {
          method: 'PATCH',
          body: { default_reminder_enabled: newValue },
          token: session?.accessToken
        }
      )

      setRemindersEnabled(newValue)
      setSuccess(newValue ? 'Reminders enabled' : 'Reminders disabled')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update reminder settings')
    } finally {
      setSavingReminders(false)
    }
  }

  const loadTemplateContent = (templateType: TemplateType) => {
    if (!templates) return

    const sms = templates.templates[templateType]?.sms
    const email = templates.templates[templateType]?.email

    setSmsContent(sms?.smsContent || '')
    setEmailSubject(email?.emailSubject || '')
    setEmailGreeting(email?.emailGreeting || '')
    setEmailBody(email?.emailBody || '')
    setEmailClosing(email?.emailClosing || '')
    setEmailSignature(email?.emailSignature || '')
    setEmailCtaText(email?.emailCtaText || '')
    setHasChanges(false)

    // Generate initial previews
    generateSmsPreview(sms?.smsContent || '')
    generateEmailPreview({
      emailSubject: email?.emailSubject || '',
      emailGreeting: email?.emailGreeting || '',
      emailBody: email?.emailBody || '',
      emailClosing: email?.emailClosing || '',
      emailSignature: email?.emailSignature || '',
      emailCtaText: email?.emailCtaText || ''
    })
  }

  // Debounced preview generation
  const debouncedSmsPreview = useCallback(
    debounce((content: string) => generateSmsPreview(content), 300),
    [organizationId, session?.accessToken, activeTab]
  )

  const debouncedEmailPreview = useCallback(
    debounce((emailData: Partial<MessageTemplate>) => generateEmailPreview(emailData), 300),
    [organizationId, session?.accessToken, activeTab]
  )

  const generateSmsPreview = async (content: string) => {
    if (!organizationId) return

    try {
      setPreviewLoading(true)
      const data = await api<SmsPreviewResponse>(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/sms/preview`,
        {
          method: 'POST',
          body: { smsContent: content },
          token: session?.accessToken
        }
      )
      setSmsPreview(data)
    } catch (err) {
      console.error('Failed to generate SMS preview:', err)
    } finally {
      setPreviewLoading(false)
    }
  }

  const generateEmailPreview = async (emailData: Partial<MessageTemplate>) => {
    if (!organizationId) return

    try {
      setPreviewLoading(true)
      const data = await api<EmailPreviewResponse>(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/email/preview`,
        {
          method: 'POST',
          body: emailData,
          token: session?.accessToken
        }
      )
      setEmailPreview(data)
    } catch (err) {
      console.error('Failed to generate email preview:', err)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSmsChange = (value: string) => {
    setSmsContent(value)
    setHasChanges(true)
    debouncedSmsPreview(value)
  }

  const handleEmailChange = (
    field: 'emailSubject' | 'emailGreeting' | 'emailBody' | 'emailClosing' | 'emailSignature' | 'emailCtaText',
    value: string
  ) => {
    const setters: Record<string, (v: string) => void> = {
      emailSubject: setEmailSubject,
      emailGreeting: setEmailGreeting,
      emailBody: setEmailBody,
      emailClosing: setEmailClosing,
      emailSignature: setEmailSignature,
      emailCtaText: setEmailCtaText
    }
    setters[field](value)
    setHasChanges(true)

    const emailData = {
      emailSubject: field === 'emailSubject' ? value : emailSubject,
      emailGreeting: field === 'emailGreeting' ? value : emailGreeting,
      emailBody: field === 'emailBody' ? value : emailBody,
      emailClosing: field === 'emailClosing' ? value : emailClosing,
      emailSignature: field === 'emailSignature' ? value : emailSignature,
      emailCtaText: field === 'emailCtaText' ? value : emailCtaText
    }
    debouncedEmailPreview(emailData)
  }

  const insertPlaceholder = (placeholder: string, target: 'sms' | 'email', _field?: string) => {
    const placeholderText = `{{${placeholder}}}`

    if (target === 'sms' && smsTextareaRef.current) {
      const textarea = smsTextareaRef.current
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = smsContent.slice(0, start) + placeholderText + smsContent.slice(end)
      handleSmsChange(newValue)
      // Restore cursor position after the placeholder
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + placeholderText.length
        textarea.focus()
      }, 0)
    }
  }

  const handleSaveSms = async () => {
    if (!organizationId) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await api(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/sms`,
        {
          method: 'PATCH',
          body: { smsContent },
          token: session?.accessToken
        }
      )

      setSuccess('SMS template saved successfully')
      setTimeout(() => setSuccess(''), 3000)
      setHasChanges(false)
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save SMS template')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEmail = async () => {
    if (!organizationId) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await api(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/email`,
        {
          method: 'PATCH',
          body: {
            emailSubject,
            emailGreeting,
            emailBody,
            emailClosing,
            emailSignature,
            emailCtaText
          },
          token: session?.accessToken
        }
      )

      setSuccess('Email template saved successfully')
      setTimeout(() => setSuccess(''), 3000)
      setHasChanges(false)
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save email template')
    } finally {
      setSaving(false)
    }
  }

  const handleResetSms = async () => {
    if (!organizationId) return
    if (!confirm('Reset SMS template to default? This cannot be undone.')) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await api(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/sms/reset`,
        {
          method: 'POST',
          token: session?.accessToken
        }
      )

      setSuccess('SMS template reset to default')
      setTimeout(() => setSuccess(''), 3000)
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset SMS template')
    } finally {
      setSaving(false)
    }
  }

  const handleResetEmail = async () => {
    if (!organizationId) return
    if (!confirm('Reset email template to default? This cannot be undone.')) return

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      await api(
        `/api/v1/organizations/${organizationId}/message-templates/${activeTab}/email/reset`,
        {
          method: 'POST',
          token: session?.accessToken
        }
      )

      setSuccess('Email template reset to default')
      setTimeout(() => setSuccess(''), 3000)
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset email template')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded-none w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded-none w-2/3 mb-8"></div>
          <div className="h-64 bg-gray-200 rounded-none"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl">
      <SettingsBackLink />
      <h1 className="text-2xl font-bold mb-2">Message Templates</h1>
      <p className="text-gray-600 mb-6">
        Customize the SMS and email messages sent to customers when sharing health checks.
      </p>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-none">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-none">
          {success}
        </div>
      )}

      {/* Template Type Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-4">
          {(Object.keys(TEMPLATE_LABELS) as TemplateType[]).map(type => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`py-3 px-4 border-b-2 font-medium text-sm whitespace-nowrap ${
                activeTab === type
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {TEMPLATE_LABELS[type]}
            </button>
          ))}
        </nav>
      </div>

      <p className="text-sm text-gray-500 mb-6">{TEMPLATE_DESCRIPTIONS[activeTab]}</p>

      {/* Reminder Toggle - Show on reminder tabs */}
      {(activeTab === 'reminder' || activeTab === 'reminder_urgent') && (
        <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-none flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-gray-900">Automatic Reminders</h3>
            <p className="text-sm text-gray-500">
              Send reminder notifications to customers who haven't viewed their health check
            </p>
          </div>
          <button
            onClick={handleToggleReminders}
            disabled={savingReminders}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 ${
              remindersEnabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                remindersEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      )}

      {/* Available Placeholders */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Available Placeholders</h3>
        <div className="flex flex-wrap gap-2">
          {templates?.placeholders.map(p => (
            <button
              key={p.key}
              onClick={() => insertPlaceholder(p.key, 'sms')}
              className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-none border border-gray-300"
              title={p.description}
            >
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SMS Template */}
        <div className="bg-white border border-gray-200 rounded-none p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">SMS Template</h2>
            <div className="flex gap-2">
              <button
                onClick={handleResetSms}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-none disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={handleSaveSms}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-none disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save SMS'}
              </button>
            </div>
          </div>

          <textarea
            ref={smsTextareaRef}
            value={smsContent}
            onChange={e => handleSmsChange(e.target.value)}
            rows={4}
            className="w-full p-3 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            placeholder="Enter SMS message..."
          />

          <div className="flex justify-between items-center mt-2 text-sm">
            <span
              className={`${
                (smsPreview?.characterCount || 0) > 160 ? 'text-amber-600' : 'text-gray-500'
              }`}
            >
              {smsPreview?.characterCount || 0} characters
              {(smsPreview?.segmentCount || 0) > 1 && ` (${smsPreview?.segmentCount} SMS segments)`}
            </span>
            {smsPreview?.warning && (
              <span className="text-amber-600">{smsPreview.warning}</span>
            )}
          </div>

          {/* SMS Preview */}
          <div className="mt-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Preview</h3>
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-none">
              <div className="bg-green-100 text-green-900 p-3 rounded-lg max-w-xs text-sm">
                {smsPreview?.preview || 'Loading preview...'}
              </div>
            </div>
          </div>
        </div>

        {/* Email Template */}
        <div className="bg-white border border-gray-200 rounded-none p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Email Template</h2>
            <div className="flex gap-2">
              <button
                onClick={handleResetEmail}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-none disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={handleSaveEmail}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-none disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Email'}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={emailSubject}
                onChange={e => handleEmailChange('emailSubject', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Greeting</label>
              <input
                type="text"
                value={emailGreeting}
                onChange={e => handleEmailChange('emailGreeting', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Hi {{customerName}},"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
              <textarea
                value={emailBody}
                onChange={e => handleEmailChange('emailBody', e.target.value)}
                rows={4}
                className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Main message content..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Use blank lines to create paragraphs
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Closing</label>
              <input
                type="text"
                value={emailClosing}
                onChange={e => handleEmailChange('emailClosing', e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="If you have any questions..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature</label>
                <input
                  type="text"
                  value={emailSignature}
                  onChange={e => handleEmailChange('emailSignature', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="{{dealershipName}}"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
                <input
                  type="text"
                  value={emailCtaText}
                  onChange={e => handleEmailChange('emailCtaText', e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="View Health Check"
                />
              </div>
            </div>
          </div>

          {/* Email Preview */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Preview</h3>
            <div className="border border-gray-200 rounded-none bg-gray-50 overflow-hidden">
              <div className="p-2 bg-gray-100 border-b border-gray-200 text-sm">
                <strong>Subject:</strong> {emailPreview?.subject || 'Loading...'}
              </div>
              <div className="h-96 overflow-auto">
                {emailPreview?.html ? (
                  <iframe
                    srcDoc={emailPreview.html}
                    className="w-full h-full border-0"
                    title="Email Preview"
                  />
                ) : (
                  <div className="p-4 text-gray-500">Loading preview...</div>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              RAG summary, repair items, and button are automatically added by the system
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
