import { useState, useEffect } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { api } from '../../../lib/api'

interface LabourEntry {
  labourCodeId: string
  hours: number
  discountPercent: number
  isVatExempt: boolean
  notes: string | null
  labourCode: {
    id: string
    code: string
    description: string
    hourlyRate: number
  } | null
}

interface PartEntry {
  partNumber: string | null
  description: string
  quantity: number
  supplierId: string | null
  supplierName: string | null
  costPrice: number
  sellPrice: number
  notes: string | null
}

interface ServicePackage {
  id: string
  name: string
  description: string | null
  labour: LabourEntry[]
  parts: PartEntry[]
}

interface ServicePackageApplyModalProps {
  repairItemId: string
  repairItemTitle: string
  onClose: () => void
  onApplied: () => void
}

export function ServicePackageApplyModal({
  repairItemId,
  repairItemTitle,
  onClose,
  onApplied
}: ServicePackageApplyModalProps) {
  const { session, user } = useAuth()
  const toast = useToast()
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const organizationId = user?.organization?.id

  useEffect(() => {
    fetchPackages()
  }, [])

  const fetchPackages = async () => {
    if (!organizationId) return
    try {
      setLoading(true)
      const data = await api<{ servicePackages: ServicePackage[] }>(
        `/api/v1/organizations/${organizationId}/service-packages`,
        { token: session?.accessToken }
      )
      setPackages(data.servicePackages || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load service packages')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async (pkg: ServicePackage) => {
    try {
      setApplying(pkg.id)
      await api(
        `/api/v1/repair-items/${repairItemId}/apply-service-package`,
        {
          method: 'POST',
          body: { service_package_id: pkg.id },
          token: session?.accessToken
        }
      )
      toast.success(`Applied "${pkg.name}" to ${repairItemTitle}`)
      onApplied()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply service package')
    } finally {
      setApplying(null)
    }
  }

  const calculateLabourTotal = (labour: LabourEntry[]) => {
    return labour.reduce((sum, l) => {
      if (!l.labourCode) return sum
      const subtotal = l.labourCode.hourlyRate * l.hours
      return sum + subtotal * (1 - l.discountPercent / 100)
    }, 0)
  }

  const calculatePartsTotal = (parts: PartEntry[]) => {
    return parts.reduce((sum, p) => sum + p.quantity * p.sellPrice, 0)
  }

  const filteredPackages = packages.filter(pkg => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      pkg.name.toLowerCase().includes(q) ||
      (pkg.description && pkg.description.toLowerCase().includes(q))
    )
  })

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-start justify-center min-h-screen px-4 pt-8 pb-20">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white w-full max-w-2xl rounded-xl shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Apply Service Package</h3>
              <p className="text-sm text-gray-500 mt-0.5">to {repairItemTitle}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          {!loading && packages.length > 0 && (
            <div className="px-6 pt-4 pb-2">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search packages..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : packages.length === 0 ? (
              <div className="text-center py-8 px-6">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <p className="text-gray-500">No service packages available.</p>
                <p className="text-sm text-gray-400 mt-1">Create packages in the Packages page first.</p>
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className="text-center py-8 px-6">
                <p className="text-gray-500">No packages match "{search}"</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredPackages.map(pkg => {
                  const labourTotal = calculateLabourTotal(pkg.labour)
                  const partsTotal = calculatePartsTotal(pkg.parts)
                  const estimatedTotal = labourTotal + partsTotal
                  const isApplying = applying === pkg.id
                  const isExpanded = expandedId === pkg.id
                  const labourCount = pkg.labour.length
                  const partsCount = pkg.parts.length

                  return (
                    <div key={pkg.id}>
                      {/* Compact row */}
                      <div
                        className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => toggleExpand(pkg.id)}
                      >
                        {/* Package icon */}
                        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>

                        {/* Name + description */}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 text-sm truncate">{pkg.name}</p>
                          {pkg.description && (
                            <p className="text-xs text-gray-500 truncate">{pkg.description}</p>
                          )}
                        </div>

                        {/* Summary chips */}
                        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                          {labourCount > 0 && (
                            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                              {labourCount} labour
                            </span>
                          )}
                          {partsCount > 0 && (
                            <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                              {partsCount} part{partsCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>

                        {/* Estimated total */}
                        {estimatedTotal > 0 && (
                          <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                            {'\u00A3'}{estimatedTotal.toFixed(2)}
                          </span>
                        )}

                        {/* Apply button */}
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            handleApply(pkg)
                          }}
                          disabled={isApplying || applying !== null}
                          className="px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50 flex-shrink-0"
                        >
                          {isApplying ? 'Applying...' : 'Apply'}
                        </button>

                        {/* Chevron */}
                        <svg
                          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>

                      {/* Expandable detail section */}
                      {isExpanded && (
                        <div className="px-6 pb-4 pt-1 bg-gray-50 border-t border-gray-100">
                          <div className="pl-8">
                            {/* Labour detail */}
                            {pkg.labour.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Labour</p>
                                <div className="space-y-1">
                                  {pkg.labour.map((l, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600">
                                        {l.labourCode?.code || '?'} - {l.labourCode?.description || 'Unknown'} ({l.hours}h)
                                      </span>
                                      <span className="text-gray-700 font-medium">
                                        {l.labourCode ? `\u00A3${(l.labourCode.hourlyRate * l.hours * (1 - l.discountPercent / 100)).toFixed(2)}` : '-'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Parts detail */}
                            {pkg.parts.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Parts</p>
                                <div className="space-y-1">
                                  {pkg.parts.map((p, i) => (
                                    <div key={i} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600">
                                        {p.description} {p.quantity > 1 ? `x${p.quantity}` : ''}
                                      </span>
                                      <span className="text-gray-700 font-medium">
                                        {'\u00A3'}{(p.quantity * p.sellPrice).toFixed(2)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Total */}
                            {estimatedTotal > 0 && (
                              <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-500">Estimated Total</span>
                                <span className="text-sm font-bold text-gray-900">{'\u00A3'}{estimatedTotal.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
