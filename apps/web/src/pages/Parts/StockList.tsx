import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface StockItem {
  id: string
  part_number: string
  description: string
  category_id: string | null
  is_stocked: boolean
  qty_on_hand: number
  average_cost: number
  min_qty: number | null
  max_qty: number | null
  bin_location: string | null
  sell_price: number | null
  sell_price_override: number | null
  stock_value: number
  stock_status: 'out' | 'low' | 'in_stock'
}
interface Category { id: string; name: string }

interface ItemForm {
  part_number: string
  description: string
  category_id: string
  cost_price: string
  sell_price: string
  min_qty: string
  max_qty: string
  bin_location: string
}
const emptyForm: ItemForm = { part_number: '', description: '', category_id: '', cost_price: '', sell_price: '', min_qty: '', max_qty: '', bin_location: '' }

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })
const STATUS_BADGE: Record<StockItem['stock_status'], string> = {
  out: 'bg-rag-red text-white',
  low: 'bg-rag-amber text-white',
  in_stock: 'bg-rag-green text-white',
}
const STATUS_LABEL: Record<StockItem['stock_status'], string> = { out: 'Out', low: 'Low', in_stock: 'In stock' }

export default function StockList() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<StockItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [defaultMargin, setDefaultMargin] = useState(40)

  const [showItemModal, setShowItemModal] = useState(false)
  const [editing, setEditing] = useState<StockItem | null>(null)
  const [form, setForm] = useState<ItemForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [adjustItem, setAdjustItem] = useState<StockItem | null>(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('stock_take')

  const token = session?.accessToken

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ include_all: 'false', limit: '200' })
      if (search) params.set('q', search)
      const data = await api<{ items: StockItem[] }>(`/api/v1/parts-stock/stock-items?${params}`, { token })
      setItems(data.items || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stock')
    } finally {
      setLoading(false)
    }
  }, [token, search])

  useEffect(() => { fetchItems() }, [fetchItems])
  useEffect(() => {
    if (!token) return
    api<{ categories: Category[] }>('/api/v1/parts-stock/part-categories', { token })
      .then(d => setCategories(d.categories || [])).catch(() => {})
    if (user?.organization?.id) {
      api<{ settings: { defaultMarginPercent: number } }>(`/api/v1/organizations/${user.organization.id}/pricing-settings`, { token })
        .then(d => setDefaultMargin(d.settings?.defaultMarginPercent ?? 40)).catch(() => {})
    }
  }, [token, user?.organization?.id])

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowItemModal(true) }
  const openEdit = (it: StockItem) => {
    setEditing(it)
    setForm({
      part_number: it.part_number, description: it.description, category_id: it.category_id ?? '',
      cost_price: String(it.average_cost || ''), sell_price: it.sell_price != null ? String(it.sell_price) : '',
      min_qty: it.min_qty != null ? String(it.min_qty) : '', max_qty: it.max_qty != null ? String(it.max_qty) : '',
      bin_location: it.bin_location ?? '',
    })
    setShowItemModal(true)
  }

  // Flat-markup default sell price (decision 7): sell = cost / (1 − margin/100)
  const applyFlatMarkup = (cost: string) => {
    const c = parseFloat(cost)
    if (!Number.isFinite(c) || defaultMargin >= 100) return
    setForm(f => ({ ...f, cost_price: cost, sell_price: (c / (1 - defaultMargin / 100)).toFixed(2) }))
  }

  const saveItem = async () => {
    if (!form.part_number || !form.description) { toast.error('Part number and description are required'); return }
    try {
      setSaving(true)
      const body = {
        part_number: form.part_number, description: form.description,
        category_id: form.category_id || null,
        cost_price: form.cost_price ? parseFloat(form.cost_price) : 0,
        sell_price: form.sell_price ? parseFloat(form.sell_price) : null,
        min_qty: form.min_qty ? parseFloat(form.min_qty) : null,
        max_qty: form.max_qty ? parseFloat(form.max_qty) : null,
        bin_location: form.bin_location || null,
        is_stocked: true,
      }
      if (editing) await api(`/api/v1/parts-stock/stock-items/${editing.id}`, { method: 'PATCH', body, token })
      else await api('/api/v1/parts-stock/stock-items', { method: 'POST', body, token })
      toast.success(editing ? 'Stock item updated' : 'Stock item created')
      setShowItemModal(false)
      fetchItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const submitAdjust = async () => {
    const delta = parseFloat(adjustQty)
    if (!adjustItem || !Number.isFinite(delta) || delta === 0) { toast.error('Enter a non-zero quantity'); return }
    try {
      setSaving(true)
      await api(`/api/v1/parts-stock/stock-items/${adjustItem.id}/adjust`, {
        method: 'POST', body: { qty_delta: delta, reason_code: adjustReason }, token,
      })
      toast.success('Stock adjusted')
      setAdjustItem(null); setAdjustQty('')
      fetchItems()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to adjust')
    } finally {
      setSaving(false)
    }
  }

  const totalValue = items.reduce((s, it) => s + (it.stock_value || 0), 0)
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock</h1>
          <p className="text-sm text-gray-500 mt-1">Held stock items, valued at average cost · {GBP.format(totalValue)} on hand</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark self-start">
          + Add stock item
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search part number or description…"
        className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 py-12 text-center">No stock items yet. Add one, or mark a catalogue part as stocked.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="py-2.5 px-4">Part</th>
                <th className="py-2.5 px-2 text-right">On hand</th>
                <th className="py-2.5 px-2 text-right">Avg cost</th>
                <th className="py-2.5 px-2 text-right">Value</th>
                <th className="py-2.5 px-2">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(it => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-gray-900">{it.part_number}</div>
                    <div className="text-gray-400 text-xs">{it.description}{it.bin_location ? ` · bin ${it.bin_location}` : ''}</div>
                  </td>
                  <td className="py-2.5 px-2 text-right text-gray-700">{it.qty_on_hand}</td>
                  <td className="py-2.5 px-2 text-right text-gray-600">{GBP.format(it.average_cost || 0)}</td>
                  <td className="py-2.5 px-2 text-right text-gray-900">{GBP.format(it.stock_value || 0)}</td>
                  <td className="py-2.5 px-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[it.stock_status]}`}>{STATUS_LABEL[it.stock_status]}</span></td>
                  <td className="py-2.5 px-4 text-right whitespace-nowrap">
                    <button onClick={() => setAdjustItem(it)} className="text-primary hover:underline text-xs font-medium mr-3">Adjust</button>
                    <button onClick={() => openEdit(it)} className="text-gray-600 hover:underline text-xs font-medium">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / edit modal */}
      {showItemModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowItemModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit stock item' : 'Add stock item'}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Part number</label>
                <input value={form.part_number} disabled={!!editing} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className={inputCls}>
                  <option value="">— Uncategorised —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cost price (£)</label>
                <input type="number" step="0.01" value={form.cost_price} onChange={e => applyFlatMarkup(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sell price (£) <span className="text-gray-400">· {defaultMargin}% margin</span></label>
                <input type="number" step="0.01" value={form.sell_price} onChange={e => setForm(f => ({ ...f, sell_price: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Min qty</label>
                <input type="number" step="1" value={form.min_qty} onChange={e => setForm(f => ({ ...f, min_qty: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Max qty</label>
                <input type="number" step="1" value={form.max_qty} onChange={e => setForm(f => ({ ...f, max_qty: e.target.value }))} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Bin location</label>
                <input value={form.bin_location} onChange={e => setForm(f => ({ ...f, bin_location: e.target.value }))} className={inputCls} placeholder="A-12" />
              </div>
            </div>
            {!editing && <p className="text-xs text-gray-400">Quantity on hand is set via stock adjustments / goods-in, not here.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowItemModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={saveItem} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust modal */}
      {adjustItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAdjustItem(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Adjust stock</h2>
              <p className="text-sm text-gray-500">{adjustItem.part_number} · on hand {adjustItem.qty_on_hand}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Quantity change (+/−)</label>
              <input type="number" step="1" value={adjustQty} onChange={e => setAdjustQty(e.target.value)} className={inputCls} placeholder="e.g. -2 or 5" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
              <select value={adjustReason} onChange={e => setAdjustReason(e.target.value)} className={inputCls}>
                <option value="stock_take">Stock take</option>
                <option value="damage">Damage</option>
                <option value="shrinkage">Shrinkage / loss</option>
                <option value="found">Found stock</option>
                <option value="correction">Correction</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setAdjustItem(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={submitAdjust} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Apply'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
