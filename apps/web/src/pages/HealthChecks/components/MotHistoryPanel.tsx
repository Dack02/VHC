import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'

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

function defectBadgeClass(type: string, dangerous: boolean): string {
  if (dangerous || type === 'DANGEROUS') return 'bg-rag-red text-white'
  if (type === 'MAJOR' || type === 'FAIL') return 'bg-rag-red/80 text-white'
  if (ADVISORY_TYPES.has(type)) return 'bg-rag-amber text-white'
  return 'bg-gray-100 text-gray-700'
}

/**
 * Renders a vehicle's stored DVSA MOT history (GET /api/v1/vehicles/:id/mot-history):
 * a status header plus a pass/fail timeline with mileage and advisories/defects.
 */
export function MotHistoryPanel({ vehicleId, token, registration }: {
  vehicleId: string
  token: string | null | undefined
  registration?: string
}) {
  const [data, setData] = useState<MotHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api<MotHistoryResponse>(`/api/v1/vehicles/${vehicleId}/mot-history`, { token })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load MOT history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vehicleId, token])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
  }

  const tests = data?.tests || []
  const statusColor =
    data?.motStatus === 'Valid' ? 'bg-rag-green text-white' :
    data?.motStatus === 'Expired' ? 'bg-rag-red text-white' :
    'bg-gray-100 text-gray-700'

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">MOT History</h2>
        {data?.motStatus && (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}>
            {data.motStatus}
          </span>
        )}
        {data?.motExpiryDate && (
          <span className="text-sm text-gray-500">Expires {formatDate(data.motExpiryDate)}</span>
        )}
        {data?.lastSyncedAt && (
          <span className="text-xs text-gray-400 ml-auto">Synced {formatDate(data.lastSyncedAt)}</span>
        )}
      </div>

      {tests.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-gray-500">
          No MOT history on record{registration ? ` for ${registration}` : ''}.
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((test) => {
            const passed = test.testResult === 'PASSED'
            return (
              <div key={test.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${passed ? 'bg-rag-green text-white' : 'bg-rag-red text-white'}`}>
                      {test.testResult || 'UNKNOWN'}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{formatDate(test.completedDate)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500">
                    {test.odometerValue != null && (
                      <span>{test.odometerValue.toLocaleString()} {test.odometerUnit || 'mi'}</span>
                    )}
                    {test.expiryDate && passed && <span>Expiry {formatDate(test.expiryDate)}</span>}
                    {test.motTestNumber && <span className="text-xs text-gray-400">#{test.motTestNumber}</span>}
                  </div>
                </div>
                {test.defects.length > 0 && (
                  <ul className="divide-y divide-gray-100">
                    {test.defects.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 px-4 py-2">
                        <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${defectBadgeClass(d.type, d.dangerous)}`}>
                          {d.dangerous ? 'Dangerous' : d.type}
                        </span>
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
    </div>
  )
}
