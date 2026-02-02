interface StatCardProps {
  label: string
  value: string | number
  trend?: { direction: 'up' | 'down' | 'flat'; percent: number }
  valueClassName?: string
}

export default function StatCard({ label, value, trend, valueClassName }: StatCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <div className={`text-2xl font-bold ${valueClassName || 'text-gray-900'}`}>
        {value}
      </div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
      {trend && trend.direction !== 'flat' && (
        <div className={`flex items-center mt-2 text-xs font-medium ${
          trend.direction === 'up' ? 'text-green-600' : 'text-red-600'
        }`}>
          <svg className="w-3.5 h-3.5 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={trend.direction === 'up' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
            />
          </svg>
          {Math.abs(trend.percent)}% vs prev period
        </div>
      )}
    </div>
  )
}
