/**
 * ReasonSubmissions - Review pending reason submissions from technicians
 * Phase 6: Admin UI - Submissions Review
 */

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Submission {
  id: string
  templateItemId: string | null
  templateItemName: string | null
  reasonType: string | null
  reasonText: string
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  submittedBy: string
  submittedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  approvedReasonId: string | null
  context: {
    healthCheckId: string
    jobNumber: string
    registration: string
  } | null
}

interface Category {
  id: string
  name: string
  color: string
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export default function ReasonSubmissions() {
  const { session, user } = useAuth()
  const orgId = user?.organization?.id

  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [approveModal, setApproveModal] = useState<{ isOpen: boolean; submission: Submission | null }>({
    isOpen: false,
    submission: null
  })
  const [rejectModal, setRejectModal] = useState<{ isOpen: boolean; submission: Submission | null }>({
    isOpen: false,
    submission: null
  })

  // Counts for tabs
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 })

  useEffect(() => {
    if (orgId) {
      fetchSubmissions()
      fetchCategories()
      fetchCounts()
    }
  }, [orgId, statusFilter])

  const fetchSubmissions = async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : ''
      const data = await api<{ submissions: Submission[]; count: number }>(
        `/api/v1/organizations/${orgId}/reason-submissions${params}`,
        { token: session?.accessToken }
      )
      setSubmissions(data.submissions || [])
    } catch (err) {
      console.error('Failed to fetch submissions:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const data = await api<{ categories: Category[] }>('/api/v1/reason-categories', {
        token: session?.accessToken
      })
      setCategories(data.categories || [])
    } catch (err) {
      console.error('Failed to fetch categories:', err)
    }
  }

  const fetchCounts = async () => {
    if (!orgId) return
    try {
      const [pending, approved, rejected] = await Promise.all([
        api<{ count: number }>(`/api/v1/organizations/${orgId}/reason-submissions/count?status=pending`, { token: session?.accessToken }),
        api<{ count: number }>(`/api/v1/organizations/${orgId}/reason-submissions/count?status=approved`, { token: session?.accessToken }),
        api<{ count: number }>(`/api/v1/organizations/${orgId}/reason-submissions/count?status=rejected`, { token: session?.accessToken })
      ])
      setCounts({
        pending: pending.count,
        approved: approved.count,
        rejected: rejected.count
      })
    } catch (err) {
      console.error('Failed to fetch counts:', err)
    }
  }

  const handleApprove = async (data: {
    submissionId: string
    reasonText: string
    technicalDescription: string
    customerDescription: string
    defaultRag: string
    categoryId: string
    applyToType: boolean
    suggestedFollowUpDays: number | null
    suggestedFollowUpText: string | null
  }) => {
    try {
      await api(`/api/v1/reason-submissions/${data.submissionId}/approve`, {
        method: 'POST',
        body: {
          reasonText: data.reasonText,
          technicalDescription: data.technicalDescription,
          customerDescription: data.customerDescription,
          defaultRag: data.defaultRag,
          categoryId: data.categoryId,
          applyToType: data.applyToType,
          suggestedFollowUpDays: data.suggestedFollowUpDays,
          suggestedFollowUpText: data.suggestedFollowUpText
        },
        token: session?.accessToken
      })
      setApproveModal({ isOpen: false, submission: null })
      fetchSubmissions()
      fetchCounts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    }
  }

  const handleReject = async (submissionId: string, reviewNotes: string) => {
    try {
      await api(`/api/v1/reason-submissions/${submissionId}/reject`, {
        method: 'POST',
        body: { reviewNotes },
        token: session?.accessToken
      })
      setRejectModal({ isOpen: false, submission: null })
      fetchSubmissions()
      fetchCounts()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading && submissions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <SettingsBackLink />
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link to="/settings/reasons" className="hover:text-gray-700">Reason Library</Link>
          <span>/</span>
          <span>Submissions</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Reason Submissions</h1>
        <p className="text-gray-600">Review and approve reasons submitted by technicians</p>
      </div>

      {/* Status Tabs */}
      <div className="mb-6">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              statusFilter === 'pending'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Pending
            {counts.pending > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                {counts.pending}
              </span>
            )}
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              statusFilter === 'approved'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Approved
            {counts.approved > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                {counts.approved}
              </span>
            )}
          </button>
          <button
            onClick={() => setStatusFilter('rejected')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              statusFilter === 'rejected'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Rejected
            {counts.rejected > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                {counts.rejected}
              </span>
            )}
          </button>
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              statusFilter === 'all'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          {statusFilter === 'pending' && 'No pending submissions'}
          {statusFilter === 'approved' && 'No approved submissions'}
          {statusFilter === 'rejected' && 'No rejected submissions'}
          {statusFilter === 'all' && 'No submissions yet'}
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              onApprove={() => setApproveModal({ isOpen: true, submission })}
              onReject={() => setRejectModal({ isOpen: true, submission })}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      {/* Approve Modal */}
      {approveModal.isOpen && approveModal.submission && (
        <ApproveModal
          submission={approveModal.submission}
          categories={categories}
          onApprove={handleApprove}
          onClose={() => setApproveModal({ isOpen: false, submission: null })}
        />
      )}

      {/* Reject Modal */}
      {rejectModal.isOpen && rejectModal.submission && (
        <RejectModal
          submission={rejectModal.submission}
          onReject={handleReject}
          onClose={() => setRejectModal({ isOpen: false, submission: null })}
        />
      )}
    </div>
  )
}

// Submission Card Component
function SubmissionCard({
  submission,
  onApprove,
  onReject,
  formatDate
}: {
  submission: Submission
  onApprove: () => void
  onReject: () => void
  formatDate: (date: string) => string
}) {
  return (
    <div
      className={`bg-white shadow rounded-lg p-4 ${
        submission.status === 'rejected' ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Reason Text */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-medium text-gray-900">
              "{submission.reasonText}"
            </span>
            {submission.status === 'approved' && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded font-medium">
                Approved
              </span>
            )}
            {submission.status === 'rejected' && (
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded font-medium">
                Rejected
              </span>
            )}
          </div>

          {/* Meta Info */}
          <div className="mt-2 text-sm text-gray-600">
            <div className="flex items-center gap-2 flex-wrap">
              <span>
                For: <strong>
                  {submission.reasonType
                    ? `${submission.reasonType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} (all items)`
                    : submission.templateItemName || 'Unknown Item'}
                </strong>
              </span>
              <span className="text-gray-400">|</span>
              <span>By: <strong>{submission.submittedBy}</strong></span>
              <span className="text-gray-400">|</span>
              <span>{formatDate(submission.submittedAt)}</span>
            </div>

            {/* Context with link */}
            {submission.context && (
              <div className="mt-1">
                <span className="text-gray-500">Context: </span>
                <Link
                  to={`/health-checks/${submission.context.healthCheckId}`}
                  className="text-primary hover:underline"
                >
                  VHC for {submission.context.registration}
                </Link>
                <span className="text-gray-500"> (Job #{submission.context.jobNumber})</span>
              </div>
            )}

            {/* Tech Notes */}
            {submission.notes && (
              <div className="mt-2 bg-blue-50 border border-blue-100 p-3 rounded">
                <div className="text-xs font-medium text-blue-700 mb-1">Tech Notes:</div>
                <div className="text-blue-800">"{submission.notes}"</div>
              </div>
            )}

            {/* Review Notes (for rejected) */}
            {submission.status === 'rejected' && submission.reviewNotes && (
              <div className="mt-2 bg-red-50 border border-red-100 p-3 rounded">
                <div className="text-xs font-medium text-red-700 mb-1">
                  Rejection Reason ({submission.reviewedBy && `by ${submission.reviewedBy}`}):
                </div>
                <div className="text-red-800">"{submission.reviewNotes}"</div>
              </div>
            )}

            {/* Approved info with link to reason */}
            {submission.status === 'approved' && (
              <div className="mt-2 bg-green-50 border border-green-100 p-3 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-green-700">
                      Approved {submission.reviewedBy && `by ${submission.reviewedBy}`}
                      {submission.reviewedAt && ` on ${formatDate(submission.reviewedAt)}`}
                    </span>
                  </div>
                  {submission.approvedReasonId && (
                    <Link
                      to={submission.reasonType
                        ? `/settings/reasons/type/${submission.reasonType}`
                        : `/settings/reasons/item/${submission.templateItemId}`}
                      className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1"
                    >
                      View Reason
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {submission.status === 'pending' && (
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={onReject}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Approve
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Approve Modal Component
function ApproveModal({
  submission,
  categories,
  onApprove,
  onClose
}: {
  submission: Submission
  categories: Category[]
  onApprove: (data: {
    submissionId: string
    reasonText: string
    technicalDescription: string
    customerDescription: string
    defaultRag: string
    categoryId: string
    applyToType: boolean
    suggestedFollowUpDays: number | null
    suggestedFollowUpText: string | null
  }) => void
  onClose: () => void
}) {
  const { session } = useAuth()

  const [formData, setFormData] = useState({
    reasonText: submission.reasonText,
    defaultRag: 'amber',
    categoryId: '',
    technicalDescription: '',
    customerDescription: '',
    applyToType: !!submission.reasonType,
    suggestedFollowUpDays: '',
    suggestedFollowUpText: ''
  })
  const [saving, setSaving] = useState(false)
  const [generatingTechnical, setGeneratingTechnical] = useState(false)
  const [generatingCustomer, setGeneratingCustomer] = useState(false)

  const handleGenerateDescription = async (type: 'technical' | 'customer') => {
    const setGenerating = type === 'technical' ? setGeneratingTechnical : setGeneratingCustomer

    setGenerating(true)
    try {
      // Use the AI to generate description based on reason text
      const result = await api<{
        technicalDescription?: string
        customerDescription?: string
      }>('/api/v1/reasons/generate-description', {
        method: 'POST',
        body: {
          reasonText: formData.reasonText,
          type,
          context: submission.reasonType || submission.templateItemName
        },
        token: session?.accessToken
      })

      if (type === 'technical' && result.technicalDescription) {
        setFormData(prev => ({ ...prev, technicalDescription: result.technicalDescription! }))
      } else if (type === 'customer' && result.customerDescription) {
        setFormData(prev => ({ ...prev, customerDescription: result.customerDescription! }))
      }
    } catch (err) {
      // If endpoint doesn't exist, show placeholder text
      if (type === 'technical') {
        setFormData(prev => ({
          ...prev,
          technicalDescription: `Technical assessment: ${formData.reasonText}. This requires further inspection and potential repair.`
        }))
      } else {
        setFormData(prev => ({
          ...prev,
          customerDescription: `We've identified an issue with your vehicle: ${formData.reasonText.toLowerCase()}. We recommend addressing this to ensure your vehicle's safety and reliability.`
        }))
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.technicalDescription || !formData.customerDescription) {
      alert('Please provide both technical and customer descriptions')
      return
    }
    if (!formData.categoryId) {
      alert('Please select a category')
      return
    }

    setSaving(true)
    await onApprove({
      submissionId: submission.id,
      reasonText: formData.reasonText,
      technicalDescription: formData.technicalDescription,
      customerDescription: formData.customerDescription,
      defaultRag: formData.defaultRag,
      categoryId: formData.categoryId,
      applyToType: formData.applyToType,
      suggestedFollowUpDays: formData.suggestedFollowUpDays ? parseInt(formData.suggestedFollowUpDays) : null,
      suggestedFollowUpText: formData.suggestedFollowUpText || null
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Approve Reason Submission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Original Submission Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Original submission:</div>
            <div className="font-medium text-gray-900 mb-2">"{submission.reasonText}"</div>
            <div className="text-sm text-gray-600">
              Submitted by: {submission.submittedBy}
            </div>
            {submission.notes && (
              <div className="mt-2 text-sm text-blue-700 bg-blue-50 p-2 rounded">
                Tech notes: "{submission.notes}"
              </div>
            )}
          </div>

          {/* Scope */}
          {submission.reasonType && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Scope</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={formData.applyToType}
                    onChange={() => setFormData({ ...formData, applyToType: true })}
                    className="text-primary"
                  />
                  <span>Add to ALL {submission.reasonType.replace(/_/g, ' ')} items</span>
                </label>
                {submission.templateItemId && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={!formData.applyToType}
                      onChange={() => setFormData({ ...formData, applyToType: false })}
                      className="text-primary"
                    />
                    <span>Add to {submission.templateItemName} only</span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Reason Text (editable) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason Text (edit if needed)
            </label>
            <input
              type="text"
              value={formData.reasonText}
              onChange={(e) => setFormData({ ...formData, reasonText: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              required
            />
          </div>

          {/* Category and RAG */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                required
              >
                <option value="">Select category...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Status *</label>
              <select
                value={formData.defaultRag}
                onChange={(e) => setFormData({ ...formData, defaultRag: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="red">Red - Safety Critical</option>
                <option value="amber">Amber - Advisory</option>
                <option value="green">Green - Positive</option>
              </select>
            </div>
          </div>

          {/* Technical Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">
                Technical Description *
              </label>
              <button
                type="button"
                onClick={() => handleGenerateDescription('technical')}
                disabled={generatingTechnical}
                className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
              >
                {generatingTechnical ? (
                  <>
                    <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate with AI
                  </>
                )}
              </button>
            </div>
            <textarea
              value={formData.technicalDescription}
              onChange={(e) => setFormData({ ...formData, technicalDescription: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Detailed technical explanation for service advisors..."
              required
            />
          </div>

          {/* Customer Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">
                Customer Description *
              </label>
              <button
                type="button"
                onClick={() => handleGenerateDescription('customer')}
                disabled={generatingCustomer}
                className="text-sm text-purple-600 hover:text-purple-700 flex items-center gap-1"
              >
                {generatingCustomer ? (
                  <>
                    <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate with AI
                  </>
                )}
              </button>
            </div>
            <textarea
              value={formData.customerDescription}
              onChange={(e) => setFormData({ ...formData, customerDescription: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Clear, friendly explanation for customers..."
              required
            />
          </div>

          {/* Follow-up */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Follow-up Suggestion (optional)
            </label>
            <div className="grid grid-cols-2 gap-4">
              <select
                value={formData.suggestedFollowUpDays}
                onChange={(e) => setFormData({ ...formData, suggestedFollowUpDays: e.target.value })}
                className="border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">No follow-up</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </select>
              <input
                type="text"
                value={formData.suggestedFollowUpText}
                onChange={(e) => setFormData({ ...formData, suggestedFollowUpText: e.target.value })}
                placeholder="Custom follow-up text..."
                className="border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Approving...' : 'Approve & Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Reject Modal Component
function RejectModal({
  submission,
  onReject,
  onClose
}: {
  submission: Submission
  onReject: (submissionId: string, reviewNotes: string) => void
  onClose: () => void
}) {
  const [reviewNotes, setReviewNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reviewNotes.trim()) {
      alert('Please provide a reason for rejection')
      return
    }

    setSaving(true)
    await onReject(submission.id, reviewNotes)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Reject Submission</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Original Submission */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Original submission:</div>
            <div className="font-medium text-gray-900">"{submission.reasonText}"</div>
            <div className="text-sm text-gray-600 mt-1">
              Submitted by: {submission.submittedBy}
            </div>
          </div>

          {/* Rejection Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Rejection Reason *
            </label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-md px-3 py-2"
              placeholder="Explain why this submission is being rejected..."
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              This will be visible to the technician who submitted the reason.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !reviewNotes.trim()}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? 'Rejecting...' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
