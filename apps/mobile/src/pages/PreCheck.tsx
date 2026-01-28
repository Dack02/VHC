import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'
import { Input } from '../components/Input'

export function PreCheck() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [job, setJob] = useState<HealthCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mileage, setMileage] = useState('')
  const [starting, setStarting] = useState(false)
  const [mriRequired, setMriRequired] = useState(false)
  const [mriComplete, setMriComplete] = useState(true)

  useEffect(() => {
    fetchJob()
  }, [id])

  const fetchJob = async () => {
    if (!session || !id) return

    try {
      const data = await api<{ healthCheck: HealthCheck }>(
        `/api/v1/health-checks/${id}`,
        { token: session.access_token }
      )
      setJob(data.healthCheck)

      // Check MRI status to determine if technician can start
      let isMriRequired = false
      let isMriComplete = true
      try {
        const mriData = await api<{ isMriComplete: boolean; progress: { total: number } }>(
          `/api/v1/health-checks/${id}/mri-results`,
          { token: session.access_token }
        )
        const hasMriItems = (mriData.progress?.total || 0) > 0
        if (hasMriItems) {
          isMriRequired = true
          isMriComplete = mriData.isMriComplete
          setMriRequired(true)
          setMriComplete(mriData.isMriComplete)
        }
      } catch {
        // MRI endpoint failed - assume not required
      }

      // Check if this is a paused job that already has mileage - skip straight to inspection
      // Only auto-resume if MRI is complete (or not required)
      const existingMileage = data.healthCheck.mileage_in
      if (data.healthCheck.status === 'paused' && existingMileage) {
        if (!isMriRequired || isMriComplete) {
          // Resume directly - clock in and go to inspection
          await api(`/api/v1/health-checks/${id}/clock-in`, {
            method: 'POST',
            token: session.access_token
          })
          navigate(`/job/${id}/inspection`, { replace: true })
          return
        }
        // MRI required but not complete - show page with warning
      }

      // Pre-fill mileage: first from health check, then from vehicle's last known
      if (existingMileage) {
        setMileage(String(existingMileage))
      } else if (data.healthCheck.vehicle?.mileage) {
        setMileage(String(data.healthCheck.vehicle.mileage))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job')
    } finally {
      setLoading(false)
    }
  }

  const handleStartInspection = async () => {
    if (!session || !id) return

    const mileageNum = mileage ? parseInt(mileage, 10) : null

    if (mileageNum && mileageNum < 0) {
      setError('Mileage must be a positive number')
      return
    }

    setStarting(true)
    setError(null)

    try {
      // Update mileage in health check
      if (mileageNum) {
        await api(`/api/v1/health-checks/${id}`, {
          method: 'PATCH',
          token: session.access_token,
          body: JSON.stringify({ mileage_in: mileageNum })
        })
      }

      // Clock in (this changes status to in_progress)
      await api(`/api/v1/health-checks/${id}/clock-in`, {
        method: 'POST',
        token: session.access_token
      })

      // Navigate to inspection
      navigate(`/job/${id}/inspection`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start inspection')
      setStarting(false)
    }
  }

  const handleBack = () => {
    navigate('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <header className="bg-primary text-white px-4 py-3">
          <h1 className="text-lg font-bold">Job Not Found</h1>
        </header>
        <main className="flex-1 p-4">
          <Card padding="lg">
            <p className="text-gray-600">{error || 'Unable to load this job'}</p>
            <Button onClick={handleBack} className="mt-4" fullWidth>
              Back to Jobs
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  const vehicle = job.vehicle
  const customer = job.customer

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top">
        <div className="flex items-center">
          <button
            onClick={handleBack}
            className="mr-3 p-2 -ml-2 hover:bg-blue-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">Pre-Check</h1>
            <p className="text-sm text-blue-200">
              {job.vhc_reference && <span className="mr-2">{job.vhc_reference}</span>}
              {vehicle?.registration}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 space-y-4">
        {/* Vehicle details */}
        <Card>
          <CardHeader title="Vehicle Details" />
          <CardContent>
            <div className="space-y-2">
              <DetailRow label="Registration" value={vehicle?.registration || '-'} highlight />
              <DetailRow label="Make" value={vehicle?.make || '-'} />
              <DetailRow label="Model" value={vehicle?.model || '-'} />
              <DetailRow label="Year" value={vehicle?.year?.toString() || '-'} />
              <DetailRow label="Colour" value={vehicle?.color || '-'} />
              <DetailRow label="Fuel" value={vehicle?.fuel_type || '-'} />
              {vehicle?.vin && <DetailRow label="VIN" value={vehicle.vin} />}
            </div>
          </CardContent>
        </Card>

        {/* Customer details */}
        {customer && (
          <Card>
            <CardHeader title="Customer" />
            <CardContent>
              <p className="font-medium text-gray-900">
                {customer.first_name} {customer.last_name}
              </p>
              {customer.mobile && (
                <p className="text-sm text-gray-600">{customer.mobile}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* MRI Not Complete Warning */}
        {mriRequired && !mriComplete && (
          <Card className="border-l-4 border-rag-amber bg-amber-50">
            <CardContent>
              <div className="flex items-start gap-3">
                <span className="text-2xl text-rag-amber">&#9888;</span>
                <div>
                  <p className="font-medium text-gray-900">MRI Scan Required</p>
                  <p className="text-sm text-gray-600">
                    The service advisor must complete the MRI scan before you can start this inspection.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mileage input */}
        <Card>
          <CardHeader
            title="Mileage In"
            subtitle="Record the current mileage"
          />
          <CardContent>
            <Input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="Enter mileage"
              className="text-2xl font-bold text-center"
            />
          </CardContent>
        </Card>

        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4">
            {error}
          </div>
        )}
      </main>

      {/* Footer with start button */}
      <footer className="bg-white border-t border-gray-200 p-4 safe-area-inset-bottom">
        <Button
          fullWidth
          size="lg"
          onClick={handleStartInspection}
          loading={starting}
          disabled={mriRequired && !mriComplete}
        >
          {job.status === 'paused' ? 'Resume Inspection' : 'Start Inspection'}
        </Button>
        {mriRequired && !mriComplete && (
          <p className="text-center text-sm text-gray-500 mt-2">
            Waiting for MRI scan completion
          </p>
        )}
      </footer>
    </div>
  )
}

interface DetailRowProps {
  label: string
  value: string
  highlight?: boolean
}

function DetailRow({ label, value, highlight }: DetailRowProps) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? 'font-bold text-lg' : 'font-medium'}>
        {value}
      </span>
    </div>
  )
}
