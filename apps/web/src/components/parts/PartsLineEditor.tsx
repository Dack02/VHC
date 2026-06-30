import { useState, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '../../lib/api'

/**
 * Shared parts line-entry grid (used by Purchase Invoice entry + the draft Purchase Order).
 * Standard columns: Part no, Description (catalogue typeahead), Qty, Unit cost. Callers add
 * screen-specific columns via `extraColumns`. Press Enter in any standard field to jump to the
 * next line (creating + focusing one on the last row) for fast keyboard entry.
 *
 * Controlled: the parent owns the `lines` array (so it can build a payload / drive a modal that
 * patches a line) and passes `onChange`. Use `blankPartLine()` to seed/extend it.
 */
export interface PartLine {
  key: number
  partId: string | null
  partNumber: string
  description: string
  qty: string
  cost: string
  // screen-specific extras (e.g. invoice disposition) — optional on the shared type
  target?: 'stock' | 'job'
  jobsheetId?: string | null
  jobLabel?: string | null
  sell?: string
}
export interface PartHit { id: string; partNumber: string; description: string; costPrice: number }
export interface ExtraColumn {
  key: string
  header: string
  thClassName?: string
  cell: (line: PartLine, patch: (p: Partial<PartLine>) => void) => ReactNode
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
export const partsInputCls =
  'border border-gray-300 rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]'

let _key = 1
export function blankPartLine(extra: Partial<PartLine> = {}): PartLine {
  return { key: _key++, partId: null, partNumber: '', description: '', qty: '1', cost: '', ...extra }
}

interface Props {
  lines: PartLine[]
  onChange: (lines: PartLine[]) => void
  orgId?: string
  token?: string
  /** Default extra fields for a freshly-added line (e.g. () => ({ target: 'stock' })). */
  newExtra?: () => Partial<PartLine>
  extraColumns?: ExtraColumn[]
  /** Minimum rows kept (the remove button is disabled at this count). */
  minRows?: number
}

export default function PartsLineEditor({ lines, onChange, orgId, token, newExtra, extraColumns = [], minRows = 1 }: Props) {
  const [hitsForKey, setHitsForKey] = useState<number | null>(null)
  const [partHits, setPartHits] = useState<PartHit[]>([])
  const partNoRefs = useRef<Map<number, HTMLInputElement>>(new Map())
  const [pendingFocus, setPendingFocus] = useState<number | null>(null)

  const patch = (key: number, p: Partial<PartLine>) => onChange(lines.map(l => (l.key === key ? { ...l, ...p } : l)))
  const remove = (key: number) => { if (lines.length > minRows) onChange(lines.filter(l => l.key !== key)) }
  const add = () => { const nl = blankPartLine(newExtra?.() ?? {}); onChange([...lines, nl]); setPendingFocus(nl.key) }

  useEffect(() => {
    if (pendingFocus == null) return
    partNoRefs.current.get(pendingFocus)?.focus()
    setPendingFocus(null)
  }, [lines, pendingFocus])

  // Catalogue typeahead for the active line (search on its description).
  const activeQuery = hitsForKey != null ? lines.find(l => l.key === hitsForKey)?.description.trim() ?? '' : ''
  useEffect(() => {
    if (!orgId || hitsForKey == null || !activeQuery || activeQuery.length < 2) { setPartHits([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const d = await api<{ parts: PartHit[] }>(
          `/api/v1/organizations/${orgId}/parts-catalog/search?q=${encodeURIComponent(activeQuery)}`, { token })
        if (!cancelled) setPartHits(d.parts || [])
      } catch { if (!cancelled) setPartHits([]) }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [activeQuery, hitsForKey, orgId, token])

  const pickPart = (key: number, p: PartHit) => {
    patch(key, { partId: p.id, partNumber: p.partNumber, description: p.description, cost: String(p.costPrice ?? '') })
    setHitsForKey(null); setPartHits([])
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>, key: number) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    setHitsForKey(null)
    const idx = lines.findIndex(l => l.key === key)
    if (idx === lines.length - 1) add()
    else partNoRefs.current.get(lines[idx + 1].key)?.focus()
  }

  return (
    <>
      <table className="min-w-full">
        <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="px-4 py-2 text-left w-44">Part no</th>
            <th className="px-4 py-2 text-left">Description</th>
            <th className="px-4 py-2 text-right w-20">Qty</th>
            <th className="px-4 py-2 text-right w-28">Unit cost</th>
            {extraColumns.map(col => <th key={col.key} className={col.thClassName ?? 'px-4 py-2 text-left'}>{col.header}</th>)}
            <th className="px-4 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {lines.map(l => (
            <tr key={l.key} className="align-top">
              <td className="px-4 py-2">
                <input
                  ref={el => { if (el) partNoRefs.current.set(l.key, el); else partNoRefs.current.delete(l.key) }}
                  value={l.partNumber}
                  onChange={e => patch(l.key, { partNumber: e.target.value, partId: null })}
                  onKeyDown={e => onKey(e, l.key)}
                  placeholder="Part no"
                  className={`${partsInputCls} w-full`}
                />
              </td>
              <td className="px-4 py-2 relative">
                <input
                  value={l.description}
                  onChange={e => { patch(l.key, { description: e.target.value, partId: null }); setHitsForKey(l.key) }}
                  onFocus={() => setHitsForKey(l.key)}
                  onKeyDown={e => onKey(e, l.key)}
                  placeholder="Search the catalogue or type a new part"
                  className={`${partsInputCls} w-full`}
                />
                {l.partId && <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[11px] text-green-600 font-medium">✓ linked</span>}
                {hitsForKey === l.key && partHits.length > 0 && (
                  <div className="absolute z-20 left-4 right-4 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                    {partHits.map(p => (
                      <button key={p.id} type="button" onMouseDown={e => { e.preventDefault(); pickPart(l.key, p) }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                        <span className="font-medium text-gray-900">{p.description}</span>
                        {p.partNumber && <span className="text-gray-400 ml-2">{p.partNumber}</span>}
                        <span className="text-gray-500 float-right">{GBP.format(p.costPrice || 0)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-2"><input value={l.qty} onChange={e => patch(l.key, { qty: e.target.value })} onKeyDown={e => onKey(e, l.key)} type="number" min="0" step="1" className={`${partsInputCls} w-full text-right`} /></td>
              <td className="px-4 py-2"><input value={l.cost} onChange={e => patch(l.key, { cost: e.target.value })} onKeyDown={e => onKey(e, l.key)} type="number" min="0" step="0.01" className={`${partsInputCls} w-full text-right`} /></td>
              {extraColumns.map(col => <td key={col.key} className="px-4 py-2">{col.cell(l, p => patch(l.key, p))}</td>)}
              <td className="px-4 py-2 text-center">
                <button type="button" onClick={() => remove(l.key)} disabled={lines.length <= minRows} className="text-gray-400 hover:text-red-600 disabled:opacity-30" title="Remove line">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-3 border-t border-gray-100">
        <button type="button" onClick={add} className="text-sm text-primary hover:underline">+ Add a line <span className="text-gray-400">· or press Enter</span></button>
      </div>
    </>
  )
}
