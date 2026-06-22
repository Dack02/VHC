import { Skeleton } from '../../components/Skeleton'
import type { MonthlyKpiData } from './types'
import { formatCurrency } from './types'

interface MonthlyKpisProps {
  data: MonthlyKpiData | null
  loading: boolean
}

/** Small green/red delta pill with a diagonal arrow (up-right for gains, rotated for declines). */
function DeltaChip({ value, text }: { value: number; text: string }) {
  const positive = value >= 0
  const color = positive ? '#2c9367' : '#cf4a45'
  return (
    <span
      className="inline-flex items-center gap-[3px] text-[12px] font-semibold min-w-[66px] justify-end"
      style={{ color }}
    >
      <svg
        className={`w-3.5 h-3.5 ${positive ? '' : 'rotate-90'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
      >
        <line x1="7" y1="17" x2="17" y2="7" />
        <polyline points="7 7 17 7 17 17" />
      </svg>
      {text}
    </span>
  )
}

function deltaChip(value: number | null | undefined, fmt: (n: number) => string) {
  if (value === null || value === undefined) return null
  return <DeltaChip value={value} text={fmt(Math.abs(value))} />
}

function MetricRow({
  label,
  sub,
  value,
  delta,
  loading
}: {
  label: string
  sub?: string
  value: string
  delta?: React.ReactNode
  loading: boolean
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#f3f3f1]">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-[#3a3f48]">{label}</div>
        {sub && <div className="text-[11px] text-[#a4a8b0] mt-0.5">{sub}</div>}
      </div>
      <div className="flex items-center gap-3.5 shrink-0">
        {loading ? (
          <Skeleton className="h-5 w-14" />
        ) : (
          <span className="text-[17px] font-extrabold text-[#16181d] tabular-nums">{value}</span>
        )}
        {!loading && delta}
      </div>
    </div>
  )
}

const pct = (n: number) => `${n}%`
const num = (n: number) => `${n}`

/** Month-to-date performance with deltas vs last month, plus the advisor-of-the-month focal banner. */
export default function MonthlyKpis({ data, loading }: MonthlyKpisProps) {
  const current = data?.currentMonth
  const deltas = data?.deltas
  const advisor = current?.topAdvisor

  const advisorInitials = advisor
    ? advisor.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : ''

  const v = (value: number | null | undefined, fmt: (n: number) => string) =>
    value === null || value === undefined ? '--' : fmt(value)

  return (
    <div className="bg-white border border-[#ededeb] rounded-[18px] px-6 py-[22px]">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-[9px]">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <h2 className="text-[15px] font-bold text-[#16181d]">This month</h2>
        </div>
        {current && data?.previousMonth && (
          <span className="text-[11.5px] text-[#a4a8b0]">
            {current.label} vs {data.previousMonth.label}
          </span>
        )}
      </div>

      <MetricRow label="Red Sold" value={v(current?.redSoldPct, pct)} delta={deltaChip(deltas?.redSoldPct, pct)} loading={loading} />
      <MetricRow label="Amber Sold" value={v(current?.amberSoldPct, pct)} delta={deltaChip(deltas?.amberSoldPct, pct)} loading={loading} />
      <MetricRow
        label="MRI Sold"
        sub={current && current.mriIdentifiedCount > 0 ? `${current.mriAuthorisedCount} / ${current.mriIdentifiedCount} MRI items` : undefined}
        value={v(current?.mriSoldPct, pct)}
        delta={deltaChip(deltas?.mriSoldPct, pct)}
        loading={loading}
      />
      <MetricRow label="Avg Identified" value={v(current?.avgIdentified, formatCurrency)} delta={deltaChip(deltas?.avgIdentified, formatCurrency)} loading={loading} />
      <MetricRow label="Avg Sold" value={v(current?.avgSold, formatCurrency)} delta={deltaChip(deltas?.avgSold, formatCurrency)} loading={loading} />
      <MetricRow label="HCs / Day" value={v(current?.avgPerDay, num)} delta={deltaChip(deltas?.avgPerDay, num)} loading={loading} />

      {/* Advisor of the Month — focal dark banner */}
      <div className="mt-4 bg-[#16181d] rounded-[13px] px-4 py-3.5 flex items-center gap-3">
        <span className="w-[38px] h-[38px] rounded-full bg-[#2c2f37] text-white flex items-center justify-center font-bold text-[14px] flex-none">
          {advisor ? advisorInitials : '—'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[10.5px] font-bold tracking-[0.07em] uppercase text-[#8a8f98]">Advisor of the Month</div>
          <div className="text-[15px] font-bold text-white mt-0.5 truncate">
            {advisor ? advisor.name : 'Not enough data yet'}
          </div>
        </div>
        {advisor && (
          <div className="text-right shrink-0">
            <div className="text-[13.5px] font-bold text-white tabular-nums">{formatCurrency(advisor.totalSold)}</div>
            <div className="text-[11px] text-[#9aa0a8]">{Math.round(advisor.redSoldPct)}% red sold</div>
          </div>
        )}
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="#d9a441" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      </div>
    </div>
  )
}
