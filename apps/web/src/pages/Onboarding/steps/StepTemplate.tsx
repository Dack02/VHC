import { useState, useEffect } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  onNext: () => void
  onBack: () => void
}

interface TemplatesResponse {
  templates: { id: string; name: string }[]
  total: number
}

export default function StepTemplate({ token, onNext, onBack }: Props) {
  const [count, setCount] = useState<number | null>(null)
  const [actionDone, setActionDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await api<TemplatesResponse>('/api/v1/templates?is_active=true', { token })
        if (active) setCount(data.total ?? (data.templates?.length || 0))
      } catch {
        if (active) setCount(0)
      }
    })()
    return () => { active = false }
  }, [token])

  const useStarter = async () => {
    setBusy(true); setError(''); setMessage('')
    try {
      const res = await api<{ templatesCopied: number; templatesCount: number }>(
        '/api/v1/onboarding/template', { method: 'POST', token, body: { mode: 'starter' } }
      )
      setCount(res.templatesCount)
      setActionDone(true)
      setMessage(res.templatesCopied > 0
        ? `Added ${res.templatesCopied} starter template${res.templatesCopied === 1 ? '' : 's'}.`
        : 'No standard template is configured yet — create your own below, or skip and build one later in Settings.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the standard template')
    } finally { setBusy(false) }
  }

  const createOwn = async () => {
    if (!name.trim()) { setError('Please enter a template name'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const res = await api<{ templatesCount: number }>(
        '/api/v1/onboarding/template', { method: 'POST', token, body: { mode: 'create', name } }
      )
      setCount(res.templatesCount)
      setActionDone(true)
      setCreating(false)
      setName('')
      setMessage('Template created. Add your sections and items in Settings → Templates.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the template')
    } finally { setBusy(false) }
  }

  const handleContinue = async () => {
    if (actionDone) { onNext(); return }
    setBusy(true); setError('')
    try {
      await api('/api/v1/onboarding/template', { method: 'POST', token, body: { mode: 'skip' } })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue')
    } finally { setBusy(false) }
  }

  const hasTemplates = (count ?? 0) > 0

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Inspection template</h2>
        <p className="text-gray-500 mt-1">
          A template is the checklist your technicians work through on each vehicle. You'll need at least one before you can run a health check.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
      {message && <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded mb-4">{message}</div>}

      {hasTemplates && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-start space-x-3">
          <svg className="w-5 h-5 text-green-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="text-sm text-green-800">
            <p className="font-medium">You have {count} inspection template{count === 1 ? '' : 's'} ready.</p>
            <p className="mt-0.5">Fine-tune the sections and items anytime in Settings → Templates.</p>
          </div>
        </div>
      )}

      {!hasTemplates && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Standard starter */}
          <div className="border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900">Use our standard template</h3>
            <p className="text-sm text-gray-500 mt-1">Start from a ready-made inspection covering the common checks. You can edit it later.</p>
            <button type="button" onClick={useStarter} disabled={busy}
              className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors">
              {busy ? 'Working...' : 'Use standard template'}
            </button>
          </div>
          {/* Create your own */}
          <div className="border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900">Create your own</h3>
            <p className="text-sm text-gray-500 mt-1">Start with an empty template and build your checklist from scratch.</p>
            {creating ? (
              <div className="mt-4 space-y-2">
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard VHC"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
                <div className="flex space-x-2">
                  <button type="button" onClick={createOwn} disabled={busy}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors">
                    {busy ? 'Creating...' : 'Create'}
                  </button>
                  <button type="button" onClick={() => { setCreating(false); setName('') }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setCreating(true)}
                className="mt-4 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
                Create template
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-6 mt-6 border-t">
        <button type="button" onClick={onBack}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">Back</button>
        <button type="button" onClick={handleContinue} disabled={busy}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors">
          {busy ? 'Working...' : (hasTemplates || actionDone) ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}
