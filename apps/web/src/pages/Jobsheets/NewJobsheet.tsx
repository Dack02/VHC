import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { api, Vehicle, Customer, User, Site } from '../../lib/api'
import WorkDetailsPanel from './WorkDetailsPanel'
import CustomerCardModal from './components/CustomerCardModal'
import CustomerFormModal, { SavedCustomer } from '../../components/customers/CustomerFormModal'

interface VehicleLookupResponse {
  found: boolean
  registration: string
  vehicle?: {
    registration: string; make: string | null; model: string | null; primaryColour: string | null
    fuelType: string | null; engineSize: string | null; firstUsedDate: string | null; manufactureDate: string | null
  }
  motTests: unknown[]
  motStatus: string | null
  motExpiryDate: string | null
}
interface VehicleLookupDraft {
  registration: string; make: string; model: string; color: string; fuelType: string
  engineSize: string; year: string; motStatus: string | null; motExpiryDate: string | null; motTestCount: number
}
interface CustomerSearchResult { id: string; firstName: string; lastName: string; email: string | null; mobile: string | null }
interface LookupOption { id: string; code: string; colour: string }

export default function NewJobsheet() {
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const { isEnabled } = useModules()
  const lookupEnabled = isEnabled('vehicle_lookup')
  const token = session?.accessToken

  const [sites, setSites] = useState<Site[]>([])
  const [advisors, setAdvisors] = useState<User[]>([])
  const [serviceTypes, setServiceTypes] = useState<LookupOption[]>([])
  const [bookingCodeOptions, setBookingCodeOptions] = useState<LookupOption[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // vehicle search / lookup
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Vehicle[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [lookupDraft, setLookupDraft] = useState<VehicleLookupDraft | null>(null)
  const [creatingVehicle, setCreatingVehicle] = useState(false)

  // customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([])
  const [customerSearching, setCustomerSearching] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [changingCustomer, setChangingCustomer] = useState(false)
  const [showCustomerCard, setShowCustomerCard] = useState(false)
  const [linkingCustomer, setLinkingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState<string | null>(null)

  // jobsheet fields
  const [form, setForm] = useState({
    siteId: '', serviceTypeId: '', advisorId: '', mileage: '', dueInDate: '', dueInTime: '', requestedDeliveryAt: '',
    courtesyVehicleRequired: false, collectionAndDelivery: false, vehicleOnSite: false, customerContactNotes: ''
  })
  const [bookingCodeIds, setBookingCodeIds] = useState<string[]>([])

  // work required
  const [requiresVhc, setRequiresVhc] = useState(true)

  // Draft jobsheet — created once a vehicle + customer exist so the Work Details
  // panel can attach priced work lines on this same screen. Committed on submit,
  // discarded on cancel / navigate-away (no reference or VHC until commit).
  const [draftId, setDraftId] = useState<string | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const committedRef = useRef(false)
  const creatingDraftRef = useRef(false)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  // inline-add state
  const [addingServiceType, setAddingServiceType] = useState(false)
  const [newServiceType, setNewServiceType] = useState('')
  const [addingCode, setAddingCode] = useState(false)
  const [newCode, setNewCode] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!token) return
      try {
        const [siteData, userData, stData, bcData] = await Promise.all([
          api<{ sites: Site[] }>('/api/v1/sites', { token }),
          api<{ users: User[] }>('/api/v1/users', { token }),
          api<{ serviceTypes: LookupOption[] }>('/api/v1/service-types?active_only=true', { token }),
          api<{ bookingCodes: LookupOption[] }>('/api/v1/booking-codes?active_only=true', { token })
        ])
        setSites(siteData.sites || [])
        setAdvisors((userData.users || []).filter(u => u.role !== 'technician'))
        setServiceTypes(stData.serviceTypes || [])
        setBookingCodeOptions(bcData.bookingCodes || [])
        const me = user?.id
        setForm(f => ({
          ...f,
          siteId: siteData.sites?.[0]?.id || '',
          advisorId: me && (userData.users || []).some(u => u.id === me) ? me : ''
        }))
      } catch (err) {
        console.error('Failed to load jobsheet form data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token, user?.id])

  // vehicle search
  useEffect(() => {
    const run = async () => {
      if (!token || searchQuery.length < 2) { setSearchResults([]); return }
      setSearching(true)
      try {
        const data = await api<{ vehicles: Vehicle[] }>(`/api/v1/vehicles?search=${encodeURIComponent(searchQuery)}`, { token })
        setSearchResults(data.vehicles || [])
      } catch { /* ignore */ } finally { setSearching(false) }
    }
    const debounce = setTimeout(run, 300)
    return () => clearTimeout(debounce)
  }, [searchQuery, token])

  // customer search
  useEffect(() => {
    const run = async () => {
      if (!token || customerSearch.trim().length < 2) { setCustomerResults([]); return }
      setCustomerSearching(true)
      try {
        const data = await api<{ customers: CustomerSearchResult[] }>(`/api/v1/customers/search?q=${encodeURIComponent(customerSearch.trim())}`, { token })
        setCustomerResults(data.customers || [])
      } catch { /* ignore */ } finally { setCustomerSearching(false) }
    }
    const debounce = setTimeout(run, 300)
    return () => clearTimeout(debounce)
  }, [customerSearch, token])

  // --- draft lifecycle -----------------------------------------------------
  const createDraft = useCallback(async (): Promise<string | null> => {
    if (!token || !selectedVehicle?.id || !selectedVehicle.customer_id) return null
    if (draftIdRef.current) return draftIdRef.current
    if (creatingDraftRef.current) return null
    creatingDraftRef.current = true
    try {
      const res = await api<{ id: string }>('/api/v1/jobsheets/draft', {
        method: 'POST', token,
        body: {
          vehicleId: selectedVehicle.id,
          dueInDate: form.dueInDate || undefined,
          siteId: form.siteId || undefined,
          advisorId: form.advisorId || undefined
        }
      })
      setDraftId(res.id); draftIdRef.current = res.id
      return res.id
    } catch {
      return null
    } finally {
      creatingDraftRef.current = false
    }
  }, [token, selectedVehicle?.id, selectedVehicle?.customer_id, form.dueInDate, form.siteId, form.advisorId])

  const discardDraft = useCallback((jid: string) => {
    if (!token) return
    api(`/api/v1/jobsheets/${jid}/discard`, { method: 'POST', token }).catch(() => {})
  }, [token])

  // Create the draft as soon as a vehicle has a linked customer.
  useEffect(() => {
    if (selectedVehicle?.customer_id && !draftIdRef.current && !creatingDraftRef.current) createDraft()
  }, [selectedVehicle?.customer_id, selectedVehicle?.id, createDraft])

  // Discard an uncommitted draft when leaving the page (in-app navigation).
  useEffect(() => {
    return () => {
      const jid = draftIdRef.current
      if (jid && !committedRef.current) discardDraft(jid)
    }
  }, [discardDraft])

  const resetCustomerUi = () => {
    setCustomerSearch(''); setCustomerResults([]); setShowNewCustomer(false); setChangingCustomer(false)
    setCustomerError(null)
  }
  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle); setSearchQuery(''); setSearchResults([]); resetCustomerUi()
  }
  const clearVehicle = () => {
    const jid = draftIdRef.current
    if (jid) { discardDraft(jid); setDraftId(null); draftIdRef.current = null }
    setSelectedVehicle(null); resetCustomerUi()
  }

  const handleLookup = async () => {
    if (!token) return
    const reg = searchQuery.trim().toUpperCase().replace(/\s/g, '')
    if (reg.length < 2) return
    setLookingUp(true); setLookupError(null)
    try {
      const result = await api<VehicleLookupResponse>(`/api/v1/vehicle-lookup/${encodeURIComponent(reg)}`, { token })
      if (!result.found || !result.vehicle) {
        setLookupDraft({ registration: reg, make: '', model: '', color: '', fuelType: '', engineSize: '', year: '', motStatus: result.motStatus, motExpiryDate: result.motExpiryDate, motTestCount: 0 })
        setLookupError('No DVSA record found — you can still enter the details manually.')
        return
      }
      const v = result.vehicle
      const dateForYear = v.firstUsedDate || v.manufactureDate
      setLookupDraft({
        registration: v.registration || reg, make: v.make || '', model: v.model || '', color: v.primaryColour || '',
        fuelType: v.fuelType || '', engineSize: v.engineSize || '',
        year: dateForYear ? String(new Date(dateForYear).getFullYear()) : '',
        motStatus: result.motStatus, motExpiryDate: result.motExpiryDate, motTestCount: result.motTests?.length || 0
      })
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Vehicle lookup failed')
    } finally { setLookingUp(false) }
  }

  const handleCreateFromLookup = async () => {
    if (!token || !lookupDraft) return
    setCreatingVehicle(true); setLookupError(null)
    try {
      const created = await api<Vehicle>('/api/v1/vehicles', {
        method: 'POST', token,
        body: {
          registration: lookupDraft.registration, make: lookupDraft.make || undefined, model: lookupDraft.model || undefined,
          color: lookupDraft.color || undefined, fuelType: lookupDraft.fuelType || undefined, engineSize: lookupDraft.engineSize || undefined,
          year: lookupDraft.year ? parseInt(lookupDraft.year, 10) : undefined, syncMotHistory: true
        }
      })
      setSelectedVehicle(created); setLookupDraft(null); setSearchQuery(''); setSearchResults([])
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Failed to add vehicle')
    } finally { setCreatingVehicle(false) }
  }

  const linkCustomerToVehicle = async (customerId: string, customer: Customer) => {
    if (!token || !selectedVehicle) return
    await api(`/api/v1/vehicles/${selectedVehicle.id}`, { method: 'PATCH', token, body: { customerId } })
    setSelectedVehicle(v => (v ? { ...v, customer_id: customerId, customer } : v))
    resetCustomerUi()
  }
  const handleSelectCustomer = async (result: CustomerSearchResult) => {
    if (!token || !selectedVehicle) return
    setLinkingCustomer(true); setCustomerError(null)
    try {
      await linkCustomerToVehicle(result.id, { id: result.id, first_name: result.firstName, last_name: result.lastName, email: result.email, mobile: result.mobile, external_id: null })
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Failed to link customer')
    } finally { setLinkingCustomer(false) }
  }
  const handleCustomerSaved = async (saved: SavedCustomer) => {
    if (!selectedVehicle) { setShowNewCustomer(false); return }
    setLinkingCustomer(true); setCustomerError(null)
    try {
      await linkCustomerToVehicle(saved.id, { id: saved.id, first_name: saved.firstName, last_name: saved.lastName, email: saved.email, mobile: saved.mobile, external_id: saved.externalId ?? null })
      setShowNewCustomer(false)
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Failed to link customer')
    } finally { setLinkingCustomer(false) }
  }

  const handleAddServiceType = async () => {
    if (!token || !newServiceType.trim()) return
    try {
      const created = await api<LookupOption>('/api/v1/service-types', { method: 'POST', token, body: { code: newServiceType.trim() } })
      setServiceTypes(s => [...s, created])
      setForm(f => ({ ...f, serviceTypeId: created.id }))
      setNewServiceType(''); setAddingServiceType(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service type')
    }
  }
  const handleAddCode = async () => {
    if (!token || !newCode.trim()) return
    try {
      const created = await api<LookupOption>('/api/v1/booking-codes', { method: 'POST', token, body: { code: newCode.trim() } })
      setBookingCodeOptions(s => [...s, created])
      setBookingCodeIds(ids => [...ids, created.id])
      setNewCode(''); setAddingCode(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add booking code')
    }
  }
  const toggleCode = (codeId: string) =>
    setBookingCodeIds(ids => ids.includes(codeId) ? ids.filter(c => c !== codeId) : [...ids, codeId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    if (!selectedVehicle) { setError('Please select a vehicle'); return }
    if (!selectedVehicle.customer_id) { setError('Please add a customer for this vehicle'); return }
    if (!form.dueInDate) { setError('Please set a due-in date'); return }
    setSubmitting(true); setError(null)
    try {
      // The draft normally exists already (created when the customer was linked); create it
      // now if a race left it unset. Commit assigns the JS reference + kicks off the VHC.
      let jid = draftIdRef.current
      if (!jid) jid = await createDraft()
      if (!jid) throw new Error('Could not start the jobsheet — please try again.')
      const res = await api<{ id: string }>(`/api/v1/jobsheets/${jid}/commit`, {
        method: 'POST', token,
        body: {
          dueInDate: form.dueInDate,
          dueInTime: form.dueInTime || undefined,
          siteId: form.siteId || undefined,
          serviceTypeId: form.serviceTypeId || undefined,
          advisorId: form.advisorId || undefined,
          mileage: form.mileage ? parseInt(form.mileage, 10) : undefined,
          requestedDeliveryAt: form.requestedDeliveryAt ? new Date(form.requestedDeliveryAt).toISOString() : undefined,
          courtesyVehicleRequired: form.courtesyVehicleRequired,
          collectionAndDelivery: form.collectionAndDelivery,
          vehicleOnSite: form.vehicleOnSite,
          customerContactNotes: form.customerContactNotes || undefined,
          bookingCodeIds,
          vhcRequired: requiresVhc
          // bookingNotes is owned by the Work Details panel (saved on the draft as you type)
        }
      })
      committedRef.current = true
      navigate(`/jobsheets/${res.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create jobsheet')
    } finally { setSubmitting(false) }
  }

  const handleCancel = () => {
    const jid = draftIdRef.current
    if (jid && !committedRef.current) discardDraft(jid)
    draftIdRef.current = null // prevent the unmount cleanup discarding again
    navigate('/jobsheets')
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

  return (
    <div className="max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/jobsheets" className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Jobsheet</h1>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 mb-6 rounded-lg text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <form onSubmit={handleSubmit} className="lg:col-span-1 space-y-4">
        {/* Vehicle */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <label className={labelCls}>Vehicle Registration No. *</label>
          {selectedVehicle ? (
            <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div>
                <div className="font-medium">{selectedVehicle.registration}</div>
                <div className="text-sm text-gray-500">
                  {selectedVehicle.make} {selectedVehicle.model}
                  {selectedVehicle.customer && <span> · {selectedVehicle.customer.first_name} {selectedVehicle.customer.last_name}</span>}
                </div>
              </div>
              <button type="button" onClick={clearVehicle} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ) : lookupDraft ? (
            <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">DVSA lookup</span>
                <button type="button" onClick={() => { setLookupDraft(null); setLookupError(null) }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {lookupError && <p className="text-xs text-amber-700">{lookupError}</p>}
              <div className="grid grid-cols-2 gap-3">
                {([['registration', 'Registration'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['color', 'Colour'], ['fuelType', 'Fuel'], ['engineSize', 'Engine size']] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type="text" value={lookupDraft[key] as string}
                      onChange={(e) => setLookupDraft(d => d ? { ...d, [key]: key === 'registration' ? e.target.value.toUpperCase() : e.target.value } : d)}
                      className={inputCls} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleCreateFromLookup} disabled={creatingVehicle || !lookupDraft.registration} className="px-4 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
                  {creatingVehicle ? 'Adding…' : 'Use this vehicle'}
                </button>
                <button type="button" onClick={() => { setLookupDraft(null); setLookupError(null) }} className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Back to search</button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by registration…" className={inputCls} />
              {searching && <div className="absolute right-3 top-2.5"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" /></div>}
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                  {searchResults.map(vehicle => (
                    <button key={vehicle.id} type="button" onClick={() => selectVehicle(vehicle)} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                      <div className="font-medium">{vehicle.registration}</div>
                      <div className="text-sm text-gray-500">{vehicle.make} {vehicle.model}{vehicle.customer && <span> · {vehicle.customer.first_name} {vehicle.customer.last_name}</span>}</div>
                    </button>
                  ))}
                </div>
              )}
              {lookupEnabled && !searching && searchResults.length === 0 && searchQuery.trim().length >= 2 && (
                <button type="button" onClick={handleLookup} disabled={lookingUp} className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-50">
                  {lookingUp ? 'Looking up…' : `Look up "${searchQuery.trim().toUpperCase().replace(/\s/g, '')}" via DVSA`}
                </button>
              )}
              {lookupError && <p className="mt-2 text-sm text-amber-700">{lookupError}</p>}
            </div>
          )}
        </div>

        {/* Customer */}
        {selectedVehicle && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <label className={labelCls}>Customer *</label>
            {selectedVehicle.customer && !changingCustomer ? (
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <button type="button" onClick={() => setShowCustomerCard(true)} className="text-left group min-w-0" title="View customer card">
                  <div className="font-medium text-gray-900 group-hover:text-primary group-hover:underline truncate">{selectedVehicle.customer.first_name} {selectedVehicle.customer.last_name}</div>
                  {selectedVehicle.customer.mobile && <div className="text-sm text-gray-500 truncate">{selectedVehicle.customer.mobile}</div>}
                  {selectedVehicle.customer.email && <div className="text-sm text-gray-500 truncate">{selectedVehicle.customer.email}</div>}
                  {!selectedVehicle.customer.mobile && !selectedVehicle.customer.email && <div className="text-sm text-gray-500">No contact details</div>}
                </button>
                <button type="button" onClick={() => { setChangingCustomer(true); setCustomerError(null) }} className="text-sm font-medium text-primary hover:underline shrink-0 ml-3">Change</button>
              </div>
            ) : (
              <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-4 space-y-3">
                <p className="text-xs text-amber-700">Search for an existing customer or add a new one — a jobsheet needs one.</p>
                <div className="relative">
                  <input type="text" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search by name, email or mobile…" className={inputCls} />
                  {customerSearching && <div className="absolute right-3 top-2.5"><div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" /></div>}
                  {customerResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-auto">
                      {customerResults.map(rc => (
                        <button key={rc.id} type="button" onClick={() => handleSelectCustomer(rc)} disabled={linkingCustomer} className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 disabled:opacity-50">
                          <div className="font-medium">{rc.firstName} {rc.lastName}</div>
                          <div className="text-sm text-gray-500">{rc.mobile || rc.email || '—'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={() => { setShowNewCustomer(true); setCustomerError(null) }} className="text-sm font-medium text-primary hover:underline">+ Add new customer</button>
                  {selectedVehicle.customer && <button type="button" onClick={() => { setChangingCustomer(false); setCustomerError(null) }} className="text-sm text-gray-500 hover:underline">Cancel</button>}
                </div>
                {customerError && <p className="text-xs text-red-600">{customerError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Booking details */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Due In Date *</label>
            <input type="date" value={form.dueInDate} onChange={(e) => setForm({ ...form, dueInDate: e.target.value })} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Due In Time <span className="text-gray-400 font-normal">(optional — blank = flexible)</span></label>
            <input type="time" value={form.dueInTime} onChange={(e) => setForm({ ...form, dueInTime: e.target.value })} className={inputCls} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Service Type</label>
              <button type="button" onClick={() => setAddingServiceType(v => !v)} className="text-xs text-primary hover:underline">+ New</button>
            </div>
            <select value={form.serviceTypeId} onChange={(e) => setForm({ ...form, serviceTypeId: e.target.value })} className={inputCls}>
              <option value="">Select…</option>
              {serviceTypes.map(st => <option key={st.id} value={st.id}>{st.code}</option>)}
            </select>
            {addingServiceType && (
              <div className="flex gap-2 mt-2">
                <input type="text" value={newServiceType} onChange={e => setNewServiceType(e.target.value)} placeholder="New service type" className={inputCls} />
                <button type="button" onClick={handleAddServiceType} className="px-3 py-2 bg-primary text-white text-sm rounded-lg shrink-0">Add</button>
              </div>
            )}
          </div>

          <div>
            <label className={labelCls}>Service Advisor</label>
            <select value={form.advisorId} onChange={(e) => setForm({ ...form, advisorId: e.target.value })} className={inputCls}>
              <option value="">Unassigned</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Mileage (optional)</label>
            <input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} placeholder="Optional" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Requested delivery date/time</label>
            <input type="datetime-local" value={form.requestedDeliveryAt} onChange={(e) => setForm({ ...form, requestedDeliveryAt: e.target.value })} className={inputCls} />
          </div>

          {sites.length > 1 && (
            <div>
              <label className={labelCls}>Site</label>
              <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className={inputCls}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([['courtesyVehicleRequired', 'Courtesy Vehicle Required'], ['collectionAndDelivery', 'Collection and Delivery'], ['vehicleOnSite', 'Vehicle on Site']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="rounded border-gray-300 text-primary focus:ring-primary" />
                {label}
              </label>
            ))}
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Booking Codes</label>
              <button type="button" onClick={() => setAddingCode(v => !v)} className="text-xs text-primary hover:underline">+ New</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {bookingCodeOptions.map(bc => {
                const on = bookingCodeIds.includes(bc.id)
                return (
                  <button type="button" key={bc.id} onClick={() => toggleCode(bc.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${on ? 'text-white border-transparent' : 'text-gray-600 border-gray-300 bg-white'}`}
                    style={on ? { backgroundColor: bc.colour } : undefined}>
                    {bc.code}
                  </button>
                )
              })}
              {bookingCodeOptions.length === 0 && <span className="text-xs text-gray-400">No booking codes yet.</span>}
            </div>
            {addingCode && (
              <div className="flex gap-2 mt-2">
                <input type="text" value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="New booking code" className={inputCls} />
                <button type="button" onClick={handleAddCode} className="px-3 py-2 bg-primary text-white text-sm rounded-lg shrink-0">Add</button>
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className={labelCls}>Customer Contact Notes</label>
            <textarea value={form.customerContactNotes} onChange={(e) => setForm({ ...form, customerContactNotes: e.target.value })} rows={3} className={inputCls} />
          </div>
        </div>

        {/* Work Required */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Work Required</h2>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={requiresVhc} onChange={(e) => setRequiresVhc(e.target.checked)} className="rounded border-gray-300 text-primary focus:ring-primary" />
            Requires VHC (health check)
          </label>
          <p className="text-xs text-gray-400">A health check is created with the booking by default. Untick if this job doesn’t need an inspection — booked work stays on the jobsheet either way. Add labour, parts and packages under <span className="font-medium text-gray-500">Work Details</span> →</p>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={submitting || !selectedVehicle?.customer_id || !form.dueInDate} className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Jobsheet'}
          </button>
          <button type="button" onClick={handleCancel} className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
        </form>

        {/* Right: priced work built live on the draft jobsheet */}
        {draftId && token ? (
          <WorkDetailsPanel
            className="lg:col-span-1 lg:sticky lg:top-6"
            parent={{ type: 'jobsheet', id: draftId }}
            token={token}
            organizationId={user?.organization?.id}
            notes={{ label: 'Booking Notes', value: null, onSave: (v) => api(`/api/v1/jobsheets/${draftId}`, { method: 'PATCH', token, body: { bookingNotes: v } }).then(() => {}) }}
          />
        ) : (
          <div className="lg:col-span-1 lg:sticky lg:top-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Work Details</h2>
            <p className="text-sm text-gray-400">Select a vehicle and customer to start adding labour, parts and packages — they’ll be saved to this booking as you go.</p>
          </div>
        )}
      </div>

      {showCustomerCard && selectedVehicle?.customer?.id && (
        <CustomerCardModal
          customerId={selectedVehicle.customer.id}
          onClose={() => setShowCustomerCard(false)}
          onUpdated={(c) => setSelectedVehicle(v => (v && v.customer)
            ? { ...v, customer: { ...v.customer, first_name: c.firstName, last_name: c.lastName, mobile: c.mobile, email: c.email } }
            : v)}
        />
      )}

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
