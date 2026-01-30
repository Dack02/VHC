import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import CustomerModal from './components/CustomerModal'
import VehicleLookupModal from './components/VehicleLookupModal'

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

export default function CustomerList() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [showVehicleLookup, setShowVehicleLookup] = useState(false)

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async (searchTerm?: string) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      const term = searchTerm !== undefined ? searchTerm : search
      if (term) params.set('search', term)

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

  const handleClearSearch = () => {
    setSearch('')
    fetchCustomers('')
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
          <div className="flex-1 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, or registration..."
              className="w-full px-4 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
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
              <th className="text-right px-4 py-3 text-sm font-semibold text-gray-600"></th>
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
                <td colSpan={4} className="px-4 py-12 text-center">
                  <div className="text-gray-400 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 font-medium mb-1">
                    {search ? 'No customers match your search' : 'No customers yet'}
                  </p>
                  <p className="text-sm text-gray-400 mb-3">
                    {search ? 'Try adjusting your search terms' : 'Add your first customer to get started'}
                  </p>
                  {!search && (
                    <button
                      onClick={() => setShowModal(true)}
                      className="text-sm text-primary hover:text-primary-dark font-medium"
                    >
                      Add Customer
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              customers.map((customer) => (
                <tr
                  key={customer.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/customers/${customer.id}`)}
                >
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
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/customers/${customer.id}`)
                      }}
                      className="text-sm text-primary hover:text-primary-dark"
                    >
                      View
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

      {/* Vehicle Lookup Modal */}
      {showVehicleLookup && (
        <VehicleLookupModal
          onClose={() => setShowVehicleLookup(false)}
        />
      )}
    </div>
  )
}
