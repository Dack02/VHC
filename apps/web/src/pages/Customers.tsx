import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

interface Vehicle {
  id: string
  registration: string
  make?: string
  model?: string
}

interface Customer {
  id: string
  firstName: string
  lastName: string
  email?: string
  mobile?: string
  address?: string
  externalId?: string
  vehicles: Vehicle[]
  createdAt: string
}

interface CustomersResponse {
  customers: Customer[]
  total: number
  limit: number
  offset: number
}

interface VehicleLookupResult {
  id: string
  customerId: string
  customer: {
    id: string
    firstName: string
    lastName: string
    email?: string
    mobile?: string
  } | null
  registration: string
  vin?: string
  make?: string
  model?: string
  year?: number
  color?: string
  fuelType?: string
  mileage?: number
}

export default function Customers() {
  const { session } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [showVehicleLookup, setShowVehicleLookup] = useState(false)

  useEffect(() => {
    fetchCustomers()
  }, [search])

  const fetchCustomers = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)

      const data = await api<CustomersResponse>(`/api/v1/customers?${params}`, {
        token: session?.accessToken
      })
      setCustomers(data.customers)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchCustomers()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowVehicleLookup(true)}
            className="px-4 py-2 text-gray-700 border border-gray-300 font-semibold hover:bg-gray-50"
          >
            Lookup Vehicle
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark"
          >
            Add Customer
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-6">
          {error}
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="flex-1 px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Search
          </button>
        </div>
      </form>

      {/* Customer List */}
      <div className="bg-white border border-gray-200 shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Contact</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Vehicles</th>
              <th className="text-left px-4 py-3 text-sm font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No customers found
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {customer.firstName} {customer.lastName}
                    </div>
                    {customer.externalId && (
                      <div className="text-xs text-gray-400">ID: {customer.externalId}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {customer.email && <div className="text-sm text-gray-600">{customer.email}</div>}
                    {customer.mobile && <div className="text-sm text-gray-600">{customer.mobile}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {customer.vehicles.length > 0 ? (
                      <div className="space-y-1">
                        {customer.vehicles.slice(0, 2).map((v) => (
                          <div key={v.id} className="text-sm">
                            <span className="font-medium">{v.registration}</span>
                            {v.make && v.model && (
                              <span className="text-gray-500 ml-1">
                                {v.make} {v.model}
                              </span>
                            )}
                          </div>
                        ))}
                        {customer.vehicles.length > 2 && (
                          <div className="text-xs text-gray-400">
                            +{customer.vehicles.length - 2} more
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">No vehicles</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedCustomer(customer)}
                      className="text-sm text-primary hover:text-primary-dark"
                    >
                      View/Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {total > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 text-sm text-gray-500">
            Showing {customers.length} of {total} customers
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      {showModal && (
        <CustomerModal
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false)
            fetchCustomers()
          }}
        />
      )}

      {/* View/Edit Customer Modal */}
      {selectedCustomer && (
        <CustomerDetailModal
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
          onUpdate={() => {
            setSelectedCustomer(null)
            fetchCustomers()
          }}
        />
      )}

      {/* Vehicle Lookup Modal */}
      {showVehicleLookup && (
        <VehicleLookupModal
          onClose={() => setShowVehicleLookup(false)}
        />
      )}
    </div>
  )
}

interface CustomerModalProps {
  onClose: () => void
  onSuccess: () => void
}

function CustomerModal({ onClose, onSuccess }: CustomerModalProps) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    address: '',
    externalId: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await api('/api/v1/customers', {
        method: 'POST',
        body: formData,
        token: session?.accessToken
      })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create customer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add New Customer</h2>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
            <input
              type="tel"
              value={formData.mobile}
              onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">External ID (DMS)</label>
            <input
              type="text"
              value={formData.externalId}
              onChange={(e) => setFormData({ ...formData, externalId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Optional reference number"
            />
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
              {loading ? 'Creating...' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface CustomerDetailModalProps {
  customer: Customer
  onClose: () => void
  onUpdate: () => void
}

function CustomerDetailModal({ customer, onClose, onUpdate }: CustomerDetailModalProps) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [formData, setFormData] = useState({
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email || '',
    mobile: customer.mobile || '',
    address: customer.address || '',
    externalId: customer.externalId || ''
  })

  const handleSave = async () => {
    setError('')
    setLoading(true)

    try {
      await api(`/api/v1/customers/${customer.id}`, {
        method: 'PATCH',
        body: formData,
        token: session?.accessToken
      })
      setIsEditing(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update customer')
    } finally {
      setLoading(false)
    }
  }

  const handleAddVehicle = async (vehicleData: { registration: string; make?: string; model?: string; year?: number }) => {
    try {
      await api('/api/v1/vehicles', {
        method: 'POST',
        body: { customerId: customer.id, ...vehicleData },
        token: session?.accessToken
      })
      setShowAddVehicle(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add vehicle')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">
            {customer.firstName} {customer.lastName}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Customer Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Details</h3>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-sm text-primary hover:text-primary-dark"
                >
                  Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="px-3 py-2 border border-gray-300 text-sm"
                    placeholder="First Name"
                  />
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="px-3 py-2 border border-gray-300 text-sm"
                    placeholder="Last Name"
                  />
                </div>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 text-sm"
                  placeholder="Email"
                />
                <input
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 text-sm"
                  placeholder="Mobile"
                />
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 text-sm"
                  placeholder="Address"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="px-3 py-1.5 bg-primary text-white text-sm disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 text-gray-600 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {customer.email && (
                  <div className="flex">
                    <span className="w-20 text-gray-500">Email:</span>
                    <span>{customer.email}</span>
                  </div>
                )}
                {customer.mobile && (
                  <div className="flex">
                    <span className="w-20 text-gray-500">Mobile:</span>
                    <span>{customer.mobile}</span>
                  </div>
                )}
                {customer.address && (
                  <div className="flex">
                    <span className="w-20 text-gray-500">Address:</span>
                    <span>{customer.address}</span>
                  </div>
                )}
                {customer.externalId && (
                  <div className="flex">
                    <span className="w-20 text-gray-500">DMS ID:</span>
                    <span>{customer.externalId}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vehicles */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Vehicles</h3>
              <button
                onClick={() => setShowAddVehicle(true)}
                className="text-sm text-primary hover:text-primary-dark"
              >
                + Add Vehicle
              </button>
            </div>

            {customer.vehicles.length === 0 ? (
              <p className="text-sm text-gray-500">No vehicles registered</p>
            ) : (
              <div className="space-y-2">
                {customer.vehicles.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="p-3 border border-gray-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{vehicle.registration}</div>
                      {vehicle.make && vehicle.model && (
                        <div className="text-sm text-gray-500">
                          {vehicle.make} {vehicle.model}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Add Vehicle Modal */}
        {showAddVehicle && (
          <AddVehicleModal
            onClose={() => setShowAddVehicle(false)}
            onSave={handleAddVehicle}
          />
        )}
      </div>
    </div>
  )
}

function AddVehicleModal({ onClose, onSave }: { onClose: () => void; onSave: (data: { registration: string; make?: string; model?: string; year?: number }) => void }) {
  const [formData, setFormData] = useState({
    registration: '',
    make: '',
    model: '',
    year: ''
  })

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white w-full max-w-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold">Add Vehicle</h3>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Registration *</label>
            <input
              type="text"
              value={formData.registration}
              onChange={(e) => setFormData({ ...formData, registration: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 border border-gray-300"
              placeholder="AB12 CDE"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
              <input
                type="text"
                value={formData.make}
                onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300"
                placeholder="e.g., Ford"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300"
                placeholder="e.g., Focus"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <input
              type="number"
              value={formData.year}
              onChange={(e) => setFormData({ ...formData, year: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300"
              placeholder="e.g., 2020"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600">
              Cancel
            </button>
            <button
              onClick={() => onSave({
                registration: formData.registration,
                make: formData.make || undefined,
                model: formData.model || undefined,
                year: formData.year ? parseInt(formData.year) : undefined
              })}
              disabled={!formData.registration.trim()}
              className="px-4 py-2 bg-primary text-white font-semibold disabled:opacity-50"
            >
              Add Vehicle
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function VehicleLookupModal({ onClose }: { onClose: () => void }) {
  const { session } = useAuth()
  const [registration, setRegistration] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<VehicleLookupResult | null>(null)

  const handleLookup = async () => {
    if (!registration.trim()) return

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const data = await api<VehicleLookupResult>(`/api/v1/vehicles/lookup/${encodeURIComponent(registration.trim())}`, {
        token: session?.accessToken
      })
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vehicle not found')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vehicle Lookup</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Registration Number</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={registration}
                onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                className="flex-1 px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., AB12 CDE"
                autoFocus
              />
              <button
                onClick={handleLookup}
                disabled={loading || !registration.trim()}
                className="px-4 py-2 bg-primary text-white font-semibold hover:bg-primary-dark disabled:opacity-50"
              >
                {loading ? 'Searching...' : 'Lookup'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold">{result.registration}</span>
                {result.year && (
                  <span className="text-sm text-gray-500">{result.year}</span>
                )}
              </div>

              {(result.make || result.model) && (
                <div className="text-lg">
                  {result.make} {result.model}
                </div>
              )}

              {result.color && (
                <div className="text-sm text-gray-600">
                  Color: {result.color}
                </div>
              )}

              {result.vin && (
                <div className="text-sm text-gray-600">
                  VIN: {result.vin}
                </div>
              )}

              {result.mileage && (
                <div className="text-sm text-gray-600">
                  Mileage: {result.mileage.toLocaleString()} miles
                </div>
              )}

              {result.customer && (
                <div className="pt-3 border-t border-gray-200">
                  <div className="text-sm font-medium text-gray-500 mb-1">Owner</div>
                  <div className="font-medium">
                    {result.customer.firstName} {result.customer.lastName}
                  </div>
                  {result.customer.email && (
                    <div className="text-sm text-gray-600">{result.customer.email}</div>
                  )}
                  {result.customer.mobile && (
                    <div className="text-sm text-gray-600">{result.customer.mobile}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
