import { useState, useEffect, type ReactNode } from 'react'

/**
 * Shared presentational primitives for the dense document lists (Jobsheets,
 * Estimates). Kept deliberately small + tone-driven so both lists read identically.
 * See GMS/LIST_LAYOUTS.md for the design rationale.
 */

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

export function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return GBP.format(Number(n))
}

export type Tone = 'gray' | 'blue' | 'indigo' | 'amber' | 'green' | 'red' | 'teal' | 'mutedGray'

const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  mutedGray: 'bg-gray-100 text-gray-500',
  blue: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  teal: 'bg-teal-100 text-teal-700'
}

export function Pill({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  )
}

/** UK number-plate chip — matches the cream/gold chip used in the arrivals strip. */
export function PlateChip({ reg, dim }: { reg?: string | null; dim?: boolean }) {
  return (
    <span
      className={`font-mono text-[11.5px] bg-[#fdf6dd] border border-[#efe2a8] text-[#796a1f] rounded-[5px] px-[7px] py-0.5 whitespace-nowrap ${dim ? 'opacity-60' : ''}`}
    >
      {reg || '—'}
    </span>
  )
}

/** Clickable summary tile (a saved-filter count promoted to navigation). */
export function CountTile({
  label,
  value,
  tone = 'gray',
  active,
  onClick
}: {
  label: string
  value: number
  tone?: 'gray' | 'red' | 'amber' | 'green' | 'blue'
  active?: boolean
  onClick?: () => void
}) {
  const toneText: Record<string, string> = {
    gray: 'text-gray-900',
    red: 'text-rag-red',
    amber: 'text-amber-600',
    green: 'text-rag-green',
    blue: 'text-blue-600'
  }
  const toneBg: Record<string, string> = {
    gray: 'bg-white',
    red: 'bg-red-50',
    amber: 'bg-amber-50',
    green: 'bg-green-50',
    blue: 'bg-blue-50'
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 min-w-[120px] text-left rounded-xl border px-3 py-2.5 transition ${toneBg[tone]} ${
        active ? 'border-primary ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className={`text-[11px] font-medium ${tone === 'gray' ? 'text-gray-500' : toneText[tone]}`}>{label}</div>
      <div className={`text-xl font-semibold ${toneText[tone]}`}>{value}</div>
    </button>
  )
}

export interface TabDef {
  key: string
  label: string
  count?: number | null
}

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`px-3 py-1.5 rounded-md text-sm transition whitespace-nowrap ${
            active === t.key ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-gray-400">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export type Density = 'compact' | 'regular' | 'comfortable'

export const DENSITY_ROW: Record<Density, string> = {
  compact: 'py-1.5',
  regular: 'py-2.5',
  comfortable: 'py-3.5'
}

export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('listDensity') : null
    return (saved as Density) || 'regular'
  })
  useEffect(() => {
    try {
      localStorage.setItem('listDensity', density)
    } catch {
      /* ignore */
    }
  }, [density])
  return [density, setDensity]
}

export function DensityToggle({ density, onChange }: { density: Density; onChange: (d: Density) => void }) {
  const opts: { key: Density; label: string }[] = [
    { key: 'compact', label: 'Compact' },
    { key: 'regular', label: 'Regular' },
    { key: 'comfortable', label: 'Comfortable' }
  ]
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" title="Row density">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`px-2 py-1 rounded-md text-xs transition ${
            density === o.key ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export type SortDir = 'asc' | 'desc'

/** A sortable column header cell. `align` right for numeric columns. */
export function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
  className = ''
}: {
  label: string
  sortKey?: string
  activeKey?: string
  dir?: SortDir
  onSort?: (k: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = sortKey && activeKey === sortKey
  const clickable = !!sortKey && !!onSort
  return (
    <th
      className={`px-3 py-2 text-[11px] font-medium text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'} ${
        clickable ? 'cursor-pointer select-none hover:text-gray-700' : ''
      } ${className}`}
      onClick={clickable ? () => onSort!(sortKey!) : undefined}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        {isActive && <span className="text-gray-400">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

/** Toolbar search input with a leading magnifier and clear affordance. */
export function SearchInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative w-full sm:w-72">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  )
}
