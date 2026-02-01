import type { CustomerVehicle } from '../../../lib/api'

interface VehicleCardProps {
  vehicle: CustomerVehicle
  healthCheckCount?: number
}

export default function VehicleCard({ vehicle, healthCheckCount }: VehicleCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="bg-yellow-300 text-black px-3 py-1 font-bold text-lg tracking-wider">
          {vehicle.registration}
        </div>
        {healthCheckCount !== undefined && healthCheckCount > 0 && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 font-medium">
            {healthCheckCount} HC{healthCheckCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {(vehicle.make || vehicle.model) && (
          <div className="font-medium text-gray-900">
            {vehicle.make} {vehicle.model}
            {vehicle.year && <span className="text-gray-500 ml-1">({vehicle.year})</span>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
          {vehicle.color && (
            <div>
              <span className="text-gray-400">Color:</span> {vehicle.color}
            </div>
          )}
          {vehicle.fuelType && (
            <div>
              <span className="text-gray-400">Fuel:</span> {vehicle.fuelType}
            </div>
          )}
          {vehicle.vin && (
            <div className="col-span-2">
              <span className="text-gray-400">VIN:</span>{' '}
              <span className="font-mono text-xs">{vehicle.vin}</span>
            </div>
          )}
          {vehicle.engineSize && (
            <div>
              <span className="text-gray-400">Engine:</span> {vehicle.engineSize}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
