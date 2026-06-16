import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

// Tyre details (manufacturer, size, etc.) for one tyre
interface TyreDetail {
  manufacturerId?: string
  manufacturerName?: string
  sizeId?: string
  size?: string
  speedRating?: string
  loadRating?: string
  runFlat?: boolean
}

// All 4 tyres
interface TyreDetailsValue {
  front_left: TyreDetail
  front_right: TyreDetail
  rear_left: TyreDetail
  rear_right: TyreDetail
}

interface TyreDetailsInputProps {
  value: TyreDetailsValue | undefined
  onChange: (value: TyreDetailsValue, ragStatus: 'green' | 'amber' | 'red' | null) => void
  onRAGChange?: (status: 'green' | 'amber' | 'red' | null) => void  // Optional for backward compat
  config?: Record<string, unknown>
}

type TyrePosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'

const TYRE_POSITIONS: { key: TyrePosition; label: string }[] = [
  { key: 'front_left', label: 'Front Left' },
  { key: 'front_right', label: 'Front Right' },
  { key: 'rear_left', label: 'Rear Left' },
  { key: 'rear_right', label: 'Rear Right' }
]

const DEFAULT_DETAIL: TyreDetail = {}

// Reference data types
interface Manufacturer { id: string; name: string }
interface TyreSize { id: string; size: string }
interface SpeedRating { id: string; code: string; description: string }
interface LoadRating { id: string; code: string; maxLoadKg: number }

// Which picker (if any) is open, and for which tyre.
type PickerTarget = { position: TyrePosition; field: 'manufacturer' | 'size' } | null

// Pull the rim diameter out of a size string ("225/65R16" -> 16, "215/65R16C" -> 16).
function parseRim(size: string): number | null {
  const m = size.match(/R(\d{2})/i)
  return m ? parseInt(m[1], 10) : null
}

// True for a van/LCV "C" (reinforced) size.
function isVanSize(size: string): boolean {
  return /C$/i.test(size.trim())
}

// Tidy a hand-typed size into the canonical NNN/NNRNN(C) shape before it is saved,
// so free entry can't reintroduce malformed values (e.g. the old "255/65/R18").
function normaliseSize(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')   // drop spaces: "225/65 R16" -> "225/65R16"
    .replace(/\/R/g, 'R')  // drop stray slash: "225/65/R16" -> "225/65R16"
}

const SIZE_PATTERN = /^\d{3}\/\d{2}R\d{2}C?$/

export function TyreDetailsInput({
  value,
  onChange,
  onRAGChange,
  config: _config
}: TyreDetailsInputProps) {
  const { session } = useAuth()

  // Reference data
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([])
  const [tyreSizes, setTyreSizes] = useState<TyreSize[]>([])
  const [speedRatings, setSpeedRatings] = useState<SpeedRating[]>([])
  const [loadRatings, setLoadRatings] = useState<LoadRating[]>([])
  const [loadingRef, setLoadingRef] = useState(true)

  // The open picker (manufacturer/size bottom sheet), if any.
  const [picker, setPicker] = useState<PickerTarget>(null)

  // Initialize with defaults if empty
  const [tyres, setTyres] = useState<TyreDetailsValue>(() => {
    if (value && (value.front_left || value.front_right || value.rear_left || value.rear_right)) {
      return {
        front_left: value.front_left || { ...DEFAULT_DETAIL },
        front_right: value.front_right || { ...DEFAULT_DETAIL },
        rear_left: value.rear_left || { ...DEFAULT_DETAIL },
        rear_right: value.rear_right || { ...DEFAULT_DETAIL }
      }
    }
    return {
      front_left: { ...DEFAULT_DETAIL },
      front_right: { ...DEFAULT_DETAIL },
      rear_left: { ...DEFAULT_DETAIL },
      rear_right: { ...DEFAULT_DETAIL }
    }
  })

  void _config

  // Calculate RAG status - tyre details are always green once data is entered
  const calculateRAG = useCallback((tyreData: TyreDetailsValue): 'green' | 'amber' | 'red' | null => {
    const hasSomeData = TYRE_POSITIONS.some(({ key }) => {
      const detail = tyreData[key]
      // A manually-typed size has no sizeId, so check the size string too.
      return detail.manufacturerId || detail.sizeId || detail.size
    })
    return hasSomeData ? 'green' : null
  }, [])

  // Fetch reference data
  useEffect(() => {
    if (!session) return

    const fetchReferenceData = async () => {
      try {
        const [mfgRes, sizesRes, speedRes, loadRes] = await Promise.all([
          api<{ manufacturers: Manufacturer[] }>('/api/v1/tyre-manufacturers?active_only=true', { token: session.access_token }),
          api<{ sizes: TyreSize[] }>('/api/v1/tyre-sizes?active_only=true', { token: session.access_token }),
          api<{ speedRatings: SpeedRating[] }>('/api/v1/speed-ratings', { token: session.access_token }),
          api<{ loadRatings: LoadRating[] }>('/api/v1/load-ratings', { token: session.access_token })
        ])

        setManufacturers(mfgRes.manufacturers || [])
        setTyreSizes(sizesRes.sizes || [])
        setSpeedRatings(speedRes.speedRatings || [])
        setLoadRatings(loadRes.loadRatings || [])
      } catch (error) {
        console.error('Failed to fetch tyre reference data:', error)
      } finally {
        setLoadingRef(false)
      }
    }

    fetchReferenceData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Merge a partial update into one tyre, recompute RAG, and notify the parent.
  const applyPatch = useCallback((position: TyrePosition, patch: Partial<TyreDetail>) => {
    setTyres((prev) => {
      const newTyres = {
        ...prev,
        [position]: { ...(prev[position] || DEFAULT_DETAIL), ...patch }
      }
      const ragStatus = calculateRAG(newTyres)
      onChange(newTyres, ragStatus)
      onRAGChange?.(ragStatus)
      return newTyres
    })
  }, [onChange, onRAGChange, calculateRAG])

  const handleCopyToAll = useCallback(() => {
    const sourceTyre = tyres.front_left // Copy from first tyre (Front Left)
    if (!sourceTyre) return

    if ('vibrate' in navigator) {
      navigator.vibrate(100)
    }

    setTyres(() => {
      const newTyres: TyreDetailsValue = {
        front_left: { ...sourceTyre },
        front_right: { ...sourceTyre },
        rear_left: { ...sourceTyre },
        rear_right: { ...sourceTyre }
      }
      const ragStatus = calculateRAG(newTyres)
      onChange(newTyres, ragStatus)
      onRAGChange?.(ragStatus)
      return newTyres
    })
  }, [tyres, onChange, onRAGChange, calculateRAG])

  // Options for the open picker.
  const pickerOptions = useMemo(() => {
    if (picker?.field === 'manufacturer') {
      return manufacturers.map((m) => ({ id: m.id, label: m.name, rim: null as number | null, isVan: false }))
    }
    if (picker?.field === 'size') {
      return tyreSizes.map((s) => ({ id: s.id, label: s.size, rim: parseRim(s.size), isVan: isVanSize(s.size) }))
    }
    return []
  }, [picker, manufacturers, tyreSizes])

  if (loadingRef) {
    return <div className="text-center py-8 text-gray-500">Loading tyre data...</div>
  }

  const current = picker ? tyres[picker.position] : null
  const positionLabel = picker ? TYRE_POSITIONS.find((p) => p.key === picker.position)?.label ?? '' : ''

  return (
    <div className="space-y-4">
      {/* Header with Copy button */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Tyre Specifications</h3>
        <button
          onClick={handleCopyToAll}
          className="text-xs text-primary font-medium px-3 py-1.5 bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
        >
          Copy First Tyre to All
        </button>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-3">
        {TYRE_POSITIONS.map(({ key, label }) => (
          <div key={key} className="bg-gray-50 rounded-lg border border-gray-200 p-3">
            <div className="text-xs font-semibold text-gray-600 mb-2 uppercase">{label}</div>

            {/* Manufacturer (opens searchable picker) */}
            <button
              type="button"
              onClick={() => setPicker({ position: key, field: 'manufacturer' })}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded bg-white mb-2 flex items-center justify-between gap-1 text-left"
            >
              <span className={`truncate ${tyres[key]?.manufacturerName ? 'text-gray-900' : 'text-gray-400'}`}>
                {tyres[key]?.manufacturerName || 'Manufacturer'}
              </span>
              <ChevronDown />
            </button>

            {/* Size (opens searchable picker with rim filter + manual entry) */}
            <button
              type="button"
              onClick={() => setPicker({ position: key, field: 'size' })}
              className="w-full h-10 px-2 text-sm border border-gray-300 rounded bg-white mb-2 flex items-center justify-between gap-1 text-left"
            >
              <span className={`truncate ${tyres[key]?.size ? 'text-gray-900' : 'text-gray-400'}`}>
                {tyres[key]?.size || 'Size'}
              </span>
              <ChevronDown />
            </button>

            {/* Speed & Load in row */}
            <div className="grid grid-cols-2 gap-2">
              <select
                value={tyres[key]?.speedRating || ''}
                onChange={(e) => applyPatch(key, { speedRating: e.target.value })}
                className="h-10 px-2 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="">Speed</option>
                {speedRatings.map(r => (
                  <option key={r.id} value={r.code}>{r.code}</option>
                ))}
              </select>
              <select
                value={tyres[key]?.loadRating || ''}
                onChange={(e) => applyPatch(key, { loadRating: e.target.value })}
                className="h-10 px-2 text-sm border border-gray-300 rounded bg-white"
              >
                <option value="">Load</option>
                {loadRatings.map(r => (
                  <option key={r.id} value={r.code}>{r.code}</option>
                ))}
              </select>
            </div>

            {/* Run Flat Toggle */}
            <button
              type="button"
              onClick={() => applyPatch(key, { runFlat: !tyres[key]?.runFlat })}
              className={`
                w-full mt-2 h-10 flex items-center justify-center gap-2 text-sm font-medium rounded border-2 transition-all
                ${tyres[key]?.runFlat
                  ? 'bg-amber-100 border-amber-500 text-amber-800'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                }
              `}
            >
              {tyres[key]?.runFlat ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  RUN FLAT
                </>
              ) : (
                'Run Flat?'
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Searchable picker sheet */}
      {picker && (
        <TyrePickerSheet
          title={picker.field === 'manufacturer' ? 'Select manufacturer' : 'Select tyre size'}
          subtitle={positionLabel}
          searchPlaceholder={picker.field === 'manufacturer' ? 'Search manufacturer…' : 'Search size, e.g. 225 or R16…'}
          options={pickerOptions}
          selectedId={picker.field === 'manufacturer' ? current?.manufacturerId : current?.sizeId}
          enableRimFilter={picker.field === 'size'}
          onSelect={(id, label) => {
            if (picker.field === 'manufacturer') {
              applyPatch(picker.position, { manufacturerId: id, manufacturerName: label })
            } else {
              applyPatch(picker.position, { sizeId: id, size: label })
            }
            setPicker(null)
          }}
          onManualEntry={picker.field === 'size'
            ? (sizeStr) => {
                applyPatch(picker.position, { sizeId: undefined, size: sizeStr })
                setPicker(null)
              }
            : undefined}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// Small chevron used on the picker trigger buttons.
function ChevronDown() {
  return (
    <svg className="w-4 h-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

interface PickerOption {
  id: string
  label: string
  rim: number | null
  isVan: boolean
}

interface TyrePickerSheetProps {
  title: string
  subtitle: string
  searchPlaceholder: string
  options: PickerOption[]
  selectedId?: string
  enableRimFilter?: boolean
  onSelect: (id: string, label: string) => void
  onManualEntry?: (value: string) => void
  onClose: () => void
}

// Bottom-sheet picker with search, optional rim-diameter filter, and an optional
// manual-entry fallback. Mirrors the ReasonSelector sheet pattern used elsewhere.
function TyrePickerSheet({
  title,
  subtitle,
  searchPlaceholder,
  options,
  selectedId,
  enableRimFilter,
  onSelect,
  onManualEntry,
  onClose
}: TyrePickerSheetProps) {
  const [query, setQuery] = useState('')
  const [rim, setRim] = useState<number | 'C' | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualValue, setManualValue] = useState('')

  // Distinct rim diameters (excluding van "C" sizes, which get their own chip).
  const rims = useMemo(() => {
    const set = new Set<number>()
    options.forEach((o) => { if (o.rim != null && !o.isVan) set.add(o.rim) })
    return Array.from(set).sort((a, b) => a - b)
  }, [options])
  const hasVan = useMemo(() => options.some((o) => o.isVan), [options])

  // A search query searches across everything; otherwise the rim chip filters.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => {
      if (q) return o.label.toLowerCase().includes(q)
      if (rim === 'C') return o.isVan
      if (typeof rim === 'number') return o.rim === rim && !o.isVan
      return true
    })
  }, [options, query, rim])

  const normalised = normaliseSize(manualValue)
  const manualValid = SIZE_PATTERN.test(normalised)

  const submitManual = () => {
    if (manualValid && onManualEntry) onManualEntry(normalised)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end"
      onClick={onClose}
    >
      <div
        className="bg-white w-full rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-gray-500 hover:text-gray-700 -mr-2"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-12 pl-10 pr-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Rim-diameter filter (sizes only) — disabled while searching */}
          {enableRimFilter && rims.length > 0 && (
            <div className={`flex flex-wrap gap-2 ${query.trim() ? 'opacity-40 pointer-events-none' : ''}`}>
              <RimChip active={rim === null} onClick={() => setRim(null)}>All</RimChip>
              {rims.map((r) => (
                <RimChip key={r} active={rim === r} onClick={() => setRim(r)}>{r}"</RimChip>
              ))}
              {hasVan && (
                <RimChip active={rim === 'C'} onClick={() => setRim('C')}>Van (C)</RimChip>
              )}
            </div>
          )}

          {/* Options */}
          {filtered.length > 0 ? (
            <div className="space-y-2">
              {filtered.map((o) => {
                const selected = o.id === selectedId
                return (
                  <button
                    key={o.id}
                    onClick={() => onSelect(o.id, o.label)}
                    className={`
                      w-full min-h-[48px] px-4 rounded-lg border-2 text-left flex items-center justify-between transition-colors active:scale-[0.98]
                      ${selected ? 'border-primary bg-blue-50 text-primary font-medium' : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300'}
                    `}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && (
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-center text-gray-500 py-6">No matches{query.trim() ? ` for "${query.trim()}"` : ''}</p>
          )}

          {/* Manual entry fallback (sizes only) */}
          {onManualEntry && (
            <div className="pt-2 border-t border-gray-200">
              {!manualMode ? (
                <button
                  onClick={() => { setManualMode(true); setManualValue(query.trim()) }}
                  className="w-full min-h-[48px] px-4 rounded-lg border border-dashed border-gray-300 text-primary font-medium flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Enter size manually
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Enter size manually</p>
                  <div className="flex gap-2">
                    <input
                      value={manualValue}
                      onChange={(e) => setManualValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitManual() }}
                      placeholder="e.g. 225/65R16"
                      autoFocus
                      className="flex-1 h-12 px-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent uppercase"
                    />
                    <button
                      onClick={submitManual}
                      disabled={!manualValid}
                      className="px-4 h-12 rounded-lg bg-primary text-white font-medium disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                  {manualValue.trim() && !manualValid ? (
                    <p className="text-sm text-rag-red">Use the format 225/65R16 (add C for van tyres).</p>
                  ) : (
                    <p className="text-sm text-gray-400">Saved as “{normalised || '…'}”. Not added to your saved list.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Pill used in the rim-diameter filter row.
function RimChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
        active ? 'bg-blue-50 border-primary text-primary font-medium' : 'bg-white border-gray-300 text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}
