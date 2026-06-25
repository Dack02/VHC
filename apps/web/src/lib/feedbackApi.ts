/**
 * Client helpers for the in-app feedback feature. Create uses multipart (for
 * screenshots) so it bypasses the JSON `api()` helper; the rest reuse it.
 */

import { api, getActiveOrgId } from './api'
import type { FeedbackTicket, FeedbackType, FeedbackPriority, FeedbackDiagnostics } from './feedbackTypes'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

export interface CreateFeedbackInput {
  type: FeedbackType
  subject: string
  description: string
  priority: FeedbackPriority
  diagnostics: FeedbackDiagnostics
  sourceApp: 'web' | 'mobile'
  screenshots: Blob[]
}

export async function createFeedback(token: string, input: CreateFeedbackInput): Promise<FeedbackTicket> {
  const form = new FormData()
  form.append('type', input.type)
  form.append('subject', input.subject)
  form.append('description', input.description)
  form.append('priority', input.priority)
  form.append('sourceApp', input.sourceApp)
  form.append('diagnostics', JSON.stringify(input.diagnostics))
  input.screenshots.forEach((blob, i) => form.append('files', blob, `screenshot-${i + 1}.jpg`))

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  const orgId = getActiveOrgId()
  if (orgId) headers['X-Organization-Id'] = orgId
  // NB: do NOT set Content-Type — the browser adds the multipart boundary.

  const res = await fetch(`${API_URL}/api/v1/feedback`, { method: 'POST', headers, body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || 'Failed to submit feedback')
  }
  const data = (await res.json()) as { ticket: FeedbackTicket }
  return data.ticket
}

export async function listMyFeedback(token: string): Promise<FeedbackTicket[]> {
  const data = await api<{ tickets: FeedbackTicket[] }>('/api/v1/feedback', { token })
  return data.tickets
}

export async function getFeedback(token: string, id: string): Promise<FeedbackTicket> {
  const data = await api<{ ticket: FeedbackTicket }>(`/api/v1/feedback/${id}`, { token })
  return data.ticket
}

export async function addFeedbackComment(token: string, id: string, body: string): Promise<void> {
  await api(`/api/v1/feedback/${id}/comments`, { method: 'POST', token, body: { body } })
}
