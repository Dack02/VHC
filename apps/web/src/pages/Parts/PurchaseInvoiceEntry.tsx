import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import PartsLineEditor, { blankPartLine, partsInputCls, type PartLine, type ExtraColumn } from '../../components/parts/PartsLineEditor'

interface Supplier { id: string; name: string }
interface JobHit {
  id: string
  reference: string | null
  closedAt: string | null
  customer: { firstName?: string; lastName?: string } | null
  vehicle: { registration?: string; make?: string; model?: string } | null
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (v: string, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d }
const jobLabelOf = (j: JobHit) => {
  const cust = [j.customer?.firstName, j.customer?.lastName].filter(Boolean).join(' ').trim()
  return [j.reference, j.vehicle?.registration, cust].filter(Boolean).join(' · ') || j.reference || 'Job'
}

/**
 * Purchase Invoice entry — record a supplier invoice in hand in one post (GMS/PARTS.md).
 * Per line, a disposition: "To stock" (builds on-hand + books the asset) or "To a job" (added
 * to that job card; cost parks on the job until it's invoiced). One invoice can mix both and fan
 * job lines out to several jobs. Lines use the shared PartsLineEditor (Part no + catalogue
 * typeahead + Enter-to-add); the disposition/sell columns are this screen's extra columns.
 */
export default function PurchaseInvoiceEntry() {
  const { session, user } = useAuth()
  const orgId = user?.organization?.id
  const toast = useToast()
  const navigate = useNavigate()

  // Stable idempotency key for this entry instance — a double-submit / retry returns the
  // already-created invoice instead of duplicating it.
  const clientRequestId = useRef<string>(crypto.randomUUID())

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PartLine[]>([blankPartLine({ target: 'stock', jobsheetId: null, jobLabel: null, sell: '' })])
  const [vat, setVat] = useState('')
  const [vatTouched, setVatTouched] = useState(false)
  const [vatRate, setVatRate] = useState(20)
  const [posting, setPosting] = useState(false)

  // Job picker modal — target a single line key, or 'all'
  const [jobPickerFor, setJobPickerFor] = useState<number | 'all' | null>(null)
  const [jobQuery, setJobQuery] = useState('')
  const [jobHits, setJobHits] = useState<JobHit[]>([])
  const [jobSearching, setJobSearching] = useState(false)

  useEffect(() => {
    if (!orgId) return
    api<{ suppliers: Supplier[] }>(`/api/v1/organizations/${orgId}/suppliers`, { token: session?.accessToken })
      .then(d => setSuppliers(d.suppliers || []))
      .catch(() => {})
    // Org VAT rate so the previewed VAT/Gross match what the API actually books.
    api<{ settings?: { vatRate?: number } }>(`/api/v1/organizations/${orgId}/pricing-settings`, { token: session?.accessToken })
      .then(d => { const r = Number(d?.settings?.vatRate); if (Number.isFinite(r) && r >= 0) setVatRate(r) })
      .catch(() => {})
  }, [orgId, session?.accessToken])

  // Live totals — preview VAT at the org's rate so it matches the posted journal.
  const net = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.cost), 0))
  const suggestedVat = round2(net * (vatRate / 100))
  const effectiveVat = vatTouched ? round2(num(vat)) : suggestedVat
  const gross = round2(net + effectiveVat)
  useEffect(() => { if (!vatTouched) setVat(suggestedVat ? String(suggestedVat) : '') }, [suggestedVat, vatTouched])

  // Job picker
  const openJobPicker = (forKey: number | 'all') => { setJobPickerFor(forKey); setJobQuery(''); setJobHits([]) }
  const runJobSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setJobHits([]); return }
    setJobSearching(true)
    try {
      const d = await api<{ jobsheets: JobHit[] }>(
        `/api/v1/jobsheets?complete=false&limit=20&q=${encodeURIComponent(q.trim())}`, { token: session?.accessToken })
      setJobHits((d.jobsheets || []).filter(j => !j.closedAt))
    } catch { setJobHits([]) } finally { setJobSearching(false) }
  }, [session?.accessToken])
  useEffect(() => {
    if (jobPickerFor == null) return
    const t = setTimeout(() => runJobSearch(jobQuery), 250)
    return () => clearTimeout(t)
  }, [jobQuery, jobPickerFor, runJobSearch])

  const chooseJob = (j: JobHit) => {
    const label = jobLabelOf(j)
    if (jobPickerFor === 'all') setLines(ls => ls.map(l => ({ ...l, target: 'job', jobsheetId: j.id, jobLabel: label })))
    else if (jobPickerFor != null) setLines(ls => ls.map(l => (l.key === jobPickerFor ? { ...l, target: 'job', jobsheetId: j.id, jobLabel: label } : l)))
    setJobPickerFor(null)
  }

  const setTarget = (key: number, target: 'stock' | 'job') => {
    if (target === 'job') {
      setLines(ls => ls.map(l => (l.key === key ? { ...l, target: 'job' } : l)))
      const l = lines.find(x => x.key === key)
      if (!l?.jobsheetId) openJobPicker(key)
    } else {
      setLines(ls => ls.map(l => (l.key === key ? { ...l, target: 'stock', jobsheetId: null, jobLabel: null } : l)))
    }
  }

  // A line is postable only with a description, qty AND a unit cost > 0 (a £0 stock receipt would
  // drag the weighted-average cost toward zero).
  const lineOk = (l: PartLine) => !!l.description.trim() && num(l.qty) > 0 && num(l.cost) > 0
  const valid = lines.some(lineOk) && net > 0
  const costlessLines = lines.some(l => l.description.trim() && num(l.qty) > 0 && num(l.cost) <= 0)
  const jobLinesMissingJob = lines.some(l => l.target === 'job' && lineOk(l) && !l.jobsheetId)

  const extraColumns: ExtraColumn[] = [
    {
      key: 'goesTo', header: 'Goes to', thClassName: 'px-4 py-2 text-left w-64',
      cell: (l) => (
        <>
          <select value={l.target ?? 'stock'} onChange={e => setTarget(l.key, e.target.value as 'stock' | 'job')} className={`${partsInputCls} w-full`}>
            <option value="stock">To stock</option>
            <option value="job">To a job</option>
          </select>
          {l.target === 'job' && (
            <button type="button" onClick={() => openJobPicker(l.key)} className="mt-1 text-xs text-left text-primary hover:underline block truncate max-w-[15rem]">
              {l.jobLabel ? l.jobLabel : 'Pick a job…'}
            </button>
          )}
        </>
      ),
    },
    {
      key: 'sell', header: 'Sell (job)', thClassName: 'px-4 py-2 text-right w-28',
      cell: (l, patch) => (l.target === 'job'
        ? <input value={l.sell ?? ''} onChange={e => patch({ sell: e.target.value })} type="number" min="0" step="0.01" placeholder="auto" className={`${partsInputCls} w-full text-right`} />
        : <span className="block text-right text-gray-300 text-sm pt-2">—</span>),
    },
  ]

  const post = async () => {
    if (costlessLines) { toast.error('Every line needs a unit cost greater than zero'); return }
    if (!valid) { toast.error('Add at least one line with a description, quantity and unit cost'); return }
    if (jobLinesMissingJob) { toast.error('Pick a job for each line set to "To a job"'); return }
    setPosting(true)
    try {
      const payload = {
        clientRequestId: clientRequestId.current,
        supplierId: supplierId || null,
        invoiceRef: invoiceRef.trim() || null,
        invoiceDate,
        vat: vatTouched ? round2(num(vat)) : null,
        notes: notes.trim() || null,
        lines: lines.filter(lineOk).map(l => ({
          partId: l.partId,
          partNumber: l.partNumber.trim() || null,
          description: l.description.trim(),
          qty: num(l.qty),
          unitCost: num(l.cost),
          target: l.target === 'job' ? 'job' : 'stock',
          jobsheetId: l.target === 'job' ? (l.jobsheetId ?? null) : null,
          sellPrice: l.target === 'job' && (l.sell ?? '').trim() !== '' ? round2(num(l.sell ?? '')) : null,
        })),
      }
      const res = await api<{ ok: boolean; stockLines: number; jobLines: number }>(
        '/api/v1/purchase-invoices', { method: 'POST', token: session?.accessToken, body: payload })
      const parts: string[] = []
      if (res.stockLines) parts.push(`${res.stockLines} into stock`)
      if (res.jobLines) parts.push(`${res.jobLines} onto job${res.jobLines > 1 ? 's' : ''}`)
      toast.success(`Invoice posted${parts.length ? ` — ${parts.join(', ')}` : ''}`)
      navigate('/parts/purchase-invoices')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post invoice')
    } finally {
      setPosting(false)
    }
  }

  const inputCls = partsInputCls

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <button onClick={() => navigate('/parts/purchase-invoices')} className="text-sm text-gray-500 hover:text-gray-700 mb-2">← Purchase invoices</button>
        <h1 className="text-2xl font-bold text-gray-900">New purchase invoice</h1>
        <p className="text-sm text-gray-500 mt-1">Enter the supplier invoice in hand. Each line goes <strong>to stock</strong> (builds on-hand + books the asset) or <strong>to a job</strong> (added to that job card; cost parks on the job until it's invoiced).</p>
      </div>

      {/* Header fields */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
          <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className={`${inputCls} w-full`}>
            <option value="">Unassigned</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Invoice ref</label>
          <input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} placeholder="e.g. INV-12345" className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Invoice date</label>
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" className={`${inputCls} w-full`} />
        </div>
      </div>

      {/* Lines */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Lines</h2>
          <button onClick={() => openJobPicker('all')} className="text-xs text-primary hover:underline">Apply all lines to one job…</button>
        </div>
        <PartsLineEditor
          lines={lines}
          onChange={setLines}
          orgId={orgId}
          token={session?.accessToken}
          newExtra={() => ({ target: 'stock', jobsheetId: null, jobLabel: null, sell: '' })}
          extraColumns={extraColumns}
        />
      </div>

      {/* Totals + post */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1 text-sm">
          <div className="flex gap-6"><span className="text-gray-500 w-16">Net</span><span className="font-medium text-gray-900 w-28 text-right">{GBP.format(net)}</span></div>
          <div className="flex gap-6 items-center">
            <span className="text-gray-500 w-16">VAT</span>
            <input value={vat} onChange={e => { setVat(e.target.value); setVatTouched(true) }} type="number" min="0" step="0.01" className={`${inputCls} w-28 text-right`} />
            {!vatTouched && <span className="text-xs text-gray-400">auto {vatRate}% · edit to match</span>}
          </div>
          <div className="flex gap-6 pt-1 border-t border-gray-100"><span className="text-gray-700 w-16 font-semibold">Gross</span><span className="font-bold text-gray-900 w-28 text-right">{GBP.format(gross)}</span></div>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/parts/purchase-invoices')} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={post} disabled={posting || !valid} className="px-5 py-2 bg-[#16191f] text-white rounded-[10px] font-semibold hover:bg-black disabled:opacity-50">
            {posting ? 'Posting…' : 'Post invoice'}
          </button>
        </div>
      </div>

      {/* Job picker modal */}
      {jobPickerFor != null && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-start justify-center min-h-screen px-4 pt-24">
            <div className="fixed inset-0 bg-gray-500/75" onClick={() => setJobPickerFor(null)} />
            <div className="relative bg-white w-full max-w-lg p-6 rounded-[18px] shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{jobPickerFor === 'all' ? 'Apply all lines to a job' : 'Pick a job'}</h3>
              <p className="text-xs text-gray-500 mb-4">Search open jobs by reg, customer or job number.</p>
              <input autoFocus value={jobQuery} onChange={e => setJobQuery(e.target.value)} placeholder="Search jobs…" className={`${inputCls} w-full mb-3`} />
              <div className="max-h-72 overflow-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                {jobSearching ? (
                  <div className="px-3 py-6 text-center text-sm text-gray-400">Searching…</div>
                ) : jobHits.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-gray-400">{jobQuery.trim() ? 'No open jobs match.' : 'Type to search open jobs.'}</div>
                ) : jobHits.map(j => (
                  <button key={j.id} type="button" onClick={() => chooseJob(j)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50">
                    <span className="font-medium text-gray-900">{j.reference || 'Job'}</span>
                    {j.vehicle?.registration && <span className="ml-2 text-gray-600">{j.vehicle.registration}</span>}
                    <span className="block text-xs text-gray-500">{[j.customer?.firstName, j.customer?.lastName].filter(Boolean).join(' ')}{j.vehicle?.make ? ` · ${j.vehicle.make} ${j.vehicle.model ?? ''}` : ''}</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={() => setJobPickerFor(null)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] font-medium hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
