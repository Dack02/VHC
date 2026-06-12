import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import type { BoardColumnDef } from './types'

interface AddColumnModalProps {
  siteId: string
  existingColumns: BoardColumnDef[]
  onClose: () => void
  onAdded: () => void
}

interface OrgUser {
  id: string
  first_name?: string
  last_name?: string
  firstName?: string
  lastName?: string
  role: string
  is_active?: boolean
  isActive?: boolean
  site_id?: string | null
  siteId?: string | null
}

const QUEUE_COLOURS = ['#6B7280', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444']

export default function AddColumnModal({ siteId, existingColumns, onClose, onAdded }: AddColumnModalProps) {
  const { session } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<'technician' | 'queue'>('technician')
  const [technicians, setTechnicians] = useState<OrgUser[]>([])
  const [loadingTechs, setLoadingTechs] = useState(true)
  const [selectedTechId, setSelectedTechId] = useState('')
  const [queueName, setQueueName] = useState('')
  const [queueColour, setQueueColour] = useState(QUEUE_COLOURS[0])
  const [saving, setSaving] = useState(false)

  const existingTechIds = new Set(
    existingColumns.filter(c => c.columnType === 'technician').map(c => c.technicianId)
  )

  useEffect(() => {
    const fetchTechnicians = async () => {
      if (!session?.accessToken) return
      try {
        const data = await api<{ users: OrgUser[] }>('/api/v1/users', { token: session.accessToken })
        const techs = (data.users || []).filter(u => {
          const active = u.is_active ?? u.isActive ?? true
          return u.role === 'technician' && active && !existingTechIds.has(u.id)
        })
        setTechnicians(techs)
        if (techs.length > 0) setSelectedTechId(techs[0].id)
      } catch {
        toast.error('Failed to load technicians')
      } finally {
        setLoadingTechs(false)
      }
    }
    fetchTechnicians()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken])

  const userName = (u: OrgUser) =>
    `${u.first_name ?? u.firstName ?? ''} ${u.last_name ?? u.lastName ?? ''}`.trim()

  const handleAdd = async () => {
    if (!session?.accessToken) return
    setSaving(true)
    try {
      const body =
        tab === 'technician'
          ? { columnType: 'technician', technicianId: selectedTechId }
          : { columnType: 'queue', name: queueName.trim(), colour: queueColour }

      await api(`/api/v1/workshop-board/columns?siteId=${siteId}`, {
        method: 'POST',
        token: session.accessToken,
        body
      })
      toast.success(tab === 'technician' ? 'Technician column added' : 'Queue column added')
      onAdded()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add column')
    } finally {
      setSaving(false)
    }
  }

  const canSave = tab === 'technician' ? !!selectedTechId : !!queueName.trim()

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Add column</h3>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
          <button
            onClick={() => setTab('technician')}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md ${
              tab === 'technician' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}
          >
            Technician
          </button>
          <button
            onClick={() => setTab('queue')}
            className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md ${
              tab === 'queue' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}
          >
            Queue
          </button>
        </div>

        {tab === 'technician' ? (
          loadingTechs ? (
            <div className="text-sm text-gray-400 py-4">Loading technicians…</div>
          ) : technicians.length === 0 ? (
            <div className="text-sm text-gray-500 py-4">
              All active technicians already have a column on this board.
            </div>
          ) : (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Technician</label>
              <select
                value={selectedTechId}
                onChange={e => setSelectedTechId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {technicians.map(t => (
                  <option key={t.id} value={t.id}>{userName(t)}</option>
                ))}
              </select>
            </div>
          )
        ) : (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Queue name</label>
              <input
                type="text"
                value={queueName}
                onChange={e => setQueueName(e.target.value)}
                maxLength={60}
                placeholder="e.g. Valeting, Awaiting Parts, Ready for Collection"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Colour</label>
              <div className="flex gap-2">
                {QUEUE_COLOURS.map(colour => (
                  <button
                    key={colour}
                    onClick={() => setQueueColour(colour)}
                    className={`w-7 h-7 rounded-full border-2 ${
                      queueColour === colour ? 'border-gray-900 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: colour }}
                    aria-label={`Colour ${colour}`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={saving || !canSave}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add column'}
          </button>
        </div>
      </div>
    </div>
  )
}
