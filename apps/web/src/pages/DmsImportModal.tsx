import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

interface PreviewBooking {
  bookingId: string
  vehicleReg: string
  customerName: string
  scheduledTime: string
  serviceType: string
}

interface SkippedBooking {
  bookingId: string
  vehicleReg: string
  customerName: string
  reason: string
}

interface PreviewData {
  success: boolean
  date: string
  summary: {
    totalBookings: number
    willImport: number
    willSkip: number
    alreadyImportedToday: number
    dailyLimit: number
    remainingCapacity: number
    limitWouldBeExceeded: boolean
  }
  willImport: PreviewBooking[]
  willSkip: SkippedBooking[]
  warnings: string[]
}

interface ImportResult {
  success?: boolean
  queued?: boolean
  message?: string
  imported?: number
  bookingsImported?: number
  bookingsSkipped?: number
  skipped?: number
  error?: string
}

type ModalState = 'loading' | 'empty' | 'preview' | 'importing' | 'success' | 'error'

interface Props {
  open: boolean
  onClose: () => void
  onImportComplete: () => void
  token: string
}

export default function DmsImportModal({ open, onClose, onImportComplete, token }: Props) {
  const [state, setState] = useState<ModalState>('loading')
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)

  const fetchPreview = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const today = new Date().toISOString().split('T')[0]
      const data = await api<PreviewData>(`/api/v1/dms-settings/preview?date=${today}`, { token })

      if (!data.success) {
        setError((data as unknown as { error?: string }).error || 'Failed to fetch preview')
        setState('error')
        return
      }

      setPreview(data)

      if (data.willImport.length === 0) {
        setState('empty')
      } else {
        // Pre-select all importable bookings
        setSelected(new Set(data.willImport.map(b => b.bookingId)))
        setState('preview')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch bookings')
      setState('error')
    }
  }, [token])

  useEffect(() => {
    if (open) {
      setResult(null)
      setShowSkipped(false)
      fetchPreview()
    }
  }, [open, fetchPreview])

  const handleSelectAll = () => {
    if (!preview) return
    if (selected.size === preview.willImport.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(preview.willImport.map(b => b.bookingId)))
    }
  }

  const handleToggle = (bookingId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(bookingId)) {
        next.delete(bookingId)
      } else {
        next.add(bookingId)
      }
      return next
    })
  }

  const handleImport = async () => {
    if (selected.size === 0) return
    setState('importing')
    setError(null)

    try {
      const today = new Date().toISOString().split('T')[0]
      const data = await api<ImportResult>('/api/v1/dms-settings/import', {
        method: 'POST',
        token,
        body: { date: today, bookingIds: Array.from(selected) }
      })

      if (data.error) {
        setError(data.error)
        setState('error')
        return
      }

      setResult(data)
      setState('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setState('error')
    }
  }

  const handleClose = () => {
    if (state === 'success') {
      onImportComplete()
    }
    onClose()
  }

  if (!open) return null

  const allSelected = preview ? selected.size === preview.willImport.length : false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="bg-white w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">DMS Import</h2>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Loading */}
          {state === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mb-4" />
              <p className="text-gray-500 text-sm">Fetching bookings from DMS...</p>
            </div>
          )}

          {/* Empty */}
          {state === 'empty' && (
            <div className="flex flex-col items-center justify-center py-12">
              <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-gray-500 font-medium">No new bookings to import</p>
              <p className="text-gray-400 text-sm mt-1">
                {preview?.willSkip.length ? `${preview.willSkip.length} booking${preview.willSkip.length !== 1 ? 's' : ''} already imported or skipped` : 'All bookings have been imported'}
              </p>
              {preview && preview.willSkip.length > 0 && (
                <button
                  onClick={() => setShowSkipped(!showSkipped)}
                  className="text-sm text-blue-600 hover:underline mt-3"
                >
                  {showSkipped ? 'Hide' : 'Show'} skipped bookings
                </button>
              )}
              {showSkipped && preview && preview.willSkip.length > 0 && (
                <div className="w-full mt-4">
                  <SkippedSection bookings={preview.willSkip} />
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {state === 'preview' && preview && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>{preview.summary.totalBookings} total bookings found</span>
                <span>{selected.size} selected for import</span>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  {preview.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

              {/* Select All Header */}
              <div className="flex items-center gap-3 py-2 border-b border-gray-200">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">
                  {allSelected ? 'Deselect All' : 'Select All'} ({preview.willImport.length})
                </span>
              </div>

              {/* Booking Rows */}
              <div className="divide-y divide-gray-100">
                {preview.willImport.map(booking => (
                  <label
                    key={booking.bookingId}
                    className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-gray-50 -mx-1 px-1"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(booking.bookingId)}
                      onChange={() => handleToggle(booking.bookingId)}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    />
                    <div className="font-mono font-semibold text-gray-900 bg-yellow-100 px-2 py-0.5 text-sm">
                      {booking.vehicleReg}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{booking.customerName}</div>
                    </div>
                    <div className="text-xs text-gray-500">{booking.scheduledTime}</div>
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                      {booking.serviceType}
                    </span>
                  </label>
                ))}
              </div>

              {/* Skipped Section */}
              {preview.willSkip.length > 0 && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowSkipped(!showSkipped)}
                    className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${showSkipped ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Already Imported / Skipped ({preview.willSkip.length})
                  </button>
                  {showSkipped && <SkippedSection bookings={preview.willSkip} />}
                </div>
              )}
            </div>
          )}

          {/* Importing */}
          {state === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-b-2 border-blue-600 rounded-full mb-4" />
              <p className="text-gray-500 text-sm">Importing {selected.size} booking{selected.size !== 1 ? 's' : ''}...</p>
            </div>
          )}

          {/* Success */}
          {state === 'success' && result && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 bg-rag-green/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-rag-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              {result.queued ? (
                <>
                  <p className="text-gray-900 font-medium">Import Queued</p>
                  <p className="text-gray-500 text-sm mt-1">Bookings will appear shortly</p>
                </>
              ) : (
                <>
                  <p className="text-gray-900 font-medium">Import Complete</p>
                  <div className="flex items-center gap-6 mt-3 text-sm">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-rag-green">{result.bookingsImported ?? result.imported ?? 0}</div>
                      <div className="text-gray-500">Imported</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-400">{result.bookingsSkipped ?? result.skipped ?? 0}</div>
                      <div className="text-gray-500">Skipped</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Error */}
          {state === 'error' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 bg-red-50 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-rag-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-900 font-medium">Import Failed</p>
              <p className="text-red-600 text-sm mt-1">{error}</p>
              <button
                onClick={fetchPreview}
                className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200">
          {state === 'preview' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import Selected ({selected.size})
              </button>
            </>
          )}
          {(state === 'success' || state === 'empty' || state === 'error') && (
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SkippedSection({ bookings }: { bookings: SkippedBooking[] }) {
  return (
    <div className="mt-2 bg-gray-50 border border-gray-200 divide-y divide-gray-100">
      {bookings.map(booking => (
        <div key={booking.bookingId} className="flex items-center gap-3 py-2 px-3 text-sm text-gray-500">
          <div className="font-mono text-gray-400 bg-gray-100 px-2 py-0.5 text-xs">
            {booking.vehicleReg}
          </div>
          <div className="flex-1 min-w-0 truncate">{booking.customerName}</div>
          <span className="text-xs text-gray-400 whitespace-nowrap">{booking.reason}</span>
        </div>
      ))}
    </div>
  )
}
