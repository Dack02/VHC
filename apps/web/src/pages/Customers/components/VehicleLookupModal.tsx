import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../lib/api'

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

interface VehicleLookupModalProps {
  onClose: () => void
}

export default function VehicleLookupModal({ onClose }: VehicleLookupModalProps) {
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
