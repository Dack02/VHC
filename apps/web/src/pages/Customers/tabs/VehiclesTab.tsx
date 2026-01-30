import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'
import type { CustomerDetail } from '../../../lib/api'
import VehicleCard from '../components/VehicleCard'
import AddVehicleModal from '../components/AddVehicleModal'
import { useState } from 'react'

interface VehiclesTabProps {
  customer: CustomerDetail
  vehicleHealthCheckCounts: Record<string, number>
  onVehicleAdded: () => void
}

export default function VehiclesTab({ customer, vehicleHealthCheckCounts, onVehicleAdded }: VehiclesTabProps) {
  const { session } = useAuth()
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [error, setError] = useState('')

  const handleAddVehicle = async (vehicleData: { registration: string; make?: string; model?: string; year?: number }) => {
    try {
      await api('/api/v1/vehicles', {
        method: 'POST',
        body: { customerId: customer.id, ...vehicleData },
        token: session?.accessToken
      })
      setShowAddVehicle(false)
      onVehicleAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add vehicle')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Vehicles ({customer.vehicles.length})
        </h3>
        <button
          onClick={() => setShowAddVehicle(true)}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold hover:bg-primary-dark"
        >
          Add Vehicle
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {customer.vehicles.length === 0 ? (
        <div className="bg-white border border-gray-200 p-8 text-center">
          <div className="text-gray-400 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h8m-8 4h4m-6 4h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm0 0v2a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
          </div>
          <p className="text-gray-500 mb-3">No vehicles registered</p>
          <button
            onClick={() => setShowAddVehicle(true)}
            className="text-sm text-primary hover:text-primary-dark font-medium"
          >
            Add a vehicle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customer.vehicles.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              healthCheckCount={vehicleHealthCheckCounts[vehicle.id]}
            />
          ))}
        </div>
      )}

      {showAddVehicle && (
        <AddVehicleModal
          onClose={() => setShowAddVehicle(false)}
          onSave={handleAddVehicle}
        />
      )}
    </div>
  )
}
