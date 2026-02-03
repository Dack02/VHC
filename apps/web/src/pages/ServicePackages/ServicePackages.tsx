import { useState, useEffect, useRef, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface LabourCode {
  id: string
  code: string
  description: string
  hourlyRate: number
}

interface Supplier {
  id: string
  name: string
}

interface CatalogEntry {
  id: string
  partNumber: string
  description: string
  costPrice: number
}

interface PackageLabour {
  labourCodeId: string
  rate: string
  hours: string
  discountPercent: string
  isVatExempt: boolean
  notes: string
}

interface PackagePart {
  partNumber: string
  description: string
  quantity: string
  supplierId: string
  supplierName: string
  costPrice: string
  sellPrice: string
  notes: string
}

interface ServicePackage {
  id: string
  name: string
  description: string | null
  labour: Array<{
    id: string
    labourCodeId: string
    rate: number | null
    hours: number
    discountPercent: number
    isVatExempt: boolean
    notes: string | null
    labourCode: { id: string; code: string; description: string; hourlyRate: number } | null
  }>
  parts: Array<{
    id: string
    partNumber: string | null
    description: string
    quantity: number
    supplierId: string | null
    supplierName: string | null
    costPrice: number
    sellPrice: number
    notes: string | null
  }>
}

const emptyLabour = (): PackageLabour => ({
  labourCodeId: '',
  rate: '',
  hours: '1',
  discountPercent: '0',
  isVatExempt: false,
  notes: ''
})

const emptyPart = (): PackagePart => ({
  partNumber: '',
  description: '',
  quantity: '1',
  supplierId: '',
  supplierName: '',
  costPrice: '0',
  sellPrice: '0',
  notes: ''
})

// Sub-component: Part row with catalog search autocomplete
function PartEntryRow({
  entry,
  index,
  catalogEntries,
  suppliers,
  onUpdate,
  onRemove
}: {
  entry: PackagePart
  index: number
  catalogEntries: CatalogEntry[]
  suppliers: Supplier[]
  onUpdate: (index: number, updated: PackagePart) => void
  onRemove: (index: number) => void
}) {
  const [searchQuery, setSearchQuery] = useState(entry.partNumber)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync searchQuery when entry.partNumber changes externally (e.g. on modal open for edit)
  useEffect(() => {
    setSearchQuery(entry.partNumber)
  }, [entry.partNumber])

  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return catalogEntries
      .filter(e => e.partNumber.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
      .slice(0, 8)
  }, [searchQuery, catalogEntries])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  const handleSelectCatalog = (cat: CatalogEntry) => {
    setSearchQuery(cat.partNumber)
    setShowDropdown(false)
    onUpdate(index, {
      ...entry,
      partNumber: cat.partNumber,
      description: cat.description,
      costPrice: cat.costPrice.toString()
    })
  }

  const handlePartNumberChange = (val: string) => {
    setSearchQuery(val)
    setShowDropdown(val.trim().length > 0)
    setHighlightIndex(-1)
    onUpdate(index, { ...entry, partNumber: val })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filteredParts.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex(prev => Math.min(prev + 1, filteredParts.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      handleSelectCatalog(filteredParts[highlightIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const updateField = (field: keyof PackagePart, value: string) => {
    onUpdate(index, { ...entry, [field]: value })
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="grid grid-cols-12 gap-2 items-end">
        {/* Part # with autocomplete */}
        <div className="col-span-2 relative">
          <label className="block text-xs text-gray-500 mb-1">Part #</label>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={e => handlePartNumberChange(e.target.value)}
            onFocus={() => { if (searchQuery.trim()) setShowDropdown(true) }}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {showDropdown && filteredParts.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
              style={{ minWidth: '280px' }}
            >
              {filteredParts.map((cat, ci) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelectCatalog(cat)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                    ci === highlightIndex ? 'bg-primary/10' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="font-mono font-medium text-gray-900 whitespace-nowrap">{cat.partNumber}</span>
                  <span className="text-gray-500 truncate flex-1">{cat.description}</span>
                  <span className="text-gray-400 whitespace-nowrap">{'\u00A3'}{cat.costPrice.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-4">
          <label className="block text-xs text-gray-500 mb-1">Description *</label>
          <input
            type="text"
            value={entry.description}
            onChange={e => updateField('description', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">Qty</label>
          <input
            type="number"
            step="1"
            min="1"
            value={entry.quantity}
            onChange={e => updateField('quantity', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Cost</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={entry.costPrice}
            onChange={e => updateField('costPrice', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Sell</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={entry.sellPrice}
            onChange={e => updateField('sellPrice', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="col-span-1 flex justify-end">
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
            title="Remove"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      {/* Supplier row */}
      <div className="grid grid-cols-12 gap-2 mt-2 items-end">
        <div className="col-span-5">
          <label className="block text-xs text-gray-500 mb-1">Supplier</label>
          <select
            value={entry.supplierId}
            onChange={e => {
              const sel = suppliers.find(s => s.id === e.target.value)
              onUpdate(index, { ...entry, supplierId: e.target.value, supplierName: sel?.name || '' })
            }}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">None</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="col-span-7">
          <label className="block text-xs text-gray-500 mb-1">Notes</label>
          <input
            type="text"
            value={entry.notes}
            onChange={e => updateField('notes', e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

export default function ServicePackages() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [packages, setPackages] = useState<ServicePackage[]>([])
  const [labourCodes, setLabourCodes] = useState<LabourCode[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingPackage, setEditingPackage] = useState<ServicePackage | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [labourEntries, setLabourEntries] = useState<PackageLabour[]>([])
  const [partsEntries, setPartsEntries] = useState<PackagePart[]>([])
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchPackages()
      fetchLabourCodes()
      fetchSuppliers()
      fetchPartsCatalog()
    }
  }, [organizationId])

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

  const fetchLabourCodes = async () => {
    if (!organizationId) return
    try {
      const data = await api<{ labourCodes: LabourCode[] }>(
        `/api/v1/organizations/${organizationId}/labour-codes`,
        { token: session?.accessToken }
      )
      setLabourCodes(data.labourCodes || [])
    } catch {
      // Silently fail - labour codes are optional
    }
  }

  const fetchSuppliers = async () => {
    if (!organizationId) return
    try {
      const data = await api<{ suppliers: Supplier[] }>(
        `/api/v1/organizations/${organizationId}/suppliers`,
        { token: session?.accessToken }
      )
      setSuppliers(data.suppliers || [])
    } catch {
      // Silently fail
    }
  }

  const fetchPartsCatalog = async () => {
    if (!organizationId) return
    try {
      const data = await api<{ parts: CatalogEntry[] }>(
        `/api/v1/organizations/${organizationId}/parts-catalog?limit=100`,
        { token: session?.accessToken }
      )
      setCatalogEntries(data.parts || [])
    } catch {
      // Silently fail
    }
  }

  const handleOpenModal = (pkg?: ServicePackage) => {
    if (pkg) {
      setEditingPackage(pkg)
      setName(pkg.name)
      setDescription(pkg.description || '')
      setLabourEntries(
        pkg.labour.map(l => ({
          labourCodeId: l.labourCodeId,
          rate: l.rate != null ? l.rate.toString() : (l.labourCode?.hourlyRate?.toString() || ''),
          hours: l.hours.toString(),
          discountPercent: l.discountPercent.toString(),
          isVatExempt: l.isVatExempt,
          notes: l.notes || ''
        }))
      )
      setPartsEntries(
        pkg.parts.map(p => ({
          partNumber: p.partNumber || '',
          description: p.description,
          quantity: p.quantity.toString(),
          supplierId: p.supplierId || '',
          supplierName: p.supplierName || '',
          costPrice: p.costPrice.toString(),
          sellPrice: p.sellPrice.toString(),
          notes: p.notes || ''
        }))
      )
    } else {
      setEditingPackage(null)
      setName('')
      setDescription('')
      setLabourEntries([])
      setPartsEntries([])
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingPackage(null)
    setFormError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return

    if (!name.trim()) {
      setFormError('Name is required')
      return
    }

    // Validate labour entries
    for (const l of labourEntries) {
      if (!l.labourCodeId) {
        setFormError('All labour entries must have a labour code selected')
        return
      }
    }

    // Validate parts entries
    for (const p of partsEntries) {
      if (!p.description.trim()) {
        setFormError('All parts entries must have a description')
        return
      }
    }

    try {
      setSaving(true)
      setFormError('')

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        labour: labourEntries.map(l => ({
          labour_code_id: l.labourCodeId,
          rate: l.rate !== '' ? parseFloat(l.rate) || null : null,
          hours: isNaN(parseFloat(l.hours)) ? 1 : parseFloat(l.hours),
          discount_percent: parseFloat(l.discountPercent) || 0,
          is_vat_exempt: l.isVatExempt,
          notes: l.notes.trim() || null
        })),
        parts: partsEntries.map(p => ({
          part_number: p.partNumber.trim() || null,
          description: p.description.trim(),
          quantity: parseFloat(p.quantity) || 1,
          supplier_id: p.supplierId || null,
          supplier_name: p.supplierName || null,
          cost_price: parseFloat(p.costPrice) || 0,
          sell_price: parseFloat(p.sellPrice) || 0,
          notes: p.notes.trim() || null
        }))
      }

      if (editingPackage) {
        await api(
          `/api/v1/organizations/${organizationId}/service-packages/${editingPackage.id}`,
          { method: 'PATCH', body: payload, token: session?.accessToken }
        )
        toast.success('Service package updated')
      } else {
        await api(
          `/api/v1/organizations/${organizationId}/service-packages`,
          { method: 'POST', body: payload, token: session?.accessToken }
        )
        toast.success('Service package created')
      }

      handleCloseModal()
      await fetchPackages()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save service package')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (pkg: ServicePackage) => {
    if (!organizationId) return
    if (!confirm(`Are you sure you want to delete "${pkg.name}"?`)) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/service-packages/${pkg.id}`,
        { method: 'DELETE', token: session?.accessToken }
      )
      toast.success('Service package deleted')
      await fetchPackages()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete service package')
    }
  }

  // Labour entry helpers
  const addLabour = () => setLabourEntries([...labourEntries, emptyLabour()])
  const removeLabour = (i: number) => setLabourEntries(labourEntries.filter((_, idx) => idx !== i))
  const updateLabour = (i: number, field: keyof PackageLabour, value: string | boolean) => {
    setLabourEntries(labourEntries.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  // Package total calculations
  const packageTotals = useMemo(() => {
    const labourTotal = labourEntries.reduce((sum, l) => {
      const rate = parseFloat(l.rate) || 0
      const hours = parseFloat(l.hours) || 0
      const discountPct = parseFloat(l.discountPercent) || 0
      return sum + rate * hours * (1 - discountPct / 100)
    }, 0)
    const partsTotal = partsEntries.reduce((sum, p) => {
      const qty = parseFloat(p.quantity) || 0
      const sell = parseFloat(p.sellPrice) || 0
      return sum + qty * sell
    }, 0)
    return { labourTotal, partsTotal, total: labourTotal + partsTotal }
  }, [labourEntries, partsEntries])

  // Parts entry helpers
  const addPart = () => setPartsEntries([...partsEntries, emptyPart()])
  const removePart = (i: number) => setPartsEntries(partsEntries.filter((_, idx) => idx !== i))
  const updatePartEntry = (i: number, updated: PackagePart) => {
    setPartsEntries(partsEntries.map((p, idx) => idx === i ? updated : p))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Packages</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pre-built labour and parts packages that can be applied to repair items
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-primary text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-dark flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Package
        </button>
      </div>

      {/* Packages Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Labour</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Parts</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {packages.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No service packages found. Click "Add Package" to create one.
                </td>
              </tr>
            ) : (
              packages.map(pkg => {
                const totalHours = pkg.labour.reduce((sum, l) => sum + l.hours, 0)
                return (
                  <tr key={pkg.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{pkg.name}</td>
                    <td className="px-6 py-4 text-gray-700 text-sm max-w-xs truncate">{pkg.description || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                      {pkg.labour.length > 0 ? (
                        <span>{pkg.labour.length} item{pkg.labour.length !== 1 ? 's' : ''} ({totalHours}h)</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-600">
                      {pkg.parts.length > 0 ? (
                        <span>{pkg.parts.length} item{pkg.parts.length !== 1 ? 's' : ''}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleOpenModal(pkg)} className="text-primary hover:text-primary-dark mr-4">Edit</button>
                      <button onClick={() => handleDelete(pkg)} className="text-red-600 hover:text-red-800">Delete</button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-start justify-center min-h-screen px-4 pt-8 pb-20">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <div className="relative bg-white w-full max-w-2xl p-6 text-left shadow-xl rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingPackage ? 'Edit Service Package' : 'Add Service Package'}
                </h3>
                <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Basic Info */}
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. Full Service"
                      maxLength={255}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input
                      type="text"
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Optional description"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {/* Labour Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-900">Labour</h4>
                    <button
                      type="button"
                      onClick={addLabour}
                      className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Labour
                    </button>
                  </div>
                  {labourEntries.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No labour entries. Click "Add Labour" to add one.</p>
                  ) : (
                    <div className="space-y-3">
                      {labourEntries.map((entry, i) => (
                        <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                          <div className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-4">
                              <label className="block text-xs text-gray-500 mb-1">Labour Code</label>
                              <select
                                value={entry.labourCodeId}
                                onChange={e => {
                                  const selectedId = e.target.value
                                  const lc = labourCodes.find(c => c.id === selectedId)
                                  setLabourEntries(labourEntries.map((l, idx) => idx === i
                                    ? { ...l, labourCodeId: selectedId, rate: lc ? lc.hourlyRate.toString() : l.rate }
                                    : l
                                  ))
                                }}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              >
                                <option value="">Select...</option>
                                {labourCodes.map(lc => (
                                  <option key={lc.id} value={lc.id}>
                                    {lc.code} - {lc.description} ({'\u00A3'}{lc.hourlyRate.toFixed(2)}/hr)
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">Rate ({'\u00A3'}/hr)</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={entry.rate}
                                onChange={e => updateLabour(i, 'rate', e.target.value)}
                                placeholder="0.00"
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-1">
                              <label className="block text-xs text-gray-500 mb-1">Hours</label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={entry.hours}
                                onChange={e => updateLabour(i, 'hours', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">Disc %</label>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="100"
                                value={entry.discountPercent}
                                onChange={e => updateLabour(i, 'discountPercent', e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-500 mb-1">Notes</label>
                              <input
                                type="text"
                                value={entry.notes}
                                onChange={e => updateLabour(i, 'notes', e.target.value)}
                                placeholder=""
                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              />
                            </div>
                            <div className="col-span-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => removeLabour(i)}
                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                title="Remove"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Parts Section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-900">Parts</h4>
                    <button
                      type="button"
                      onClick={addPart}
                      className="text-sm text-primary hover:text-primary-dark font-medium flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Part
                    </button>
                  </div>
                  {partsEntries.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No parts entries. Click "Add Part" to add one.</p>
                  ) : (
                    <div className="space-y-3">
                      {partsEntries.map((entry, i) => (
                        <PartEntryRow
                          key={i}
                          entry={entry}
                          index={i}
                          catalogEntries={catalogEntries}
                          suppliers={suppliers}
                          onUpdate={updatePartEntry}
                          onRemove={removePart}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Package Total */}
                {(labourEntries.length > 0 || partsEntries.length > 0) && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Package Total</h4>
                    <div className="space-y-1 text-sm">
                      {labourEntries.length > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>Labour ({labourEntries.length} item{labourEntries.length !== 1 ? 's' : ''})</span>
                          <span>{'\u00A3'}{packageTotals.labourTotal.toFixed(2)}</span>
                        </div>
                      )}
                      {partsEntries.length > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>Parts ({partsEntries.length} item{partsEntries.length !== 1 ? 's' : ''})</span>
                          <span>{'\u00A3'}{packageTotals.partsTotal.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-gray-900 pt-1 border-t border-gray-300">
                        <span>Total</span>
                        <span>{'\u00A3'}{packageTotals.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-primary text-white px-4 py-2 font-semibold rounded-lg hover:bg-primary-dark disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingPackage ? 'Update Package' : 'Create Package'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
