import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, User } from '../../lib/api'
import WorkDetailsPanel from './WorkDetailsPanel'
import { CheckInTab } from '../HealthChecks/tabs/CheckInTab'
import { MriScanSection } from '../HealthChecks/components/MriScanSection'
import { MriTab } from '../HealthChecks/tabs/MriTab'

interface LookupOption { id: string; code: string; colour: string }

interface Jobsheet {
  id: string
  reference: string
  createdAt: string
  dueInDate: string
  dueInTime: string | null
  mileage: number | null
  requestedDeliveryAt: string | null
  courtesyVehicleRequired: boolean
  collectionAndDelivery: boolean
  vehicleOnSite: boolean
  customerContactNotes: string | null
  jobsheetComplete: boolean
  vhcRequired: boolean
  bookingNotes: string | null
  vehicleStatus: string
  customer: { id: string; firstName: string; lastName: string; mobile: string | null; email: string | null; phone: string | null; contactName: string | null } | null
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null; fuelType: string | null } | null
  serviceType: { id: string; code: string; colour: string } | null
  advisor: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; firstName: string; lastName: string } | null
  // inspectionRequired distinguishes a real VHC from a check-in-only "visit" shell.
  healthCheck: { id: string; status: string; vehicleStatus: string; vhcReference: string | null; inspectionRequired: boolean } | null
  checkIn: {
    status: string
    arrivedAt: string | null
    checkedInAt: string | null
    checkedInBy: { id: string; firstName: string; lastName: string } | null
    mileageIn: number | null
    keyLocation: string | null
    timeRequired: string | null
    customerWaiting: boolean | null
    checkinNotes: string | null
  } | null
  bookingCodes: LookupOption[]
}

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  due_in: 'Due In', arrived: 'Arrived', in_workshop: 'In Workshop', work_complete: 'Work Complete', collected: 'Collected'
}
const VEHICLE_STATUS_STYLES: Record<string, string> = {
  due_in: 'bg-gray-100 text-gray-700', arrived: 'bg-blue-100 text-blue-700', in_workshop: 'bg-amber-100 text-amber-700',
  work_complete: 'bg-green-100 text-green-700', collected: 'bg-gray-100 text-gray-500'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatDueIn(dateStr: string, time: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  const datePart = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  return `${datePart} · ${time ? time : 'time flexible'}`
}

// datetime-local needs "YYYY-MM-DDTHH:mm"
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type JobsheetTab = 'overview' | 'checkin' | 'mri' | 'work'

export default function JobsheetDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = session?.accessToken

  const [js, setJs] = useState<Jobsheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ensuring, setEnsuring] = useState(false)
  const [checkinEnabled, setCheckinEnabled] = useState(false)

  const [serviceTypes, setServiceTypes] = useState<LookupOption[]>([])
  const [bookingCodeOptions, setBookingCodeOptions] = useState<LookupOption[]>([])
  const [advisors, setAdvisors] = useState<User[]>([])

  // editable form
  const [form, setForm] = useState({
    dueInDate: '', dueInTime: '', serviceTypeId: '', advisorId: '', mileage: '', requestedDeliveryAt: '',
    courtesyVehicleRequired: false, collectionAndDelivery: false, vehicleOnSite: false,
    customerContactNotes: '', jobsheetComplete: false, bookingCodeIds: [] as string[]
  })

  const load = useCallback(async () => {
    if (!token || !id) return
    try {
      const data = await api<Jobsheet>(`/api/v1/jobsheets/${id}`, { token })
      setJs(data)
      setForm({
        dueInDate: data.dueInDate || '',
        dueInTime: data.dueInTime || '',
        serviceTypeId: data.serviceType?.id || '',
        advisorId: data.advisor?.id || '',
        mileage: data.mileage != null ? String(data.mileage) : '',
        requestedDeliveryAt: toLocalInput(data.requestedDeliveryAt),
        courtesyVehicleRequired: data.courtesyVehicleRequired,
        collectionAndDelivery: data.collectionAndDelivery,
        vehicleOnSite: data.vehicleOnSite,
        customerContactNotes: data.customerContactNotes || '',
        jobsheetComplete: data.jobsheetComplete,
        bookingCodeIds: data.bookingCodes.map(b => b.id)
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load jobsheet')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id])

  useEffect(() => { load() }, [load])

  // Org check-in setting governs whether the Check-In / MRI tabs appear (mirrors the VHC).
  useEffect(() => {
    if (!token || !user?.organization?.id) return
    api<{ checkinEnabled: boolean }>(`/api/v1/organizations/${user.organization.id}/checkin-settings`, { token })
      .then(d => setCheckinEnabled(!!d.checkinEnabled)).catch(() => setCheckinEnabled(false))
  }, [token, user?.organization?.id])

  // lookups for edit mode
  useEffect(() => {
    if (!token) return
    api<{ serviceTypes: LookupOption[] }>('/api/v1/service-types?active_only=true', { token })
      .then(d => setServiceTypes(d.serviceTypes || [])).catch(() => {})
    api<{ bookingCodes: LookupOption[] }>('/api/v1/booking-codes?active_only=true', { token })
      .then(d => setBookingCodeOptions(d.bookingCodes || [])).catch(() => {})
    api<{ users: User[] }>('/api/v1/users', { token })
      .then(d => setAdvisors((d.users || []).filter(u => u.role !== 'technician'))).catch(() => {})
  }, [token])

  const toggleCode = (codeId: string) => {
    setForm(f => ({
      ...f,
      bookingCodeIds: f.bookingCodeIds.includes(codeId)
        ? f.bookingCodeIds.filter(c => c !== codeId)
        : [...f.bookingCodeIds, codeId]
    }))
  }

  const handleSave = async () => {
    if (!token || !id) return
    setSaving(true)
    try {
      const updated = await api<Jobsheet>(`/api/v1/jobsheets/${id}`, {
        method: 'PATCH', token,
        body: {
          dueInDate: form.dueInDate || undefined,
          dueInTime: form.dueInTime || null,
          serviceTypeId: form.serviceTypeId || null,
          advisorId: form.advisorId || null,
          mileage: form.mileage ? parseInt(form.mileage, 10) : null,
          requestedDeliveryAt: form.requestedDeliveryAt ? new Date(form.requestedDeliveryAt).toISOString() : null,
          courtesyVehicleRequired: form.courtesyVehicleRequired,
          collectionAndDelivery: form.collectionAndDelivery,
          vehicleOnSite: form.vehicleOnSite,
          customerContactNotes: form.customerContactNotes || null,
          jobsheetComplete: form.jobsheetComplete,
          bookingCodeIds: form.bookingCodeIds
        }
      })
      setJs(updated)
      setEditing(false)
      toast.success('Jobsheet updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save jobsheet')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!token || !id) return
    if (!window.confirm('Delete this jobsheet? Its health check will also be removed. This cannot be undone.')) return
    try {
      await api(`/api/v1/jobsheets/${id}`, { method: 'DELETE', token })
      toast.success('Jobsheet deleted')
      navigate('/jobsheets')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete jobsheet')
    }
  }

  // Bring the vehicle in: ensure a health_check (a visit shell for no-VHC jobsheets), mark it
  // arrived, then the Check-In panel renders against it. Mirrors the Arrivals hub action.
  const handleStartCheckIn = useCallback(async () => {
    if (!token || !id) return
    setEnsuring(true)
    try {
      let hcId = js?.healthCheck?.id
      if (!hcId) {
        const r = await api<{ healthCheckId: string }>(`/api/v1/jobsheets/${id}/ensure-visit`, { method: 'POST', token })
        hcId = r.healthCheckId
      }
      await api(`/api/v1/health-checks/${hcId}/mark-arrived`, { method: 'POST', token })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check in vehicle')
    } finally {
      setEnsuring(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, js?.healthCheck?.id, load])

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }
  if (!js) {
    return <div className="max-w-3xl mx-auto py-12 text-center text-gray-500">Jobsheet not found. <Link to="/jobsheets" className="text-primary hover:underline">Back to jobsheets</Link></div>
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1'

  const realVhc = !!(js.healthCheck && js.healthCheck.inspectionRequired)
  const hc = js.healthCheck
  const arrived = !!(hc && hc.status !== 'awaiting_arrival')

  // Tabs — Check-In / MRI only when the org has check-in enabled (mirrors the VHC detail).
  const tabs: { id: JobsheetTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(checkinEnabled ? [{ id: 'checkin' as JobsheetTab, label: 'Check-In' }] : []),
    ...(checkinEnabled ? [{ id: 'mri' as JobsheetTab, label: 'MRI Scan' }] : []),
    { id: 'work', label: 'Work' }
  ]
  const tabIds = tabs.map(t => t.id)
  const rawTab = (searchParams.get('tab') || 'overview') as JobsheetTab
  const activeTab: JobsheetTab = tabIds.includes(rawTab) ? rawTab : 'overview'
  const setTab = (t: JobsheetTab) => {
    setEditing(false)
    setSearchParams(prev => { prev.set('tab', t); return prev })
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <Link to="/jobsheets" className="text-sm text-gray-500 hover:text-gray-700">← Jobsheets</Link>
        <div className="flex items-start justify-between mt-2 gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{js.reference}</h1>
              {js.vehicleStatus && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VEHICLE_STATUS_STYLES[js.vehicleStatus] || 'bg-gray-100 text-gray-700'}`}>
                  {VEHICLE_STATUS_LABELS[js.vehicleStatus] || js.vehicleStatus}
                </span>
              )}
              {!realVhc && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">No VHC</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">Document date: {formatDate(js.createdAt)}{js.createdBy && ` · by ${js.createdBy.firstName} ${js.createdBy.lastName}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {realVhc && hc && (
              <Link to={`/health-checks/${hc.id}`} className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                Open VHC{hc.vhcReference ? ` · ${hc.vhcReference}` : ''}
              </Link>
            )}
            {activeTab === 'overview' && (!editing ? (
              <button onClick={() => setEditing(true)} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg">Edit</button>
            ) : (
              <>
                <button onClick={() => { setEditing(false); load() }} className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              </>
            ))}
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab — customer, vehicle, booking details */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Customer */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Customer</h2>
            {js.customer ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd className="text-gray-900 font-medium">{js.customer.firstName} {js.customer.lastName}</dd></div>
                {js.customer.contactName && <div className="flex justify-between"><dt className="text-gray-500">Contact</dt><dd className="text-gray-900">{js.customer.contactName}</dd></div>}
                <div className="flex justify-between"><dt className="text-gray-500">Mobile</dt><dd className="text-gray-900">{js.customer.mobile || '—'}</dd></div>
                {js.customer.phone && <div className="flex justify-between"><dt className="text-gray-500">Phone</dt><dd className="text-gray-900">{js.customer.phone}</dd></div>}
                <div className="flex justify-between"><dt className="text-gray-500">Email</dt><dd className="text-gray-900 truncate ml-4">{js.customer.email || '—'}</dd></div>
              </dl>
            ) : <p className="text-sm text-gray-400">No customer.</p>}
          </div>

          {/* Vehicle */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Vehicle</h2>
            {js.vehicle ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Registration</dt><dd className="text-gray-900 font-medium">{js.vehicle.registration}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Description</dt><dd className="text-gray-900 ml-4 text-right">{[js.vehicle.make, js.vehicle.model].filter(Boolean).join(' ') || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Year</dt><dd className="text-gray-900">{js.vehicle.year || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Fuel</dt><dd className="text-gray-900">{js.vehicle.fuelType || '—'}</dd></div>
              </dl>
            ) : <p className="text-sm text-gray-400">No vehicle.</p>}
          </div>

          {/* Booking details */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Booking details</h2>

            {!editing ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">Due in</dt><dd className="text-gray-900 font-medium">{formatDueIn(js.dueInDate, js.dueInTime)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Vehicle Status</dt><dd><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${VEHICLE_STATUS_STYLES[js.vehicleStatus] || 'bg-gray-100 text-gray-700'}`}>{VEHICLE_STATUS_LABELS[js.vehicleStatus] || js.vehicleStatus}</span></dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Service Type</dt><dd>{js.serviceType ? <span className="px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: js.serviceType.colour }}>{js.serviceType.code}</span> : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Service Advisor</dt><dd className="text-gray-900">{js.advisor ? `${js.advisor.firstName} ${js.advisor.lastName}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Mileage</dt><dd className="text-gray-900">{js.mileage != null ? js.mileage.toLocaleString() : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Requested delivery</dt><dd className="text-gray-900">{formatDate(js.requestedDeliveryAt)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Courtesy vehicle</dt><dd className="text-gray-900">{js.courtesyVehicleRequired ? 'Yes' : 'No'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Collection & delivery</dt><dd className="text-gray-900">{js.collectionAndDelivery ? 'Yes' : 'No'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Vehicle on site</dt><dd className="text-gray-900">{js.vehicleOnSite ? 'Yes' : 'No'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">Jobsheet complete</dt><dd className="text-gray-900">{js.jobsheetComplete ? 'Yes' : 'No'}</dd></div>
                <div className="sm:col-span-2 pt-2 border-t border-gray-100 mt-1">
                  <dt className="text-gray-500 mb-1">Booking Codes</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {js.bookingCodes.length ? js.bookingCodes.map(bc => (
                      <span key={bc.id} className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: `${bc.colour}22`, color: bc.colour }}>{bc.code}</span>
                    )) : <span className="text-gray-400 text-sm">None</span>}
                  </dd>
                </div>
                {js.customerContactNotes && (
                  <div className="sm:col-span-2 pt-2 border-t border-gray-100 mt-1">
                    <dt className="text-gray-500 mb-1">Customer Contact Notes</dt>
                    <dd className="text-gray-900 whitespace-pre-wrap">{js.customerContactNotes}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Due In Date *</label>
                  <input type="date" value={form.dueInDate} onChange={e => setForm({ ...form, dueInDate: e.target.value })} className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>Due In Time <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="time" value={form.dueInTime} onChange={e => setForm({ ...form, dueInTime: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Service Type</label>
                  <select value={form.serviceTypeId} onChange={e => setForm({ ...form, serviceTypeId: e.target.value })} className={inputCls}>
                    <option value="">None</option>
                    {serviceTypes.map(st => <option key={st.id} value={st.id}>{st.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Service Advisor</label>
                  <select value={form.advisorId} onChange={e => setForm({ ...form, advisorId: e.target.value })} className={inputCls}>
                    <option value="">Unassigned</option>
                    {advisors.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Mileage</label>
                  <input type="number" value={form.mileage} onChange={e => setForm({ ...form, mileage: e.target.value })} placeholder="Optional" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Requested delivery date/time</label>
                  <input type="datetime-local" value={form.requestedDeliveryAt} onChange={e => setForm({ ...form, requestedDeliveryAt: e.target.value })} className={inputCls} />
                </div>
                <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([
                    ['courtesyVehicleRequired', 'Courtesy vehicle'],
                    ['collectionAndDelivery', 'Collection & delivery'],
                    ['vehicleOnSite', 'Vehicle on site'],
                    ['jobsheetComplete', 'Jobsheet complete']
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} className="rounded border-gray-300 text-primary focus:ring-primary" />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Booking Codes</label>
                  <div className="flex flex-wrap gap-2">
                    {bookingCodeOptions.map(bc => {
                      const on = form.bookingCodeIds.includes(bc.id)
                      return (
                        <button type="button" key={bc.id} onClick={() => toggleCode(bc.id)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${on ? 'text-white border-transparent' : 'text-gray-600 border-gray-300 bg-white'}`}
                          style={on ? { backgroundColor: bc.colour } : undefined}>
                          {bc.code}
                        </button>
                      )
                    })}
                    {bookingCodeOptions.length === 0 && <span className="text-xs text-gray-400">No booking codes configured.</span>}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Customer Contact Notes</label>
                  <textarea value={form.customerContactNotes} onChange={e => setForm({ ...form, customerContactNotes: e.target.value })} rows={3} className={inputCls} />
                </div>
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="lg:col-span-2 flex justify-end">
            <button onClick={handleDelete} className="text-sm text-red-600 hover:underline">Delete jobsheet</button>
          </div>
        </div>
      )}

      {/* Check-In tab — the shared VHC Check-In panel, bound to this jobsheet's health check */}
      {activeTab === 'checkin' && (
        arrived && hc ? (
          <CheckInTab
            healthCheckId={hc.id}
            healthCheckStatus={hc.status}
            onUpdate={load}
            onCheckInComplete={() => { load(); setTab('work') }}
            advisor={js.advisor ? { id: js.advisor.id, first_name: js.advisor.firstName, last_name: js.advisor.lastName } : null}
            onAdvisorChange={() => load()}
          />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-10 text-center">
            <p className="text-sm text-gray-500 mb-4">The vehicle hasn’t arrived yet. Check it in when it’s on site to record mileage, keys and an MRI scan.</p>
            <button onClick={handleStartCheckIn} disabled={ensuring}
              className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {ensuring ? 'Working…' : 'Check in vehicle'}
            </button>
          </div>
        )
      )}

      {/* MRI tab — the shared MRI scan/results, bound to this jobsheet's health check */}
      {activeTab === 'mri' && (
        !hc ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-10 text-center">
            <p className="text-sm text-gray-500 mb-4">Check the vehicle in first to record its MRI scan.</p>
            <button onClick={handleStartCheckIn} disabled={ensuring}
              className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {ensuring ? 'Working…' : 'Check in vehicle'}
            </button>
          </div>
        ) : ['awaiting_arrival', 'awaiting_checkin'].includes(hc.status) ? (
          <MriScanSection healthCheckId={hc.id} onComplete={load} />
        ) : (
          <MriTab healthCheckId={hc.id} />
        )
      )}

      {/* Work tab — labour + parts + packages + booking notes */}
      {activeTab === 'work' && token && (
        <WorkDetailsPanel
          jobsheetId={js.id}
          token={token}
          organizationId={user?.organization?.id}
          initialBookingNotes={js.bookingNotes}
          onChange={load}
        />
      )}
    </div>
  )
}
