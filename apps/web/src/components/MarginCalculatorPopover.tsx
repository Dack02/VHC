/**
 * MarginCalculatorPopover Component
 * A small popover for calculating sell price from margin % or vice versa
 *
 * Features:
 * - Bidirectional calculation: margin → sell or sell → margin
 * - +5% / -5% stepper buttons for quick adjustments
 * - Live profit calculation
 * - Click outside or Escape to dismiss
 */

import { useState, useEffect, useRef } from 'react'

interface MarginCalculatorPopoverProps {
  costPrice: number
  currentSellPrice: number
  defaultMargin: number
  anchorEl: HTMLElement | null
  onApply: (sellPrice: number) => void
  onClose: () => void
}

// Calculate sell price from cost and margin
const calculateSellPrice = (cost: number, margin: number): number => {
  if (margin >= 100) return cost * 100 // Cap at reasonable max
  if (margin <= 0) return cost
  return cost / (1 - margin / 100)
}

// Calculate margin from cost and sell price
const calculateMargin = (cost: number, sell: number): number => {
  if (sell <= 0 || sell <= cost) return 0
  return ((sell - cost) / sell) * 100
}

export function MarginCalculatorPopover({
  costPrice,
  currentSellPrice,
  defaultMargin,
  anchorEl,
  onApply,
  onClose
}: MarginCalculatorPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Initialize with current values or defaults
  const initialMargin = currentSellPrice > 0 && costPrice > 0
    ? calculateMargin(costPrice, currentSellPrice)
    : defaultMargin
  const initialSell = currentSellPrice > 0
    ? currentSellPrice
    : calculateSellPrice(costPrice, defaultMargin)

  const [margin, setMargin] = useState(initialMargin.toFixed(1))
  const [sellPrice, setSellPrice] = useState(initialSell.toFixed(2))

  // Position the popover
  const [position, setPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect()
      const popoverWidth = 220
      const popoverHeight = 260

      // Position below the anchor, centered
      let top = rect.bottom + 8
      let left = rect.left + (rect.width / 2) - (popoverWidth / 2)

      // Ensure it stays within viewport
      if (left < 8) left = 8
      if (left + popoverWidth > window.innerWidth - 8) {
        left = window.innerWidth - popoverWidth - 8
      }
      if (top + popoverHeight > window.innerHeight - 8) {
        // Position above instead
        top = rect.top - popoverHeight - 8
      }

      setPosition({ top, left })
    }
  }, [anchorEl])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Delay adding listener to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Handle margin change → recalculate sell
  const handleMarginChange = (value: string) => {
    setMargin(value)
    const marginNum = parseFloat(value)
    if (!isNaN(marginNum) && marginNum >= 0 && marginNum < 100) {
      const newSell = calculateSellPrice(costPrice, marginNum)
      setSellPrice(newSell.toFixed(2))
    }
  }

  // Handle sell change → recalculate margin
  const handleSellChange = (value: string) => {
    setSellPrice(value)
    const sellNum = parseFloat(value)
    if (!isNaN(sellNum) && sellNum > 0) {
      const newMargin = calculateMargin(costPrice, sellNum)
      setMargin(newMargin.toFixed(1))
    }
  }

  // Stepper buttons
  const adjustMargin = (delta: number) => {
    const currentMargin = parseFloat(margin) || 0
    const newMargin = Math.max(0, Math.min(99.9, currentMargin + delta))
    handleMarginChange(newMargin.toFixed(1))
  }

  // Calculate profit for display
  const sellNum = parseFloat(sellPrice) || 0
  const profit = sellNum - costPrice

  const handleApply = () => {
    const finalSell = parseFloat(sellPrice)
    if (!isNaN(finalSell) && finalSell >= costPrice) {
      onApply(finalSell)
    }
  }

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 bg-white border border-gray-300 shadow-lg rounded-lg"
      style={{
        top: position.top,
        left: position.left,
        width: 220
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
        <h4 className="text-sm font-medium text-gray-900">Margin Calculator</h4>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        {/* Cost (readonly) */}
        <div className="flex justify-between items-center">
          <span className="text-xs text-gray-500">Cost:</span>
          <span className="text-sm font-medium text-gray-700">£{costPrice.toFixed(2)}</span>
        </div>

        {/* Margin input with steppers */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Margin %</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => adjustMargin(-5)}
              className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg"
            >
              -5
            </button>
            <input
              type="number"
              value={margin}
              onChange={(e) => handleMarginChange(e.target.value)}
              step="0.1"
              min="0"
              max="99.9"
              className="flex-1 w-full px-2 py-1 text-sm text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-sm text-gray-500">%</span>
            <button
              type="button"
              onClick={() => adjustMargin(5)}
              className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg"
            >
              +5
            </button>
          </div>
        </div>

        {/* Sell price input */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sell Price</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">£</span>
            <input
              type="number"
              value={sellPrice}
              onChange={(e) => handleSellChange(e.target.value)}
              step="0.01"
              min="0"
              className="flex-1 w-full px-2 py-1 text-sm text-right border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Profit display */}
        <div className="flex justify-between items-center pt-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">Profit:</span>
          <span className={`text-sm font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            £{profit.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1 text-xs font-medium text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={sellNum < costPrice}
          className="px-3 py-1 text-xs font-medium text-white bg-primary hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
