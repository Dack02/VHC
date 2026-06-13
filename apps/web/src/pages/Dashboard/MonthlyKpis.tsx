import KpiCard, { type KpiDelta } from './KpiCard'
import type { MonthlyKpiData } from './types'
import { formatCurrency } from './types'

interface MonthlyKpisProps {
  data: MonthlyKpiData | null
  loading: boolean
}

function pctDelta(value: number | null): KpiDelta | null {
  if (value === null) return null
  return { text: `${value > 0 ? '+' : ''}${value}%`, positive: value >= 0 }
}

function currencyDelta(value: number | null): KpiDelta | null {
  if (value === null) return null
  return { text: `${value > 0 ? '+' : ''}${formatCurrency(value)}`, positive: value >= 0 }
}

function numberDelta(value: number | null): KpiDelta | null {
  if (value === null) return null
  return { text: `${value > 0 ? '+' : ''}${value}`, positive: value >= 0 }
}

/** Month-to-date performance with deltas vs last month — every card here is month-scoped. */
export default function MonthlyKpis({ data, loading }: MonthlyKpisProps) {
  const current = data?.currentMonth
  const deltas = data?.deltas

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">
          Monthly Performance{current ? ` — ${current.label}` : ''}
        </h2>
        {data?.previousMonth && (
          <span className="text-xs text-gray-400">vs {data.previousMonth.label}</span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KpiCard
          label="Red Sold"
          value={current?.redSoldPct !== null && current?.redSoldPct !== undefined ? `${current.redSoldPct}%` : '--'}
          delta={pctDelta(deltas?.redSoldPct ?? null)}
          tooltip="Red (urgent) inspection items authorised this month, out of red inspection items identified. Excludes MRI."
          loading={loading}
        />
        <KpiCard
          label="Amber Sold"
          value={current?.amberSoldPct !== null && current?.amberSoldPct !== undefined ? `${current.amberSoldPct}%` : '--'}
          delta={pctDelta(deltas?.amberSoldPct ?? null)}
          tooltip="Amber (advisory) inspection items authorised this month, out of amber inspection items identified. Excludes MRI."
          loading={loading}
        />
        <KpiCard
          label="MRI Sold"
          value={current?.mriSoldPct !== null && current?.mriSoldPct !== undefined ? `${current.mriSoldPct}%` : '--'}
          delta={pctDelta(deltas?.mriSoldPct ?? null)}
          subtext={current && current.mriIdentifiedCount > 0 ? `${current.mriAuthorisedCount}/${current.mriIdentifiedCount} MRI items` : undefined}
          tooltip="Manufacturer-recommended items authorised this month, out of MRI items identified. Tracked separately from inspection work."
          loading={loading}
        />
        <KpiCard
          label="Avg Identified"
          value={current?.avgIdentified !== null && current?.avgIdentified !== undefined ? formatCurrency(current.avgIdentified) : '--'}
          delta={currencyDelta(deltas?.avgIdentified ?? null)}
          tooltip="Average value of work found per health check this month (inc. VAT)"
          valueClassName="text-gray-900 !text-xl lg:!text-2xl"
          loading={loading}
        />
        <KpiCard
          label="Avg Sold"
          value={current?.avgSold !== null && current?.avgSold !== undefined ? formatCurrency(current.avgSold) : '--'}
          delta={currencyDelta(deltas?.avgSold ?? null)}
          tooltip="Average value of work authorised per health check this month (inc. VAT)"
          valueClassName="text-gray-900 !text-xl lg:!text-2xl"
          loading={loading}
        />
        <KpiCard
          label="HCs / Day"
          value={current?.avgPerDay ?? '--'}
          delta={numberDelta(deltas?.avgPerDay ?? null)}
          tooltip="Inspections completed per day this month (completed by the technician)"
          loading={loading}
        />

        {/* Advisor of the Month */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <div className="text-sm text-gray-500">Advisor of the Month</div>
          {current?.topAdvisor ? (
            <div className="mt-1">
              <div className="text-lg font-bold text-gray-900 truncate">{current.topAdvisor.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {Math.round(current.topAdvisor.redSoldPct)}% red sold · {formatCurrency(current.topAdvisor.totalSold)}
              </div>
            </div>
          ) : (
            <div className="text-2xl font-bold text-gray-400 mt-1">--</div>
          )}
        </div>
      </div>
    </div>
  )
}
