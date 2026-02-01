/**
 * CustomerPortal - Public health check viewing and authorization
 * Thin wrapper: fetches data, handles API actions, renders CustomerPortalContent
 */

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import CustomerPortalContent from './CustomerPortalContent'
import type { PortalData } from './types'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

export default function CustomerPortal() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  // Fetch portal data
  useEffect(() => {
    if (!token) return

    async function fetchData() {
      try {
        const response = await fetch(`${API_URL}/api/public/vhc/${token}`)
        const result = await response.json()

        if (!response.ok) {
          if (response.status === 410) {
            setExpired(true)
          }
          throw new Error(result.error || 'Failed to load health check')
        }

        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [token])

  // Handle approve new repair item
  const handleApproveItem = async (repairItemId: string, selectedOptionId: string | null) => {
    if (!token) return

    const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedOptionId })
    })

    if (!response.ok) {
      const result = await response.json()
      throw new Error(result.error || 'Failed to approve')
    }

    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        newRepairItems: (prev.newRepairItems || []).map(item =>
          item.id === repairItemId
            ? {
                ...item,
                customerApproved: true,
                customerApprovedAt: new Date().toISOString(),
                selectedOptionId
              }
            : item
        )
      }
    })
  }

  // Handle decline new repair item
  const handleDeclineItem = async (repairItemId: string) => {
    if (!token) return

    const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/${repairItemId}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    if (!response.ok) {
      throw new Error('Failed to decline')
    }

    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        newRepairItems: (prev.newRepairItems || []).map(item =>
          item.id === repairItemId
            ? {
                ...item,
                customerApproved: false,
                customerApprovedAt: new Date().toISOString(),
                selectedOptionId: null
              }
            : item
        )
      }
    })
  }

  // Handle approve all
  const handleApproveAll = async (selections: Array<{ repairItemId: string; selectedOptionId: string | null }>) => {
    if (!token) return

    const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/approve-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections })
    })

    if (!response.ok) {
      throw new Error('Failed to approve all')
    }

    const selectionMap = new Map(selections.map(s => [s.repairItemId, s.selectedOptionId]))
    setData(prev => {
      if (!prev) return prev
      const now = new Date().toISOString()
      return {
        ...prev,
        newRepairItems: (prev.newRepairItems || []).map(item =>
          item.customerApproved === null
            ? {
                ...item,
                customerApproved: true,
                customerApprovedAt: now,
                selectedOptionId: selectionMap.get(item.id) ?? item.options[0]?.id ?? null
              }
            : item
        )
      }
    })
  }

  // Handle decline all
  const handleDeclineAll = async () => {
    if (!token) return

    const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/decline-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    if (!response.ok) {
      throw new Error('Failed to decline all')
    }

    setData(prev => {
      if (!prev) return prev
      const now = new Date().toISOString()
      return {
        ...prev,
        newRepairItems: (prev.newRepairItems || []).map(item =>
          item.customerApproved === null
            ? {
                ...item,
                customerApproved: false,
                customerApprovedAt: now,
                selectedOptionId: null
              }
            : item
        )
      }
    })
  }

  // Handle signature
  const handleSign = async (signatureData: string) => {
    if (!token) return

    const response = await fetch(`${API_URL}/api/public/vhc/${token}/repair-items/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureData })
    })

    if (!response.ok) {
      throw new Error('Failed to save signature')
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading your health check...</p>
        </div>
      </div>
    )
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 max-w-md text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600 mb-4">
            This health check link has expired. Please contact the dealership for a new link.
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 max-w-md text-center shadow-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Not Found</h1>
          <p className="text-gray-600">{error || 'Health check not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <CustomerPortalContent
      data={data}
      previewMode={false}
      onApproveItem={handleApproveItem}
      onDeclineItem={handleDeclineItem}
      onApproveAll={handleApproveAll}
      onDeclineAll={handleDeclineAll}
      onSign={handleSign}
    />
  )
}
