import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import type { BoardCard, BoardColumnDef, BoardData } from './types'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function fmtDateLong(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function bookedSummary(card: BoardCard): string {
  return (card.bookedRepairs || []).map(r => r.description || r.code).filter(Boolean).join(', ')
}

export default function PrintDaySheet() {
  const [params] = useSearchParams()
  const date = params.get('date') || new Date().toISOString().split('T')[0]
  const techId = params.get('tech') || ''
  const { session, user } = useAuth()
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!session?.accessToken) return
      try {
        const qp = new URLSearchParams({ date })
        if (user?.site?.id) qp.set('siteId', user.site.id)
        const data = await api<BoardData>(`/api/v1/workshop-board?${qp}`, { token: session.accessToken })
        if (!cancelled) setBoard(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
    return () => { cancelled = true }
  }, [session?.accessToken, date, user?.site?.id])

  // Auto-open the print dialog once the data has rendered.
  useEffect(() => {
    if (!board) return
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [board])

  if (error) return <div className="p-8 text-red-600">{error}</div>
  if (!board) return <div className="p-8 text-gray-500">Loading day sheet…</div>

  const techCols = board.columns.filter(c => c.columnType === 'technician' && c.isVisible)
  const selected = techId ? techCols.filter(c => c.technicianId === techId) : techCols

  const cardsFor = (col: BoardColumnDef): BoardCard[] =>
    board.cards
      .filter(c => c.technician?.id === col.technicianId && c.position !== 'work_complete')
      .sort((a, b) => (a.plannedStartAt || '~').localeCompare(b.plannedStartAt || '~'))

  return (
    <div className="day-sheet p-6 text-gray-900 bg-white">
      <style>{`
        @page { margin: 1.2cm; }
        @media print { .no-print { display: none !important; } .tech-block { break-inside: avoid; } }
        .day-sheet table { width: 100%; border-collapse: collapse; }
        .day-sheet th, .day-sheet td { border: 1px solid #d1d5db; padding: 4px 6px; font-size: 12px; text-align: left; vertical-align: top; }
        .day-sheet th { background: #f3f4f6; }
      `}</style>

      <div className="no-print mb-4 flex items-center gap-3">
        <button onClick={() => window.print()} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Print</button>
        <span className="text-sm text-gray-500">{selected.length} technician sheet{selected.length === 1 ? '' : 's'}</span>
      </div>

      <h1 className="text-xl font-bold">{user?.site?.name || 'Workshop'} — Day sheet</h1>
      <p className="text-sm text-gray-600 mb-4">{fmtDateLong(date)}</p>

      {selected.length === 0 && <p className="text-gray-500">No technician columns to print.</p>}

      {selected.map(col => {
        const cards = cardsFor(col)
        const totalHours = cards.reduce((s, c) => s + (c.estimatedHours ?? 0), 0)
        return (
          <div key={col.id} className="tech-block mb-6">
            <h2 className="text-base font-semibold mb-1">
              {col.name} <span className="font-normal text-gray-500">— {cards.length} job{cards.length === 1 ? '' : 's'} · {Math.round(totalHours * 10) / 10}h</span>
            </h2>
            {cards.length === 0 ? (
              <p className="text-sm text-gray-400">No jobs scheduled.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '8%' }}>Time</th>
                    <th style={{ width: '12%' }}>Reg</th>
                    <th style={{ width: '18%' }}>Customer</th>
                    <th style={{ width: '6%' }}>Est</th>
                    <th style={{ width: '12%' }}>Key</th>
                    <th>Booked work</th>
                    <th style={{ width: '20%' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(c => (
                    <tr key={c.healthCheckId}>
                      <td>{fmtTime(c.plannedStartAt)}</td>
                      <td><strong>{c.vehicle?.registration || '—'}</strong>{c.customerWaiting ? ' (W)' : ''}</td>
                      <td>{c.customer ? `${c.customer.first_name} ${c.customer.last_name}` : '—'}</td>
                      <td>{c.estimatedHours != null ? `${c.estimatedHours}h` : '—'}</td>
                      <td>{c.keyLocation || '—'}</td>
                      <td>{bookedSummary(c) || '—'}</td>
                      <td>{c.latestNote?.content || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
