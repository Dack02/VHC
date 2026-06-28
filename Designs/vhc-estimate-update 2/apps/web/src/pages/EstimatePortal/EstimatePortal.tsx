import { useState, useEffect, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { matchUspIcon, UspIcon } from '../../lib/uspIcons'
import NextStepTracker from './NextStepTracker'
import BookingFlow, { BookingConfirmation, type ConfirmedBooking } from './BookingFlow'

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
  // `usps` are the tenant's selling points (Settings → Estimates → Your selling points).
  organization: { name?: string; logoUrl?: string | null; primaryColor?: string; phone?: string; address?: string; usps?: string[] }
  customer: { firstName: string; lastName: string } | null
  vehicle: { registration: string; make: string | null; model: string | null; year: number | null } | null
  lines: Line[]
  totals: { subtotal: number; vatAmount: number; totalIncVat: number }
  // Online booking flags (see README §7 — added to the GET payload from settings).
  booking?: { enabled: boolean; courtesyCar: boolean }
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

function initials(name?: string): string {
  if (!name) return 'E'
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || 'E'
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
        className="w-full h-40 border border-gray-300 rounded-xl bg-white touch-none"
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
  // Online booking: the slot the customer confirmed (Step 3), and whether they chose to book later.
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBooking | null>(null)
  const [skipBooking, setSkipBooking] = useState(false)

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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
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
  const orgName = organization.name || 'Your garage'
  const brand = organization.primaryColor || '#1b5e54'
  // Brand-derived accents (works for any tenant hex). color-mix is supported by all current
  // evergreen browsers; if you must support older ones, precompute these server-side.
  const brandTint = `color-mix(in srgb, ${brand} 11%, #ffffff)`
  const onTintInk = `color-mix(in srgb, ${brand} 72%, #102420)`
  const usps = (organization.usps || []).filter((u) => (u || '').trim()).slice(0, 6)

  const responded = estimate.responseFinalised || TERMINAL_STATUSES.includes(estimate.status)
  const approvedCount = lines.filter(l => l.customerApproved === true).length
  const declinedCount = lines.filter(l => l.customerApproved === false).length
  const approvedTotal = lines.filter(l => l.customerApproved === true).reduce((s, l) => s + l.totalIncVat, 0)
  const anyDecided = approvedCount + declinedCount > 0
  const requireSig = estimate.requireSignature
  const canAccept = !requireSig || !!signature
  // Booking is offered after the customer has finalised an approval (accepted / partial).
  const bookingEnabled = !!data.booking?.enabled
  const finalisedApproved = estimate.responseFinalised && (estimate.status === 'accepted' || estimate.status === 'partial')
  const showBooking = bookingEnabled && finalisedApproved && approvedCount > 0

  return (
    <div className="min-h-screen bg-gray-50 pb-16 font-sans" style={{ ['--est-brand' as string]: brand } as CSSProperties}>
      {/* ── Brand hero ─────────────────────────────────────────────── */}
      <div style={{ backgroundColor: brand }} className="text-white">
        <div className="max-w-2xl mx-auto px-5 pt-6 pb-7">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {organization.logoUrl
                ? <img src={organization.logoUrl} alt={orgName} className="h-9 max-w-[150px] object-contain" />
                : <>
                    <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-[12px] font-extrabold shrink-0">{initials(orgName)}</div>
                    <span className="font-bold text-sm truncate">{orgName}</span>
                  </>}
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/15 rounded-full px-2.5 py-1 shrink-0">
              <UspIcon name="shield" size={13} />Secure
            </span>
          </div>

          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">Estimate · {estimate.reference}</div>
            <h1 className="mt-1.5 text-[26px] leading-tight font-extrabold tracking-tight">Your repair estimate</h1>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {vehicle?.registration && (
                <span className="font-mono text-sm font-semibold rounded-md px-2.5 py-1.5 tracking-wide" style={{ background: '#fdf6dd', border: '1px solid #efe2a8', color: '#6f6320' }}>
                  {vehicle.registration}
                </span>
              )}
              <div className="leading-tight">
                {vehicle && <div className="text-[13px] font-semibold">{[vehicle.make, vehicle.model].filter(Boolean).join(' ')}</div>}
                <div className="text-[11.5px] text-white/65">
                  {[vehicle?.year, customer && `${customer.firstName} ${customer.lastName}`].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* ── Why choose us (USP trust strip) ──────────────────────── */}
        {usps.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mt-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 mb-4">Why choose {orgName}</div>
            <div className="flex flex-col gap-4">
              {usps.map((u, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: brandTint, color: brand }}>
                    <UspIcon name={matchUspIcon(u)} size={20} />
                  </span>
                  <span className="text-[14px] font-semibold" style={{ color: onTintInk }}>{u}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Optional advisor note */}
        {estimate.customerNotes && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mt-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-gray-400 mb-2">A note from us</div>
            <p className="text-[13.5px] leading-relaxed text-gray-700 whitespace-pre-wrap">{estimate.customerNotes}</p>
          </div>
        )}

        {estimate.validUntil && (
          <p className="text-center text-xs text-gray-400 mt-4">Valid until {formatDate(estimate.validUntil)}</p>
        )}

        {error && <div className="bg-red-50 text-red-700 p-3 mt-4 rounded-xl text-sm">{error}</div>}

        {/* ── Work lines ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mt-4 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-gray-400">What we recommend</span>
            <span className="text-[11.5px] text-gray-400">{!responded && !requireSig ? 'Approve each item' : `${lines.length} item${lines.length === 1 ? '' : 's'}`}</span>
          </div>
          {lines.map((line, idx) => {
            const approved = line.customerApproved === true
            const declined = line.customerApproved === false
            return (
              <div key={line.id} className={`px-4 py-4 ${idx < lines.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14.5px] font-semibold text-gray-900">{line.name}</div>
                    {line.description && <div className="text-[12px] text-gray-500 mt-0.5">{line.description}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-bold text-gray-900 tabular-nums">{money(line.totalIncVat)}</div>
                    <div className="text-[10px] text-gray-400">inc VAT</div>
                  </div>
                </div>

                {/* Per-line decision (only when no signature gate + not yet finalised) */}
                {!responded && !requireSig && (
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => decideLine(line.id, true)}
                      style={approved ? { backgroundColor: brand, borderColor: brand } : undefined}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-[13px] font-bold border transition-colors ${approved ? 'text-white' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                      aria-pressed={approved}
                    >
                      {approved && <UspIcon name="check" size={15} />}
                      {approved ? 'Approved' : 'Approve'}
                    </button>
                    <button
                      onClick={() => decideLine(line.id, false)}
                      className={`flex-1 h-10 rounded-xl text-[13px] font-semibold border transition-colors ${declined ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      aria-pressed={declined}
                    >
                      {declined ? 'Declined' : 'Decline'}
                    </button>
                  </div>
                )}
                {(responded || requireSig) && line.customerApproved != null && (
                  <div className={`mt-2 text-xs font-bold ${approved ? '' : 'text-red-600'}`} style={approved ? { color: brand } : undefined}>
                    {approved ? 'Approved' : 'Declined'}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Totals ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mt-4 p-4 text-sm">
          <div className="flex justify-between text-gray-500"><span>Net</span><span className="tabular-nums">{money(totals.subtotal)}</span></div>
          <div className="flex justify-between text-gray-500 mt-1"><span>VAT</span><span className="tabular-nums">{money(totals.vatAmount)}</span></div>
          <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-gray-100">
            <span className="text-[15px] font-bold text-gray-900">Total inc VAT</span>
            <span className="text-[22px] font-extrabold tracking-tight tabular-nums" style={{ color: brand }}>{money(totals.totalIncVat)}</span>
          </div>
        </div>

        {/* Terms */}
        {estimate.termsText && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mt-4 p-4">
            <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Terms &amp; Conditions</h2>
            <p className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">{estimate.termsText}</p>
          </div>
        )}

        {/* ── "What happens next" tracker — sets booking as the next step ── */}
        {!responded && bookingEnabled && (
          <div className="mt-4">
            <NextStepTracker current="approve" brand={brand} />
          </div>
        )}

        {/* ── Action: signature flow ───────────────────────────────── */}
        {!responded && requireSig && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mt-4 p-5">
            <p className="text-sm font-medium text-gray-700 mb-2">Please sign to approve this estimate</p>
            <SignaturePad onChange={setSignature} />
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <button disabled={busy || !canAccept}
                onClick={() => post('/approve-all', signature ? { signatureData: signature } : undefined)}
                style={{ backgroundColor: brand }}
                className="flex-1 h-12 text-white font-bold rounded-xl disabled:opacity-50">
                {bookingEnabled ? 'Approve & book your slot' : 'Approve & accept estimate'}
              </button>
              <button disabled={busy} onClick={() => post('/decline-all')}
                className="px-5 h-12 text-gray-700 font-semibold rounded-xl border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Decline
              </button>
            </div>
            {!signature && <p className="text-xs text-gray-400 mt-2">Add your signature above to enable approval.</p>}
          </div>
        )}

        {/* ── Action: per-line response ────────────────────────────── */}
        {!responded && !requireSig && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mt-4 p-5">
            <button disabled={busy || !anyDecided} onClick={() => post('/submit')}
              style={{ backgroundColor: brand }}
              className="w-full h-12 text-white font-bold rounded-xl disabled:opacity-50">
              {bookingEnabled && approvedCount > 0 ? 'Submit & book your slot' : 'Submit my response'}
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              {anyDecided
                ? `Approving ${approvedCount} ${approvedCount === 1 ? 'item' : 'items'}${approvedCount ? ` · ${money(approvedTotal)}` : ''}${declinedCount ? `, declining ${declinedCount}` : ''}.${bookingEnabled && approvedCount > 0 ? ' You’ll pick a date next.' : ' Anything left undecided won’t be booked.'}`
                : 'Approve or decline at least one item above, then submit your response.'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-100">
              <span className="text-xs text-gray-400">Or quickly:</span>
              <button disabled={busy} onClick={() => post('/approve-all')}
                className="px-3 py-1.5 text-sm font-semibold text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Approve all
              </button>
              <button disabled={busy} onClick={() => post('/decline-all')}
                className="px-3 py-1.5 text-sm font-semibold text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
                Decline all
              </button>
            </div>
          </div>
        )}

        {/* ── After approval: book online (the clear next step) ────── */}
        {confirmedBooking && (
          <div className="mt-4">
            <BookingConfirmation booking={confirmedBooking} brand={brand} orgName={orgName} phone={organization.phone} address={organization.address} />
          </div>
        )}

        {!confirmedBooking && showBooking && !skipBooking && (
          <div className="mt-4">
            <NextStepTracker current="book" brand={brand} />
            <div className="mt-4">
              <BookingFlow
                token={token!}
                brand={brand}
                approvedSummary={`${approvedCount} item${approvedCount > 1 ? 's' : ''} approved · ${money(approvedTotal)}`}
                onBooked={(b) => { setConfirmedBooking(b); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              />
            </div>
            <button onClick={() => setSkipBooking(true)}
              className="w-full mt-3 h-11 rounded-xl border border-gray-200 bg-white text-gray-500 text-sm font-semibold hover:bg-gray-50">
              I’ll book later
            </button>
          </div>
        )}

        {!confirmedBooking && responded && (!showBooking || skipBooking) && (
          <div className="rounded-2xl mt-4 p-5 text-center border" style={{ backgroundColor: brandTint, borderColor: `color-mix(in srgb, ${brand} 22%, #ffffff)` }}>
            <p className="text-sm font-semibold" style={{ color: onTintInk }}>
              Thank you — your response has been recorded{approvedCount > 0 ? ` (${approvedCount} item${approvedCount > 1 ? 's' : ''} approved)` : ''}.
            </p>
            {showBooking && skipBooking && (
              <button onClick={() => setSkipBooking(false)} style={{ backgroundColor: brand }}
                className="mt-3 h-11 px-5 rounded-xl text-white text-sm font-bold">
                Book your slot now
              </button>
            )}
            {organization.phone && <p className="text-xs mt-2" style={{ color: onTintInk }}>Questions? Call us on {organization.phone}.</p>}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          {orgName}{organization.phone ? ` · ${organization.phone}` : ''}
        </p>
      </div>
    </div>
  )
}
