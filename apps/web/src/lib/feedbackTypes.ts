/**
 * Feedback types for the web app. Mirrors the canonical definitions in
 * packages/shared (vhc-shared/types); kept local because the web app resolves
 * its types locally rather than depending on the shared package.
 */

export type FeedbackType = 'bug' | 'feature' | 'question'
export type FeedbackPriority = 'low' | 'normal' | 'high' | 'urgent'
export type FeedbackStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed'
export type FeedbackSyncState = 'pending' | 'synced' | 'failed'
export type FeedbackCommentAuthor = 'user' | 'dev'
export type FeedbackCommentOrigin = 'inspect' | 'ollo_dev'

export interface FeedbackConsoleError {
  level: string
  message: string
  ts: string
}

export interface FeedbackDiagnostics {
  route?: string
  url?: string
  appVersion?: string
  build?: string
  browser?: string
  device?: string
  viewport?: string
  consoleErrors?: FeedbackConsoleError[]
  timestamp?: string
  timezone?: string
}

export interface FeedbackAttachment {
  id: string
  url: string
  contentType: string
  width?: number | null
  height?: number | null
}

export interface FeedbackComment {
  id: string
  authorType: FeedbackCommentAuthor
  authorName: string | null
  body: string
  origin: FeedbackCommentOrigin
  createdAt: string
}

export interface FeedbackTicket {
  id: string
  type: FeedbackType
  subject: string
  description: string
  priority: FeedbackPriority
  status: FeedbackStatus
  syncState: FeedbackSyncState
  olloDevTicketId: string | null
  sourceApp: 'web' | 'mobile'
  createdAt: string
  updatedAt: string
  attachments?: FeedbackAttachment[]
  comments?: FeedbackComment[]
  commentCount?: number
}
