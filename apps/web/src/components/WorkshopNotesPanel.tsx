import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { api } from '../lib/api'

export interface WorkshopNote {
  id: string
  content: string
  isPinned: boolean
  advisorAttention: boolean
  actionedAt: string | null
  actionedBy: { id: string; first_name: string; last_name: string } | null
  createdAt: string
  user: { id: string; first_name: string; last_name: string; role?: string } | null
}

interface WorkshopNotesPanelProps {
  healthCheckId: string
  /** Notify parent something changed (e.g. board refresh for note previews) */
  onChanged?: () => void
  /** Reports the current note count (for tab badges) */
  onCountChange?: (count: number) => void
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  org_admin: 'Admin',
  site_admin: 'Site Admin',
  service_advisor: 'Advisor',
  technician: 'Tech'
}

const ADMIN_ROLES = ['super_admin', 'org_admin', 'site_admin']

export function needsAdvisorAction(note: Pick<WorkshopNote, 'advisorAttention' | 'actionedAt'>): boolean {
  return note.advisorAttention && !note.actionedAt
}

export default function WorkshopNotesPanel({ healthCheckId, onChanged, onCountChange }: WorkshopNotesPanelProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken

  const [notes, setNotes] = useState<WorkshopNote[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [advisorAttention, setAdvisorAttention] = useState(false)
  const [saving, setSaving] = useState(false)

  const isAdmin = ADMIN_ROLES.includes(user?.role || '')

  useEffect(() => {
    onCountChange?.(notes.length)
  }, [notes.length, onCountChange])

  const fetchNotes = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ notes: WorkshopNote[] }>(
        `/api/v1/workshop-board/cards/${healthCheckId}/notes`,
        { token }
      )
      setNotes(sortNotes(data.notes))
    } catch {
      // Non-fatal - panel still allows adding notes
    } finally {
      setLoading(false)
    }
  }, [token, healthCheckId])

  useEffect(() => {
    setLoading(true)
    fetchNotes()
  }, [fetchNotes])

  // Red (unactioned attention) notes first, then pinned, then newest
  const sortNotes = (list: WorkshopNote[]) =>
    [...list].sort((a, b) => {
      const aRed = needsAdvisorAction(a)
      const bRed = needsAdvisorAction(b)
      if (aRed !== bRed) return aRed ? -1 : 1
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return a.createdAt < b.createdAt ? 1 : -1
    })

  const handleAdd = async () => {
    const content = draft.trim()
    if (!token || !content || saving) return
    setSaving(true)
    try {
      const data = await api<{ note: WorkshopNote }>(
        `/api/v1/workshop-board/cards/${healthCheckId}/notes`,
        { method: 'POST', token, body: { content, advisorAttention } }
      )
      setNotes(prev => sortNotes([data.note, ...prev]))
      setDraft('')
      setAdvisorAttention(false)
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  const patchNote = async (note: WorkshopNote, body: Record<string, unknown>, optimistic: Partial<WorkshopNote>) => {
    if (!token) return
    setNotes(prev => sortNotes(prev.map(n => (n.id === note.id ? { ...n, ...optimistic } : n))))
    try {
      await api(`/api/v1/workshop-board/cards/${healthCheckId}/notes/${note.id}`, {
        method: 'PATCH',
        token,
        body
      })
      onChanged?.()
    } catch (err) {
      setNotes(prev => sortNotes(prev.map(n => (n.id === note.id ? note : n))))
      toast.error(err instanceof Error ? err.message : 'Failed to update note')
    }
  }

  const handleTogglePin = (note: WorkshopNote) =>
    patchNote(note, { isPinned: !note.isPinned }, { isPinned: !note.isPinned })

  const handleMarkActioned = (note: WorkshopNote) =>
    patchNote(
      note,
      { actioned: true },
      {
        actionedAt: new Date().toISOString(),
        actionedBy: user ? { id: user.id, first_name: user.firstName, last_name: user.lastName || '' } : null
      }
    )

  const handleDelete = async (note: WorkshopNote) => {
    if (!token) return
    if (!window.confirm('Delete this note?')) return
    try {
      await api(`/api/v1/workshop-board/cards/${healthCheckId}/notes/${note.id}`, {
        method: 'DELETE',
        token
      })
      setNotes(prev => prev.filter(n => n.id !== note.id))
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete note')
    }
  }

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-3">
      {/* Composer */}
      <div>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleAdd()
            }
          }}
          rows={2}
          maxLength={500}
          placeholder="Add a note… (visible to the whole team)"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <label
            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none px-2 py-1.5 rounded-lg border ${
              advisorAttention
                ? 'bg-red-50 border-red-300 text-red-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
            title="Stays red and counts on the Notes badge until someone confirms it has been seen"
          >
            <input
              type="checkbox"
              checked={advisorAttention}
              onChange={e => setAdvisorAttention(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            Advisor attention
          </label>
          <div className="flex items-center gap-2">
            {draft.length > 400 && (
              <span className="text-xs text-gray-400">{500 - draft.length} left</span>
            )}
            <button
              onClick={handleAdd}
              disabled={saving || !draft.trim()}
              className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
          No notes yet. Anything the team should know about this job?
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map(note => {
            const canDelete = isAdmin || note.user?.id === user?.id
            const roleLabel = note.user?.role ? ROLE_LABELS[note.user.role] : null
            const isRed = needsAdvisorAction(note)
            return (
              <li
                key={note.id}
                className={`group rounded-lg px-3 py-2 border ${
                  isRed
                    ? 'bg-red-50 border-red-300'
                    : note.isPinned
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-gray-50 border-gray-100'
                }`}
              >
                {(isRed || note.isPinned) && (
                  <div className="flex items-center justify-between mb-1">
                    <span className={`flex items-center gap-1 text-[11px] font-semibold ${isRed ? 'text-red-600' : 'text-amber-600'}`}>
                      {isRed ? (
                        <>
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 11.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
                          </svg>
                          Advisor attention
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M16 3a1 1 0 01.117 1.993L16 5v4.764l1.894 3.789A1 1 0 0117 15h-4v6a1 1 0 01-1.993.117L11 21v-6H7a1 1 0 01-.94-1.342l.046-.103L8 9.764V5a1 1 0 01-.117-1.993L8 3h8z" />
                          </svg>
                          Pinned
                        </>
                      )}
                    </span>
                    {isRed && (
                      <button
                        onClick={() => handleMarkActioned(note)}
                        className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700"
                      >
                        Mark actioned
                      </button>
                    )}
                  </div>
                )}
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                {note.advisorAttention && note.actionedAt && (
                  <p className="flex items-center gap-1 text-[11px] text-green-700 mt-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Seen by {note.actionedBy ? `${note.actionedBy.first_name} ${note.actionedBy.last_name}` : 'staff'} · {formatDateTime(note.actionedAt)}
                  </p>
                )}
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-gray-400">
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
                  <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleTogglePin(note)}
                      className={`p-1 rounded hover:bg-gray-200 ${note.isPinned ? 'text-amber-500' : 'text-gray-400'}`}
                      title={note.isPinned ? 'Unpin note' : 'Pin note'}
                    >
                      <svg className="w-3.5 h-3.5" fill={note.isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 4v5l2 4h-5v7l-1 1-1-1v-7H6l2-4V4h8z" />
                      </svg>
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(note)}
                        className="p-1 rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
                        title="Delete note"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
