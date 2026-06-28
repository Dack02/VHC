import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useModules } from '../../contexts/ModulesContext'
import { api, ApiError, User, TimelineEvent } from '../../lib/api'
import ComposeMessageModal from '../../components/ComposeMessageModal'
import FollowUpDetailModal from '../FollowUps/FollowUpDetailModal'
import WorkDetailsPanel from './WorkDetailsPanel'
import CustomerInsightsBanner from '../../components/CustomerInsightsBanner'
import { CheckInTab } from '../HealthChecks/tabs/CheckInTab'
import { MriScanSection } from '../HealthChecks/components/MriScanSection'
import { MriTab } from '../HealthChecks/tabs/MriTab'
import { TimelineTab } from '../HealthChecks/tabs/TimelineTab'

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
  closedAt: string | null
  invoiceNumber: string | null
  taxPointDate: string | null
  vhcRequired: boolean
  bookingNotes: string | null
  vehicleStatus: string
  customer: { id: string; firstName: string; lastName: string; mobile: string | null; email: string | null; phone: string | null; contactName: string | null } | null
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null; fuelType: string | null; motExpiryDate: string | null; motStatus: string | null; motLastSyncedAt: string | null } | null
  serviceType: { id: string; code: string; colour: string } | null
  advisor: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; firstName: string; lastName: string } | null
  // inspectionRequired distinguishes a real VHC from a check-in-only "visit" shell.
  healthCheck: { id: string; status: string; vehicleStatus: string; vhcReference: string | null; inspectionRequired: boolean; redCount: number; amberCount: number; greenCount: number; completedAt: string | null } | null
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
  // Detail-only enrichment (see loadJobsheetExtras in the API).
  history?: { totalVisits: number; lastVisitAt: string | null }
  deferred?: { count: number; totalValue: number; caseId: string | null }
  recentMessages?: { id: string; direction: 'inbound' | 'outbound'; body: string; status: string; createdAt: string; senderName: string | null }[]
  work?: { itemCount: number; totalIncVat: number; vat: number; net: number }
  // Originating estimate when this jobsheet was converted from one (reverse lookup).
  sourceEstimate?: { id: string; reference: string | null; convertedAt: string | null } | null
  bookingSource?: string | null // 'online_estimate' = customer self-booked online
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

function formatDateOnly(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}

// MOT pill colour from the DVSA-derived status / expiry.
function motTone(status: string | null, expiry: string | null): string {
  if (status === 'Valid') {
    if (expiry) {
      const days = Math.round((new Date(`${expiry}T00:00:00`).getTime() - Date.now()) / 86400000)
      if (days <= 30) return 'bg-amber-100 text-amber-700' // due soon
    }
    return 'bg-green-100 text-green-700'
  }
  if (status === 'Expired') return 'bg-red-100 text-red-700'
  return 'bg-gray-100 text-gray-600'
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
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

type JobsheetTab = 'overview' | 'checkin' | 'mri' | 'work' | 'timeline'

export default function JobsheetDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { isEnabled } = useModules()
  const [searchParams, setSearchParams] = useSearchParams()
  const token = session?.accessToken

  // Origin-aware back link: callers (e.g. the Booking Diary) pass ?from=&fromLabel=
  // so we return to where the user came from; otherwise fall back to the list.
  const backTo = searchParams.get('from') || '/jobsheets'
  const backLabel = searchParams.get('fromLabel') || 'Jobsheets'

  const [js, setJs] = useState<Jobsheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [ensuring, setEnsuring] = useState(false)
  const [checkinEnabled, setCheckinEnabled] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [followUpCaseId, setFollowUpCaseId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [timelineLoaded, setTimelineLoaded] = useState(false)

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

  // Jobsheet-level activity feed (created, created-from-estimate, booked work-line
  // outcomes, comms) merged with the linked VHC's timeline — fetched lazily on open.
  // Works whether or not a VHC exists, so estimate-sourced jobsheets get a timeline too.
  useEffect(() => {
    if (searchParams.get('tab') !== 'timeline' || !token || !id || timelineLoaded) return
    api<{ timeline: TimelineEvent[] }>(`/api/v1/jobsheets/${id}/timeline`, { token })
      .then(d => { setTimeline(d.timeline || []); setTimelineLoaded(true) })
      .catch(() => setTimelineLoaded(true))
  }, [searchParams, token, id, timelineLoaded])

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

  // Invoice the jobsheet — the parts COGS/sale trigger (GMS/PARTS.md §7.3).
  const handleInvoice = async (force = false) => {
    if (!token || !id) return
    setInvoicing(true)
    try {
      const res = await api<{ invoiceNumber?: string; warnings?: string[] }>(
        `/api/v1/jobsheets/${id}/invoice`, { method: 'POST', body: { force }, token }
      )
      toast.success(`Invoiced${res.invoiceNumber ? ` · ${res.invoiceNumber}` : ''}`)
      res.warnings?.forEach(w => toast.error(w))
      load()
    } catch (err) {
      const blockers = err instanceof ApiError && err.code === 'zero_cost_lines'
        ? (err.details?.blockers as Array<{ label: string }> | undefined)
        : undefined
      if (blockers?.length) {
        const list = blockers.map(b => `• ${b.label}`).join('\n')
        if (window.confirm(`These parts have no recorded cost (margin would book at 100%):\n\n${list}\n\nInvoice anyway?`)) {
          await handleInvoice(true)
          return
        }
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to invoice')
      }
    } finally {
      setInvoicing(false)
    }
  }

  const handleReopen = async () => {
    if (!token || !id) return
    if (!window.confirm('Reopen this invoice? The parts sale journal will be reversed so the jobsheet can be edited and re-invoiced.')) return
    setInvoicing(true)
    try {
      await api(`/api/v1/jobsheets/${id}/reopen`, { method: 'POST', token })
      toast.success('Invoice reopened')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reopen')
    } finally {
      setInvoicing(false)
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
    return <div className="max-w-3xl mx-auto py-12 text-center text-gray-500">Jobsheet not found. <Link to={backTo} className="text-primary hover:underline">Back to {backLabel.toLowerCase()}</Link></div>
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
    { id: 'work', label: 'Work' },
    { id: 'timeline', label: 'Timeline' }
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
        <Link to={backTo} className="text-sm text-gray-500 hover:text-gray-700">← {backLabel}</Link>
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
              {js.bookingSource === 'online_estimate' && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 inline-flex items-center gap-1" title="The customer booked this slot online from their estimate. Confirm the time if needed.">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M3.6 9h16.8 M3.6 15h16.8 M12 3a15 15 0 010 18 M12 3a15 15 0 000 18" /></svg>
                  Online estimate
                </span>
              )}
              {js.sourceEstimate && (
                <Link to={`/estimates/${js.sourceEstimate.id}`}
                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 inline-flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  From estimate{js.sourceEstimate.reference ? ` · ${js.sourceEstimate.reference}` : ''}
                </Link>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">Document date: {formatDate(js.createdAt)}{js.createdBy && ` · by ${js.createdBy.firstName} ${js.createdBy.lastName}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {js.customer && (
              <Link to={`/customers/${js.customer.id}`} target="_blank" rel="noopener noreferrer"
                className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 inline-flex items-center gap-1.5">
                Customer
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              </Link>
            )}
            {realVhc && hc && (
              <Link to={`/health-checks/${hc.id}`} className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                Open VHC{hc.vhcReference ? ` · ${hc.vhcReference}` : ''}
              </Link>
            )}
            {js.closedAt ? (
              <>
                <span className="px-3 py-2 rounded-lg text-sm font-medium bg-rag-green/10 text-rag-green inline-flex items-center gap-1.5" title={js.taxPointDate ? `Tax point ${formatDate(js.taxPointDate)}` : undefined}>
                  Invoiced{js.invoiceNumber ? ` · ${js.invoiceNumber}` : ''}
                </span>
                <button onClick={handleReopen} disabled={invoicing} className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">Reopen</button>
              </>
            ) : (
              <button onClick={() => handleInvoice(false)} disabled={invoicing} className="px-4 py-2 bg-[#16191f] text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-50">{invoicing ? 'Invoicing…' : 'Invoice'}</button>
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

      {/* Smart banner — staff-facing customer/vehicle cues */}
      <CustomerInsightsBanner customerId={js.customer?.id} vehicleId={js.vehicle?.id} excludeHealthCheckId={js.healthCheck?.id} className="mb-4" />

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
                {(js.vehicle.motStatus || js.vehicle.motExpiryDate) && (
                  <div className="flex justify-between items-center"><dt className="text-gray-500">MOT</dt><dd>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${motTone(js.vehicle.motStatus, js.vehicle.motExpiryDate)}`}>
                      {js.vehicle.motExpiryDate ? `Due ${formatDateOnly(js.vehicle.motExpiryDate)}` : (js.vehicle.motStatus || '—')}
                    </span>
                  </dd></div>
                )}
                {js.history && (
                  <>
                    <div className="flex justify-between pt-1.5 border-t border-gray-100"><dt className="text-gray-500">Last visit</dt><dd className="text-gray-900">{formatDateOnly(js.history.lastVisitAt)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">Total visits</dt><dd className="text-gray-900">{js.history.totalVisits}</dd></div>
                  </>
                )}
              </dl>
            ) : <p className="text-sm text-gray-400">No vehicle.</p>}
          </div>

          {/* Outstanding deferred work — recovery opportunity from prior visits.
              When a follow-up case exists for this vehicle, open it directly in the
              modal; otherwise fall back to the full follow-up worklist. */}
          {js.deferred && js.deferred.count > 0 && (() => {
            const bannerCls = 'lg:col-span-2 w-full text-left flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:bg-amber-100/70 transition-colors'
            const inner = (
              <>
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" /></svg>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">{js.deferred.count} item{js.deferred.count === 1 ? '' : 's'} of deferred work outstanding</p>
                    <p className="text-xs text-amber-700">{GBP.format(js.deferred.totalValue)} from previous inspections · review for this visit</p>
                  </div>
                </div>
                <span className="text-sm font-medium text-amber-700 whitespace-nowrap">Follow up →</span>
              </>
            )
            return js.deferred.caseId ? (
              <button type="button" onClick={() => setFollowUpCaseId(js.deferred!.caseId)} className={bannerCls}>{inner}</button>
            ) : (
              <Link to="/follow-ups" className={bannerCls}>{inner}</Link>
            )
          })()}

          {/* Quoted total — grand total inc VAT for the booked + inspection work */}
          {js.work && js.work.itemCount > 0 && (
            <button onClick={() => setTab('work')} className="text-left bg-white border border-gray-200 rounded-xl shadow-sm p-5 hover:border-gray-300 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">Quoted total</h2>
                <span className="text-sm font-medium text-primary">Work →</span>
              </div>
              <div className="text-3xl font-bold text-gray-900 leading-none">{GBP.format(js.work.totalIncVat)}</div>
              <p className="text-xs text-gray-500 mt-1.5">
                {GBP.format(js.work.net)} net + {GBP.format(js.work.vat)} VAT · {js.work.itemCount} item{js.work.itemCount === 1 ? '' : 's'}
              </p>
            </button>
          )}

          {/* Inspection (VHC) summary — RAG at a glance without opening the VHC */}
          {realVhc && hc && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Inspection</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">{humanizeStatus(hc.status)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { label: 'Red', count: hc.redCount, cls: 'bg-rag-red' },
                  { label: 'Amber', count: hc.amberCount, cls: 'bg-rag-amber' },
                  { label: 'Green', count: hc.greenCount, cls: 'bg-rag-green' }
                ]).map(r => (
                  <div key={r.label} className={`${r.cls} text-white rounded-lg py-2 text-center`}>
                    <div className="text-xl font-bold leading-none">{r.count}</div>
                    <div className="text-[11px] font-medium opacity-90 mt-0.5">{r.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{hc.completedAt ? `Completed ${formatDateOnly(hc.completedAt)}` : 'In progress'}</span>
                <Link to={`/health-checks/${hc.id}`} className="font-medium text-primary hover:text-primary-dark">Open VHC →</Link>
              </div>
            </div>
          )}

          {/* Recent customer messages */}
          {isEnabled('customer_comms') && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Messages</h2>
                {js.customer?.mobile && (
                  <button onClick={() => setShowCompose(true)} className="text-sm font-medium text-primary hover:text-primary-dark">Send message</button>
                )}
              </div>
              {js.recentMessages && js.recentMessages.length > 0 ? (
                <ul className="space-y-2">
                  {js.recentMessages.slice(0, 4).map(m => (
                    <li key={m.id} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 ${m.direction === 'inbound' ? 'bg-gray-100 text-gray-600' : 'bg-primary/10 text-primary'}`}>{m.direction === 'inbound' ? 'In' : 'Out'}</span>
                      <span className="text-gray-700 line-clamp-2 flex-1">{m.body}</span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">{timeAgo(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">{js.customer?.mobile ? 'No messages yet.' : 'No mobile number on file.'}</p>
              )}
            </div>
          )}

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
                  <label className={labelCls}>Main Booking Requirement</label>
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
          parent={{ type: 'jobsheet', id: js.id }}
          token={token}
          organizationId={user?.organization?.id}
          notes={{ label: 'Booking Notes', value: js.bookingNotes, onSave: (v) => api(`/api/v1/jobsheets/${js.id}`, { method: 'PATCH', token, body: { bookingNotes: v } }).then(() => {}) }}
          onChange={load}
        />
      )}

      {/* Timeline tab — jobsheet activity feed (created, from-estimate, booked work,
          comms) merged with the linked VHC's timeline. TimelineTab renders its own
          empty state, so it's safe to show even before the feed has loaded. */}
      {activeTab === 'timeline' && <TimelineTab timeline={timeline} />}

      {showCompose && js.customer && (
        <ComposeMessageModal
          customer={{
            id: js.customer.id,
            firstName: js.customer.firstName,
            lastName: js.customer.lastName,
            mobile: js.customer.mobile
          }}
          onClose={() => setShowCompose(false)}
          onSent={() => { setShowCompose(false); load() }}
        />
      )}

      {followUpCaseId && (
        <FollowUpDetailModal
          caseId={followUpCaseId}
          onClose={() => { setFollowUpCaseId(null); load() }}
          onChanged={load}
        />
      )}
    </div>
  )
}
