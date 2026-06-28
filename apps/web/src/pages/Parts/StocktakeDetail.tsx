import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface Line {
  id: string
  stockItemId: string
  partNumber: string | null
  description: string | null
  expectedQty: number
  countedQty: number | null
  unitCost: number
  varianceQty: number
  varianceValue: number
  reasonCode: string | null
  movementId: string | null
}
interface SessionInfo {
  id: string
  reference: string | null
  scopeType: string
  locationName: string | null
  status: string
  lineCount: number
  varianceValue: number
  committedAt: string | null
  createdAt: string
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const REASONS = [
  { value: 'count_correction', label: 'Count correction' },
  { value: 'shrinkage', label: 'Shrinkage / loss' },
  { value: 'damaged', label: 'Damaged / written off' },
  { value: 'found', label: 'Found / over-count' },
  { value: 'data_error', label: 'Data error' },
  { value: 'other', label: 'Other' },
]

export default function StocktakeDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  // Local edits keyed by line id: counted (string for the input) + reason.
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ session: SessionInfo; lines: Line[] }>(`/api/v1/stocktake/${id}`, { token: session?.accessToken })
      setInfo(data.session)
      setLines(data.lines || [])
      const c: Record<string, string> = {}
      const r: Record<string, string> = {}
      for (const l of data.lines || []) {
        if (l.countedQty != null) c[l.id] = String(l.countedQty)
        if (l.reasonCode) r[l.id] = l.reasonCode
      }
      setCounted(c)
      setReasons(r)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stocktake')
    } finally {
      setLoading(false)
    }
  }, [id, session?.accessToken, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const editable = info?.status === 'counting'
  const varianceOf = (l: Line): number | null => {
    const raw = counted[l.id]
    if (raw === undefined || raw === '') return null
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) return null
    return Math.round((n - l.expectedQty) * 1000) / 1000
  }

  const buildCounts = () => lines.map((l) => {
    const raw = counted[l.id]
    const has = raw !== undefined && raw !== ''
    return { lineId: l.id, countedQty: has ? parseFloat(raw) : null, reasonCode: reasons[l.id] ?? null }
  }).filter((x) => x.countedQty != null || x.reasonCode != null)

  const saveCounts = async () => {
    const counts = buildCounts()
    if (counts.length === 0) { toast.error('Enter at least one count'); return }
    setSaving(true)
    try {
      await api(`/api/v1/stocktake/${id}/counts`, { method: 'POST', token: session?.accessToken, body: { counts } })
      toast.success('Counts saved')
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save counts')
    } finally {
      setSaving(false)
    }
  }

  const commit = async () => {
    // Client-side guard mirroring the server: every counted line with a variance needs a reason.
    const missing = lines.filter((l) => {
      const v = varianceOf(l)
      return v != null && v !== 0 && !reasons[l.id]
    })
    if (missing.length > 0) { toast.error(`Pick a reason for ${missing.length} varianced line(s) first`); return }
    const variancedCount = lines.filter((l) => { const v = varianceOf(l); return v != null && v !== 0 }).length
    if (!confirm(`Commit this stocktake? ${variancedCount} adjustment(s) will be posted to stock and the ledger. This can't be undone.`)) return
    setCommitting(true)
    try {
      // Persist the latest counts + reasons, then commit.
      const counts = buildCounts()
      if (counts.length > 0) await api(`/api/v1/stocktake/${id}/counts`, { method: 'POST', token: session?.accessToken, body: { counts } })
      const res = await api<{ adjustments: number; varianceValue: number }>(`/api/v1/stocktake/${id}/commit`, { method: 'POST', token: session?.accessToken })
      toast.success(`Committed — ${res.adjustments} adjustment(s), net ${GBP.format(res.varianceValue)}`)
      await fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to commit stocktake')
    } finally {
      setCommitting(false)
    }
  }

  const cancel = async () => {
    if (!confirm('Cancel this stocktake? No adjustments will be posted.')) return
    try {
      await api(`/api/v1/stocktake/${id}/cancel`, { method: 'POST', token: session?.accessToken })
      toast.success('Stocktake cancelled')
      navigate('/parts/stocktake')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
  }
  if (!info) return null

  const filtered = lines.filter((l) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (l.partNumber || '').toLowerCase().includes(q) || (l.description || '').toLowerCase().includes(q)
  })
  const countedSoFar = lines.filter((l) => counted[l.id] !== undefined && counted[l.id] !== '').length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <Link to="/parts/stocktake" className="text-sm text-gray-500 hover:text-gray-700">← Stocktake</Link>
        <div className="flex items-center justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{info.reference || 'Stocktake'}</h1>
            <p className="text-sm text-gray-500 mt-1 capitalize">
              {info.scopeType}{info.locationName ? ` · ${info.locationName}` : ''} · {info.lineCount} items · {info.status}
            </p>
          </div>
          {editable && (
            <div className="flex items-center gap-2">
              <button onClick={cancel} className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={saveCounts} disabled={saving} className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">{saving ? 'Saving…' : 'Save counts'}</button>
              <button onClick={commit} disabled={committing} className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-50">{committing ? 'Committing…' : 'Commit'}</button>
            </div>
          )}
        </div>
      </div>

      {editable && (
        <div className="flex items-center justify-between">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part…"
            className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
          <span className="text-sm text-gray-500">{countedSoFar}/{lines.length} counted</span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Part</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Expected</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Counted</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Variance</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {filtered.map((l) => {
              const v = editable ? varianceOf(l) : (l.countedQty != null ? l.varianceQty : null)
              const hasVar = v != null && v !== 0
              return (
                <tr key={l.id} className={hasVar ? 'bg-amber-50/40' : ''}>
                  <td className="px-4 py-3 text-gray-900">
                    <div className="font-medium">{l.partNumber || l.description}</div>
                    {l.partNumber && <div className="text-xs text-gray-400 truncate max-w-[280px]">{l.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{l.expectedQty}</td>
                  <td className="px-4 py-3 text-right">
                    {editable ? (
                      <input type="number" step="0.001" value={counted[l.id] ?? ''}
                        onChange={(e) => setCounted((p) => ({ ...p, [l.id]: e.target.value }))}
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                    ) : (l.countedQty ?? <span className="text-gray-400">—</span>)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {v == null ? <span className="text-gray-300">—</span>
                      : <span className={v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-400'}>{v > 0 ? '+' : ''}{v}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {hasVar ? (
                      editable ? (
                        <select value={reasons[l.id] ?? ''} onChange={(e) => setReasons((p) => ({ ...p, [l.id]: e.target.value }))}
                          className={`px-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f] ${reasons[l.id] ? 'border-gray-300' : 'border-red-300'}`}>
                          <option value="">Reason required…</option>
                          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      ) : (
                        <span className="text-gray-600">{REASONS.find((r) => r.value === l.reasonCode)?.label || l.reasonCode || '—'}</span>
                      )
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {info.status === 'committed' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
          Committed {info.committedAt ? `on ${new Date(info.committedAt).toLocaleString('en-GB')}` : ''} · net variance {GBP.format(info.varianceValue)}. Adjustments posted to stock and the ledger (Event 6).
        </div>
      )}
    </div>
  )
}
