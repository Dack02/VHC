import { Link } from 'react-router-dom'
import type { QueueItem, TechnicianWorkloadEntry } from './types'
import { formatStatusLabel } from './types'

interface TeamPanelProps {
  technicians: TechnicianWorkloadEntry[]
  customerQueue: { items: QueueItem[]; total: number } | null
}

// Stale open time entries can be days old — keep the display readable
function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d+`
}

/** Side-by-side team view: technician workload and what's sitting with customers. */
export default function TeamPanel({ technicians, customerQueue }: TeamPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Technician Workload */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Technician Workload</h2>
          <Link to="/dashboard/technicians" className="text-sm text-primary hover:underline">
            View All
          </Link>
        </div>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {technicians.map(tech => (
            <div key={tech.id} className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      tech.status === 'working' ? 'bg-rag-green' :
                      tech.status === 'available' ? 'bg-rag-amber' : 'bg-gray-400'
                    }`}
                    title={tech.status}
                  />
                  <div>
                    <div className="font-medium text-gray-900">{tech.firstName} {tech.lastName}</div>
                    {tech.currentJob && (
                      <div className="text-sm text-gray-500">
                        {tech.currentJob.vehicle.registration} · {formatElapsed(tech.currentJob.timeElapsedMinutes)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900">{tech.queueCount} in queue</div>
                  <div className="text-xs text-gray-500">{tech.completedToday} completed today</div>
                </div>
              </div>
            </div>
          ))}
          {technicians.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">No technicians found</div>
          )}
        </div>
      </div>

      {/* With Customer */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between bg-purple-50 rounded-t-xl">
          <h2 className="font-semibold text-purple-700">With Customer</h2>
          <span className="bg-purple-600 text-white px-2 py-0.5 text-sm font-medium rounded-full">
            {customerQueue?.total || 0}
          </span>
        </div>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {customerQueue?.items.map(item => (
            <Link key={item.id} to={`/health-checks/${item.id}`} className="block p-3 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">{item.vehicle?.registration}</div>
                  <div className="text-sm text-gray-500">
                    {item.customer?.first_name} {item.customer?.last_name}
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  item.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                  item.status === 'delivered' ? 'bg-blue-200 text-blue-800' :
                  item.status === 'opened' ? 'bg-purple-100 text-purple-700' :
                  'bg-purple-200 text-purple-800'
                }`}>
                  {formatStatusLabel(item.status).toUpperCase()}
                </span>
              </div>
            </Link>
          ))}
          {(!customerQueue || customerQueue.items.length === 0) && (
            <div className="p-4 text-center text-gray-500 text-sm">No items with customers</div>
          )}
        </div>
      </div>
    </div>
  )
}
