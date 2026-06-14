import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'

interface Category {
  id: string
  key: string
  label: string
  kind: string
  colour: string | null
  isActive: boolean
}

interface ActiveIndirect {
  id: string
  clockInAt: string
  category: { key?: string; label?: string; colour?: string } | null
}

function fmtHMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * Dedicated standalone (job-less) indirect-time screen. Reached from the Job
 * List header — used when a technician is clocked into work but not on a job
 * (cleaning, training, meetings, waiting), or after they've paused/stopped a
 * job. Indirect time is never job-linked; on a job the tech only pauses/stops.
 * See docs/technician-job-clocking-spec.md §8.
 */
export function IndirectTime() {
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const token = session?.access_token
  const orgId = (user as any)?.organization?.id || (user as any)?.organizationId

  const [enabled, setEnabled] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [active, setActive] = useState<ActiveIndirect | null>(null)
  const [liveSec, setLiveSec] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadActive = useCallback(async () => {
    if (!token) return
    const d = await api<{ active: ActiveIndirect | null }>(
      `/api/v1/time-entries/indirect/active`,
      { token }
    )
    setActive(d.active)
  }, [token])

  useEffect(() => {
    if (!token || !orgId) {
      setLoading(false)
      return
    }
    Promise.all([
      api<{ indirectTimeEnabled: boolean; categories: Category[] }>(
        `/api/v1/organizations/${orgId}/time-tracking-settings`,
        { token }
      ),
      api<{ active: ActiveIndirect | null }>(`/api/v1/time-entries/indirect/active`, { token })
    ])
      .then(([settings, activeResp]) => {
        setEnabled(settings.indirectTimeEnabled)
        setCategories((settings.categories || []).filter(c => c.kind === 'indirect' && c.isActive))
        setActive(activeResp.active)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [token, orgId])

  // Live tick for the open indirect segment.
  const clockInAt = active?.clockInAt ?? null
  useEffect(() => {
    if (!clockInAt) {
      setLiveSec(0)
      return
    }
    const start = new Date(clockInAt).getTime()
    const calc = () => Math.max(0, Math.floor((Date.now() - start) / 1000))
    setLiveSec(calc())
    const t = setInterval(() => setLiveSec(calc()), 1000)
    return () => clearInterval(t)
  }, [clockInAt])

  const start = async (cat: Category) => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/v1/time-entries/indirect`, {
        method: 'POST',
        token,
        body: JSON.stringify({ categoryKey: cat.key })
      })
      await loadActive()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/v1/time-entries/indirect/stop`, { method: 'POST', token })
      setActive(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top sticky top-0 z-10">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/')}
            className="mr-3 p-2 -ml-2 hover:bg-blue-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">Indirect Time</h1>
            <p className="text-sm text-blue-200">Non-job time — breaks, cleaning, training</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-4 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : !enabled ? (
          <Card padding="lg" className="text-center">
            <p className="text-gray-600">Indirect time tracking isn't enabled for your organisation.</p>
            <Button onClick={() => navigate('/')} className="mt-4" fullWidth>
              Back to Jobs
            </Button>
          </Card>
        ) : active ? (
          /* Currently on indirect time — live timer + stop */
          <Card padding="lg" className="border-l-4 border-rag-amber bg-amber-50">
            <div className="text-center">
              <p className="text-sm font-medium text-amber-800">
                On {active.category?.label?.toLowerCase() || 'indirect time'}
              </p>
              <p className="text-4xl font-bold tabular-nums text-amber-900 my-3">{fmtHMS(liveSec)}</p>
              <Button variant="danger" size="lg" fullWidth onClick={stop} loading={busy}>
                Stop
              </Button>
            </div>
          </Card>
        ) : (
          /* Idle — pick what you're doing */
          <Card>
            <CardHeader title="What are you doing?" subtitle="Start logging non-job time" />
            <CardContent>
              {categories.length === 0 ? (
                <p className="text-sm text-gray-500">No indirect categories are configured.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => start(cat)}
                      disabled={busy}
                      className="flex items-center gap-2 px-3 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 text-left disabled:opacity-50 active:bg-gray-50"
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.colour || '#94A3B8' }}
                      />
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4">{error}</div>
        )}
      </main>
    </div>
  )
}
