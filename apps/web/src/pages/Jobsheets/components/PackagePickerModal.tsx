/**
 * PackagePickerModal — searchable multi-select picker for service packages.
 *
 * The "Add Packages" list grows comprehensive over time, so packages are
 * chosen from a modal with a search box rather than an inline pill wall.
 * Selection is held in a local draft and only applied to the parent when the
 * user confirms (Done); Cancel / Escape / backdrop click discard the draft.
 */

import { useEffect, useMemo, useState } from 'react'

export interface PackageOption {
  id: string
  name: string
  description?: string | null
}

interface PackagePickerModalProps {
  packages: PackageOption[]
  selectedIds: string[]
  onClose: () => void
  onConfirm: (ids: string[]) => void
}

export default function PackagePickerModal({ packages, selectedIds, onClose, onConfirm }: PackagePickerModalProps) {
  const [draft, setDraft] = useState<string[]>(selectedIds)
  const [query, setQuery] = useState('')

  // Close on Escape (discards draft)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return packages
    return packages.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false)
    )
  }, [packages, query])

  const toggle = (id: string) =>
    setDraft(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id])

  const apply = () => { onConfirm(draft); onClose() }

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div onClick={e => e.stopPropagation()} className="bg-white w-full max-w-lg rounded-xl shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Add packages</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="relative">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search packages…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {packages.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No service packages configured.</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No packages match “{query.trim()}”.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(p => {
                const on = draft.includes(p.id)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className={`w-full flex items-start gap-3 px-5 py-3 text-left hover:bg-gray-50 ${on ? 'bg-indigo-50/60' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'bg-primary border-primary text-white' : 'border-gray-300 bg-white'}`}>
                        {on && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">{p.name}</span>
                        {p.description && <span className="block text-xs text-gray-500 truncate">{p.description}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span>{draft.length} selected</span>
            {draft.length > 0 && (
              <button type="button" onClick={() => setDraft([])} className="text-gray-400 hover:text-gray-600 hover:underline">Clear</button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
            <button type="button" onClick={apply} className="px-4 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark text-sm">Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}
