import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface Line {
  id: string
  name: string
  description: string | null
  subtotal: number
  vatAmount: number
  totalIncVat: number
  customerApproved: boolean | null
  customerDeclinedReason: string | null
}
interface EstimateData {
  estimate: { id: string; reference: string | null; status: string; validUntil: string | null; customerNotes: string | null; termsText: string | null; requireSignature: boolean; responseFinalised: boolean }
  organization: { name?: string; logoUrl?: string | null; primaryColor?: string; phone?: string }
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null; year: number | null } | null
  lines: Line[]
  totals: { subtotal: number; vatAmount: number; totalIncVat: number }
}

const money = (n: number) => `£${(n || 0).toFixed(2)}`
// Statuses that lock the portal regardless of the customer's response. The portal otherwise
// stays interactive until the customer explicitly finalises (estimate.responseFinalised);
// in-progress 'opened'/'accepted'/'partial'/'declined' do NOT lock on their own.
const TERMINAL_STATUSES = ['converted', 'cancelled', 'expired']

function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Minimal canvas signature pad.
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  const pos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height }
  }
  const start = (e: React.PointerEvent) => {
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke()
    dirty.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (dirty.current) onChange(canvasRef.current!.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    dirty.current = false
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={160}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full h-40 border border-gray-300 rounded-lg bg-white touch-none"
      />
      <button onClick={clear} className="mt-2 text-sm text-gray-500 hover:text-gray-700">Clear signature</button>
    </div>
  )
}

export default function EstimatePortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<EstimateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/public/estimate/${token}`)
      if (res.status === 410) { setExpired(true); return }
      if (!res.ok) { setError('Estimate not found'); return }
      setData(await res.json())
    } catch {
      setError('Could not load this estimate. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // Apply org brand colour.
  useEffect(() => {
    const colour = data?.organization?.primaryColor
    if (colour) document.documentElement.style.setProperty('--est-brand', colour)
  }, [data?.organization?.primaryColor])

  // Background line-save promises in flight. A finalising action (submit / approve-all /
  // decline-all) awaits these first so a just-tapped line can't persist *after* finalisation
  // and get rejected.
  const pendingLineSaves = useRef<Promise<unknown>[]>([])

  const post = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true)
    try {
      if (pendingLineSaves.current.length) await Promise.allSettled(pendingLineSaves.current)
      const res = await fetch(`${API_URL}/api/public/estimate/${token}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      })
      if (res.status === 410) { setExpired(true); return }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Something went wrong'); return }
      await load()
    } catch {
      setError('Could not save your response. Please try again.')
    } finally { setBusy(false) }
  }

  // A single line's approve/decline updates that line locally first (instant, no flicker),
  // then persists in the background. The priced totals don't change and the page stays open
  // until the customer submits, so there's no need to refetch — we only resync on failure.
  const decideLine = (lineId: string, approved: boolean) => {
    setError(null)
    setData(prev => prev ? { ...prev, lines: prev.lines.map(l => l.id === lineId ? { ...l, customerApproved: approved } : l) } : prev)
    const p = fetch(`${API_URL}/api/public/estimate/${token}/lines/${lineId}/${approved ? 'approve' : 'decline'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }).then(async res => {
      if (res.status === 410) { setExpired(true); return }
      if (!res.ok) { setError('Could not save your response. Please try again.'); await load() }
    }).catch(async () => { setError('Could not save your response. Please try again.'); await load() })
    pendingLineSaves.current.push(p)
    p.finally(() => { pendingLineSaves.current = pendingLineSaves.current.filter(x => x !== p) })
  }

  // Full-screen spinner only on the very first load — never on a refetch, which would tear
  // the whole page down and flash (the flicker on each per-line decision).
  if (loading && !data) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin h-8 w-8 border-4 border-gray-300 border-t-gray-600 rounded-full" /></div>
  }
  if (expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">This estimate link has expired</h1>
          <p className="text-gray-600">Please contact the garage to request an up-to-date estimate.</p>
        </div>
      </div>
    )
  }
  if (error && !data) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 text-gray-600">{error}</div>
  }
  if (!data) return null

  const { estimate, organization, customer, vehicle, lines, totals } = data
  const brand = organization.primaryColor || '#4f46e5'
  const responded = estimate.responseFinalised || TERMINAL_STATUSES.includes(estimate.status)
  const approvedCount = lines.filter(l => l.customerApproved === true).length
  const declinedCount = lines.filter(l => l.customerApproved === false).length
  const anyDecided = approvedCount + declinedCount > 0
  const requireSig = estimate.requireSignature
  const canAccept = !requireSig || !!signature

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      {/* Header */}
      <div style={{ backgroundColor: brand }} className="px-6 py-6 text-white">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {organization.logoUrl
            ? <img src={organization.logoUrl} alt={organization.name} className="h-10 max-w-[180px] object-contain" />
            : <span className="text-lg font-bold">{organization.name}</span>}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Title card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mt-5">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Estimate {estimate.reference}</h1>
            {responded && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 capitalize">{estimate.status}</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {customer && <>{customer.firstName} {customer.lastName} · </>}
            {vehicle && <>{vehicle.registration} {vehicle.make} {vehicle.model}</>}
          </p>
          {estimate.validUntil && <p className="text-sm text-gray-500 mt-1">Valid until {formatDate(estimate.validUntil)}</p>}
          {estimate.customerNotes && <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{estimate.customerNotes}</p>}
        </div>

        {error && <div className="bg-red-50 text-red-700 p-3 mt-4 rounded-lg text-sm">{error}</div>}

        {/* Lines */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 divide-y divide-gray-100">
          {lines.map(line => (
            <div key={line.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{line.name}</div>
                  {line.description && <div className="text-sm text-gray-500 mt-0.5">{line.description}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold text-gray-900">{money(line.totalIncVat)}</div>
                  <div className="text-[11px] text-gray-400">inc VAT</div>
                </div>
              </div>
              {/* Per-line decision (only when no signature gate + not yet finalised) */}
              {!responded && !requireSig && (
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={() => decideLine(line.id, true)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${line.customerApproved === true ? 'bg-green-600 text-white border-green-600' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {line.customerApproved === true ? 'Approved' : 'Approve'}
                  </button>
                  <button onClick={() => decideLine(line.id, false)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${line.customerApproved === false ? 'bg-red-600 text-white border-red-600' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                    {line.customerApproved === false ? 'Declined' : 'Decline'}
                  </button>
                </div>
              )}
              {(responded || requireSig) && line.customerApproved != null && (
                <div className={`mt-2 text-xs font-semibold ${line.customerApproved ? 'text-green-600' : 'text-red-600'}`}>
                  {line.customerApproved ? 'Approved' : 'Declined'}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4 text-sm">
          <div className="flex justify-between text-gray-500"><span>Net</span><span>{money(totals.subtotal)}</span></div>
          <div className="flex justify-between text-gray-500 mt-1"><span>VAT</span><span>{money(totals.vatAmount)}</span></div>
          <div className="flex justify-between text-gray-900 font-bold text-base mt-2 pt-2 border-t border-gray-100"><span>Total inc VAT</span><span>{money(totals.totalIncVat)}</span></div>
        </div>

        {/* Terms */}
        {estimate.termsText && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-4">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Terms &amp; Conditions</h2>
            <p className="text-xs text-gray-600 whitespace-pre-wrap">{estimate.termsText}</p>
          </div>
        )}

        {/* Action area */}
        {!responded && requireSig && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-5">
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Please sign to approve this estimate</p>
              <SignaturePad onChange={setSignature} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button disabled={busy || !canAccept}
                onClick={() => post('/approve-all', signature ? { signatureData: signature } : undefined)}
                style={{ backgroundColor: brand }}
                className="flex-1 px-4 py-2.5 text-white font-semibold rounded-lg disabled:opacity-50">
                Approve &amp; accept estimate
              </button>
              <button disabled={busy} onClick={() => post('/decline-all')}
                className="px-4 py-2.5 text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Decline
              </button>
            </div>
            {!signature && <p className="text-xs text-gray-400 mt-2">Add your signature above to enable approval.</p>}
          </div>
        )}

        {/* Per-line response: choose each item above, then confirm. */}
        {!responded && !requireSig && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mt-4 p-5">
            <button disabled={busy || !anyDecided} onClick={() => post('/submit')}
              style={{ backgroundColor: brand }}
              className="w-full px-4 py-2.5 text-white font-semibold rounded-lg disabled:opacity-50">
              Submit my response
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              {anyDecided
                ? `Approving ${approvedCount} ${approvedCount === 1 ? 'item' : 'items'}${declinedCount ? `, declining ${declinedCount}` : ''}. Anything left undecided won’t be booked.`
                : 'Approve or decline at least one item above, then submit your response.'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-400">Or quickly:</span>
              <button disabled={busy} onClick={() => post('/approve-all')}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Approve all
              </button>
              <button disabled={busy} onClick={() => post('/decline-all')}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Decline all
              </button>
            </div>
          </div>
        )}

        {responded && (
          <div className="bg-green-50 border border-green-200 rounded-xl mt-4 p-5 text-center">
            <p className="text-sm font-medium text-green-800">
              Thank you — your response has been recorded{approvedCount > 0 ? ` (${approvedCount} item${approvedCount > 1 ? 's' : ''} approved)` : ''}.
            </p>
            {organization.phone && <p className="text-xs text-green-700 mt-1">Questions? Call us on {organization.phone}.</p>}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">{organization.name}</p>
      </div>
    </div>
  )
}
