import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api, ApiError } from '../../lib/api'
import type { ExpiryType } from '../Vehicles/types'

interface Campaign {
  id: string
  expiry_type_id: string
  name: string
  channel: string
  message_template: string | null
  lead_days: number
  is_enabled: boolean
}

interface RowState {
  type: ExpiryType
  campaign: Campaign | null
  channel: string
  leadDays: number
  messageTemplate: string
  enabled: boolean
  count: number | null
  dirty: boolean
}

export default function VehicleReminderCampaigns() {
  const { session } = useAuth()
  const toast = useToast()
  const token = session?.accessToken
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [t, c] = await Promise.all([
        api<{ types: ExpiryType[] }>(`/api/v1/expiry-types`, { token }),
        api<{ campaigns: Campaign[] }>(`/api/v1/expiry-campaigns`, { token })
      ])
      const byType = new Map(c.campaigns.map(cp => [cp.expiry_type_id, cp]))
      const next: RowState[] = (t.types || []).filter(ty => ty.is_active).map(ty => {
        const cp = byType.get(ty.id) || null
        return {
          type: ty, campaign: cp,
          channel: cp?.channel || ty.default_channel,
          leadDays: cp?.lead_days ?? ty.default_lead_days,
          messageTemplate: cp?.message_template || '',
          enabled: cp?.is_enabled || false,
          count: null, dirty: false
        }
      })
      setRows(next)
      // fetch audience counts for existing campaigns
      for (const cp of c.campaigns) {
        api<{ count: number }>(`/api/v1/expiry-campaigns/${cp.id}/audience-count`, { token })
          .then(r => setRows(prev => prev.map(x => x.type.id === cp.expiry_type_id ? { ...x, count: r.count } : x)))
          .catch(() => {})
      }
    } catch { toast.error('Failed to load campaigns') } finally { setLoading(false) }
  }, [token, toast])

  useEffect(() => { load() }, [load])

  const update = (typeId: string, patch: Partial<RowState>) =>
    setRows(prev => prev.map(r => r.type.id === typeId ? { ...r, ...patch, dirty: true } : r))

  const save = async (r: RowState) => {
    try {
      await api(`/api/v1/expiry-campaigns`, {
        method: 'PUT', token,
        body: {
          expiryTypeId: r.type.id, name: `${r.type.label} reminder`,
          channel: r.channel, leadDays: r.leadDays,
          messageTemplate: r.messageTemplate || null, isEnabled: r.enabled
        }
      })
      toast.success(`${r.type.label} reminder saved`)
      load()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') }
  }

  const runNow = async () => {
    setRunning(true)
    try {
      const res = await api<{ sent: number }>(`/api/v1/expiry-campaigns/run`, { method: 'POST', token, body: {} })
      toast.success(`Sent ${res.sent} reminder${res.sent === 1 ? '' : 's'}`)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Run failed') } finally { setRunning(false) }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
      <div className="flex items-center justify-between mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Expiry reminder campaigns</h1>
        <button onClick={runNow} disabled={running} className="px-3 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50">{running ? 'Running…' : 'Run now'}</button>
      </div>
      <p className="text-gray-600 mb-6">Automatically remind the vehicle’s reminder contact when MOT, Service or a custom date is due. Runs daily; reminders go to the owner (or the driver, for lease cars).</p>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-4">
          {rows.map(r => (
            <div key={r.type.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">{r.type.label}</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={r.enabled} onChange={e => update(r.type.id, { enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <label className="text-xs text-gray-500">Send when due within (days)
                  <input type="number" value={r.leadDays} onChange={e => update(r.type.id, { leadDays: Number(e.target.value) })} className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
                </label>
                <label className="text-xs text-gray-500">Channel
                  <select value={r.channel} onChange={e => update(r.type.id, { channel: e.target.value })} className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1">
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>
              <label className="text-xs text-gray-500 block mt-3">Message ({'{{firstName}}'}, {'{{registration}}'}, {'{{type}}'}, {'{{dueDate}}'}, {'{{garageName}}'} available)
                <textarea value={r.messageTemplate} onChange={e => update(r.type.id, { messageTemplate: e.target.value })} rows={2} placeholder="Leave blank to use the default reminder wording" className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1" />
              </label>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-gray-400">{r.count != null ? `${r.count} vehicle${r.count === 1 ? '' : 's'} currently in window` : (r.campaign ? '…' : 'Not yet saved')}</span>
                <button onClick={() => save(r)} disabled={!r.dirty} className="px-4 py-2 bg-[#16191f] text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-40">Save</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
