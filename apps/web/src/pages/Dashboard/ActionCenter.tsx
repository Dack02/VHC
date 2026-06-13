import { Link } from 'react-router-dom'
import type { AwaitingArrivalItem, AwaitingCheckinItem, QueueItem } from './types'

interface ActionCenterProps {
  awaitingCheckin: AwaitingCheckinItem[]
  awaitingCheckinLoading: boolean
  onRefreshCheckin: () => void
  needsAttention: { items: QueueItem[]; total: number } | null
  awaitingArrival: AwaitingArrivalItem[]
  awaitingArrivalTotal: number
  awaitingArrivalLoading: boolean
  onRefreshArrival: () => void
  onMarkArrived: (id: string) => void
  onMarkNoShow: (id: string) => void
  onDelete: (item: AwaitingArrivalItem) => void
  isAdmin: boolean
}

function SectionHeader({
  title,
  count,
  tone,
  right
}: {
  title: string
  count: number
  tone: 'red' | 'amber' | 'blue'
  right?: React.ReactNode
}) {
  const tones = {
    red: 'text-red-700 bg-red-600',
    amber: 'text-amber-700 bg-amber-500',
    blue: 'text-primary bg-primary'
  }
  const [textTone, badgeTone] = [tones[tone].split(' ')[0], tones[tone].split(' ')[1]]
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-gray-50/80 border-y border-gray-100 first:border-t-0">
      <div className="flex items-center gap-2">
        <h3 className={`text-sm font-semibold ${textTone}`}>{title}</h3>
        <span className={`${badgeTone} text-white px-2 py-0.5 text-xs font-bold rounded-full`}>{count}</span>
      </div>
      {right}
    </div>
  )
}

function RefreshButton({ onClick, loading, className = 'text-gray-500 hover:bg-gray-100' }: { onClick: () => void; loading: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={loading} className={`p-1.5 rounded-lg disabled:opacity-50 ${className}`} title="Refresh">
      <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  )
}

/**
 * One prioritized zone for everything that needs a human right now:
 * check-ins (vehicle is here), overdue/expiring health checks, and
 * expected arrivals with their one-click actions.
 */
export default function ActionCenter({
  awaitingCheckin,
  awaitingCheckinLoading,
  onRefreshCheckin,
  needsAttention,
  awaitingArrival,
  awaitingArrivalTotal,
  awaitingArrivalLoading,
  onRefreshArrival,
  onMarkArrived,
  onMarkNoShow,
  onDelete,
  isAdmin
}: ActionCenterProps) {
  const attentionItems = needsAttention?.items || []
  const totalActions = awaitingCheckin.length + (needsAttention?.total || 0) + awaitingArrivalTotal

  if (totalActions === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        All clear — nothing needs attention right now
      </div>
    )
  }

  return (
    <div className="bg-white border-2 border-red-300 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <h2 className="font-bold text-red-700">Action Center</h2>
        </div>
        <span className="bg-red-600 text-white px-2.5 py-0.5 text-sm font-bold rounded-full">{totalActions}</span>
      </div>

      {/* 1. Check-in required — vehicle is on site, customer may be standing there */}
      {awaitingCheckin.length > 0 && (
        <>
          <SectionHeader
            title="Check-In Required"
            count={awaitingCheckin.length}
            tone="red"
            right={
              <div className="flex items-center gap-2">
                <RefreshButton onClick={onRefreshCheckin} loading={awaitingCheckinLoading} className="text-red-600 hover:bg-red-100" />
                <Link to="/health-checks?status=awaiting_checkin" className="text-xs text-red-600 hover:underline font-medium">
                  View All
                </Link>
              </div>
            }
          />
          <div className="divide-y divide-gray-100">
            {awaitingCheckin.map(item => {
              const arrivedTime = item.arrivedAt ? new Date(item.arrivedAt) : null
              const isValidDate = arrivedTime && !isNaN(arrivedTime.getTime())
              const elapsedMinutes = isValidDate
                ? Math.floor((Date.now() - arrivedTime.getTime()) / (1000 * 60))
                : null
              const isOverdue = elapsedMinutes !== null && elapsedMinutes >= 20

              return (
                <Link
                  key={item.id}
                  to={`/health-checks/${item.id}?tab=checkin`}
                  className={`flex items-center justify-between gap-3 p-3 hover:bg-red-50 ${isOverdue ? 'bg-red-100' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <span className="font-mono font-semibold text-gray-900 bg-yellow-50 px-2.5 py-1 border border-gray-300 rounded-lg text-sm">
                        {item.registration}
                      </span>
                      {item.customerWaiting && (
                        <span className="px-2 py-0.5 text-xs font-bold text-white bg-red-600 rounded-full animate-pulse">WAITING</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900 truncate">{item.make} {item.model}</div>
                      <div className="text-sm text-gray-500 truncate">{item.customerName}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`text-right ${isOverdue ? 'text-red-700' : 'text-gray-600'}`}>
                      <span className={`font-medium tabular-nums ${isOverdue ? 'font-bold' : ''}`}>
                        {elapsedMinutes !== null ? `${elapsedMinutes}m` : '-'}
                      </span>
                      <div className="text-xs text-gray-400">
                        {isValidDate ? `Arrived ${arrivedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Awaiting arrival'}
                      </div>
                    </div>
                    <span className="px-3 py-1.5 bg-red-600 text-white text-sm font-bold rounded-lg">CHECK IN</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}

      {/* 2. Overdue / expiring health checks */}
      {attentionItems.length > 0 && (
        <>
          <SectionHeader title="Needs Attention" count={needsAttention?.total || 0} tone="amber" />
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {attentionItems.map(item => (
              <Link key={item.id} to={`/health-checks/${item.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">{item.vehicle?.registration}</div>
                  <div className="text-sm text-gray-500 truncate">
                    {item.customer?.first_name} {item.customer?.last_name}
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full text-white shrink-0 ${
                  item.alertType === 'overdue' ? 'bg-rag-red' : 'bg-rag-amber'
                }`}>
                  {item.alertType === 'overdue' ? 'OVERDUE' : 'EXPIRING'}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* 3. Awaiting arrival (DMS imports) */}
      {awaitingArrival.length > 0 && (
        <>
          <SectionHeader
            title="Awaiting Arrival"
            count={awaitingArrivalTotal}
            tone="blue"
            right={
              <div className="flex items-center gap-2">
                <RefreshButton onClick={onRefreshArrival} loading={awaitingArrivalLoading} />
                <Link to="/health-checks?status=awaiting_arrival" className="text-xs text-primary hover:underline font-medium">
                  View All
                </Link>
              </div>
            }
          />
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {awaitingArrival.map(item => (
              <div key={item.id} className={`p-3 flex items-center justify-between gap-3 hover:bg-gray-50 ${item.customerWaiting ? 'bg-red-50' : ''}`}>
                <Link to={`/health-checks/${item.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-mono font-semibold text-gray-900 bg-yellow-50 px-2.5 py-1 border border-gray-300 rounded-lg text-sm">
                        {item.registration}
                      </span>
                      {item.customerWaiting && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold text-white bg-red-600 rounded-full animate-pulse">
                          <span className="w-2 h-2 bg-white rounded-full"></span>
                          WAITING
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900 truncate flex items-center gap-2">
                        {item.make} {item.model}
                        {item.loanCarRequired && (
                          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-100 rounded-full" title="Loan car required">
                            LOAN
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 truncate">{item.customerName}</div>
                    </div>
                    {(item.dueDate || item.promiseTime) && (
                      <div className="text-sm text-gray-500">
                        Due: {new Date(item.dueDate || item.promiseTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                    {item.bookedRepairs && item.bookedRepairs.length > 0 && (
                      <div className="text-xs text-gray-400" title={item.bookedRepairs.map(r => r.description).join(', ')}>
                        {item.bookedRepairs.length} pre-booked
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onMarkArrived(item.id)}
                    className="px-3 py-1.5 bg-rag-green text-white text-sm font-medium rounded-lg hover:bg-rag-green/90"
                    title="Mark vehicle as arrived"
                  >
                    Arrived
                  </button>
                  <button
                    onClick={() => onMarkNoShow(item.id)}
                    className="px-3 py-1.5 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600"
                    title="Mark as no-show"
                  >
                    No Show
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => onDelete(item)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete health check"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
