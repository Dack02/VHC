import { Link } from 'react-router-dom'
import { jobPath } from '../../lib/jobLink'
import type { QueueItem, TechnicianWorkloadEntry } from './types'
import { formatStatusLabel } from './types'

interface TeamPanelProps {
  technicians: TechnicianWorkloadEntry[]
  customerQueue: { items: QueueItem[]; total: number } | null
}

const initialsOf = (first: string, last: string) =>
  `${first?.charAt(0) || ''}${last?.charAt(0) || ''}`.toUpperCase() || '?'

/** Bottom row: technician workload (load bars) and what's currently sitting with customers. */
export default function TeamPanel({ technicians, customerQueue }: TeamPanelProps) {
  // Bar is relative to the busiest technician's queue, matching the design's load model.
  const maxQueue = Math.max(1, ...technicians.map(t => t.queueCount))
  const customerItems = customerQueue?.items ?? []

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-6">
      {/* Technician workload */}
      <div className="bg-white border border-[#ededeb] rounded-[18px] px-6 py-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[15px] font-bold text-[#16181d]">Technician workload</h3>
          <Link to="/dashboard/technicians" className="text-[13px] font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {technicians.map(tech => {
            const loadPct = Math.round((tech.queueCount / maxQueue) * 100)
            return (
              <div key={tech.id} className="flex items-center gap-3.5 py-3 border-b border-[#f5f5f3] last:border-0">
                <span className="w-[34px] h-[34px] rounded-full bg-[#f0f0ee] text-[#5f636c] font-bold text-[12.5px] flex items-center justify-center flex-none">
                  {initialsOf(tech.firstName, tech.lastName)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-[7px] gap-2">
                    <span className="text-[13.5px] font-semibold text-[#16181d] truncate">
                      {tech.firstName} {tech.lastName}
                    </span>
                    <span className="text-[12px] text-[#a4a8b0] shrink-0">{tech.queueCount} in queue</span>
                  </div>
                  <div className="h-1.5 bg-[#f0f0ee] rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${loadPct}%` }} />
                  </div>
                </div>
              </div>
            )
          })}
          {technicians.length === 0 && (
            <div className="py-8 text-center text-[#a4a8b0] text-sm">No technicians found</div>
          )}
        </div>
      </div>

      {/* With customer */}
      <div className="bg-white border border-[#ededeb] rounded-[18px] px-6 py-5 flex flex-col">
        <h3 className="text-[15px] font-bold text-[#16181d] mb-2">With customer</h3>
        {customerItems.length > 0 ? (
          <div className="max-h-80 overflow-y-auto">
            {customerItems.map(item => {
              const purple = item.status === 'opened' || item.status === 'partial_response'
              const tone = purple ? '#7a5ad9' : '#3f7fd1'
              return (
                <Link
                  key={item.id}
                  to={jobPath({ jobsheetId: item.jobsheet_id, healthCheckId: item.id })}
                  className="flex items-center justify-between gap-3 py-3 border-b border-[#f5f5f3] last:border-0 -mx-2 px-2 rounded-lg hover:bg-[#f7f7f5]"
                >
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-[#16181d] truncate">{item.vehicle?.registration}</div>
                    <div className="text-[12px] text-[#a4a8b0] truncate">
                      {item.customer?.first_name} {item.customer?.last_name}
                    </div>
                  </div>
                  <span
                    className="px-2 py-0.5 text-[11px] font-semibold rounded-full shrink-0"
                    style={{ color: tone, background: `${tone}1a` }}
                  >
                    {formatStatusLabel(item.status).toUpperCase()}
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-7 gap-[11px]">
            <span className="w-[46px] h-[46px] rounded-full bg-[#f3f3f1] text-[#a4a8b0] flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M18 21a8 8 0 0 0-16 0" />
                <circle cx="10" cy="8" r="5" />
                <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
              </svg>
            </span>
            <div className="text-[14px] font-semibold text-[#3a3f48]">No checks with customers</div>
            <div className="text-[12.5px] text-[#a4a8b0] max-w-[240px] leading-relaxed">
              Authorised work and declines appear here as advisors share results.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
