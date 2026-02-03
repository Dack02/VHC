import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface RepairItemActionsMenuProps {
  onApplyServicePackage: () => void
}

export function RepairItemActionsMenu({ onApplyServicePackage }: RepairItemActionsMenuProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setShowDropdown(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (buttonRef.current && !showDropdown) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.right - 200
      })
    }

    setShowDropdown(!showDropdown)
  }

  const handleAction = (action: () => void) => {
    setShowDropdown(false)
    action()
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        title="Actions"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[200px]"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          <button
            onClick={() => handleAction(onApplyServicePackage)}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Apply Service Package
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
