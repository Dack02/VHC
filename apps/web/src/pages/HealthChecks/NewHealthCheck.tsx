import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, Vehicle, Customer, Template, User, Site } from '../../lib/api'
import CustomerFormModal, { SavedCustomer } from '../../components/customers/CustomerFormModal'
import { useModules } from '../../contexts/ModulesContext'

interface VehicleLookupResponse {
  found: boolean
  registration: string
  vehicle?: {
    registration: string
    make: string | null
    model: string | null
    primaryColour: string | null
    fuelType: string | null
    engineSize: string | null
    firstUsedDate: string | null
    manufactureDate: string | null
  }
  motTests: unknown[]
  motStatus: string | null
  motExpiryDate: string | null
}

interface VehicleLookupDraft {
  registration: string
  make: string
  model: string
  color: string
  fuelType: string
  engineSize: string
  year: string
  motStatus: string | null
  motExpiryDate: string | null
  motTestCount: number
}

interface CustomerSearchResult {
  id: string
  firstName: string
  lastName: string
  email: string | null
  mobile: string | null
}

export default function NewHealthCheck() {
  const { session } = useAuth()
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<Template[]>([])
  const [technicians, setTechnicians] = useState<User[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Vehicle[]>([])
  const [searching, setSearching] = useState(false)

  const [form, setForm] = useState({
    vehicleId: '',
    templateId: '',
    technicianId: '',
    siteId: '',
    mileageIn: ''
  })

  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

  // Customer requirement — a health check must belong to a customer. Vehicles can
  // be created customer-less (walk-in / DVSA lookup), so when the selected vehicle
  // has no customer we require one to be searched/created and linked before submit.
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([])
  const [customerSearching, setCustomerSearching] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [changingCustomer, setChangingCustomer] = useState(false)
  const [linkingCustomer, setLinkingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState<string | null>(null)

  // DVSA vehicle lookup (gated by the vehicle_lookup module)
  const { isEnabled } = useModules()
  const lookupEnabled = isEnabled('vehicle_lookup')
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupDraft, setLookupDraft] = useState<VehicleLookupDraft | null>(null)
  const [creatingVehicle, setCreatingVehicle] = useState(false)

  // Load templates and technicians on mount
  useEffect(() => {
    const loadData = async () => {
      if (!session?.accessToken) return

      try {
        // Load templates
        const templateData = await api<{ templates: Template[] }>(
          '/api/v1/templates',
          { token: session.accessToken }
        )
        setTemplates(templateData.templates || [])

        // Load technicians
        const userData = await api<{ users: User[] }>(
          '/api/v1/users',
          { token: session.accessToken }
        )
        setTechnicians(userData.users?.filter(u => u.role === 'technician') || [])

        // Load sites
        const siteData = await api<{ sites: Site[] }>(
          '/api/v1/sites',
          { token: session.accessToken }
        )
        setSites(siteData.sites || [])
        // Default to first site
        if (siteData.sites?.length > 0) {
          setForm(f => ({ ...f, siteId: siteData.sites[0].id }))
        }
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [session?.accessToken])

  // Search vehicles
  useEffect(() => {
    const searchVehicles = async () => {
      if (!session?.accessToken || searchQuery.length < 2) {
        setSearchResults([])
        return
      }

      setSearching(true)
      try {
        const data = await api<{ vehicles: Vehicle[] }>(
          `/api/v1/vehicles?search=${encodeURIComponent(searchQuery)}`,
          { token: session.accessToken }
        )
        setSearchResults(data.vehicles || [])
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setSearching(false)
      }
    }

    const debounce = setTimeout(searchVehicles, 300)
    return () => clearTimeout(debounce)
  }, [searchQuery, session?.accessToken])

  // Search existing customers (only relevant while attaching one to the vehicle)
  useEffect(() => {
    const searchCustomers = async () => {
      if (!session?.accessToken || customerSearch.trim().length < 2) {
        setCustomerResults([])
        return
      }
      setCustomerSearching(true)
      try {
        const data = await api<{ customers: CustomerSearchResult[] }>(
          `/api/v1/customers/search?q=${encodeURIComponent(customerSearch.trim())}`,
          { token: session.accessToken }
        )
        setCustomerResults(data.customers || [])
      } catch (err) {
        console.error('Customer search failed:', err)
      } finally {
        setCustomerSearching(false)
      }
    }

    const debounce = setTimeout(searchCustomers, 300)
    return () => clearTimeout(debounce)
  }, [customerSearch, session?.accessToken])

  const resetCustomerUi = () => {
    setCustomerSearch('')
    setCustomerResults([])
    setShowNewCustomer(false)
    setChangingCustomer(false)
    setCustomerError(null)
  }

  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle)
    setForm({ ...form, vehicleId: vehicle.id })
    setSearchQuery('')
    setSearchResults([])
    resetCustomerUi()
  }

  const clearVehicle = () => {
    setSelectedVehicle(null)
    setForm({ ...form, vehicleId: '' })
    resetCustomerUi()
  }

  const handleLookup = async () => {
    if (!session?.accessToken) return
    const reg = searchQuery.trim().toUpperCase().replace(/\s/g, '')
    if (reg.length < 2) return

    setLookingUp(true)
    setLookupError(null)
    try {
      const result = await api<VehicleLookupResponse>(
        `/api/v1/vehicle-lookup/${encodeURIComponent(reg)}`,
        { token: session.accessToken }
      )

      if (!result.found || !result.vehicle) {
        // No DVSA record — let the advisor enter the details manually
        setLookupDraft({
          registration: reg, make: '', model: '', color: '', fuelType: '',
          engineSize: '', year: '', motStatus: result.motStatus,
          motExpiryDate: result.motExpiryDate, motTestCount: 0
        })
        setLookupError('No DVSA record found — you can still enter the details manually.')
        return
      }

      const v = result.vehicle
      const dateForYear = v.firstUsedDate || v.manufactureDate
      setLookupDraft({
        registration: v.registration || reg,
        make: v.make || '',
        model: v.model || '',
        color: v.primaryColour || '',
        fuelType: v.fuelType || '',
        engineSize: v.engineSize || '',
        year: dateForYear ? String(new Date(dateForYear).getFullYear()) : '',
        motStatus: result.motStatus,
        motExpiryDate: result.motExpiryDate,
        motTestCount: result.motTests?.length || 0
      })
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Vehicle lookup failed')
    } finally {
      setLookingUp(false)
    }
  }

  const handleCreateFromLookup = async () => {
    if (!session?.accessToken || !lookupDraft) return

    setCreatingVehicle(true)
    setLookupError(null)
    try {
      const created = await api<Vehicle>(
        '/api/v1/vehicles',
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            registration: lookupDraft.registration,
            make: lookupDraft.make || undefined,
            model: lookupDraft.model || undefined,
            color: lookupDraft.color || undefined,
            fuelType: lookupDraft.fuelType || undefined,
            engineSize: lookupDraft.engineSize || undefined,
            year: lookupDraft.year ? parseInt(lookupDraft.year, 10) : undefined,
            syncMotHistory: true
          }
        }
      )

      setSelectedVehicle(created)
      setForm(f => ({ ...f, vehicleId: created.id }))
      setLookupDraft(null)
      setSearchQuery('')
      setSearchResults([])
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Failed to add vehicle')
    } finally {
      setCreatingVehicle(false)
    }
  }

  // Link a customer to the selected vehicle and reflect it locally so the
  // requirement is satisfied (the health check inherits the vehicle's customer).
  const linkCustomerToVehicle = async (customerId: string, customer: Customer) => {
    if (!session?.accessToken || !selectedVehicle) return
    await api(`/api/v1/vehicles/${selectedVehicle.id}`, {
      method: 'PATCH',
      token: session.accessToken,
      body: { customerId }
    })
    setSelectedVehicle(v => (v ? { ...v, customer_id: customerId, customer } : v))
    resetCustomerUi()
  }

  const handleSelectCustomer = async (result: CustomerSearchResult) => {
    if (!session?.accessToken || !selectedVehicle) return
    setLinkingCustomer(true)
    setCustomerError(null)
    try {
      await linkCustomerToVehicle(result.id, {
        id: result.id,
        first_name: result.firstName,
        last_name: result.lastName,
        email: result.email,
        mobile: result.mobile,
        external_id: null
      })
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Failed to link customer')
    } finally {
      setLinkingCustomer(false)
    }
  }

  const handleCustomerSaved = async (saved: SavedCustomer) => {
    if (!selectedVehicle) { setShowNewCustomer(false); return }
    setLinkingCustomer(true)
    setCustomerError(null)
    try {
      await linkCustomerToVehicle(saved.id, {
        id: saved.id,
        first_name: saved.firstName,
        last_name: saved.lastName,
        email: saved.email,
        mobile: saved.mobile,
        external_id: saved.externalId ?? null
      })
      setShowNewCustomer(false)
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Failed to link customer')
    } finally {
      setLinkingCustomer(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken) return

    if (!form.vehicleId) {
      setError('Please select a vehicle')
      return
    }
    if (!selectedVehicle?.customer_id) {
      setError('Please add a customer for this vehicle before creating the health check')
      return
    }
    if (!form.templateId) {
      setError('Please select a template')
      return
    }
    if (!form.siteId) {
      setError('No site available')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await api<{ id: string }>(
        '/api/v1/health-checks',
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            vehicleId: form.vehicleId,
            templateId: form.templateId,
            technicianId: form.technicianId || undefined,
            siteId: form.siteId,
            mileageIn: form.mileageIn ? parseInt(form.mileageIn) : undefined
          }
        }
      )
      navigate(`/health-checks/${response.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create health check')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/health-checks" className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Health Check</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
          {/* Vehicle Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vehicle *
            </label>
            {selectedVehicle ? (
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200">
                <div>
                  <div className="font-medium">{selectedVehicle.registration}</div>
                  <div className="text-sm text-gray-500">
                    {selectedVehicle.make} {selectedVehicle.model}
                    {selectedVehicle.customer && (
                      <span> - {selectedVehicle.customer.first_name} {selectedVehicle.customer.last_name}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearVehicle}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : lookupDraft ? (
              <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">DVSA lookup</span>
                    {lookupDraft.motTestCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                        {lookupDraft.motTestCount} MOT test{lookupDraft.motTestCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {lookupDraft.motStatus && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        MOT: {lookupDraft.motStatus}{lookupDraft.motExpiryDate ? ` (exp ${lookupDraft.motExpiryDate})` : ''}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setLookupDraft(null); setLookupError(null) }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Review and adjust the details, then add the vehicle. Full MOT history is saved automatically.
                </p>
                {lookupError && <p className="text-xs text-amber-700">{lookupError}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Registration</label>
                    <input
                      type="text"
                      value={lookupDraft.registration}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, registration: e.target.value.toUpperCase() } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
                    <input
                      type="text"
                      value={lookupDraft.year}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, year: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Make</label>
                    <input
                      type="text"
                      value={lookupDraft.make}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, make: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                    <input
                      type="text"
                      value={lookupDraft.model}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, model: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Colour</label>
                    <input
                      type="text"
                      value={lookupDraft.color}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, color: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fuel</label>
                    <input
                      type="text"
                      value={lookupDraft.fuelType}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, fuelType: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Engine size</label>
                    <input
                      type="text"
                      value={lookupDraft.engineSize}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, engineSize: e.target.value } : d)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCreateFromLookup}
                    disabled={creatingVehicle || !lookupDraft.registration}
                    className="px-4 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50"
                  >
                    {creatingVehicle ? 'Adding...' : 'Use this vehicle'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLookupDraft(null); setLookupError(null) }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                  >
                    Back to search
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by registration..."
                  className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searching && (
                  <div className="absolute right-3 top-2.5">
                    <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                    {searchResults.map(vehicle => (
                      <button
                        key={vehicle.id}
                        type="button"
                        onClick={() => selectVehicle(vehicle)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="font-medium">{vehicle.registration}</div>
                        <div className="text-sm text-gray-500">
                          {vehicle.make} {vehicle.model}
                          {vehicle.customer && (
                            <span> - {vehicle.customer.first_name} {vehicle.customer.last_name}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {lookupEnabled && !searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                  <button
                    type="button"
                    onClick={handleLookup}
                    disabled={lookingUp}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {lookingUp ? 'Looking up…' : `Look up "${searchQuery.trim().toUpperCase().replace(/\s/g, '')}" via DVSA`}
                  </button>
                )}
                {lookupError && (
                  <p className="mt-2 text-sm text-amber-700">{lookupError}</p>
                )}
              </div>
            )}
          </div>

          {/* Customer (required — a health check must belong to a customer) */}
          {selectedVehicle && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customer *
              </label>
              {selectedVehicle.customer && !changingCustomer ? (
                <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <div>
                    <div className="font-medium">
                      {selectedVehicle.customer.first_name} {selectedVehicle.customer.last_name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {selectedVehicle.customer.mobile || selectedVehicle.customer.email || 'No contact details'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setChangingCustomer(true); setCustomerError(null) }}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-amber-700">
                    This vehicle has no customer yet. Search for an existing customer or add a new one —
                    a health check can&rsquo;t be created without one.
                  </p>
                  <div className="relative">
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search by name, email or mobile..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    {customerSearching && (
                      <div className="absolute right-3 top-2.5">
                        <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                      </div>
                    )}
                    {customerResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                        {customerResults.map(rc => (
                          <button
                            key={rc.id}
                            type="button"
                            onClick={() => handleSelectCustomer(rc)}
                            disabled={linkingCustomer}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 disabled:opacity-50"
                          >
                            <div className="font-medium">{rc.firstName} {rc.lastName}</div>
                            <div className="text-sm text-gray-500">{rc.mobile || rc.email || '—'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => { setShowNewCustomer(true); setCustomerError(null) }}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      + Add new customer
                    </button>
                    {selectedVehicle.customer && (
                      <button
                        type="button"
                        onClick={() => { setChangingCustomer(false); setCustomerError(null) }}
                        className="text-sm text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                  {customerError && <p className="text-xs text-red-600">{customerError}</p>}
                </div>
              )}
            </div>
          )}

          {/* Template Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template *
            </label>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a template...</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {/* Site Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Site *
            </label>
            <select
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>

          {/* Technician Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign Technician (optional)
            </label>
            <select
              value={form.technicianId}
              onChange={(e) => setForm({ ...form, technicianId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Unassigned</option>
              {technicians.map(tech => (
                <option key={tech.id} value={tech.id}>
                  {tech.firstName} {tech.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Mileage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mileage In (optional)
            </label>
            <input
              type="number"
              value={form.mileageIn}
              onChange={(e) => setForm({ ...form, mileageIn: e.target.value })}
              placeholder="Enter mileage"
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={submitting || !selectedVehicle?.customer_id}
            className="px-6 py-2 bg-primary text-white font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Health Check'}
          </button>
          <Link
            to="/health-checks"
            className="px-6 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>

      {showNewCustomer && (
        <CustomerFormModal
          initialName={customerSearch}
          siteId={form.siteId || undefined}
          onClose={() => setShowNewCustomer(false)}
          onSaved={handleCustomerSaved}
        />
      )}
    </div>
  )
}
