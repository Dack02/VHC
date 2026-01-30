import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import type { CustomerDetail as CustomerDetailType, CustomerStats, CustomerHealthCheckSummary } from '../../lib/api'
import OverviewTab from './tabs/OverviewTab'
import VehiclesTab from './tabs/VehiclesTab'
import HealthCheckHistoryTab from './tabs/HealthCheckHistoryTab'
import NotesTab from './tabs/NotesTab'

type Tab = 'overview' | 'vehicles' | 'health-checks' | 'notes'

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()

  const [customer, setCustomer] = useState<CustomerDetailType | null>(null)
  const [stats, setStats] = useState<CustomerStats | null>(null)
  const [recentHealthChecks, setRecentHealthChecks] = useState<CustomerHealthCheckSummary[]>([])
  const [vehicleHcCounts, setVehicleHcCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  useEffect(() => {
    if (id) {
      fetchCustomer()
      fetchStats()
      fetchRecentHealthChecks()
    }
  }, [id])

  const fetchCustomer = async () => {
    try {
      setLoading(true)
      const data = await api<CustomerDetailType>(`/api/v1/customers/${id}`, {
        token: session?.accessToken
      })
      setCustomer(data)

      // Compute vehicle HC counts from health checks
      fetchVehicleHcCounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer')
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const data = await api<CustomerStats>(`/api/v1/customers/${id}/stats`, {
        token: session?.accessToken
      })
      setStats(data)
    } catch {
      // Stats are non-critical
    }
  }

  const fetchRecentHealthChecks = async () => {
    try {
      const data = await api<{ healthChecks: CustomerHealthCheckSummary[] }>(
        `/api/v1/customers/${id}/health-checks?limit=5`,
        { token: session?.accessToken }
      )
      setRecentHealthChecks(data.healthChecks || [])
    } catch {
      // Non-critical
    }
  }

  const fetchVehicleHcCounts = async () => {
    // Fetch all health checks to count per vehicle
    try {
      const data = await api<{ healthChecks: CustomerHealthCheckSummary[] }>(
        `/api/v1/customers/${id}/health-checks?limit=1000`,
        { token: session?.accessToken }
      )
      const counts: Record<string, number> = {}
      data.healthChecks?.forEach((hc) => {
        if (hc.vehicle?.id) {
          counts[hc.vehicle.id] = (counts[hc.vehicle.id] || 0) + 1
        }
      })
      setVehicleHcCounts(counts)
    } catch {
      // Non-critical
    }
  }

  const handleCustomerUpdate = (updated: CustomerDetailType) => {
    setCustomer(updated)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading customer...</div>
      </div>
    )
  }

  if (error || !customer) {
    return (
      <div className="py-12">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 max-w-lg mx-auto">
          {error || 'Customer not found'}
        </div>
        <div className="text-center mt-4">
          <Link to="/customers" className="text-primary hover:text-primary-dark text-sm">
            Back to Customers
          </Link>
        </div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'vehicles', label: `Vehicles (${customer.vehicles.length})` },
    { key: 'health-checks', label: 'Health Checks' },
    { key: 'notes', label: 'Notes' }
  ]

  return (
    <div className="-m-6">
      {/* Action Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Link
          to="/customers"
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Customers
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('overview')}
            className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 hover:bg-gray-50"
          >
            Edit Customer
          </button>
          <Link
            to="/health-checks/new"
            className="px-3 py-1.5 text-sm bg-primary text-white font-semibold hover:bg-primary-dark"
          >
            Create Health Check
          </Link>
        </div>
      </div>

      {/* Customer Info Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Initials Avatar */}
          <div className="w-12 h-12 bg-primary text-white flex items-center justify-center text-lg font-bold flex-shrink-0 rounded-full">
            {customer.firstName.charAt(0)}{customer.lastName.charAt(0)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {customer.firstName} {customer.lastName}
              </h1>
              {customer.externalId && (
                <span className="text-sm text-gray-400">DMS: {customer.externalId}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 mt-1 text-sm text-gray-600">
              {customer.mobile && (
                <div className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {customer.mobile}
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {customer.email}
                </div>
              )}
              {customer.address && (
                <div className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="truncate max-w-[200px]">{customer.address}</span>
                </div>
              )}
              {/* Quick stats */}
              {stats && (
                <div className="flex items-center gap-3 ml-auto text-xs text-gray-500">
                  <span>{stats.totalHealthChecks} Health Check{stats.totalHealthChecks !== 1 ? 's' : ''}</span>
                  <span className="text-gray-300">|</span>
                  <span>{stats.vehicleCount} Vehicle{stats.vehicleCount !== 1 ? 's' : ''}</span>
                  <span className="text-gray-300">|</span>
                  <span>Last Visit: {formatDate(stats.lastVisit)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200 px-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="bg-gray-50 p-6 min-h-[400px]">
        {activeTab === 'overview' && (
          <OverviewTab
            customer={customer}
            stats={stats}
            recentHealthChecks={recentHealthChecks}
            onCustomerUpdate={handleCustomerUpdate}
          />
        )}
        {activeTab === 'vehicles' && (
          <VehiclesTab
            customer={customer}
            vehicleHealthCheckCounts={vehicleHcCounts}
            onVehicleAdded={() => {
              fetchCustomer()
              fetchStats()
            }}
          />
        )}
        {activeTab === 'health-checks' && (
          <HealthCheckHistoryTab customer={customer} />
        )}
        {activeTab === 'notes' && (
          <NotesTab
            customer={customer}
            onCustomerUpdate={handleCustomerUpdate}
          />
        )}
      </div>
    </div>
  )
}
