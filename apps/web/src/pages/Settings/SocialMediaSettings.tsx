import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface SocialAccount {
  id: string
  platform: string
  account_type: string
  display_name: string | null
  handle: string | null
  avatar_url: string | null
  currency: string | null
  status: string
  is_active: boolean
  token_expires_at: string | null
}

interface ConnectionState {
  status: string
  profileLinked: boolean
  keyConfigured: boolean
  syncHour: number
  syncMinute: number
  lastSyncedAt: string | null
  lastError: string | null
}

interface ConnectionResponse {
  connection: ConnectionState
  accounts: SocialAccount[]
  platforms: string[]
}

const PLATFORM_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }

export default function SocialMediaSettings() {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<ConnectionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [zernioProfiles, setZernioProfiles] = useState<{ id: string; name: string; isDefault: boolean; accountCount: number }[] | null>(null)
  const [selectedProfile, setSelectedProfile] = useState<string>('__new__')

  const fetchState = useCallback(async () => {
    if (!token) return
    try {
      const res = await api<ConnectionResponse>('/api/v1/social-media/connection', { token })
      setData(res)
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchState() }, [fetchState])

  const fetchProfiles = useCallback(async () => {
    if (!token) return
    try {
      const res = await api<{ profiles: { id: string; name: string; isDefault: boolean; accountCount: number }[] }>('/api/v1/social-media/zernio-profiles', { token })
      setZernioProfiles(res.profiles)
      const def = res.profiles.find((p) => p.isDefault) || res.profiles[0]
      if (def) setSelectedProfile(def.id)
    } catch {
      setZernioProfiles([])
    }
  }, [token])

  // When the key is set but no profile is linked yet, load existing Zernio
  // workspaces so the user can bind one (e.g. their existing "Dack Group").
  useEffect(() => {
    const c = data?.connection
    if (c?.keyConfigured && !c?.profileLinked && c?.status !== 'disabled' && zernioProfiles === null) {
      fetchProfiles()
    }
  }, [data, zernioProfiles, fetchProfiles])

  const conn = data?.connection
  const accounts = data?.accounts || []
  const platforms = data?.platforms || ['facebook', 'instagram', 'tiktok']

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setMessage(null)
    try { await fn() } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Something went wrong' })
    } finally { setBusy(null) }
  }

  const initConnection = () => run('init', async () => {
    const body = selectedProfile && selectedProfile !== '__new__' ? { profileId: selectedProfile } : {}
    await api('/api/v1/social-media/connection/init', { method: 'POST', body, token })
    setMessage({ type: 'success', text: 'Connection initialised. You can now sync and link accounts.' })
    await fetchState()
  })

  const connectPlatform = (platform: string) => run(`connect:${platform}`, async () => {
    const res = await api<{ authUrl: string }>(
      `/api/v1/social-media/connect/${platform}/url?redirectUrl=${encodeURIComponent(window.location.href)}`,
      { token }
    )
    window.location.href = res.authUrl
  })

  const syncNow = () => run('sync', async () => {
    await api('/api/v1/social-media/sync', { method: 'POST', token })
    setMessage({ type: 'success', text: 'Sync started — data will appear shortly.' })
  })

  const disconnect = () => run('disconnect', async () => {
    await api('/api/v1/social-media/connection', { method: 'DELETE', token })
    setMessage({ type: 'success', text: 'Disconnected.' })
    await fetchState()
  })

  const saveSchedule = (syncHour: number) => run('schedule', async () => {
    await api('/api/v1/social-media/connection', { method: 'PATCH', body: { syncHour, syncMinute: 0 }, token })
    setMessage({ type: 'success', text: 'Sync time updated.' })
    await fetchState()
  })

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
  }

  const isConnected = conn?.status === 'connected' || conn?.status === 'error'

  return (
    <div className="max-w-3xl mx-auto">
      <SettingsBackLink />

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Social Media Analytics</h1>
      <p className="text-sm text-gray-500 mb-6">
        Link your Facebook, Instagram and TikTok accounts to track reach, engagement, follower growth and ad spend.
        Connections are handled securely by Zernio — you authorise each account through its own platform.
      </p>

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {!conn?.keyConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          The Zernio API key isn't configured yet. Set <code className="font-mono">ZERNIO_API_KEY</code> in the API
          environment, then reload this page.
        </div>
      )}

      {conn?.keyConfigured && !conn?.profileLinked && conn?.status !== 'disabled' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Get started</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">Link an existing Zernio workspace for this dealership, or create a new one, then connect accounts.</p>
          {zernioProfiles && zernioProfiles.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">Workspace</label>
              <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full max-w-sm">
                {zernioProfiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''} · {p.accountCount} account{p.accountCount === 1 ? '' : 's'}</option>
                ))}
                <option value="__new__">+ Create a new workspace</option>
              </select>
            </div>
          )}
          <button onClick={initConnection} disabled={busy === 'init'}
            className="px-4 py-2 bg-[#16191f] hover:bg-black text-white rounded-[10px] text-sm font-medium disabled:opacity-50">
            {busy === 'init' ? 'Setting up…' : 'Initialise connection'}
          </button>
        </div>
      )}

      {conn?.status === 'disabled' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-600 mb-4">Social Media analytics is disconnected for this dealership.</p>
          <button onClick={initConnection} disabled={busy === 'init'}
            className="px-4 py-2 bg-[#16191f] hover:bg-black text-white rounded-[10px] text-sm font-medium disabled:opacity-50">
            {busy === 'init' ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}

      {isConnected && conn?.profileLinked && (
        <div className="space-y-6">
          {/* Linked accounts / connect buttons */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Connected accounts</h2>
              <button onClick={syncNow} disabled={busy === 'sync'}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
            <div className="p-6 space-y-3">
              {platforms.map((p) => {
                const linked = accounts.filter((a) => a.platform === p)
                return (
                  <div key={p} className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">{PLATFORM_LABEL[p] || p}</div>
                      {linked.length > 0 ? (
                        <div className="text-xs text-gray-500 truncate">
                          {linked.map((a) => a.handle || a.display_name || a.account_type).join(', ')}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400">Not connected</div>
                      )}
                    </div>
                    <button onClick={() => connectPlatform(p)} disabled={busy === `connect:${p}`}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                      {busy === `connect:${p}` ? 'Opening…' : linked.length > 0 ? 'Add / re-link' : 'Connect'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sync status + schedule */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Sync</h2>
            <div className="text-sm text-gray-600 space-y-1">
              <div>Last synced: {conn?.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleString() : 'never'}</div>
              {conn?.lastError && <div className="text-red-600">Last error: {conn.lastError}</div>}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <label className="text-sm text-gray-600">Daily sync hour</label>
              <select defaultValue={String(conn?.syncHour ?? 2)} onChange={(e) => saveSchedule(parseInt(e.target.value, 10))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span className="text-xs text-gray-400">Europe/London</span>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={disconnect} disabled={busy === 'disconnect'}
              className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
