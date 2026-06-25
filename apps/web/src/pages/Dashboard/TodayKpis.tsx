import { Skeleton } from '../../components/Skeleton'
import type { DashboardMetrics, DateRange, TodayRagData } from './types'
import { formatCurrency } from './types'

const RANGE_TITLE: Record<DateRange, string> = {
  today: 'Today',
  week: 'Last 7 Days',
  month: 'Last 30 Days'
}

interface TodayKpisProps {
  metrics: DashboardMetrics | null
  todayRag: TodayRagData | null
  dateRange: DateRange
  loading: boolean
}

const soldPct = (b?: { itemCount: number; authorizedCount: number }) =>
  b && b.itemCount > 0 ? Math.round((b.authorizedCount / b.itemCount) * 100) : null

function Tile({
  label,
  value,
  valueClassName = 'text-[#16181d]',
  note,
  dot,
  loading
}: {
  label: string
  value: React.ReactNode
  valueClassName?: string
  note?: string
  dot?: string
  loading: boolean
}) {
  return (
    <div className="bg-white border border-[#ededeb] rounded-[12px] px-4 py-[15px]">
      <div className="flex items-center gap-[7px] text-[12px] font-semibold text-[#7b7f88] mb-2.5">
        {dot && <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <div className={`text-[23px] font-extrabold tracking-[-0.02em] tabular-nums leading-none ${valueClassName}`}>
          {value}
        </div>
      )}
      {note && !loading && <div className="text-[10.5px] text-[#a4a8b0] mt-2 leading-snug">{note}</div>}
    </div>
  )
}

/** Period-scoped headline KPIs grouped in the "Today" well, plus (today only) the inspection red/amber + MRI sold tiles. */
export default function TodayKpis({ metrics, todayRag, dateRange, loading }: TodayKpisProps) {
  // Red/Amber = technician-flagged inspection items; MRI tracked separately (its own sales motion)
  const red = todayRag?.ragBreakdown?.inspection?.red
  const amber = todayRag?.ragBreakdown?.inspection?.amber
  const mri = todayRag?.ragBreakdown?.mri
  const redSoldPct = soldPct(red)
  const amberSoldPct = soldPct(amber)
  const mriSoldPct = soldPct(mri)
  const showTodayRag = dateRange === 'today'

  return (
    <div className="bg-[#fafaf8] border border-[#ededeb] rounded-[18px] p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-[9px]">
          <span className="w-2 h-2 rounded-full bg-[#2c9367]" />
          <h2 className="text-[15px] font-bold text-[#16181d]">{RANGE_TITLE[dateRange]}</h2>
        </div>
        {showTodayRag && (
          <span className="text-[11.5px] text-[#a4a8b0]">Live · resets at midnight</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-[11px]">
        <Tile label="Health Checks" value={metrics?.totalToday ?? 0} loading={loading} />
        <Tile label="Completed" value={metrics?.completedToday ?? 0} valueClassName="text-[#2c9367]" loading={loading} />
        <Tile
          label="Conversion"
          value={`${metrics?.conversionRate ?? 0}%`}
          valueClassName="text-primary"
          note={
            metrics && metrics.presentedCount > 0
              ? `${metrics.convertedCount} / ${metrics.presentedCount} presented`
              : 'Nothing presented yet'
          }
          loading={loading}
        />
        <Tile label="Avg Time to Open" value={`${metrics?.avgResponseTimeMinutes ?? 0}m`} loading={loading} />
        <Tile label="Authorized" value={formatCurrency(metrics?.totalValueAuthorized || 0)} valueClassName="text-[#2c9367]" loading={loading} />
        <Tile label="Declined" value={formatCurrency(metrics?.totalValueDeclined || 0)} valueClassName="text-[#cf4a45]" loading={loading} />

        {showTodayRag && (
          <>
            <Tile
              label="Red Sold"
              value={redSoldPct !== null ? `${redSoldPct}%` : '—'}
              dot="#cf4a45"
              note={red ? `${red.authorizedCount} / ${red.itemCount} red items` : undefined}
              loading={loading}
            />
            <Tile
              label="Amber Sold"
              value={amberSoldPct !== null ? `${amberSoldPct}%` : '—'}
              dot="#c98a2b"
              note={amber ? `${amber.authorizedCount} / ${amber.itemCount} amber items` : undefined}
              loading={loading}
            />
            <Tile
              label="MRI Sold"
              value={mriSoldPct !== null ? `${mriSoldPct}%` : '—'}
              dot="#3f7fd1"
              note={mri ? `${mri.authorizedCount} / ${mri.itemCount} MRI items` : undefined}
              loading={loading}
            />
          </>
        )}
      </div>
    </div>
  )
}
