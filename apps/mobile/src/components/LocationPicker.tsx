import { useState } from 'react'
import { VehicleLocation } from '../lib/api'

interface LocationPickerProps {
  locations: VehicleLocation[]
  templateItemName: string
  onSave: (selectedLocations: { id: string; name: string; shortName: string }[]) => void
  onClose: () => void
}

export function LocationPicker({ locations, templateItemName, onSave, onClose }: LocationPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleLocation = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === locations.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(locations.map(l => l.id)))
    }
  }

  const handleSave = () => {
    const selectedLocs = locations.filter(l => selected.has(l.id)).map(l => ({
      id: l.id,
      name: l.name,
      shortName: l.shortName
    }))
    onSave(selectedLocs)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Bottom sheet */}
      <div className="mt-auto relative bg-white rounded-t-2xl shadow-xl safe-area-inset-bottom flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate">Select Locations</h3>
            <p className="text-sm text-gray-500 truncate">{templateItemName}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-2 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Location grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Select All */}
          <button
            onClick={selectAll}
            className="w-full mb-3 py-2 text-sm font-medium text-primary border border-primary/30 bg-primary/5 active:bg-primary/10"
          >
            {selected.size === locations.length ? 'Deselect All' : 'Select All'}
          </button>

          <div className="grid grid-cols-2 gap-3">
            {locations.map(loc => {
              const isSelected = selected.has(loc.id)
              return (
                <button
                  key={loc.id}
                  onClick={() => toggleLocation(loc.id)}
                  className={`min-h-[56px] flex flex-col items-center justify-center gap-1 border-2 transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
                  }`}
                >
                  <span className="text-lg font-bold">{loc.shortName}</span>
                  <span className="text-xs">{loc.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 safe-area-inset-bottom">
          <button
            onClick={handleSave}
            disabled={selected.size === 0}
            className="w-full py-3 bg-primary text-white font-semibold disabled:opacity-40 active:bg-primary-dark"
          >
            {selected.size === 0
              ? 'Select at least one location'
              : `Save ${selected.size} location${selected.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
