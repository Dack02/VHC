import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

interface Category {
  id: string
  key: string
  label: string
  kind: string
  colour: string | null
  isActive: boolean
}

/**
 * Indirect-time control for the inspection screen. Lets a technician log
 * non-job time (waiting for parts, break) against the job — which pauses the
 * job clock — and resume. Renders nothing unless the org has indirect time
 * enabled, so it's invisible by default. See docs/technician-job-clocking-spec.md.
 */
export default function IndirectTimeControl({ healthCheckId }: { healthCheckId: string }) {
  const { session, user } = useAuth()
  const token = session?.access_token
  const orgId = (user as any)?.organization?.id || (user as any)?.organizationId

  const [enabled, setEnabled] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [active, setActive] = useState<{ label: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !orgId) return
    api<{ indirectTimeEnabled: boolean; categories: Category[] }>(
      `/api/v1/organizations/${orgId}/time-tracking-settings`,
      { token }
    )
      .then(d => {
        setEnabled(d.indirectTimeEnabled)
        setCategories((d.categories || []).filter(c => c.kind === 'indirect' && c.isActive))
      })
      .catch(() => { /* leave disabled */ })
  }, [token, orgId])

  if (!enabled || categories.length === 0) return null

  const startIndirect = async (cat: Category) => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/v1/health-checks/${healthCheckId}/clock-indirect`, {
        method: 'POST',
        token,
        body: JSON.stringify({ categoryKey: cat.key })
      })
      setActive({ label: cat.label })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }

  const resume = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      // Re-clock onto the job (auto-tagged inspection/repair by split-by-milestone)
      await api(`/api/v1/health-checks/${healthCheckId}/clock-in`, {
        method: 'POST',
        token,
        body: JSON.stringify({})
      })
      setActive(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume')
    } finally {
      setBusy(false)
    }
  }

  if (active) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
        <span className="text-sm font-medium text-amber-800">On {active.label.toLowerCase()} — job clock paused</span>
        <button
          onClick={resume}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          Resume
        </button>
      </div>
    )
  }

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700"
      >
        ⏸ Log break / waiting
      </button>
      {open && (
        <div className="mt-1 grid grid-cols-2 gap-1">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => startIndirect(cat)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 text-left disabled:opacity-50"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.colour || '#94A3B8' }} />
              {cat.label}
            </button>
          ))}
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
