import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

/**
 * Read-only "Booked work" context on the VHC.
 *
 * Booked work lives on the parent jobsheet (not the health check), so it stays out of
 * the inspection-findings + quote flow. This panel surfaces it on the VHC as read-only
 * context for whoever is inspecting/pricing. Renders nothing when the check has no
 * jobsheet or no booked work — so non-GMS / inspection-only checks are unaffected.
 */

interface BookedLabour { id: string; label: string; total: number }
interface BookedPart { id: string; description: string; quantity: number; lineTotal: number }
interface BookedLine { id: string; name: string; totalIncVat: number; labour: BookedLabour[]; parts: BookedPart[] }
interface BookedWorkResponse { jobsheetId: string | null; jobsheetReference: string | null; workLines: BookedLine[] }

const money = (n: number) => `£${(n || 0).toFixed(2)}`

export default function BookedWorkPanel({ healthCheckId }: { healthCheckId: string }) {
  const { session } = useAuth()
  const token = session?.accessToken
  const [data, setData] = useState<BookedWorkResponse | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    api<BookedWorkResponse>(`/api/v1/health-checks/${healthCheckId}/booked-work`, { token })
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { /* non-fatal — panel just stays hidden */ })
    return () => { cancelled = true }
  }, [healthCheckId, token])

  if (!data || !data.jobsheetId || data.workLines.length === 0) return null

  const total = data.workLines.reduce((s, w) => s + (w.totalIncVat || 0), 0)

  return (
    <div className="bg-indigo-50/40 border border-indigo-200 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Booked work <span className="text-xs font-normal text-gray-500">· from the jobsheet · read-only</span>
        </h3>
        <Link to={`/jobsheets/${data.jobsheetId}`} className="text-xs font-medium text-primary hover:underline">
          {data.jobsheetReference ? `Open ${data.jobsheetReference}` : 'Open jobsheet'}
        </Link>
      </div>

      <div className="divide-y divide-indigo-100">
        {data.workLines.map(w => {
          const detail = [
            ...w.labour.map(l => l.label),
            ...w.parts.map(p => `${p.quantity}× ${p.description}`)
          ].filter(Boolean).join(' · ')
          return (
            <div key={w.id} className="py-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-800">{w.name}</span>
                <span className="text-gray-900">{money(w.totalIncVat)}</span>
              </div>
              {detail && <div className="text-xs text-gray-500 mt-0.5">{detail}</div>}
            </div>
          )
        })}
      </div>

      <div className="flex justify-between items-center border-t border-indigo-200 mt-2 pt-2">
        <span className="text-[11px] text-gray-400">Edit booked work on the jobsheet.</span>
        <span className="text-sm font-semibold text-gray-900">Total {money(total)}</span>
      </div>
    </div>
  )
}
