import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface Band {
  id?: string
  costFrom: number
  costTo: number | null
  markupPct: number | null
  multiplier: number | null
}
interface Matrix {
  id: string
  name: string
  categoryId: string | null
  categoryName: string | null
  isDefault: boolean
  isActive: boolean
  bands: Band[]
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

// Apply a band's rule to a cost — mirrors the server-side resolver for the preview.
function applyBand(b: Band, cost: number): number {
  if (b.multiplier != null) return cost * b.multiplier
  if (b.markupPct != null) return cost * (1 + b.markupPct / 100)
  return cost
}
function priceFor(bands: Band[], cost: number): number | null {
  const band = bands.find((b) => cost >= b.costFrom && (b.costTo == null || cost < b.costTo))
  if (!band) return null
  const p = applyBand(band, cost)
  return p > cost ? p : null
}

export default function PricingMatrix() {
  const { session } = useAuth()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [defaultMargin, setDefaultMargin] = useState(40)
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [bands, setBands] = useState<Band[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ enabled: boolean; defaultMarginPercent: number; matrices: Matrix[] }>(
        '/api/v1/pricing-matrix',
        { token: session?.accessToken }
      )
      setEnabled(!!data.enabled)
      setDefaultMargin(data.defaultMarginPercent ?? 40)
      const def = data.matrices.find((m) => m.isDefault) || data.matrices[0] || null
      setMatrix(def)
      setBands(def ? def.bands.map((b) => ({ ...b })) : [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load pricing matrix')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleEnabled = async (next: boolean) => {
    setEnabled(next)
    try {
      await api('/api/v1/pricing-matrix/settings', { method: 'PATCH', token: session?.accessToken, body: { enabled: next } })
      toast.success(next ? 'Banded pricing enabled' : 'Banded pricing disabled — reverted to flat markup')
    } catch (err) {
      setEnabled(!next)
      toast.error(err instanceof Error ? err.message : 'Failed to update setting')
    }
  }

  const updateBand = (i: number, patch: Partial<Band>) => {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)))
  }
  const setMode = (i: number, mode: 'multiplier' | 'markup') => {
    updateBand(i, mode === 'multiplier' ? { multiplier: bands[i].multiplier ?? 1.5, markupPct: null } : { markupPct: bands[i].markupPct ?? 50, multiplier: null })
  }
  const addBand = () => {
    const last = bands[bands.length - 1]
    const from = last ? (last.costTo ?? (last.costFrom + 100)) : 0
    setBands((prev) => [...prev, { costFrom: from, costTo: null, multiplier: 1.4, markupPct: null }])
  }
  const removeBand = (i: number) => setBands((prev) => prev.filter((_, idx) => idx !== i))

  const validationError = (): string | null => {
    if (bands.length === 0) return 'Add at least one band'
    const sorted = [...bands].sort((a, b) => a.costFrom - b.costFrom)
    for (const b of sorted) {
      const hasMarkup = b.markupPct != null
      const hasMult = b.multiplier != null
      if (hasMarkup === hasMult) return 'Each band needs exactly one of markup % or multiplier'
      if (b.costTo != null && b.costTo <= b.costFrom) return 'Each band "to" must be greater than "from"'
    }
    return null
  }

  const save = async () => {
    if (!matrix) return
    const err = validationError()
    if (err) { toast.error(err); return }
    try {
      setSaving(true)
      await api(`/api/v1/pricing-matrix/${matrix.id}/bands`, {
        method: 'PUT', token: session?.accessToken,
        body: { bands: bands.map((b) => ({ costFrom: b.costFrom, costTo: b.costTo, markupPct: b.markupPct, multiplier: b.multiplier })) },
      })
      toast.success('Bands saved')
      await fetchData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save bands')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  const previewCosts = [5, 25, 75, 150, 400]

  return (
    <div className="max-w-4xl">
      <SettingsBackLink />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pricing Matrix</h1>
        <p className="text-sm text-gray-500 mt-1">
          Set a higher markup on cheaper parts using cost bands. When off, parts price at your flat default margin ({defaultMargin}%).
        </p>
      </div>

      {/* Master switch */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-6 flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-900">Banded pricing matrix</div>
          <div className="text-sm text-gray-500 mt-0.5">
            {enabled ? 'Active — suggested sell prices use the bands below.' : 'Off — suggested sell prices use the flat default margin.'}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => toggleEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-[#16191f]' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Band editor */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Cost bands</h2>
          <button onClick={addBand} className="text-sm text-primary hover:text-primary-dark font-medium">+ Add band</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="py-2 pr-3">Cost from (£)</th>
                <th className="py-2 px-3">Cost to (£)</th>
                <th className="py-2 px-3">Rule</th>
                <th className="py-2 px-3">Value</th>
                <th className="py-2 pl-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bands.map((b, i) => {
                const mode: 'multiplier' | 'markup' = b.multiplier != null ? 'multiplier' : 'markup'
                return (
                  <tr key={i}>
                    <td className="py-2 pr-3">
                      <input type="number" step="0.01" value={b.costFrom}
                        onChange={(e) => updateBand(i, { costFrom: parseFloat(e.target.value) || 0 })}
                        className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" step="0.01" value={b.costTo ?? ''} placeholder="∞"
                        onChange={(e) => updateBand(i, { costTo: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                    </td>
                    <td className="py-2 px-3">
                      <select value={mode} onChange={(e) => setMode(i, e.target.value as 'multiplier' | 'markup')}
                        className="px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                        <option value="multiplier">× Multiplier</option>
                        <option value="markup">% Markup</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      {mode === 'multiplier' ? (
                        <input type="number" step="0.01" value={b.multiplier ?? ''}
                          onChange={(e) => updateBand(i, { multiplier: parseFloat(e.target.value) || 0, markupPct: null })}
                          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                      ) : (
                        <input type="number" step="1" value={b.markupPct ?? ''}
                          onChange={(e) => updateBand(i, { markupPct: parseFloat(e.target.value) || 0, multiplier: null })}
                          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                      )}
                    </td>
                    <td className="py-2 pl-3">
                      <button onClick={() => removeBand(i)} className="text-gray-400 hover:text-red-600" title="Remove band">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-[#16191f] text-white rounded-[10px] text-sm font-semibold hover:bg-black disabled:opacity-50">
            {saving ? 'Saving…' : 'Save bands'}
          </button>
        </div>
      </div>

      {/* Live preview */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Preview</h2>
        <div className="grid grid-cols-5 gap-3">
          {previewCosts.map((cost) => {
            const matrixPrice = enabled ? priceFor(bands, cost) : null
            const flat = cost / (1 - Math.min(defaultMargin, 99.99) / 100)
            const price = matrixPrice ?? flat
            return (
              <div key={cost} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">cost {GBP.format(cost)}</div>
                <div className="text-lg font-semibold text-gray-900 mt-1">{GBP.format(price)}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{matrixPrice != null ? 'matrix' : 'flat'}</div>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Suggested sell prices only — a manual price on a job line or a fixed item price always wins.
        </p>
      </div>
    </div>
  )
}
