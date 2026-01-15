import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api, Vehicle, Template, User, Site } from '../../lib/api'

export default function NewHealthCheck() {
  const { session } = useAuth()
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<Template[]>([])
  const [technicians, setTechnicians] = useState<User[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Vehicle[]>([])
  const [searching, setSearching] = useState(false)

  const [form, setForm] = useState({
    vehicleId: '',
    templateId: '',
    technicianId: '',
    siteId: '',
    mileageIn: ''
  })

  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)

  // Load templates and technicians on mount
  useEffect(() => {
    const loadData = async () => {
      if (!session?.accessToken) return

      try {
        // Load templates
        const templateData = await api<{ templates: Template[] }>(
          '/api/v1/templates',
          { token: session.accessToken }
        )
        setTemplates(templateData.templates || [])

        // Load technicians
        const userData = await api<{ users: User[] }>(
          '/api/v1/users',
          { token: session.accessToken }
        )
        setTechnicians(userData.users?.filter(u => u.role === 'technician') || [])

        // Load sites
        const siteData = await api<{ sites: Site[] }>(
          '/api/v1/sites',
          { token: session.accessToken }
        )
        setSites(siteData.sites || [])
        // Default to first site
        if (siteData.sites?.length > 0) {
          setForm(f => ({ ...f, siteId: siteData.sites[0].id }))
        }
      } catch (err) {
        console.error('Failed to load data:', err)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [session?.accessToken])

  // Search vehicles
  useEffect(() => {
    const searchVehicles = async () => {
      if (!session?.accessToken || searchQuery.length < 2) {
        setSearchResults([])
        return
      }

      setSearching(true)
      try {
        const data = await api<{ vehicles: Vehicle[] }>(
          `/api/v1/vehicles?search=${encodeURIComponent(searchQuery)}`,
          { token: session.accessToken }
        )
        setSearchResults(data.vehicles || [])
      } catch (err) {
        console.error('Search failed:', err)
      } finally {
        setSearching(false)
      }
    }

    const debounce = setTimeout(searchVehicles, 300)
    return () => clearTimeout(debounce)
  }, [searchQuery, session?.accessToken])

  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle)
    setForm({ ...form, vehicleId: vehicle.id })
    setSearchQuery('')
    setSearchResults([])
  }

  const clearVehicle = () => {
    setSelectedVehicle(null)
    setForm({ ...form, vehicleId: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.accessToken) return

    if (!form.vehicleId) {
      setError('Please select a vehicle')
      return
    }
    if (!form.templateId) {
      setError('Please select a template')
      return
    }
    if (!form.siteId) {
      setError('No site available')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await api<{ id: string }>(
        '/api/v1/health-checks',
        {
          method: 'POST',
          token: session.accessToken,
          body: {
            vehicleId: form.vehicleId,
            templateId: form.templateId,
            technicianId: form.technicianId || undefined,
            siteId: form.siteId,
            mileageIn: form.mileageIn ? parseInt(form.mileageIn) : undefined
          }
        }
      )
      navigate(`/health-checks/${response.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create health check')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/health-checks" className="text-gray-500 hover:text-gray-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Health Check</h1>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="bg-white border border-gray-200 shadow-sm p-6 space-y-6">
          {/* Vehicle Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vehicle *
            </label>
            {selectedVehicle ? (
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200">
                <div>
                  <div className="font-medium">{selectedVehicle.registration}</div>
                  <div className="text-sm text-gray-500">
                    {selectedVehicle.make} {selectedVehicle.model}
                    {selectedVehicle.customer && (
                      <span> - {selectedVehicle.customer.first_name} {selectedVehicle.customer.last_name}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearVehicle}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by registration..."
                  className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searching && (
                  <div className="absolute right-3 top-2.5">
                    <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                  </div>
                )}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 shadow-lg max-h-60 overflow-auto">
                    {searchResults.map(vehicle => (
                      <button
                        key={vehicle.id}
                        type="button"
                        onClick={() => selectVehicle(vehicle)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <div className="font-medium">{vehicle.registration}</div>
                        <div className="text-sm text-gray-500">
                          {vehicle.make} {vehicle.model}
                          {vehicle.customer && (
                            <span> - {vehicle.customer.first_name} {vehicle.customer.last_name}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Template Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template *
            </label>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a template...</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          {/* Site Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Site *
            </label>
            <select
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>

          {/* Technician Assignment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assign Technician (optional)
            </label>
            <select
              value={form.technicianId}
              onChange={(e) => setForm({ ...form, technicianId: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Unassigned</option>
              {technicians.map(tech => (
                <option key={tech.id} value={tech.id}>
                  {tech.firstName} {tech.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Mileage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mileage In (optional)
            </label>
            <input
              type="number"
              value={form.mileageIn}
              onChange={(e) => setForm({ ...form, mileageIn: e.target.value })}
              placeholder="Enter mileage"
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-primary text-white font-medium hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Health Check'}
          </button>
          <Link
            to="/health-checks"
            className="px-6 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
