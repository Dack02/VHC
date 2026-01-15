import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { useNavigate } from 'react-router-dom'

interface Template {
  id: string
  name: string
  description?: string
  isActive: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface TemplatesResponse {
  templates: Template[]
  total: number
}

export default function TemplateList() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const data = await api<TemplatesResponse>('/api/v1/templates', {
        token: session?.accessToken
      })
      setTemplates(data.templates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  const handleDuplicate = async (template: Template) => {
    try {
      await api(`/api/v1/templates/${template.id}/duplicate`, {
        method: 'POST',
        body: { name: `${template.name} (Copy)` },
        token: session?.accessToken
      })
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate template')
    }
  }

  const handleDelete = async (template: Template) => {
    if (!confirm(`Are you sure you want to deactivate "${template.name}"?`)) {
      return
    }
    try {
      await api(`/api/v1/templates/${template.id}`, {
        method: 'DELETE',
        token: session?.accessToken
      })
      fetchTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading templates...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Check Templates</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark"
        >
          New Template
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {templates.length === 0 ? (
          <div className="bg-white border border-gray-200 shadow-sm p-8 text-center text-gray-500">
            No templates found. Create your first template.
          </div>
        ) : (
          templates.map((template) => (
            <div key={template.id} className="bg-white border border-gray-200 shadow-sm">
              <div className="p-4 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{template.name}</h3>
                    {template.isDefault && (
                      <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                        Default
                      </span>
                    )}
                    {!template.isActive && (
                      <span className="inline-block px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                        Inactive
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Last updated: {new Date(template.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/templates/${template.id}`)}
                    className="px-3 py-1.5 text-sm font-medium text-primary border border-primary hover:bg-primary hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDuplicate(template)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => handleDelete(template)}
                    className="px-3 py-1.5 text-sm font-medium text-red-600 border border-red-300 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Template Modal */}
      {showModal && (
        <CreateTemplateModal
          onClose={() => setShowModal(false)}
          onSuccess={(id) => {
            setShowModal(false)
            navigate(`/templates/${id}`)
          }}
        />
      )}
    </div>
  )
}

interface CreateTemplateModalProps {
  onClose: () => void
  onSuccess: (id: string) => void
}

function CreateTemplateModal({ onClose, onSuccess }: CreateTemplateModalProps) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await api<{ id: string }>('/api/v1/templates', {
        method: 'POST',
        body: formData,
        token: session?.accessToken
      })
      onSuccess(data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create New Template</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Full Vehicle Health Check"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Brief description of the template"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isDefault"
              checked={formData.isDefault}
              onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="isDefault" className="text-sm text-gray-700">
              Set as default template
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
