import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useModules } from '../../contexts/ModulesContext'
import { api } from '../../lib/api'

// Unified Parts surface — catalogue master + perpetual stock in one list. "Stock" is just
// the subset flagged is_stocked; one table (parts_catalog), one add form with a
// "Track in stock" toggle. Stock columns/actions appear only when the parts_stock module is on.
interface Part {
  id: string
  partNumber: string
  description: string
  costPrice: number
  isActive: boolean
  isStocked: boolean
  categoryId: string | null
  categoryName: string | null
  sellPrice: number | null
  qtyOnHand: number
  averageCost: number
  stockValue: number
  minQty: number | null
  binLocation: string | null
  stockStatus: string | null
}
interface Category { id: string; name: string }
interface Supplier { id: string; name: string }

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const STATUS_BADGE: Record<string, string> = {
  in_stock: 'bg-green-100 text-green-700',
  low: 'bg-amber-100 text-amber-800',
  out: 'bg-red-100 text-red-700',
}
const STATUS_LABEL: Record<string, string> = { in_stock: 'In stock', low: 'Low', out: 'Out' }

const emptyForm = {
  part_number: '', description: '', cost_price: '', sell_price: '',
  category_id: '', preferred_supplier_id: '', barcode: '',
  is_stocked: false, min_qty: '', max_qty: '', bin_location: '',
}

export default function PartsCatalog() {
  const { session, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { isEnabled } = useModules()
  const stockOn = isEnabled('parts_stock')
  const orgId = user?.organization?.id
  const [params, setParams] = useSearchParams()

  const [parts, setParts] = useState<Part[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'all' | 'stocked' | 'catalogue'>(params.get('view') === 'stocked' ? 'stocked' : 'all')
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  const limit = 25

  const fetchParts = useCallback(async () => {
    if (!orgId) return
    try {
      setLoading(true)
      const qp = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search.trim()) qp.set('q', search.trim())
      if (view === 'stocked') qp.set('stocked', 'true')
      else if (view === 'catalogue') qp.set('stocked', 'false')
      const data = await api<{ parts: Part[]; total: number }>(
        `/api/v1/organizations/${orgId}/parts-catalog?${qp}`,
        { token: session?.accessToken }
      )
      setParts(data.parts || [])
      setTotal(data.total || 0)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load parts')
    } finally {
      setLoading(false)
    }
  }, [orgId, page, search, view, session?.accessToken, toast])

  useEffect(() => { fetchParts() }, [fetchParts])
  // keep ?view= in the URL so /parts/stock → /parts?view=stocked lands on the stocked tab
  useEffect(() => {
    const next = new URLSearchParams(params)
    if (view === 'stocked') next.set('view', 'stocked'); else next.delete('view')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const openAdd = async () => {
    setForm(emptyForm); setFormError(''); setShowAdd(true)
    const reqs: Promise<void>[] = []
    if (orgId) reqs.push(api<{ suppliers: Supplier[] }>(`/api/v1/organizations/${orgId}/suppliers`, { token: session?.accessToken }).then(d => { setSuppliers(d.suppliers || []) }).catch(() => {}))
    if (stockOn) reqs.push(api<{ categories: Category[] }>('/api/v1/parts-stock/part-categories', { token: session?.accessToken }).then(d => { setCategories(d.categories || []) }).catch(() => {}))
    await Promise.all(reqs)
  }

  const savePart = async () => {
    if (!orgId) return
    if (!form.part_number.trim()) { setFormError('Part number is required'); return }
    if (!form.description.trim()) { setFormError('Description is required'); return }
    setSaving(true); setFormError('')
    try {
      await api(`/api/v1/organizations/${orgId}/parts-catalog`, {
        method: 'POST', token: session?.accessToken,
        body: {
          part_number: form.part_number.trim(),
          description: form.description.trim(),
          cost_price: form.cost_price === '' ? 0 : parseFloat(form.cost_price),
          sell_price: form.sell_price === '' ? null : parseFloat(form.sell_price),
          category_id: form.category_id || null,
          preferred_supplier_id: form.preferred_supplier_id || null,
          barcode: form.barcode.trim() || null,
          is_stocked: form.is_stocked,
          min_qty: form.is_stocked && form.min_qty !== '' ? parseFloat(form.min_qty) : null,
          max_qty: form.is_stocked && form.max_qty !== '' ? parseFloat(form.max_qty) : null,
          bin_location: form.is_stocked ? (form.bin_location.trim() || null) : null,
        },
      })
      toast.success('Part added')
      setShowAdd(false)
      await fetchParts()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add part')
    } finally {
      setSaving(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const TABS: Array<{ key: typeof view; label: string }> = [
    { key: 'all', label: 'All parts' },
    { key: 'stocked', label: 'Stocked' },
    { key: 'catalogue', label: 'Catalogue only' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parts</h1>
          <p className="text-sm text-gray-500 mt-1">Your parts master and price book.{stockOn ? ' Toggle “track in stock” to hold and value inventory.' : ''}</p>
        </div>
        <button onClick={openAdd} className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black">Add part</button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {stockOn ? (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {TABS.map(t => (
              <button key={t.key} onClick={() => { setView(t.key); setPage(1) }}
                className={`px-3 py-1.5 text-sm font-medium ${view === t.key ? 'bg-[#16191f] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        ) : <div />}
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search part no, description, barcode…"
          className="w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Part</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                {stockOn && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">On hand</th>}
                {stockOn && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>}
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {parts.length === 0 ? (
                <tr><td colSpan={stockOn ? 6 : 4} className="px-6 py-10 text-center text-gray-500">No parts found. Click “Add part” to create one.</td></tr>
              ) : parts.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/parts/${p.id}`)}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{p.partNumber}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[320px]">{p.description}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{p.categoryName || <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{GBP.format(p.costPrice)}</td>
                  {stockOn && <td className="px-6 py-4 text-right text-gray-900">{p.isStocked ? p.qtyOnHand : <span className="text-gray-300">—</span>}</td>}
                  {stockOn && <td className="px-6 py-4 text-right text-gray-900">{p.isStocked ? GBP.format(p.stockValue) : <span className="text-gray-300">—</span>}</td>}
                  <td className="px-6 py-4 text-center">
                    {p.isStocked
                      ? <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.stockStatus || ''] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[p.stockStatus || ''] || 'Stocked'}</span>
                      : <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Catalogue</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 text-sm">
              <span className="text-gray-500">{total} parts</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Prev</button>
                <span className="px-2 py-1 text-gray-600">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 border border-gray-300 rounded-lg disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500/75" onClick={() => setShowAdd(false)} />
            <div className="relative bg-white w-full max-w-lg p-6 rounded-[18px] shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Add part</h3>
              {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 mb-4 text-sm rounded-lg">{formError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Part number <span className="text-[#d23f3f]">*</span></label>
                  <input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Barcode <span className="text-[#aeb4be]">· optional</span></label>
                  <input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-[#d23f3f]">*</span></label>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost (£)</label>
                  <input type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sell price (£) <span className="text-[#aeb4be]">· optional</span></label>
                  <input type="number" step="0.01" value={form.sell_price} onChange={e => setForm({ ...form, sell_price: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                </div>
                {stockOn && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                      <option value="">—</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                <div className={stockOn ? '' : 'col-span-2'}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred supplier</label>
                  <select value={form.preferred_supplier_id} onChange={e => setForm({ ...form, preferred_supplier_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#16191f]">
                    <option value="">—</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              {stockOn && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.is_stocked} onChange={e => setForm({ ...form, is_stocked: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                    <span className="text-sm font-medium text-gray-800">Track this part in stock</span>
                  </label>
                  {form.is_stocked && (
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Min qty</label>
                        <input type="number" step="1" value={form.min_qty} onChange={e => setForm({ ...form, min_qty: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Max qty</label>
                        <input type="number" step="1" value={form.max_qty} onChange={e => setForm({ ...form, max_qty: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bin</label>
                        <input value={form.bin_location} onChange={e => setForm({ ...form, bin_location: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded-[10px] text-sm focus:outline-none focus:ring-2 focus:ring-[#16191f]" />
                      </div>
                      <p className="col-span-3 text-xs text-gray-400">On-hand quantity is built from goods-in and stock adjustments, not entered here.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-5">
                <button onClick={() => setShowAdd(false)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-[10px] font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={savePart} disabled={saving} className="flex-1 px-4 py-2 bg-[#16191f] text-white rounded-[10px] font-semibold hover:bg-black disabled:opacity-50">{saving ? 'Saving…' : 'Add part'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
