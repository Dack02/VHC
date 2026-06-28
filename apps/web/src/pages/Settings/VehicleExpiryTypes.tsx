import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import type { ExpiryType } from '../Vehicles/types'

export default function VehicleExpiryTypes() {
  const { session } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const [types, setTypes] = useState<ExpiryType[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newLead, setNewLead] = useState('30')

  const load = useCallback(async () => {
    if (!token) return
    try {
      const data = await api<{ types: ExpiryType[] }>(`/api/v1/expiry-types`, { token })
      setTypes(data.types || [])
    } catch { toast.error('Failed to load expiry types') } finally { setLoading(false) }
  }, [token, toast])

  useEffect(() => { load() }, [load])

  const patch = async (id: string, body: Record<string, unknown>) => {
    try { await api(`/api/v1/expiry-types/${id}`, { method: 'PATCH', token, body }); load() }
    catch { toast.error('Could not update') }
  }
  const add = async () => {
    if (!newLabel.trim()) return
    try {
      await api(`/api/v1/expiry-types`, { method: 'POST', token, body: { label: newLabel.trim(), defaultLeadDays: Number(newLead) || 30 } })
      setNewLabel(''); setNewLead('30'); load()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not add type') }
  }
  const del = async (t: ExpiryType) => {
    if (!confirm(`Delete “${t.label}”?`)) return
    try { await api(`/api/v1/expiry-types/${t.id}`, { method: 'DELETE', token }); load() }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not delete') }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
      <h1 className="text-2xl font-bold text-gray-900 mt-2 mb-1">Vehicle expiry types</h1>
      <p className="text-gray-600 mb-6">The date types tracked against each vehicle (MOT, Service, Tax) and any custom ones — used for reminders and marketing.</p>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-3">
          {types.map(t => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[160px]">
                <div className="font-medium text-gray-900">{t.label}
                  {t.is_system && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">system</span>}
                </div>
                <div className="text-xs text-gray-400">{t.code}{t.is_mileage_based ? ' · mileage-based' : ''}</div>
              </div>
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                Lead days
                <input type="number" defaultValue={t.default_lead_days} onBlur={e => { const v = Number(e.target.value); if (v !== t.default_lead_days) patch(t.id, { defaultLeadDays: v }) }} className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
              </label>
              <select defaultValue={t.default_channel} onChange={e => patch(t.id, { defaultChannel: e.target.value })} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="both">Both</option>
              </select>
              <label className="text-xs text-gray-500 flex items-center gap-1.5">
                <input type="checkbox" checked={t.is_active} onChange={e => patch(t.id, { isActive: e.target.checked })} /> Active
              </label>
              {!t.is_system && <button onClick={() => del(t)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>}
            </div>
          ))}

          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-medium text-gray-600">New custom type</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Cambelt, Air-con regas, Warranty" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <label className="text-xs text-gray-500">Lead days
              <input type="number" value={newLead} onChange={e => setNewLead(e.target.value)} className="block w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm mt-1" />
            </label>
            <button onClick={add} disabled={!newLabel.trim()} className="px-4 py-2 bg-[#16191f] text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-50">Add type</button>
          </div>
        </div>
      )}
    </div>
  )
}
