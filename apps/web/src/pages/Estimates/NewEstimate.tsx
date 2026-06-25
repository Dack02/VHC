import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { api, Vehicle, Customer, User, Site } from '../../lib/api'
import WorkDetailsPanel from '../Jobsheets/WorkDetailsPanel'
import CustomerCardModal from '../Jobsheets/components/CustomerCardModal'

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

export default function NewEstimate() {
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const { isEnabled } = useModules()
  const lookupEnabled = isEnabled('vehicle_lookup')
  const token = session?.accessToken

  const [sites, setSites] = useState<Site[]>([])
  const [advisors, setAdvisors] = useState<User[]>([])
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
  const [newCustomer, setNewCustomer] = useState({ firstName: '', lastName: '', mobile: '', phone: '', contactName: '', email: '' })
  const [linkingCustomer, setLinkingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState<string | null>(null)

  // estimate fields
  const [form, setForm] = useState({ siteId: '', advisorId: '', mileage: '', validUntil: '', customerNotes: '', internalNotes: '' })

  // Draft estimate — created once a vehicle + customer exist so the Work Details panel
  // can attach priced quote lines on this same screen. Committed on submit, discarded
  // on cancel / navigate-away (no reference until commit).
  const [draftId, setDraftId] = useState<string | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const committedRef = useRef(false)
  const creatingDraftRef = useRef(false)
  useEffect(() => { draftIdRef.current = draftId }, [draftId])

  useEffect(() => {
    const load = async () => {
      if (!token) return
      try {
        const [siteData, userData] = await Promise.all([
          api<{ sites: Site[] }>('/api/v1/sites', { token }),
          api<{ users: User[] }>('/api/v1/users', { token })
        ])
        setSites(siteData.sites || [])
        setAdvisors((userData.users || []).filter(u => u.role !== 'technician'))
        const me = user?.id
        setForm(f => ({
          ...f,
          siteId: siteData.sites?.[0]?.id || '',
          advisorId: me && (userData.users || []).some(u => u.id === me) ? me : ''
        }))
      } catch (err) {
        console.error('Failed to load estimate form data:', err)
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
      const res = await api<{ id: string }>('/api/v1/estimates/draft', {
        method: 'POST', token,
        body: { vehicleId: selectedVehicle.id, siteId: form.siteId || undefined, advisorId: form.advisorId || undefined }
      })
      setDraftId(res.id); draftIdRef.current = res.id
      return res.id
    } catch {
      return null
    } finally {
      creatingDraftRef.current = false
    }
  }, [token, selectedVehicle?.id, selectedVehicle?.customer_id, form.siteId, form.advisorId])

  const discardDraft = useCallback((eid: string) => {
    if (!token) return
    api(`/api/v1/estimates/${eid}/discard`, { method: 'POST', token }).catch(() => {})
  }, [token])

  // Create the draft as soon as a vehicle has a linked customer.
  useEffect(() => {
    if (selectedVehicle?.customer_id && !draftIdRef.current && !creatingDraftRef.current) createDraft()
  }, [selectedVehicle?.customer_id, selectedVehicle?.id, createDraft])

  // Discard an uncommitted draft when leaving the page (in-app navigation).
  useEffect(() => {
    return () => {
      const eid = draftIdRef.current
      if (eid && !committedRef.current) discardDraft(eid)
    }
  }, [discardDraft])

  const resetCustomerUi = () => {
    setCustomerSearch(''); setCustomerResults([]); setShowNewCustomer(false); setChangingCustomer(false)
    setCustomerError(null); setNewCustomer({ firstName: '', lastName: '', mobile: '', phone: '', contactName: '', email: '' })
  }
  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle); setSearchQuery(''); setSearchResults([]); resetCustomerUi()
  }
  const clearVehicle = () => {
    const eid = draftIdRef.current
    if (eid) { discardDraft(eid); setDraftId(null); draftIdRef.current = null }
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
  const handleCreateCustomer = async () => {
    if (!token || !selectedVehicle) return
    if (!newCustomer.firstName.trim() || !newCustomer.lastName.trim()) { setCustomerError('First and last name are required'); return }
    setLinkingCustomer(true); setCustomerError(null)
    try {
      const created = await api<{ id: string; firstName: string; lastName: string; email: string | null; mobile: string | null }>('/api/v1/customers', {
        method: 'POST', token,
        body: {
          firstName: newCustomer.firstName.trim(), lastName: newCustomer.lastName.trim(),
          mobile: newCustomer.mobile.trim() || undefined, phone: newCustomer.phone.trim() || undefined,
          contactName: newCustomer.contactName.trim() || undefined, email: newCustomer.email.trim() || undefined,
          siteId: form.siteId || undefined
        }
      })
      await linkCustomerToVehicle(created.id, { id: created.id, first_name: created.firstName, last_name: created.lastName, email: created.email, mobile: created.mobile, external_id: null })
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Failed to create customer')
    } finally { setLinkingCustomer(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    if (!selectedVehicle) { setError('Please select a vehicle'); return }
    if (!selectedVehicle.customer_id) { setError('Please add a customer for this vehicle'); return }
    setSubmitting(true); setError(null)
    try {
      let eid = draftIdRef.current
      if (!eid) eid = await createDraft()
      if (!eid) throw new Error('Could not start the estimate — please try again.')
      const res = await api<{ id: string }>(`/api/v1/estimates/${eid}/commit`, {
        method: 'POST', token,
        body: {
          siteId: form.siteId || undefined,
          advisorId: form.advisorId || undefined,
          mileage: form.mileage ? parseInt(form.mileage, 10) : undefined,
          validUntil: form.validUntil || undefined,
          customerNotes: form.customerNotes || undefined,
          internalNotes: form.internalNotes || undefined
        }
      })
      committedRef.current = true
      navigate(`/estimates/${res.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create estimate')
    } finally { setSubmitting(false) }
  }

  const handleCancel = () => {
    const eid = draftIdRef.current
    if (eid && !committedRef.current) discardDraft(eid)
    draftIdRef.current = null // prevent the unmount cleanup discarding again
    navigate('/estimates')
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5'

  return (
    <div className="max-w-7xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/estimates" className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Estimate</h1>
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
                <p className="text-xs text-amber-700">Search for an existing customer or add a new one — an estimate needs one.</p>
                {!showNewCustomer ? (
                  <>
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
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input type="text" value={newCustomer.firstName} onChange={(e) => setNewCustomer(n => ({ ...n, firstName: e.target.value }))} placeholder="First name *" className={inputCls} />
                      <input type="text" value={newCustomer.lastName} onChange={(e) => setNewCustomer(n => ({ ...n, lastName: e.target.value }))} placeholder="Last name *" className={inputCls} />
                      <input type="text" value={newCustomer.contactName} onChange={(e) => setNewCustomer(n => ({ ...n, contactName: e.target.value }))} placeholder="Contact (optional)" className={inputCls} />
                      <input type="text" value={newCustomer.mobile} onChange={(e) => setNewCustomer(n => ({ ...n, mobile: e.target.value }))} placeholder="Mobile" className={inputCls} />
                      <input type="text" value={newCustomer.phone} onChange={(e) => setNewCustomer(n => ({ ...n, phone: e.target.value }))} placeholder="Phone (landline)" className={inputCls} />
                      <input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer(n => ({ ...n, email: e.target.value }))} placeholder="Email" className={inputCls} />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleCreateCustomer} disabled={linkingCustomer || !newCustomer.firstName.trim() || !newCustomer.lastName.trim()} className="px-4 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
                        {linkingCustomer ? 'Saving…' : 'Save & link customer'}
                      </button>
                      <button type="button" onClick={() => { setShowNewCustomer(false); setCustomerError(null) }} className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Back to search</button>
                    </div>
                  </div>
                )}
                {customerError && <p className="text-xs text-red-600">{customerError}</p>}
              </div>
            )}
          </div>
        )}

        {/* Estimate details */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Valid Until <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className={inputCls} />
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
          {sites.length > 1 && (
            <div>
              <label className={labelCls}>Site</label>
              <select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} className={inputCls}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes to Customer <span className="text-gray-400 font-normal">(shown on the estimate)</span></label>
            <textarea value={form.customerNotes} onChange={(e) => setForm({ ...form, customerNotes: e.target.value })} rows={2} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Internal Notes <span className="text-gray-400 font-normal">(staff only)</span></label>
            <textarea value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} rows={2} className={inputCls} />
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={submitting || !selectedVehicle?.customer_id} className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Estimate'}
          </button>
          <button type="button" onClick={handleCancel} className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
        </form>

        {/* Right: priced quote lines built live on the draft estimate */}
        {draftId && token ? (
          <WorkDetailsPanel
            className="lg:col-span-1 lg:sticky lg:top-6"
            parent={{ type: 'estimate', id: draftId }}
            token={token}
            organizationId={user?.organization?.id}
          />
        ) : (
          <div className="lg:col-span-1 lg:sticky lg:top-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Work Details</h2>
            <p className="text-sm text-gray-400">Select a vehicle and customer to start adding labour, parts and packages — they’ll be saved to this estimate as you go.</p>
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
    </div>
  )
}
