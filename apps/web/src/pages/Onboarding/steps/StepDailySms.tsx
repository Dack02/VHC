import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  orgId: string
  onNext: () => void
  onBack: () => void
}

interface Recipient {
  id: string
  name: string
  phoneNumber: string
}

export default function StepDailySms({ token, orgId, onNext, onBack }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [time, setTime] = useState('18:00')
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const base = `/api/v1/organizations/${orgId}/daily-sms-overview`

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [settings, recs] = await Promise.all([
          api<{ enabled: boolean; time: string }>(`${base}/settings`, { token }),
          api<{ recipients: Recipient[] }>(`${base}/recipients`, { token })
        ])
        if (!active) return
        setEnabled(settings.enabled)
        setTime(settings.time || '18:00')
        setRecipients(recs.recipients || [])
      } catch {
        /* defaults are fine for a fresh org */
      }
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const addRecipient = async () => {
    if (!name.trim() || !phone.trim()) { setError('Enter a name and phone number'); return }
    setAdding(true); setError('')
    try {
      const rec = await api<Recipient>(`${base}/recipients`, { method: 'POST', token, body: { name, phoneNumber: phone } })
      setRecipients(prev => [...prev, rec])
      setName(''); setPhone('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add recipient')
    } finally { setAdding(false) }
  }

  const removeRecipient = async (id: string) => {
    try {
      await api(`${base}/recipients/${id}`, { method: 'DELETE', token })
      setRecipients(prev => prev.filter(r => r.id !== id))
    } catch {
      /* non-fatal */
    }
  }

  const finish = async (saveSettings: boolean) => {
    setSaving(true); setError('')
    try {
      if (saveSettings) {
        await api(`${base}/settings`, { method: 'PATCH', token, body: { enabled, time } })
      }
      await api('/api/v1/onboarding/daily-sms', { method: 'POST', token })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Daily SMS Overview</h2>
        <p className="text-gray-500 mt-1">
          A short text message sent each evening with the day's numbers — health checks completed, conversion rate, and
          the value of work identified versus sold — so you can keep an eye on the workshop without logging in.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">{error}</div>}

      {/* Enable toggle */}
      <div className="bg-gray-50 p-4 rounded-lg mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-gray-900">Send a daily overview</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {enabled ? 'On — the recipients below get a daily summary text.' : 'Off — turn this on to receive the daily summary.'}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>
      </div>

      {enabled && (
        <>
          <div className="mb-5 max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1">Send time (Europe/London)</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
          </div>

          <div className="mb-2">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Recipients</h3>
            {recipients.length > 0 ? (
              <div className="space-y-2 mb-3">
                {recipients.map(r => (
                  <div key={r.id} className="flex items-center justify-between bg-white border border-gray-200 p-3 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">{r.name}</p>
                      <p className="text-sm text-gray-500">{r.phoneNumber}</p>
                    </div>
                    <button type="button" onClick={() => removeRecipient(r.id)} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-3">No recipients yet — add at least one phone number to receive the overview.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Name"
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44 7700 900000"
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
              <button type="button" onClick={addRecipient} disabled={adding}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
                {adding ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex justify-between pt-6 mt-6 border-t">
        <button type="button" onClick={onBack} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Back</button>
        <div className="flex space-x-3">
          <button type="button" onClick={() => finish(false)} disabled={saving} className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors">Skip for now</button>
          <button type="button" onClick={() => finish(true)} disabled={saving} className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors">{saving ? 'Saving...' : 'Continue'}</button>
        </div>
      </div>
    </div>
  )
}
