import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { formatNumber } from '../Reports/utils/formatters'

// ---------------------------------------------------------------------------
// API contract (GET /api/v1/social-media/profiles)
// ---------------------------------------------------------------------------
interface ProfileAccount {
  id: string
  platform: string
  displayName: string | null
  handle: string | null
  avatarUrl: string | null
  followers: number
  status: string
}

interface Profile {
  id: string
  name: string
  color: string | null
  isDefault: boolean
  status: string
  lastSyncedAt: string | null
  accountCount: number
  accounts: ProfileAccount[]
}

// Platform brand colours + labels. Keep in sync with SocialOverview.tsx.
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn',
  googlebusiness: 'Google Business', twitter: 'X', youtube: 'YouTube', pinterest: 'Pinterest', threads: 'Threads',
}
const PLATFORM_COLOR: Record<string, string> = {
  facebook: '#1877F2', instagram: '#E1306C', tiktok: '#000000', linkedin: '#0A66C2',
  googlebusiness: '#4285F4', youtube: '#FF0000', twitter: '#000000', pinterest: '#E60023', threads: '#000000',
}

// Platforms a card can connect into (the contract's allowed set).
const CONNECTABLE: { key: string; label: string }[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'googlebusiness', label: 'Google Business' },
]

// Swatch options for the new-profile colour picker.
const COLOR_SWATCHES = ['#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#0EA5E9', '#16191F']
const DEFAULT_COLOR = COLOR_SWATCHES[0]

function platformColor(platform: string): string {
  return PLATFORM_COLOR[platform] || '#6B7280'
}

// Small uppercase initial for an avatar fallback.
function initialOf(account: ProfileAccount): string {
  const src = account.displayName || account.handle || account.platform || '?'
  return src.trim().charAt(0).toUpperCase() || '?'
}

function relativeSync(iso: string | null): string {
  if (!iso) return 'never synced'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never synced'
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'synced just now'
  if (mins < 60) return `synced ${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `synced ${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `synced ${days}d ago`
}

// status pill copy/colour, tolerant of whatever the API sends.
function statusPill(status: string): { label: string; cls: string } {
  switch (status) {
    case 'connected':
      return { label: 'Connected', cls: 'bg-green-50 text-green-700 border-green-200' }
    case 'needs_reconnect':
    case 'reconnect':
    case 'expired':
      return { label: 'Needs reconnect', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'error':
      return { label: 'Error', cls: 'bg-red-50 text-red-700 border-red-200' }
    case 'pending':
      return { label: 'Pending', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
    default:
      return { label: status ? status.replace(/_/g, ' ') : 'Unknown', cls: 'bg-gray-50 text-gray-500 border-gray-200' }
  }
}

// ---------------------------------------------------------------------------
// Platform glyph badge — a small coloured square with the platform initial.
// ---------------------------------------------------------------------------
function PlatformBadge({ platform, className = '' }: { platform: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md text-[9px] font-bold text-white ${className}`}
      style={{ backgroundColor: platformColor(platform) }}
      title={PLATFORM_LABEL[platform] || platform}
    >
      {(PLATFORM_LABEL[platform] || platform).charAt(0)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Account chip — avatar (or coloured initial fallback) + platform badge + name.
// ---------------------------------------------------------------------------
function AccountChip({ account }: { account: ProfileAccount }) {
  const [broken, setBroken] = useState(false)
  const color = platformColor(account.platform)
  const name = account.displayName || account.handle || PLATFORM_LABEL[account.platform] || account.platform
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <div className="relative shrink-0">
        {account.avatarUrl && !broken ? (
          <img
            src={account.avatarUrl}
            alt={name}
            onError={() => setBroken(true)}
            className="h-9 w-9 rounded-full object-cover ring-1 ring-gray-200"
          />
        ) : (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-black/5"
            style={{ backgroundColor: color }}
          >
            {initialOf(account)}
          </div>
        )}
        <PlatformBadge platform={account.platform} className="absolute -bottom-1 -right-1 h-4 w-4 ring-2 ring-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">{name}</div>
        <div className="truncate text-xs text-gray-400">
          {PLATFORM_LABEL[account.platform] || account.platform}
          {account.handle ? ` · @${account.handle}` : ''}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums text-gray-900">{formatNumber(account.followers || 0)}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400">followers</div>
      </div>
    </div>
  )
}

export default function SocialProfiles() {
  const { session } = useAuth()
  const token = session?.accessToken

  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [showNewModal, setShowNewModal] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const fetchProfiles = useCallback(async () => {
    if (!token) return
    try {
      const res = await api<{ profiles: Profile[] }>('/api/v1/social-media/profiles', { token })
      setProfiles(res.profiles || [])
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load profiles' })
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchProfiles() }, [fetchProfiles])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setMessage(null)
    try { await fn() } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Something went wrong' })
    } finally { setBusy(null) }
  }

  const syncNow = () => run('sync', async () => {
    await api('/api/v1/social-media/sync', { method: 'POST', token })
    setMessage({ type: 'success', text: 'Sync started — fresh data will appear shortly.' })
  })

  const connect = (profileId: string, platform: string) => run(`connect:${profileId}:${platform}`, async () => {
    const res = await api<{ authUrl: string }>(
      `/api/v1/social-media/profiles/${profileId}/connect/${platform}/url?redirectUrl=${encodeURIComponent(window.location.href)}`,
      { token }
    )
    window.location.href = res.authUrl
  })

  const createProfile = (name: string, color: string) => run('create', async () => {
    await api<{ profile: Profile }>('/api/v1/social-media/profiles', { method: 'POST', body: { name, color }, token })
    setShowNewModal(false)
    setMessage({ type: 'success', text: 'Profile created. Connect an account to start tracking it.' })
    await fetchProfiles()
  })

  const renameProfile = (profileId: string, name: string) => run(`rename:${profileId}`, async () => {
    await api(`/api/v1/social-media/profiles/${profileId}`, { method: 'PATCH', body: { name }, token })
    setEditing(null)
    await fetchProfiles()
  })

  const deleteProfile = (profileId: string, name: string) => run(`delete:${profileId}`, async () => {
    if (!window.confirm(`Delete profile "${name}"? Its linked accounts will be unlinked. This can't be undone.`)) return
    await api(`/api/v1/social-media/profiles/${profileId}`, { method: 'DELETE', token })
    setMenuOpen(null)
    setMessage({ type: 'success', text: 'Profile deleted.' })
    await fetchProfiles()
  })

  const startEdit = (p: Profile) => { setEditing(p.id); setEditName(p.name); setMenuOpen(null) }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
  }

  const list = profiles || []

  return (
    <div onClick={() => { setMenuOpen(null); setConnectOpen(null) }}>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="max-w-2xl">
          <h1 className="text-lg font-semibold text-gray-900">Profiles</h1>
          <p className="text-sm text-gray-500 mt-1">
            A profile is a brand or workspace. Link a Facebook page, Instagram, TikTok, LinkedIn or Google Business
            account to each one — then deep-dive any profile from the Overview.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); syncNow() }}
            disabled={busy === 'sync'}
            className="h-[42px] rounded-[10px] border border-[#d7dbe0] bg-white px-4 text-[14px] font-semibold text-[#3a3f4a] hover:bg-[#f6f7f9] disabled:opacity-50"
          >
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewModal(true) }}
            className="h-[42px] rounded-[10px] bg-[#16191f] px-[18px] text-[14px] font-bold text-white hover:bg-black"
          >
            + New profile
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-5 rounded-lg border px-4 py-2 text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Empty state */}
      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6-4a3 3 0 11-3-3M5 11a3 3 0 11-3-3" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">Create your first profile</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Group your social accounts by brand or page. Each Facebook page gets its own profile so its analytics stay clean.
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); setShowNewModal(true) }}
            className="mt-5 inline-flex h-[42px] items-center rounded-[10px] bg-[#16191f] px-[18px] text-[14px] font-bold text-white hover:bg-black"
          >
            + New profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const accent = p.color || DEFAULT_COLOR
            const totalFollowers = p.accounts.reduce((sum, a) => sum + (a.followers || 0), 0)
            const pill = statusPill(p.status)
            const connectId = `${p.id}`
            return (
              <div
                key={p.id}
                className="group relative flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Colour accent strip */}
                <div className="h-1.5 w-full rounded-t-xl" style={{ backgroundColor: accent }} />

                <div className="flex flex-col gap-4 p-5">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: accent }} />
                      {editing === p.id ? (
                        <form
                          onSubmit={(e) => { e.preventDefault(); if (editName.trim()) renameProfile(p.id, editName.trim()) }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
                            className="h-8 w-40 rounded-[8px] border border-[#e4e7ec] px-2.5 text-sm text-[#16191f] focus:border-[#16191f] focus:outline-none focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]"
                          />
                          <button type="submit" disabled={busy === `rename:${p.id}`} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">Save</button>
                          <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h3 className="truncate text-base font-semibold text-gray-900">{p.name}</h3>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEdit(p) }}
                            title="Rename profile"
                            className="text-gray-300 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                        </div>
                      )}
                      {p.isDefault && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Default</span>
                      )}
                    </div>

                    {/* ⋯ menu */}
                    <div className="relative shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === p.id ? null : p.id); setConnectOpen(null) }}
                        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="More"
                      >
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4zm0 6a2 2 0 100-4 2 2 0 000 4z" /></svg>
                      </button>
                      {menuOpen === p.id && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <button onClick={() => startEdit(p)} className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">Rename</button>
                          <button
                            onClick={() => deleteProfile(p.id, p.name)}
                            disabled={busy === `delete:${p.id}`}
                            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {busy === `delete:${p.id}` ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Total followers headline */}
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-bold tabular-nums text-gray-900">{formatNumber(totalFollowers)}</div>
                      <div className="text-xs text-gray-400">total followers · {p.accountCount} account{p.accountCount === 1 ? '' : 's'}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${pill.cls}`}>{pill.label}</span>
                  </div>

                  {/* Accounts */}
                  <div className="rounded-lg border border-gray-100 bg-gray-50/40 p-1.5">
                    {p.accounts.length > 0 ? (
                      <div className="divide-y divide-gray-100">
                        {p.accounts.map((a) => <AccountChip key={a.id} account={a} />)}
                      </div>
                    ) : (
                      <div className="px-3 py-4 text-center text-xs text-gray-400">
                        No accounts linked yet — connect one below.
                      </div>
                    )}
                  </div>

                  {/* Footer: connect + last synced */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setConnectOpen(connectOpen === connectId ? null : connectId); setMenuOpen(null) }}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <span className="text-base leading-none">+</span> Connect
                      </button>
                      {connectOpen === connectId && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute bottom-10 left-0 z-20 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">Connect a platform</div>
                          {CONNECTABLE.map((c) => {
                            const label = busy === `connect:${p.id}:${c.key}` ? 'Opening…' : c.label
                            return (
                              <button
                                key={c.key}
                                onClick={() => connect(p.id, c.key)}
                                disabled={busy === `connect:${p.id}:${c.key}`}
                                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <PlatformBadge platform={c.key} className="h-5 w-5 text-[10px]" />
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">{relativeSync(p.lastSyncedAt)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNewModal && (
        <NewProfileModal
          busy={busy === 'create'}
          onClose={() => setShowNewModal(false)}
          onCreate={createProfile}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// New-profile modal — follows docs/form-design-guidelines.md tokens.
// ---------------------------------------------------------------------------
function NewProfileModal({
  busy, onClose, onCreate,
}: {
  busy: boolean
  onClose: () => void
  onCreate: (name: string, color: string) => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const nameError = touched && !name.trim()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!name.trim()) return
    onCreate(name.trim(), color)
  }

  const inputCls =
    'h-[42px] w-full box-border rounded-[10px] border bg-white px-[14px] text-[15px] text-[#16191f] ' +
    'placeholder:text-[#aeb4be] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,20,28,0.45)] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New profile"
        className="flex w-[460px] max-w-full flex-col overflow-hidden rounded-[18px] border border-[rgba(16,20,28,0.05)] bg-white shadow-[0_28px_70px_-24px_rgba(16,20,28,0.34),0_8px_24px_-14px_rgba(16,20,28,0.18)]"
      >
        <form onSubmit={submit}>
          {/* Header */}
          <div className="border-b border-[#eef0f3] px-[30px] pb-5 pt-[22px]">
            <h2 className="text-[19px] font-bold tracking-[-0.015em] text-[#16191f]">New profile</h2>
            <p className="mt-1 text-[13px] text-[#8a909c]">A profile groups the social accounts for one brand or page.</p>
          </div>

          {/* Body */}
          <div className="px-[30px] py-[22px]">
            <div className="mb-5">
              <label className="mb-1.5 block text-[13px] font-semibold text-[#3a3f4a]">
                Profile name<span className="text-[#d23f3f]"> *</span>
              </label>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="e.g. Central Garage — Main Page"
                className={`${inputCls} ${nameError ? 'border-[#d23f3f]' : 'border-[#e4e7ec]'}`}
              />
              {nameError && <p className="mt-1 text-[12.5px] text-[#d23f3f]">A name is required.</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-[#3a3f4a]">
                Accent colour<span className="font-medium text-[#aeb4be]"> · optional</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    title={c}
                    className={`h-8 w-8 rounded-full ring-offset-2 transition ${color === c ? 'ring-2 ring-[#16191f]' : 'ring-1 ring-black/10 hover:ring-black/30'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#eef0f3] bg-[#fafbfc] px-[30px] py-4">
            <span className="text-[12.5px] text-[#9aa0ab]">* Required fields</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-[42px] rounded-[10px] border border-[#d7dbe0] bg-white px-5 text-[14px] font-semibold text-[#3a3f4a] hover:bg-[#f6f7f9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-[42px] rounded-[10px] bg-[#16191f] px-[22px] text-[14px] font-bold text-white hover:bg-black disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create profile'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
