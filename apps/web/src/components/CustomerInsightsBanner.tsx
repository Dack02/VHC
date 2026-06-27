import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

/**
 * Shared "smart banner" shown on the Estimate / Jobsheet / VHC detail pages. Renders a
 * compact, conditional strip of staff-facing cues — each badge appears ONLY when its
 * trigger fires (Salesforce "Dynamic Highlights" pattern), ordered safety → commercial →
 * lifecycle. Staff-only: never rendered on the customer-facing portal / PDF.
 */

interface Insights {
  customer: {
    isNew: boolean
    totalVisits: number
    lastVisitAt: string | null
    monthsSinceLastVisit: number | null
    lapsedTier: 'none' | 'soft' | 'lapsed' | 'long'
    wasRegular: boolean
  }
  deferred: { count: number; totalValue: number; caseId: string | null }
  mot: { status: string | null; expiryDate: string | null; daysToExpiry: number | null; tier: 'expired' | 'due' | 'ok' | 'unknown' } | null
}

type Severity = 'red' | 'amber' | 'info'

const PILL: Record<Severity, string> = {
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-indigo-50 text-indigo-700 border-indigo-200'
}

function monthLabel(m: number | null): string {
  if (m == null) return ''
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`
  const y = Math.floor(m / 12)
  const r = m % 12
  return r ? `${y}y ${r}m` : `${y} year${y === 1 ? '' : 's'}`
}
function shortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

interface Badge { key: string; severity: Severity; label: string; title?: string; to?: string; icon: JSX.Element }

const icons = {
  alert: <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" /></svg>,
  clock: <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  wrench: <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  sparkle: <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
}

function buildBadges(ins: Insights): Badge[] {
  const out: Badge[] = []

  // 1. Safety — MOT.
  if (ins.mot && ins.mot.tier === 'expired') {
    out.push({ key: 'mot', severity: 'red', label: 'MOT expired', title: ins.mot.expiryDate ? `Expired ${shortDate(ins.mot.expiryDate)}` : undefined, icon: icons.alert })
  } else if (ins.mot && ins.mot.tier === 'due') {
    const d = ins.mot.daysToExpiry
    out.push({ key: 'mot', severity: 'amber', label: d != null ? `MOT due in ${d} day${d === 1 ? '' : 's'}` : 'MOT due soon', title: ins.mot.expiryDate ? `Expires ${shortDate(ins.mot.expiryDate)}` : undefined, icon: icons.alert })
  }

  // 2. Commercial — outstanding advised work.
  if (ins.deferred.count > 0) {
    out.push({
      key: 'deferred',
      severity: 'amber',
      label: `£${Math.round(ins.deferred.totalValue).toLocaleString()} advised work outstanding`,
      title: `${ins.deferred.count} deferred item${ins.deferred.count === 1 ? '' : 's'} not yet done`,
      to: '/follow-ups',
      icon: icons.wrench
    })
  }

  // 3. Lifecycle — lapsed / at-risk.
  if (ins.customer.lapsedTier !== 'none') {
    const sev: Severity = ins.customer.lapsedTier === 'soft' ? 'amber' : 'red'
    const m = monthLabel(ins.customer.monthsSinceLastVisit)
    const lead = ins.customer.wasRegular ? 'Regular customer — not seen' : 'Not seen'
    out.push({ key: 'lapsed', severity: sev, label: `${lead} in ${m}`, title: ins.customer.lastVisitAt ? `Last visit ${shortDate(ins.customer.lastVisitAt)} · ${ins.customer.totalVisits} visits` : undefined, icon: icons.clock })
  }

  // 4. Lifecycle — new customer.
  if (ins.customer.isNew) {
    out.push({ key: 'new', severity: 'info', label: 'New customer', title: 'No service history on file — confirm contact details', icon: icons.sparkle })
  }

  return out
}

export default function CustomerInsightsBanner({
  customerId, vehicleId, excludeHealthCheckId, className = ''
}: {
  customerId?: string | null
  vehicleId?: string | null
  excludeHealthCheckId?: string | null
  className?: string
}) {
  const { session } = useAuth()
  const token = session?.accessToken
  const [badges, setBadges] = useState<Badge[]>([])

  useEffect(() => {
    if (!token || !customerId) { setBadges([]); return }
    const qs = new URLSearchParams()
    if (vehicleId) qs.set('vehicle_id', vehicleId)
    if (excludeHealthCheckId) qs.set('exclude_hc', excludeHealthCheckId)
    let cancelled = false
    api<Insights>(`/api/v1/customers/${customerId}/insights${qs.toString() ? `?${qs}` : ''}`, { token })
      .then(d => { if (!cancelled) setBadges(buildBadges(d)) })
      .catch(() => { if (!cancelled) setBadges([]) })
    return () => { cancelled = true }
  }, [token, customerId, vehicleId, excludeHealthCheckId])

  if (badges.length === 0) return null

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {badges.map(b => {
        const cls = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${PILL[b.severity]}`
        const content = <>{b.icon}<span>{b.label}</span></>
        return b.to
          ? <Link key={b.key} to={b.to} title={b.title} className={`${cls} hover:brightness-95`}>{content}</Link>
          : <span key={b.key} title={b.title} className={cls}>{content}</span>
      })}
    </div>
  )
}
