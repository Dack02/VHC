import { Link } from 'react-router-dom'
import { Skeleton } from '../../components/Skeleton'
import type { ColumnCounts } from './types'

interface Stage {
  key: keyof ColumnCounts
  label: string
  /** statuses for the list-view deep link (comma list supported by the API) */
  statuses: string
  /** colour of the big stage number */
  numberClass: string
  /** status dot colour (design hex) */
  dot: string
}

const STAGES: Stage[] = [
  {
    key: 'technician',
    label: 'Technician Queue',
    statuses: 'created,assigned,in_progress,paused',
    numberClass: 'text-[#16181d]',
    dot: '#a4a8b0'
  },
  {
    key: 'tech_done',
    label: 'Tech Done / Review',
    statuses: 'tech_completed,awaiting_review,awaiting_pricing,awaiting_parts',
    numberClass: 'text-[#16181d]',
    dot: '#c98a2b'
  },
  {
    key: 'advisor',
    label: 'Ready to Send',
    statuses: 'ready_to_send',
    numberClass: 'text-[#16181d]',
    dot: '#3f7fd1'
  },
  {
    key: 'customer',
    label: 'With Customer',
    statuses: 'sent,delivered,opened,partial_response',
    numberClass: 'text-[#16181d]',
    dot: '#7a5ad9'
  },
  {
    key: 'actioned',
    label: 'Actioned',
    statuses: 'authorized,declined,no_show',
    numberClass: 'text-[#2c9367]',
    dot: '#2c9367'
  }
]

interface PipelineStripProps {
  counts: ColumnCounts | null
  loading?: boolean
}

/** The live workflow as a left-to-right funnel; each stage links to the filtered HC list. */
export default function PipelineStrip({ counts, loading = false }: PipelineStripProps) {
  const active =
    (counts?.technician ?? 0) +
    (counts?.tech_done ?? 0) +
    (counts?.advisor ?? 0) +
    (counts?.customer ?? 0)
  const actioned = counts?.actioned ?? 0

  return (
    <div className="bg-white border border-[#ededeb] rounded-[18px] px-7 py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold text-[#16181d]">Health check pipeline</h3>
        <span className="text-[12.5px] text-[#a4a8b0] whitespace-nowrap">
          {active} active · {actioned} actioned today
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1.5 mt-[18px] min-w-[560px]">
          {STAGES.map((stage, i) => (
            <div key={stage.key} className="flex items-center flex-1 min-w-0">
              <Link
                to={`/health-checks?status=${stage.statuses}`}
                className="flex-1 min-w-0 text-center rounded-[10px] py-2 hover:bg-[#f7f7f5] transition-colors"
                title={`View ${stage.label.toLowerCase()} health checks`}
              >
                {loading ? (
                  <Skeleton className="h-[30px] w-12 mx-auto" />
                ) : (
                  <div className={`text-[30px] font-extrabold tabular-nums leading-none tracking-[-0.025em] ${stage.numberClass}`}>
                    {counts?.[stage.key] ?? 0}
                  </div>
                )}
                <div className="flex items-center justify-center gap-[7px] mt-2 text-[12px] font-semibold text-[#7b7f88]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.dot }} />
                  <span className="truncate">{stage.label}</span>
                </div>
              </Link>
              {i < STAGES.length - 1 && (
                <svg className="w-4 h-4 text-[#d0d3d8] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
