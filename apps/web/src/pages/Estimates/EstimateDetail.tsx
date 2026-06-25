import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { api, User } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import WorkDetailsPanel from '../Jobsheets/WorkDetailsPanel'
import CustomerCardModal from '../Jobsheets/components/CustomerCardModal'
import CustomerInsightsBanner from '../../components/CustomerInsightsBanner'

interface Estimate {
  id: string
  reference: string | null
  status: string
  validUntil: string | null
  mileage: number | null
  customerNotes: string | null
  internalNotes: string | null
  convertedToJobsheetId: string | null
  sentAt: string | null
  firstOpenedAt: string | null
  respondedAt: string | null
  responseFinalisedAt: string | null
  createdAt: string
  customer: { id: string; firstName: string; lastName: string; mobile: string | null; email: string | null; phone: string | null } | null
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null; fuelType: string | null } | null
  advisor: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; firstName: string; lastName: string } | null
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', opened: 'Opened', accepted: 'Accepted',
  partial: 'Partly accepted', declined: 'Declined', expired: 'Expired',
  converted: 'Converted', cancelled: 'Cancelled'
}
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700', opened: 'bg-indigo-100 text-indigo-700',
  accepted: 'bg-green-100 text-green-700', partial: 'bg-amber-100 text-amber-700', declined: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700', converted: 'bg-teal-100 text-teal-700', cancelled: 'bg-gray-100 text-gray-500'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

type EstimateTab = 'overview' | 'work'

export default function EstimateDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, user } = useAuth()
  const { isEnabled } = useModules()
  const navigate = useNavigate()
  const toast = useToast()
  const token = session?.accessToken
  const [searchParams, setSearchParams] = useSearchParams()

  const [est, setEst] = useState<Estimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [advisors, setAdvisors] = useState<User[]>([])
  const [showCustomerCard, setShowCustomerCard] = useState(false)
  const [form, setForm] = useState({ advisorId: '', mileage: '', validUntil: '', customerNotes: '', internalNotes: '' })
  const [showSend, setShowSend] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendOpts, setSendOpts] = useState({ email: true, sms: false, message: '' })
  const [showConvert, setShowConvert] = useState(false)
  const [converting, setConverting] = useState(false)
  const [serviceTypes, setServiceTypes] = useState<{ id: string; code: string }[]>([])
  const [convertOpts, setConvertOpts] = useState({ lineSelection: 'approved' as 'approved' | 'all', dueInDate: '', dueInTime: '', serviceTypeId: '', advisorId: '', bookingNotes: '' })

  const load = useCallback(async () => {
    if (!token || !id) return
    try {
      const data = await api<Estimate>(`/api/v1/estimates/${id}`, { token })
      setEst(data)
      setForm({
        advisorId: data.advisor?.id || '',
        mileage: data.mileage != null ? String(data.mileage) : '',
        validUntil: data.validUntil || '',
        customerNotes: data.customerNotes || '',
        internalNotes: data.internalNotes || ''
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load estimate')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!token || !editing || advisors.length) return
    api<{ users: User[] }>('/api/v1/users', { token })
      .then(d => setAdvisors((d.users || []).filter(u => u.role !== 'technician'))).catch(() => {})
  }, [token, editing, advisors.length])

  const activeTab: EstimateTab = (searchParams.get('tab') === 'work' ? 'work' : 'overview')
  const setTab = (t: EstimateTab) => setSearchParams(prev => { prev.set('tab', t); return prev })

  const save = async () => {
    if (!token || !id) return
    setSaving(true)
    try {
      await api(`/api/v1/estimates/${id}`, {
        method: 'PATCH', token,
        body: {
          advisorId: form.advisorId || null,
          mileage: form.mileage ? parseInt(form.mileage, 10) : null,
          validUntil: form.validUntil || null,
          customerNotes: form.customerNotes,
          internalNotes: form.internalNotes
        }
      })
      setEditing(false)
      await load()
      toast.success('Estimate saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!token || !id || !window.confirm('Delete this estimate?')) return
    try {
      await api(`/api/v1/estimates/${id}`, { method: 'DELETE', token })
      navigate('/estimates')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleSend = async () => {
    if (!token || !id) return
    if (!sendOpts.email && !sendOpts.sms) { toast.error('Choose email and/or SMS'); return }
    setSending(true)
    try {
      const res = await api<{ sent: { email: { success: boolean } | null; sms: { success: boolean } | null } }>(
        `/api/v1/estimates/${id}/send`,
        { method: 'POST', token, body: { sendEmail: sendOpts.email, sendSms: sendOpts.sms, message: sendOpts.message || undefined } }
      )
      const emailOk = res.sent?.email?.success
      const smsOk = res.sent?.sms?.success
      if ((sendOpts.email && emailOk === false) || (sendOpts.sms && smsOk === false)) {
        toast.error('Estimate marked as sent, but a message failed to deliver. Check contact details / settings.')
      } else {
        toast.success('Estimate sent to the customer')
      }
      setShowSend(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send estimate')
    } finally { setSending(false) }
  }

  const openConvert = () => {
    if (!est || !token) return
    setConvertOpts({
      lineSelection: ['accepted', 'partial'].includes(est.status) ? 'approved' : 'all',
      dueInDate: new Date().toISOString().slice(0, 10),
      dueInTime: '',
      serviceTypeId: '',
      advisorId: est.advisor?.id || '',
      bookingNotes: ''
    })
    setShowConvert(true)
    api<{ serviceTypes: { id: string; code: string }[] }>('/api/v1/service-types?active_only=true', { token })
      .then(d => setServiceTypes(d.serviceTypes || [])).catch(() => {})
    if (!advisors.length) {
      api<{ users: User[] }>('/api/v1/users', { token })
        .then(d => setAdvisors((d.users || []).filter(u => u.role !== 'technician'))).catch(() => {})
    }
  }

  const handleMakeJobsheet = async () => {
    if (!token || !id) return
    if (!convertOpts.dueInDate) { toast.error('Choose a due-in date'); return }
    setConverting(true)
    try {
      const res = await api<{ jobsheetId: string }>(`/api/v1/estimates/${id}/make-jobsheet`, {
        method: 'POST', token,
        body: {
          dueInDate: convertOpts.dueInDate,
          dueInTime: convertOpts.dueInTime || undefined,
          serviceTypeId: convertOpts.serviceTypeId || undefined,
          advisorId: convertOpts.advisorId || undefined,
          bookingNotes: convertOpts.bookingNotes || undefined,
          lineSelection: convertOpts.lineSelection
        }
      })
      toast.success('Jobsheet created from estimate')
      navigate(`/jobsheets/${res.jobsheetId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to convert estimate')
    } finally { setConverting(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center p-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
  }
  if (!est) {
    return <div className="max-w-3xl mx-auto text-center py-12 text-gray-400">Estimate not found. <Link to="/estimates" className="text-primary hover:underline">Back to estimates</Link></div>
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const labelCls = 'block text-xs font-medium text-gray-500 mb-1'
  const canEditRole = user?.role !== 'technician'

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <Link to="/estimates" className="text-gray-500 hover:text-gray-700 mt-1">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{est.reference || 'Estimate'}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[est.status] || 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABELS[est.status] || est.status}
            </span>
            {est.convertedToJobsheetId && (
              <Link to={`/jobsheets/${est.convertedToJobsheetId}`} className="text-xs font-medium text-teal-700 hover:underline">View jobsheet →</Link>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Created {formatDate(est.createdAt)}{est.createdBy && <span> by {est.createdBy.firstName} {est.createdBy.lastName}</span>}</p>
        </div>
        {activeTab === 'overview' && canEditRole && (
          !editing ? (
            <div className="flex items-center gap-2">
              {!['converted', 'cancelled'].includes(est.status) && (
                <button onClick={() => setShowSend(true)} className="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark">
                  {est.sentAt ? 'Resend' : 'Send to customer'}
                </button>
              )}
              {!['converted', 'cancelled'].includes(est.status) && isEnabled('jobsheets') && (
                <button onClick={openConvert} className="px-3 py-1.5 text-sm font-medium text-primary border border-indigo-200 rounded-lg hover:bg-indigo-50">
                  Make Jobsheet
                </button>
              )}
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Edit</button>
              <button onClick={remove} className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={saving} className="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); load() }} className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            </div>
          )
        )}
      </div>

      {/* Smart banner — staff-facing customer/vehicle cues */}
      <CustomerInsightsBanner customerId={est.customer?.id} vehicleId={est.vehicle?.id} className="mb-4" />

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {(['overview', 'work'] as EstimateTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${activeTab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'overview' ? 'Overview' : 'Work Details'}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Customer response timeline (once sent) */}
          {est.sentAt && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <p className={labelCls}>Customer</p>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div><span className="text-gray-500">Sent</span> <span className="text-gray-900 font-medium ml-1">{formatDateTime(est.sentAt)}</span></div>
                <div><span className="text-gray-500">Opened</span> <span className="text-gray-900 font-medium ml-1">{est.firstOpenedAt ? formatDateTime(est.firstOpenedAt) : 'Not yet'}</span></div>
                <div><span className="text-gray-500">Responded</span> <span className="text-gray-900 font-medium ml-1">{est.responseFinalisedAt ? formatDateTime(est.responseFinalisedAt) : est.respondedAt ? 'In progress' : 'Not yet'}</span></div>
              </div>
            </div>
          )}

          {/* Customer + vehicle */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <p className={labelCls}>Customer</p>
              {est.customer ? (
                <button onClick={() => setShowCustomerCard(true)} className="text-left group">
                  <div className="font-medium text-gray-900 group-hover:text-primary group-hover:underline">{est.customer.firstName} {est.customer.lastName}</div>
                  <div className="text-sm text-gray-500">{est.customer.mobile || est.customer.phone || est.customer.email || 'No contact details'}</div>
                </button>
              ) : <div className="text-sm text-gray-400">No customer</div>}
            </div>
            <div>
              <p className={labelCls}>Vehicle</p>
              {est.vehicle ? (
                <>
                  <div className="font-medium text-gray-900">{est.vehicle.registration}</div>
                  <div className="text-sm text-gray-500">{[est.vehicle.make, est.vehicle.model, est.vehicle.year].filter(Boolean).join(' ')}</div>
                </>
              ) : <div className="text-sm text-gray-400">No vehicle</div>}
            </div>
          </div>

          {/* Details */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className={labelCls}>Valid Until</p>
              {editing
                ? <input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} className={inputCls} />
                : <p className="text-sm text-gray-900">{formatDate(est.validUntil)}</p>}
            </div>
            <div>
              <p className={labelCls}>Service Advisor</p>
              {editing
                ? <select value={form.advisorId} onChange={e => setForm({ ...form, advisorId: e.target.value })} className={inputCls}>
                    <option value="">Unassigned</option>
                    {advisors.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
                  </select>
                : <p className="text-sm text-gray-900">{est.advisor ? `${est.advisor.firstName} ${est.advisor.lastName}` : '—'}</p>}
            </div>
            <div>
              <p className={labelCls}>Mileage</p>
              {editing
                ? <input type="number" value={form.mileage} onChange={e => setForm({ ...form, mileage: e.target.value })} placeholder="Optional" className={inputCls} />
                : <p className="text-sm text-gray-900">{est.mileage != null ? est.mileage.toLocaleString() : '—'}</p>}
            </div>
            <div className="sm:col-span-2">
              <p className={labelCls}>Notes to Customer <span className="text-gray-400">(shown on the estimate)</span></p>
              {editing
                ? <textarea value={form.customerNotes} onChange={e => setForm({ ...form, customerNotes: e.target.value })} rows={2} className={inputCls} />
                : <p className="text-sm text-gray-900 whitespace-pre-wrap">{est.customerNotes || '—'}</p>}
            </div>
            <div className="sm:col-span-2">
              <p className={labelCls}>Internal Notes <span className="text-gray-400">(staff only)</span></p>
              {editing
                ? <textarea value={form.internalNotes} onChange={e => setForm({ ...form, internalNotes: e.target.value })} rows={2} className={inputCls} />
                : <p className="text-sm text-gray-900 whitespace-pre-wrap">{est.internalNotes || '—'}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Work tab */}
      {activeTab === 'work' && token && (
        <WorkDetailsPanel
          className=""
          parent={{ type: 'estimate', id: est.id }}
          token={token}
          organizationId={user?.organization?.id}
          onChange={load}
        />
      )}

      {showCustomerCard && est.customer?.id && (
        <CustomerCardModal customerId={est.customer.id} onClose={() => setShowCustomerCard(false)} />
      )}

      {/* Send to customer modal */}
      {showSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => !sending && setShowSend(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Send estimate to customer</h2>
            <p className="text-sm text-gray-500 mb-4">
              A link to view and approve {est.reference} will be sent. Expiry is set in <Link to="/settings/estimate-settings" className="text-primary hover:underline">Estimate Settings</Link>.
            </p>
            <div className="space-y-3">
              <label className="flex items-center gap-2.5 text-sm text-gray-700">
                <input type="checkbox" checked={sendOpts.email} onChange={e => setSendOpts(o => ({ ...o, email: e.target.checked }))} className="rounded border-gray-300 text-primary focus:ring-primary" />
                Email {est.customer?.email ? <span className="text-gray-400">· {est.customer.email}</span> : <span className="text-amber-600">· no email on file</span>}
              </label>
              <label className="flex items-center gap-2.5 text-sm text-gray-700">
                <input type="checkbox" checked={sendOpts.sms} onChange={e => setSendOpts(o => ({ ...o, sms: e.target.checked }))} className="rounded border-gray-300 text-primary focus:ring-primary" />
                SMS {est.customer?.mobile ? <span className="text-gray-400">· {est.customer.mobile}</span> : <span className="text-amber-600">· no mobile on file</span>}
              </label>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Message (optional)</label>
                <textarea value={sendOpts.message} onChange={e => setSendOpts(o => ({ ...o, message: e.target.value }))} rows={2}
                  placeholder="Add a personal note for the customer…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowSend(false)} disabled={sending} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSend} disabled={sending || (!sendOpts.email && !sendOpts.sms)} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Make Jobsheet modal */}
      {showConvert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => !converting && setShowConvert(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Make jobsheet from {est.reference}</h2>
            <p className="text-sm text-gray-500 mb-4">Copies the chosen lines onto a new jobsheet as pre-authorised booked work.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Lines to copy</label>
                <div className="flex gap-2">
                  {(['approved', 'all'] as const).map(opt => (
                    <button key={opt} onClick={() => setConvertOpts(o => ({ ...o, lineSelection: opt }))}
                      className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-lg border ${convertOpts.lineSelection === opt ? 'bg-primary/10 text-primary border-primary/30' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                      {opt === 'approved' ? 'Approved only' : 'All lines'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Due in date *</label>
                  <input type="date" value={convertOpts.dueInDate} onChange={e => setConvertOpts(o => ({ ...o, dueInDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
                  <input type="time" value={convertOpts.dueInTime} onChange={e => setConvertOpts(o => ({ ...o, dueInTime: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Service type</label>
                  <select value={convertOpts.serviceTypeId} onChange={e => setConvertOpts(o => ({ ...o, serviceTypeId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">None</option>
                    {serviceTypes.map(st => <option key={st.id} value={st.id}>{st.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Advisor</label>
                  <select value={convertOpts.advisorId} onChange={e => setConvertOpts(o => ({ ...o, advisorId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Unassigned</option>
                    {advisors.map(a => <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Booking notes</label>
                <textarea value={convertOpts.bookingNotes} onChange={e => setConvertOpts(o => ({ ...o, bookingNotes: e.target.value }))} rows={2}
                  placeholder={est.customerNotes ? 'Defaults to the estimate notes if left blank' : 'Optional'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowConvert(false)} disabled={converting} className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleMakeJobsheet} disabled={converting || !convertOpts.dueInDate} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50">
                {converting ? 'Creating…' : 'Create jobsheet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
