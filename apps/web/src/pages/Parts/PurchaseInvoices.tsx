import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

interface InvoiceRow {
  id: string
  poNumber: string | null
  origin: string | null
  supplierId: string | null
  supplierName: string | null
  invoiceRef: string | null
  invoiceDate: string | null
  net: number
  vat: number
  gross: number
}

const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

/**
 * Purchase ledger — every supplier invoice on the books (raised-then-invoiced POs and
 * direct invoice-in-hand entries), newest first, with net/VAT/gross from each one's
 * Event-2 journal. "New invoice" opens the invoice-in-hand entry screen.
 */
export default function PurchaseInvoices() {
  const { session } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api<{ invoices: InvoiceRow[] }>('/api/v1/purchase-invoices', { token: session?.accessToken })
      setRows(data.invoices || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load purchase invoices')
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, toast])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">Supplier invoices on the purchase ledger — enter one in hand to book the cost and put parts into stock or onto a job</p>
        </div>
        <button
          onClick={() => navigate('/parts/purchase-invoices/new')}
          className="px-4 py-2 bg-[#16191f] text-white rounded-lg text-sm font-semibold hover:bg-black"
        >
          New invoice
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Net</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">VAT</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gross</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No purchase invoices yet. Click "New invoice" to enter one in hand.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/parts/purchase-orders/${r.id}`)}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-medium text-gray-900">{r.invoiceRef || r.poNumber || '—'}</span>
                    {r.origin === 'direct_invoice' && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">Direct</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-gray-700">{r.supplierName || <span className="text-gray-400">Unassigned</span>}</td>
                  <td className="px-6 py-4 text-gray-500 text-sm">{r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('en-GB') : '—'}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{GBP.format(r.net)}</td>
                  <td className="px-6 py-4 text-right text-gray-500">{GBP.format(r.vat)}</td>
                  <td className="px-6 py-4 text-right font-medium text-gray-900">{GBP.format(r.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
