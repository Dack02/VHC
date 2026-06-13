import KpiCard from './KpiCard'
import type { DashboardMetrics, DateRange, TodayRagData } from './types'
import { formatCurrency } from './types'

const RANGE_LABELS: Record<DateRange, string> = {
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

/** Period-scoped headline KPIs plus (today only) the inspection red/amber + MRI sold cards. */
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
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">{RANGE_LABELS[dateRange]}'s Flow</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="Health Checks"
          value={metrics?.totalToday ?? 0}
          tooltip="Health checks due (or created) in the period, plus any with work actioned in the period"
          loading={loading}
        />
        <KpiCard
          label="Completed"
          value={metrics?.completedToday ?? 0}
          tooltip="Health checks the customer has actioned: authorised, declined or completed"
          valueClassName="text-rag-green"
          loading={loading}
        />
        <KpiCard
          label="Conversion"
          value={`${metrics?.conversionRate ?? 0}%`}
          subtext={
            metrics && metrics.presentedCount > 0
              ? `${metrics.convertedCount}/${metrics.presentedCount} presented`
              : 'Nothing presented yet'
          }
          tooltip="Of the health checks presented to customers (sent, or actioned over the phone), the share with at least one item authorised"
          valueClassName="text-primary"
          loading={loading}
        />
        <KpiCard
          label="Avg Time to Open"
          value={`${metrics?.avgResponseTimeMinutes ?? 0}m`}
          tooltip="Average time between sending a health check and the customer first opening it"
          loading={loading}
        />
        <KpiCard
          label="Authorized"
          value={formatCurrency(metrics?.totalValueAuthorized || 0)}
          tooltip="Value of work customers said yes to (inc. VAT)"
          valueClassName="text-rag-green !text-xl lg:!text-2xl"
          loading={loading}
        />
        <KpiCard
          label="Declined"
          value={formatCurrency(metrics?.totalValueDeclined || 0)}
          tooltip="Value of work customers declined (inc. VAT)"
          valueClassName="text-rag-red !text-xl lg:!text-2xl"
          loading={loading}
        />

        {showTodayRag && (
          <>
            <KpiCard
              label="Red Sold"
              value={redSoldPct !== null ? `${redSoldPct}%` : '--'}
              subtext={red ? `${red.authorizedCount}/${red.itemCount} red items` : undefined}
              badge={{ text: 'Today', className: 'bg-red-100 text-red-700' }}
              tooltip="Red (urgent) inspection items authorised today, out of red inspection items identified today. Excludes MRI."
              loading={loading}
            />
            <KpiCard
              label="Amber Sold"
              value={amberSoldPct !== null ? `${amberSoldPct}%` : '--'}
              subtext={amber ? `${amber.authorizedCount}/${amber.itemCount} amber items` : undefined}
              badge={{ text: 'Today', className: 'bg-amber-100 text-amber-700' }}
              tooltip="Amber (advisory) inspection items authorised today, out of amber inspection items identified today. Excludes MRI."
              loading={loading}
            />
            <KpiCard
              label="MRI Sold"
              value={mriSoldPct !== null ? `${mriSoldPct}%` : '--'}
              subtext={mri ? `${mri.authorizedCount}/${mri.itemCount} MRI items` : undefined}
              badge={{ text: 'Today', className: 'bg-indigo-100 text-indigo-700' }}
              tooltip="Manufacturer-recommended items authorised today, out of MRI items identified today. Tracked separately from inspection work."
              loading={loading}
            />
          </>
        )}
      </div>
    </div>
  )
}
