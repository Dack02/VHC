import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface Technician {
  id: string
  firstName: string
  lastName: string
}

interface AddColumnModalProps {
  siteId: string  // Used for context, passed from parent
  existingTechIds: string[]
  onAdd: (techId: string) => void
  onClose: () => void
}

export default function AddColumnModal({ siteId, existingTechIds, onAdd, onClose }: AddColumnModalProps) {
  const { session } = useAuth()
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTechnicians = async () => {
      if (!session?.accessToken) {
        setLoading(false)
        return
      }

      try {
        const params = new URLSearchParams({
          role: 'technician',
          site_id: siteId,
          limit: '200',
        })

        const data = await api<{ users: any[] }>(`/api/v1/users?${params.toString()}`, {
          token: session.accessToken,
        })

        setTechnicians(
          (data.users || [])
            .filter((u: any) => u.isActive)
            .map((u: any) => ({
              id: u.id,
              firstName: u.firstName,
              lastName: u.lastName,
            }))
        )
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }
    fetchTechnicians()
  }, [session?.accessToken, siteId])

  const available = technicians.filter(t => !existingTechIds.includes(t.id))

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Add Technician Column</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : available.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              All technicians have been added to the board.
            </p>
          ) : (
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {available.map(tech => (
                <button
                  key={tech.id}
                  onClick={() => onAdd(tech.id)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">
                    {tech.firstName.charAt(0)}{tech.lastName.charAt(0)}
                  </div>
                  <span className="text-sm text-gray-900">
                    {tech.firstName} {tech.lastName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
