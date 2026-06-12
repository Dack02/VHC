import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { api } from '../../lib/api'

type NotesView = 'unactioned' | 'actioned' | 'all'

interface NotesListItem {
  id: string
  content: string
  isPinned: boolean
  advisorAttention: boolean
  actionedAt: string | null
  actionedBy: { id: string; first_name: string; last_name: string } | null
  createdAt: string
  user: { id: string; first_name: string; last_name: string; role?: string } | null
  healthCheckId: string
  healthCheck: {
    status: string
    jobsheetNumber: string | null
    vehicle: { registration: string; make: string | null; model: string | null } | null
    customer: { first_name: string; last_name: string } | null
  } | null
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  org_admin: 'Admin',
  site_admin: 'Site Admin',
  service_advisor: 'Advisor',
  technician: 'Tech'
}

const VIEW_TABS: { id: NotesView; label: string }[] = [
  { id: 'unactioned', label: 'Needs action' },
  { id: 'actioned', label: 'Actioned' },
  { id: 'all', label: 'All notes' }
]

export default function NotesPage() {
  const { session, user } = useAuth()
  const toast = useToast()
  const { on, off } = useSocket()
  const token = session?.accessToken

  const [view, setView] = useState<NotesView>('unactioned')
  const [notes, setNotes] = useState<NotesListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [unactionedCount, setUnactionedCount] = useState<number | null>(null)

  const fetchNotes = useCallback(async (silent = false) => {
    if (!token) return
    if (!silent) setLoading(true)
    try {
      const data = await api<{ notes: NotesListItem[] }>(
        `/api/v1/workshop-board/notes?view=${view}`,
        { token }
      )
      setNotes(data.notes)
      if (view === 'unactioned') setUnactionedCount(data.notes.length)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load notes')
    } finally {
      setLoading(false)
    }
  }, [token, view, toast])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  // Keep the count chip fresh even when browsing other tabs
  const fetchUnactionedCount = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ count: number }>('/api/v1/workshop-board/notes/attention-count', { token })
      setUnactionedCount(data.count)
    } catch {
      // chip is cosmetic
    }
  }, [token])

  useEffect(() => {
    fetchUnactionedCount()
  }, [fetchUnactionedCount])

  // Live refresh when notes change anywhere on the site's board
  useEffect(() => {
    const handleBoardUpdated = (payload: { reason?: string }) => {
      if (payload?.reason?.startsWith('note_')) {
        fetchNotes(true)
        fetchUnactionedCount()
      }
    }
    on(WS_EVENTS.WORKSHOP_BOARD_UPDATED, handleBoardUpdated)
    return () => {
      off(WS_EVENTS.WORKSHOP_BOARD_UPDATED, handleBoardUpdated as any)
    }
  }, [on, off, fetchNotes, fetchUnactionedCount])

  const setActioned = async (note: NotesListItem, actioned: boolean) => {
    if (!token) return
    // Optimistic: on the work-queue tab the row leaves the list immediately
    const before = notes
    if (view === 'unactioned' && actioned) {
      setNotes(prev => prev.filter(n => n.id !== note.id))
      setUnactionedCount(prev => (prev != null ? Math.max(0, prev - 1) : prev))
    } else {
      setNotes(prev =>
        prev.map(n =>
          n.id === note.id
            ? {
                ...n,
                actionedAt: actioned ? new Date().toISOString() : null,
                actionedBy: actioned && user
                  ? { id: user.id, first_name: user.firstName, last_name: user.lastName }
                  : null
              }
            : n
        )
      )
    }
    try {
      await api(`/api/v1/workshop-board/cards/${note.healthCheckId}/notes/${note.id}`, {
        method: 'PATCH',
        token,
        body: { actioned }
      })
    } catch (err) {
      setNotes(before)
      toast.error(err instanceof Error ? err.message : 'Failed to update note')
    }
  }

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Notes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Workshop notes across {user?.site?.name || 'all sites'} — advisor-attention notes stay red until someone confirms they've been seen.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
        {VIEW_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px ${
              view === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.id === 'unactioned' && unactionedCount != null && unactionedCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-red-500 text-white">
                {unactionedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-10 text-center">
          {view === 'unactioned' ? (
            <>
              <svg className="w-12 h-12 mx-auto mb-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium text-gray-900">All caught up</p>
              <p className="text-sm text-gray-500 mt-1">No notes waiting for advisor attention.</p>
            </>
          ) : (
            <p className="text-sm text-gray-500">No notes here yet.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map(note => {
            const isRed = note.advisorAttention && !note.actionedAt
            const roleLabel = note.user?.role ? ROLE_LABELS[note.user.role] : null
            const vehicle = note.healthCheck?.vehicle
            const customer = note.healthCheck?.customer
            return (
              <li
                key={note.id}
                className={`bg-white border rounded-xl shadow-sm p-4 ${
                  isRed ? 'border-red-300 border-l-4 border-l-red-500' : 'border-gray-200'
                }`}
              >
                {/* Job context row */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className="font-bold text-gray-900">{vehicle?.registration || 'No reg'}</span>
                    <span className="text-gray-500">
                      {[vehicle?.make, vehicle?.model].filter(Boolean).join(' ')}
                    </span>
                    {customer && (
                      <span className="text-gray-400">· {customer.first_name} {customer.last_name}</span>
                    )}
                    {note.healthCheck?.jobsheetNumber && (
                      <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        JS {note.healthCheck.jobsheetNumber}
                      </span>
                    )}
                  </div>
                  {isRed && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 flex-shrink-0">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 11.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
                      </svg>
                      Advisor attention
                    </span>
                  )}
                </div>

                {/* Note */}
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                <p className="text-xs text-gray-400 mt-1.5">
                  <span className="font-medium text-gray-500">
                    {note.user ? `${note.user.first_name} ${note.user.last_name}` : 'Unknown'}
                  </span>
                  {roleLabel && (
                    <span className="ml-1.5 px-1.5 py-px rounded-full bg-gray-200 text-gray-500 text-[10px] font-medium">
                      {roleLabel}
                    </span>
                  )}
                  <span className="ml-1.5">{formatDateTime(note.createdAt)}</span>
                </p>
                {note.advisorAttention && note.actionedAt && (
                  <p className="flex items-center gap-1 text-xs text-green-700 mt-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Seen by {note.actionedBy ? `${note.actionedBy.first_name} ${note.actionedBy.last_name}` : 'staff'} · {formatDateTime(note.actionedAt)}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <Link
                    to={`/health-checks/${note.healthCheckId}?tab=notes`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Open health check →
                  </Link>
                  {isRed ? (
                    <button
                      onClick={() => setActioned(note, true)}
                      className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
                    >
                      Mark actioned
                    </button>
                  ) : note.advisorAttention && note.actionedAt ? (
                    <button
                      onClick={() => setActioned(note, false)}
                      className="text-xs text-gray-400 hover:text-gray-600 underline"
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
