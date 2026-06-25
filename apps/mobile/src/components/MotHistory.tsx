import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { Card, CardContent } from './Card'
import { Badge } from './Badge'
import { Button } from './Button'

interface MotDefect {
  text: string
  type: string
  dangerous: boolean
}

interface MotTestRecord {
  id: string
  motTestNumber: string | null
  completedDate: string | null
  testResult: string | null
  expiryDate: string | null
  odometerValue: number | null
  odometerUnit: string | null
  odometerResult: string | null
  defects: MotDefect[]
}

interface MotHistoryResponse {
  motStatus: string | null
  motExpiryDate: string | null
  lastSyncedAt: string | null
  firstUsedDate: string | null
  tests: MotTestRecord[]
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const ADVISORY_TYPES = new Set(['ADVISORY', 'MINOR', 'USER ENTERED'])

function defectVariant(type: string, dangerous: boolean): 'red' | 'amber' | 'gray' {
  if (dangerous || type === 'DANGEROUS' || type === 'MAJOR' || type === 'FAIL') return 'red'
  if (ADVISORY_TYPES.has(type)) return 'amber'
  return 'gray'
}

function statusVariant(status: string | null): 'green' | 'red' | 'gray' {
  if (status === 'Valid') return 'green'
  if (status === 'Expired') return 'red'
  return 'gray'
}

/**
 * Collapsible MOT history card for the technician inspection screen. Reads the
 * vehicle's stored DVSA history (GET /api/v1/vehicles/:id/mot-history) and lets
 * the tech pull a fresh lookup on demand (POST /api/v1/vehicles/:id/mot-sync).
 */
export function MotHistory({ vehicleId, registration, token }: {
  vehicleId: string
  registration?: string | null
  token: string | null | undefined
}) {
  const [data, setData] = useState<MotHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  const loadHistory = useCallback(async (opts?: { quiet?: boolean; cancelledRef?: { cancelled: boolean } }) => {
    if (!opts?.quiet) setLoading(true)
    setError(null)
    try {
      const d = await api<MotHistoryResponse>(`/api/v1/vehicles/${vehicleId}/mot-history`, { token: token ?? undefined })
      if (!opts?.cancelledRef?.cancelled) setData(d)
    } catch (err) {
      if (!opts?.cancelledRef?.cancelled) setError(err instanceof Error ? err.message : 'Failed to load MOT history')
    } finally {
      if (!opts?.quiet && !opts?.cancelledRef?.cancelled) setLoading(false)
    }
  }, [vehicleId, token])

  useEffect(() => {
    const cancelledRef = { cancelled: false }
    loadHistory({ cancelledRef })
    return () => { cancelledRef.cancelled = true }
  }, [loadHistory])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      await api<{ success: boolean; found: boolean }>(
        `/api/v1/vehicles/${vehicleId}/mot-sync`,
        { method: 'POST', token: token ?? undefined }
      )
      await loadHistory({ quiet: true })
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'MOT lookup failed')
    } finally {
      setSyncing(false)
    }
  }

  const tests = data?.tests || []

  return (
    <Card padding="none">
      {/* Tappable summary header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[56px] text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">MOT History</span>
          {loading ? (
            <span className="inline-block h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              {data?.motStatus && (
                <Badge variant={statusVariant(data.motStatus)} size="sm">{data.motStatus}</Badge>
              )}
              {data?.motExpiryDate && (
                <span className="text-xs text-gray-500">Exp {formatDate(data.motExpiryDate)}</span>
              )}
              {!loading && !error && !data?.motStatus && tests.length === 0 && (
                <span className="text-xs text-gray-400">No data</span>
              )}
            </>
          )}
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <CardContent className="px-4 pb-4 space-y-3 border-t border-gray-100">
          {error && (
            <div className="bg-rag-red-bg text-rag-red px-3 py-2 text-sm">{error}</div>
          )}

          {/* Sync row */}
          <div className="flex items-center justify-between gap-3 pt-3">
            <span className="text-xs text-gray-400">
              {data?.lastSyncedAt ? `Synced ${formatDate(data.lastSyncedAt)}` : 'Not yet looked up'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={syncing}
              onClick={handleSync}
            >
              {syncing ? 'Looking up…' : tests.length === 0 ? 'Look up MOT' : 'Refresh'}
            </Button>
          </div>

          {syncError && (
            <div className="bg-rag-amber-bg text-rag-amber px-3 py-2 text-sm">{syncError}</div>
          )}

          {tests.length === 0 ? (
            !loading && (
              <div className="bg-gray-50 border border-gray-200 p-4 text-center text-sm text-gray-500">
                No MOT history on record{registration ? ` for ${registration}` : ''}.
              </div>
            )
          ) : (
            <div className="space-y-3">
              {tests.map((test) => {
                const passed = test.testResult === 'PASSED'
                return (
                  <div key={test.id} className="border border-gray-200 bg-white">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Badge variant={passed ? 'green' : 'red'} size="sm">{test.testResult || 'UNKNOWN'}</Badge>
                        <span className="text-sm font-medium text-gray-900">{formatDate(test.completedDate)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        {test.odometerValue != null && (
                          <span>{test.odometerValue.toLocaleString()} {test.odometerUnit || 'mi'}</span>
                        )}
                        {test.expiryDate && passed && <span>Exp {formatDate(test.expiryDate)}</span>}
                      </div>
                    </div>
                    {test.defects.length > 0 && (
                      <ul className="divide-y divide-gray-100">
                        {test.defects.map((d, i) => (
                          <li key={i} className="flex items-start gap-2 px-3 py-2">
                            <Badge variant={defectVariant(d.type, d.dangerous)} size="sm" className="uppercase text-[10px] shrink-0">
                              {d.dangerous ? 'Dangerous' : d.type}
                            </Badge>
                            <span className="text-sm text-gray-700">{d.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
