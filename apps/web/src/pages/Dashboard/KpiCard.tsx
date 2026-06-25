import { Link } from 'react-router-dom'
import { Tooltip } from '../../components/ui/Tooltip'
import { Skeleton } from '../../components/Skeleton'

export interface KpiDelta {
  /** Pre-formatted delta text, e.g. "+£12.50" or "-3.1%" */
  text: string
  positive: boolean
}

interface KpiCardProps {
  label: string
  value: React.ReactNode
  /** Small context line under the value, e.g. "7/9 presented" */
  subtext?: string
  /** vs-previous-period chip in the top-right corner */
  delta?: KpiDelta | null
  /** Scope badge in the top-right corner (e.g. "Today") — mutually exclusive with delta */
  badge?: { text: string; className: string }
  /** Plain-English definition shown on hover of the ⓘ icon */
  tooltip?: string
  /** Makes the whole card a link */
  to?: string
  loading?: boolean
  valueClassName?: string
}

export default function KpiCard({
  label,
  value,
  subtext,
  delta,
  badge,
  tooltip,
  to,
  loading = false,
  valueClassName = 'text-gray-900'
}: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
          <div className="text-sm text-gray-500 truncate">{label}</div>
          {tooltip && (
            <Tooltip content={tooltip}>
              <svg className="w-3.5 h-3.5 text-gray-300 hover:text-gray-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </Tooltip>
          )}
        </div>
        {delta && (
          <span className={`flex items-center text-xs font-medium shrink-0 ${delta.positive ? 'text-emerald-600' : 'text-red-600'}`}>
            <svg className={`w-3 h-3 mr-0.5 ${!delta.positive ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            {delta.text}
          </span>
        )}
        {!delta && badge && (
          <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded-full shrink-0 ${badge.className}`}>
            {badge.text}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20 mt-2" />
      ) : (
        <div className={`text-2xl lg:text-3xl font-bold mt-1 tabular-nums ${valueClassName}`}>{value}</div>
      )}
      {subtext && !loading && <div className="text-xs text-gray-400 mt-1 truncate">{subtext}</div>}
    </>
  )

  const cardClass = 'bg-white border border-gray-200 rounded-xl shadow-sm p-4 block'

  if (to) {
    return (
      <Link to={to} className={`${cardClass} hover:border-primary transition-colors`}>
        {body}
      </Link>
    )
  }
  return <div className={cardClass}>{body}</div>
}
