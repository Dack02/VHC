import { Link } from 'react-router-dom'
import { jobPath } from '../../lib/jobLink'
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

const TONE_DOT: Record<'red' | 'amber' | 'blue', string> = {
  red: '#cf4a45',
  amber: '#c98a2b',
  blue: '#3f7fd1'
}

/**
 * "Due …" label for an arrival row — friendly date (no year) so staleness is obvious.
 * Date-only DMS imports arrive as midnight UTC, which would render as a misleading
 * "01:00" (BST); for those we drop the time and show just the date. Real promise times
 * keep the clock. Anything due before today is flagged in red as overdue/stale.
 */
function DueLabel({ iso }: { iso: string }) {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const overdue = d.getTime() < startOfToday.getTime()
  return (
    <div className={`text-[12.5px] ${overdue ? 'text-[#cf4a45] font-medium' : 'text-[#7b7f88]'}`}>
      Due {dateOnly ? datePart : `${datePart} · ${time}`}
    </div>
  )
}

/** Reg-plate chip — IBM Plex Mono on the amber paper background from the design tokens. */
function PlateChip({ reg }: { reg: string }) {
  return (
    <span className="font-mono text-[11.5px] bg-[#fdf6dd] border border-[#efe2a8] text-[#796a1f] rounded-[5px] px-[7px] py-0.5 whitespace-nowrap">
      {reg}
    </span>
  )
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
  return (
    <div className="flex items-center justify-between px-[22px] py-2 bg-[#fafaf8] border-y border-[#f3f3f1]">
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: TONE_DOT[tone] }} />
        <h3 className="text-[13px] font-semibold text-[#3a3f48]">{title}</h3>
        <span className="bg-[#f0f0ee] text-[#7b7f88] px-2 py-px text-[11px] font-semibold rounded-full min-w-[21px] text-center">
          {count}
        </span>
      </div>
      {right}
    </div>
  )
}

function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} className="p-1.5 rounded-lg text-[#7b7f88] hover:bg-[#f0f0ee] disabled:opacity-50" title="Refresh">
      <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  )
}

const btnPrimary = 'bg-[#2c9367] text-white rounded-[9px] px-[17px] py-[9px] text-[13px] font-semibold hover:opacity-90'
const btnSecondary = 'bg-white text-[#5f636c] border border-[#e6e6e3] rounded-[9px] px-[17px] py-[9px] text-[13px] font-semibold hover:bg-[#f7f7f5]'

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
      <div className="flex items-center gap-2.5 px-[22px] py-3.5 bg-white border border-[#ededeb] rounded-[14px] text-[13px] font-medium text-[#2c9367]">
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M21.801 10A10 10 0 1 1 17 3.335" />
          <path d="m9 11 3 3L22 4" />
        </svg>
        All clear — nothing needs action right now
      </div>
    )
  }

  // Short descriptor for the banner title, e.g. "2 to check in · 1 awaiting arrival"
  const summaryParts: string[] = []
  if (awaitingCheckin.length) summaryParts.push(`${awaitingCheckin.length} to check in`)
  if (needsAttention?.total) summaryParts.push(`${needsAttention.total} need${needsAttention.total === 1 ? 's' : ''} attention`)
  if (awaitingArrivalTotal) summaryParts.push(`${awaitingArrivalTotal} awaiting arrival`)

  return (
    <div className="bg-white border border-[#ededeb] border-l-4 border-l-[#cf4a45] rounded-[14px] overflow-hidden">
      {/* Banner header */}
      <div className="flex items-center gap-[15px] px-[22px] py-[15px]">
        <span className="w-[34px] h-[34px] rounded-[10px] bg-[#fbeceb] text-[#cf4a45] flex items-center justify-center flex-none">
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M10.268 21a2 2 0 0 0 3.464 0" />
            <path d="M22 8c0-2.3-.8-4.3-2-6" />
            <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
            <path d="M4 2C2.8 3.7 2 5.7 2 8" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-[#16181d]">
            Action Center{summaryParts.length ? ` · ${summaryParts.join(' · ')}` : ''}
          </div>
          <div className="text-[12.5px] text-[#7b7f88] mt-[3px]">Needs a human right now</div>
        </div>
      </div>

      {/* 1. Check-in required — vehicle is on site, customer may be standing there */}
      {awaitingCheckin.length > 0 && (
        <>
          <SectionHeader
            title="Check-in required"
            count={awaitingCheckin.length}
            tone="red"
            right={
              <div className="flex items-center gap-2">
                <RefreshButton onClick={onRefreshCheckin} loading={awaitingCheckinLoading} />
                <Link to="/health-checks?status=awaiting_checkin" className="text-[12px] font-semibold text-primary hover:underline">
                  View all
                </Link>
              </div>
            }
          />
          <div>
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
                  to={jobPath({ jobsheetId: item.jobsheetId, healthCheckId: item.id }, { tab: 'checkin' })}
                  className={`flex items-center justify-between gap-3 px-[22px] py-3 border-b border-[#f3f3f1] last:border-0 hover:bg-[#f7f7f5] ${isOverdue ? 'bg-[#fbeceb]/60' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <PlateChip reg={item.registration} />
                      {item.customerWaiting && (
                        <span className="px-2 py-0.5 text-[10px] font-bold text-white bg-[#cf4a45] rounded-full animate-pulse">WAITING</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-[#16181d] truncate">{item.make} {item.model}</div>
                      <div className="text-[12.5px] text-[#7b7f88] truncate">{item.customerName}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`text-right ${isOverdue ? 'text-[#cf4a45]' : 'text-[#7b7f88]'}`}>
                      <span className={`text-[13px] font-semibold tabular-nums ${isOverdue ? 'font-bold' : ''}`}>
                        {elapsedMinutes !== null ? `${elapsedMinutes}m` : '-'}
                      </span>
                      <div className="text-[11px] text-[#a4a8b0]">
                        {isValidDate ? `Arrived ${arrivedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Awaiting arrival'}
                      </div>
                    </div>
                    <span className="px-[15px] py-[7px] bg-[#cf4a45] text-white text-[12px] font-bold rounded-[9px]">CHECK IN</span>
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
          <SectionHeader title="Needs attention" count={needsAttention?.total || 0} tone="amber" />
          <div className="max-h-64 overflow-y-auto">
            {attentionItems.map(item => (
              <Link key={item.id} to={jobPath({ jobsheetId: item.jobsheet_id, healthCheckId: item.id })} className="flex items-center justify-between gap-3 px-[22px] py-3 border-b border-[#f3f3f1] last:border-0 hover:bg-[#f7f7f5]">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-[#16181d] truncate">{item.vehicle?.registration}</div>
                  <div className="text-[12.5px] text-[#7b7f88] truncate">
                    {item.customer?.first_name} {item.customer?.last_name}
                  </div>
                </div>
                <span
                  className="px-2 py-0.5 text-[11px] font-semibold rounded-full shrink-0 text-white"
                  style={{ background: item.alertType === 'overdue' ? '#cf4a45' : '#c98a2b' }}
                >
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
            title="Awaiting arrival"
            count={awaitingArrivalTotal}
            tone="blue"
            right={
              <div className="flex items-center gap-2">
                <RefreshButton onClick={onRefreshArrival} loading={awaitingArrivalLoading} />
                <Link to="/health-checks?status=awaiting_arrival" className="text-[12px] font-semibold text-primary hover:underline">
                  View all
                </Link>
              </div>
            }
          />
          <div className="max-h-80 overflow-y-auto">
            {awaitingArrival.map(item => (
              <div key={item.id} className={`px-[22px] py-3 flex items-center justify-between gap-3 border-b border-[#f3f3f1] last:border-0 hover:bg-[#f7f7f5] ${item.customerWaiting ? 'bg-[#fbeceb]/60' : ''}`}>
                <Link to={jobPath({ jobsheetId: item.jobsheetId, healthCheckId: item.id })} className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex flex-col items-center gap-1">
                      <PlateChip reg={item.registration} />
                      {item.customerWaiting && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-white bg-[#cf4a45] rounded-full animate-pulse">
                          <span className="w-1.5 h-1.5 bg-white rounded-full" />
                          WAITING
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-[#16181d] truncate flex items-center gap-2">
                        {item.make} {item.model}
                        {item.loanCarRequired && (
                          <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold text-[#3f7fd1] bg-[#3f7fd1]/10 rounded-full" title="Loan car required">
                            LOAN
                          </span>
                        )}
                      </div>
                      <div className="text-[12.5px] text-[#7b7f88] truncate">{item.customerName}</div>
                    </div>
                    {(item.dueDate || item.promiseTime) && (
                      <DueLabel iso={(item.dueDate || item.promiseTime)!} />
                    )}
                    {item.bookedRepairs && item.bookedRepairs.length > 0 && (
                      <div className="text-[11px] text-[#a4a8b0]" title={item.bookedRepairs.map(r => r.description).join(', ')}>
                        {item.bookedRepairs.length} pre-booked
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onMarkArrived(item.id)} className={btnPrimary} title="Mark vehicle as arrived">
                    Arrived
                  </button>
                  <button onClick={() => onMarkNoShow(item.id)} className={btnSecondary} title="Mark as no-show">
                    No show
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => onDelete(item)}
                      className="p-1.5 text-[#a4a8b0] hover:text-[#cf4a45] hover:bg-[#fbeceb] rounded-lg transition-colors"
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
