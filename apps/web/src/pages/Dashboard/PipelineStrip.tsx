import { Link } from 'react-router-dom'
import { Skeleton } from '../../components/Skeleton'
import type { ColumnCounts } from './types'

interface Stage {
  key: keyof ColumnCounts
  label: string
  /** statuses for the list-view deep link (comma list supported by the API) */
  statuses: string
  countClassName: string
  dotClassName: string
}

const STAGES: Stage[] = [
  {
    key: 'technician',
    label: 'Technician Queue',
    statuses: 'created,assigned,in_progress,paused',
    countClassName: 'text-gray-900',
    dotClassName: 'bg-gray-400'
  },
  {
    key: 'tech_done',
    label: 'Tech Done / Review',
    statuses: 'tech_completed,awaiting_review,awaiting_pricing,awaiting_parts',
    countClassName: 'text-rag-amber',
    dotClassName: 'bg-rag-amber'
  },
  {
    key: 'advisor',
    label: 'Ready to Send',
    statuses: 'ready_to_send',
    countClassName: 'text-primary',
    dotClassName: 'bg-primary'
  },
  {
    key: 'customer',
    label: 'With Customer',
    statuses: 'sent,delivered,opened,partial_response',
    countClassName: 'text-purple-600',
    dotClassName: 'bg-purple-600'
  },
  {
    key: 'actioned',
    label: 'Actioned',
    statuses: 'authorized,declined,no_show',
    countClassName: 'text-rag-green',
    dotClassName: 'bg-rag-green'
  }
]

interface PipelineStripProps {
  counts: ColumnCounts | null
  loading?: boolean
}

/** The live workflow as a left-to-right funnel; each stage links to the filtered HC list. */
export default function PipelineStrip({ counts, loading = false }: PipelineStripProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 overflow-x-auto">
      <div className="flex items-stretch min-w-[640px]">
        {STAGES.map((stage, i) => (
          <div key={stage.key} className="flex items-center flex-1 min-w-0">
            <Link
              to={`/health-checks?status=${stage.statuses}`}
              className="flex-1 min-w-0 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
              title={`View ${stage.label.toLowerCase()} health checks`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${stage.dotClassName}`} />
                <span className="text-xs text-gray-500 truncate">{stage.label}</span>
              </div>
              {loading ? (
                <Skeleton className="h-7 w-10 mt-1" />
              ) : (
                <div className={`text-2xl font-bold tabular-nums ${stage.countClassName}`}>
                  {counts?.[stage.key] ?? 0}
                </div>
              )}
            </Link>
            {i < STAGES.length - 1 && (
              <svg className="w-4 h-4 text-gray-300 shrink-0 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
