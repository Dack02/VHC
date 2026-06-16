/**
 * In-app feedback widget. Two tabs:
 *  - New feedback: pick type (Bug / Feature request / Question), describe it,
 *    attach screenshots (1-click html2canvas capture, drag/drop, paste, upload)
 *    with optional annotation, then submit. Auto-diagnostics ride along silently.
 *  - My feedback: the reporter's tickets with live status + the dev thread, and
 *    a reply box that syncs back up to Ollo Dev.
 *
 * The whole widget carries data-feedback-ignore so it never appears in captures.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedbackTicket, FeedbackType, FeedbackPriority } from '../../lib/feedbackTypes'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useSocket, WS_EVENTS } from '../../contexts/SocketContext'
import { collectDiagnostics } from '../../lib/diagnostics'
import { createFeedback, listMyFeedback, getFeedback, addFeedbackComment } from '../../lib/feedbackApi'
import ScreenshotAnnotator from './ScreenshotAnnotator'

type Tab = 'new' | 'mine'
interface Shot { id: string; dataUrl: string }

const TYPE_OPTIONS: Array<{ value: FeedbackType; label: string }> = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature request' },
  { value: 'question', label: 'Question' },
]

const STATUS_LABEL: Record<string, string> = {
  open: 'New', pending: 'Pending', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed',
}
const STATUS_CLASS: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700',
  pending: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-rag-amber text-white',
  resolved: 'bg-rag-green text-white',
  closed: 'bg-gray-200 text-gray-600',
}
const MAX_SHOTS = 10

function uid(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function FeedbackWidget({ onClose }: { onClose: () => void }) {
  const { session } = useAuth()
  const toast = useToast()
  const { socket } = useSocket()
  const token = session?.accessToken || ''

  const [tab, setTab] = useState<Tab>('new')

  // New-feedback form
  const [type, setType] = useState<FeedbackType>('bug')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<FeedbackPriority>('normal')
  const [shots, setShots] = useState<Shot[]>([])
  const [annotatingId, setAnnotatingId] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // My-feedback tracker
  const [tickets, setTickets] = useState<FeedbackTicket[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<FeedbackTicket | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [reply, setReply] = useState('')
  const [sendingReply, setSendingReply] = useState(false)

  const addShot = useCallback((dataUrl: string) => {
    setShots((prev) => (prev.length >= MAX_SHOTS ? prev : [...prev, { id: uid(), dataUrl }]))
  }, [])

  // Esc closes the widget (but not while annotating — that has its own cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !annotatingId) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, annotatingId])

  // Paste-from-clipboard image support while the widget is open.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) addShot(await fileToDataUrl(file))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addShot])

  const loadList = useCallback(async () => {
    if (!token) return
    setLoadingList(true)
    try {
      setTickets(await listMyFeedback(token))
    } catch {
      /* non-fatal */
    } finally {
      setLoadingList(false)
    }
  }, [token])

  // Load + poll the tracker list while the "mine" tab is open (no detail view).
  useEffect(() => {
    if (tab !== 'mine' || selectedId) return
    loadList()
    const t = setInterval(loadList, 20000)
    return () => clearInterval(t)
  }, [tab, selectedId, loadList])

  // Load a ticket's thread when selected.
  useEffect(() => {
    if (!selectedId || !token) return
    let active = true
    setLoadingDetail(true)
    getFeedback(token, selectedId)
      .then((t) => { if (active) setDetail(t) })
      .catch(() => { if (active) toast.error('Could not load that report') })
      .finally(() => { if (active) setLoadingDetail(false) })
    return () => { active = false }
  }, [selectedId, token, toast])

  // Live updates pushed from Ollo Dev (status change / dev reply).
  useEffect(() => {
    if (!socket) return
    const handler = (data: { feedbackId?: string }) => {
      if (tab === 'mine' && !selectedId) loadList()
      if (selectedId && data?.feedbackId === selectedId && token) {
        getFeedback(token, selectedId).then(setDetail).catch(() => {})
      }
    }
    socket.on(WS_EVENTS.FEEDBACK_UPDATED, handler)
    return () => { socket.off(WS_EVENTS.FEEDBACK_UPDATED, handler) }
  }, [socket, tab, selectedId, token, loadList])

  async function captureScreen() {
    setCapturing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        backgroundColor: '#ffffff',
        scale: Math.min(window.devicePixelRatio || 1, 1.5),
        // Exclude the widget itself (and its launcher) from the snapshot.
        ignoreElements: (el) => (el as HTMLElement).dataset?.feedbackIgnore === 'true',
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
      })
      addShot(canvas.toDataURL('image/jpeg', 0.85))
    } catch {
      toast.error('Could not capture the screen — try uploading instead')
    } finally {
      setCapturing(false)
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files) return
    for (const file of [...files]) {
      if (file.type.startsWith('image/')) addShot(await fileToDataUrl(file))
    }
  }

  async function submit() {
    if (!subject.trim()) { toast.error('Please add a subject'); return }
    if (!token) { toast.error('You must be signed in'); return }
    setSubmitting(true)
    try {
      await createFeedback(token, {
        type,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        diagnostics: collectDiagnostics(),
        sourceApp: 'web',
        screenshots: shots.map((s) => dataUrlToBlob(s.dataUrl)),
      })
      toast.success("Thanks! Your feedback has been received — we'll keep you posted.")
      setSubject(''); setDescription(''); setType('bug'); setPriority('normal'); setShots([])
      setTab('mine')
      loadList()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  async function sendReply() {
    if (!reply.trim() || !selectedId || !token) return
    setSendingReply(true)
    try {
      await addFeedbackComment(token, selectedId, reply.trim())
      setReply('')
      setDetail(await getFeedback(token, selectedId))
    } catch {
      toast.error('Failed to send your reply')
    } finally {
      setSendingReply(false)
    }
  }

  const annotating = shots.find((s) => s.id === annotatingId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end p-0 sm:items-center sm:justify-center sm:p-4"
      data-feedback-ignore="true"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:h-[80vh] sm:rounded-xl">
        {/* Header + tabs */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Feedback</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex border-b border-gray-200 px-5">
          {(['new', 'mine'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelectedId(null); setDetail(null) }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'new' ? 'New feedback' : 'My feedback'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'new' ? (
            <div className="space-y-4">
              {/* Type */}
              <div className="flex gap-2">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setType(opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      type === opt.value ? 'border-primary bg-primary/5 text-primary' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Short summary"
                  maxLength={200}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Details</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="What happened? What did you expect?"
                  className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as FeedbackPriority)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Screenshots */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files) }}
                className="rounded-lg border border-dashed border-gray-300 p-3"
              >
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    onClick={captureScreen}
                    disabled={capturing || shots.length >= MAX_SHOTS}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {capturing ? 'Capturing…' : 'Capture screen'}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={shots.length >= MAX_SHOTS}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                  >
                    Upload
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
                  />
                  <span className="self-center text-xs text-gray-400">or drag &amp; drop / paste</span>
                </div>

                {shots.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {shots.map((s) => (
                      <div key={s.id} className="group relative h-20 w-28 overflow-hidden rounded border border-gray-200">
                        <img src={s.dataUrl} alt="screenshot" className="h-full w-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition group-hover:opacity-100">
                          <button onClick={() => setAnnotatingId(s.id)} className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-gray-800">Annotate</button>
                          <button onClick={() => setShots((p) => p.filter((x) => x.id !== s.id))} className="rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-red-600">Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-400">
                We automatically include your current page, app version and device to help us reproduce the issue.
              </p>
            </div>
          ) : selectedId ? (
            /* Thread detail */
            <div>
              <button onClick={() => { setSelectedId(null); setDetail(null) }} className="mb-3 text-sm text-primary hover:underline">
                ← Back to my feedback
              </button>
              {loadingDetail || !detail ? (
                <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[detail.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABEL[detail.status] || detail.status}
                      </span>
                      <span className="text-xs uppercase tracking-wide text-gray-400">{detail.type}</span>
                    </div>
                    <h3 className="text-base font-semibold text-gray-900">{detail.subject}</h3>
                    {detail.description && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{detail.description}</p>}
                  </div>

                  {detail.attachments && detail.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {detail.attachments.map((a) => (
                        <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="h-16 w-24 overflow-hidden rounded border border-gray-200">
                          <img src={a.url} alt="attachment" className="h-full w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    {(detail.comments || []).map((cm) => (
                      <div key={cm.id} className={`flex ${cm.authorType === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${cm.authorType === 'user' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800'}`}>
                          {cm.authorType === 'dev' && <div className="mb-0.5 text-xs font-medium opacity-70">{cm.authorName || 'Support'}</div>}
                          <div className="whitespace-pre-wrap">{cm.body}</div>
                        </div>
                      </div>
                    ))}
                    {(detail.comments || []).length === 0 && (
                      <p className="text-center text-xs text-gray-400">No replies yet.</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendReply() }}
                      placeholder="Reply…"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={sendReply}
                      disabled={sendingReply || !reply.trim()}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Tracker list */
            <div>
              {loadingList && tickets.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
              ) : tickets.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">No feedback yet. Use the New feedback tab to report something.</div>
              ) : (
                <div className="space-y-2">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-200 p-3 text-left hover:border-primary/40 hover:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900">{t.subject}</div>
                        <div className="mt-0.5 text-xs text-gray-400">
                          {new Date(t.createdAt).toLocaleDateString()} · {t.type}
                          {t.syncState === 'failed' && <span className="ml-1 text-yellow-600">· sending…</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status] || 'bg-gray-100 text-gray-700'}`}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer (only on the new-feedback tab) */}
        {tab === 'new' && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              onClick={submit}
              disabled={submitting || !subject.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        )}
      </div>

      {annotating && (
        <ScreenshotAnnotator
          imageUrl={annotating.dataUrl}
          onCancel={() => setAnnotatingId(null)}
          onSave={(dataUrl) => {
            setShots((prev) => prev.map((s) => (s.id === annotating.id ? { ...s, dataUrl } : s)))
            setAnnotatingId(null)
          }}
        />
      )}
    </div>
  )
}
