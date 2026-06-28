import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

export interface PickedCustomer {
  id: string
  firstName: string
  lastName: string
  mobile: string | null
}

/** Debounced customer search picker. Used by transfer-owner + add-driver. */
export default function CustomerPicker({
  value,
  onChange,
  placeholder = 'Search customers…'
}: {
  value: PickedCustomer | null
  onChange: (c: PickedCustomer | null) => void
  placeholder?: string
}) {
  const { session } = useAuth()
  const token = session?.accessToken
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickedCustomer[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (term: string) => {
    if (!token || term.trim().length < 2) { setResults([]); return }
    try {
      const data = await api<{ customers: PickedCustomer[] }>(`/api/v1/customers/search?q=${encodeURIComponent(term.trim())}`, { token })
      setResults(data.customers || [])
    } catch {
      setResults([])
    }
  }, [token])

  useEffect(() => {
    const t = setTimeout(() => search(q), 250)
    return () => clearTimeout(t)
  }, [q, search])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[10px] border border-gray-300 px-3 h-[42px]">
        <span className="text-sm text-[#16191f] truncate">
          {value.firstName} {value.lastName}
          {value.mobile && <span className="text-gray-400"> · {value.mobile}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-gray-400 hover:text-gray-600 text-sm">Change</button>
      </div>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-[10px] border border-gray-300 px-3 h-[42px] text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-[10px] shadow-lg max-h-56 overflow-auto">
          {results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange(r); setQ(''); setResults([]); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {r.firstName} {r.lastName}
              {r.mobile && <span className="text-gray-400"> · {r.mobile}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
