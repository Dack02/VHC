import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { CustomerDetail, CustomerStats } from '../../../lib/api'

/**
 * Read-only customer "card" shown as a modal from the New Jobsheet screen, so an
 * advisor can glance at the customer's contact details, stats and vehicles without
 * leaving the booking (which would discard the in-progress draft). "Open full
 * profile" deliberately opens in a new tab for the same reason. Editing lives on
 * the full customer page.
 */

const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n || 0)
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export default function CustomerCardModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { session } = useAuth()
  const token = session?.accessToken
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [stats, setStats] = useState<CustomerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true); setError(null)
    api<CustomerDetail>(`/api/v1/customers/${customerId}`, { token })
      .then(c => { if (!cancelled) setCustomer(c) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load customer') })
      .finally(() => { if (!cancelled) setLoading(false) })
    api<CustomerStats>(`/api/v1/customers/${customerId}/stats`, { token })
      .then(s => { if (!cancelled) setStats(s) })
      .catch(() => { /* stats are non-critical */ })
    return () => { cancelled = true }
  }, [token, customerId])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {customer ? `${customer.firstName} ${customer.lastName}` : 'Customer'}
            </h2>
            <p className="text-xs text-gray-500">Customer card</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a href={`/customers/${customerId}`} target="_blank" rel="noopener noreferrer"
              className="text-sm font-medium text-primary hover:underline whitespace-nowrap">Open full profile ↗</a>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8"><div className="animate-spin h-7 w-7 border-4 border-primary border-t-transparent rounded-full" /></div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : customer ? (
            <>
              {/* Contact */}
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Contact</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                  <div><dt className="text-gray-500">Mobile</dt><dd className="text-gray-900 font-medium">{customer.mobile || '—'}</dd></div>
                  <div className="min-w-0"><dt className="text-gray-500">Email</dt><dd className="text-gray-900 font-medium break-words">{customer.email || '—'}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-gray-500">Address</dt><dd className="text-gray-900 font-medium whitespace-pre-wrap">{customer.address || '—'}</dd></div>
                  {customer.externalId && <div><dt className="text-gray-500">External ID (DMS)</dt><dd className="text-gray-900 font-medium">{customer.externalId}</dd></div>}
                </dl>
              </div>

              {/* Stats */}
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Health Checks" value={String(stats.totalHealthChecks)} />
                  <Stat label="Total Value" value={money(stats.totalAuthorisedValue)} />
                  <Stat label="Last Visit" value={fmtDate(stats.lastVisit)} />
                  <Stat label="Vehicles" value={String(stats.vehicleCount)} />
                </div>
              )}

              {/* Vehicles */}
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Vehicles</h3>
                {customer.vehicles.length === 0 ? (
                  <p className="text-sm text-gray-400">No vehicles on file.</p>
                ) : (
                  <div className="space-y-2">
                    {customer.vehicles.map(v => (
                      <div key={v.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-900">{v.registration}</span>
                        <span className="text-sm text-gray-500 truncate ml-3">{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="text-base font-bold text-gray-900 leading-tight">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}
