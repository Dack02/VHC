import { useState } from 'react'

interface AddVehicleModalProps {
  onClose: () => void
  onSave: (data: { registration: string; make?: string; model?: string; year?: number }) => void
}

export default function AddVehicleModal({ onClose, onSave }: AddVehicleModalProps) {
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
