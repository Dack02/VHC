import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck, CheckResult, TemplateSection, TemplateItem } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'
import { TextArea } from '../components/Input'
import { RAGIndicator } from '../components/RAGSelector'
import { SignaturePad } from '../components/SignaturePad'
import { useThresholds } from '../context/ThresholdsContext'

// Type for reasons attached to a check result
interface SelectedReason {
  id: string
  reasonText: string
  customerDescription?: string | null
  followUpDays?: number | null
  followUpText?: string | null
}

export function Summary() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()
  const { thresholds } = useThresholds()

  const [job, setJob] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [results, setResults] = useState<CheckResult[]>([])
  const [reasonsByResult, setReasonsByResult] = useState<Record<string, SelectedReason[]>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [technicianSignature, setTechnicianSignature] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    if (!session || !id) return

    try {
      // Fetch health check
      const { healthCheck } = await api<{ healthCheck: HealthCheck }>(
        `/api/v1/health-checks/${id}`,
        { token: session.access_token }
      )
      setJob(healthCheck)
      setNotes(healthCheck.technician_notes || '')

      // Fetch template
      if (healthCheck.template_id) {
        const template = await api<{ sections?: TemplateSection[] }>(
          `/api/v1/templates/${healthCheck.template_id}`,
          { token: session.access_token }
        )
        setSections(template.sections || [])
      }

      // Fetch results
      const { results: fetchedResults } = await api<{ results: CheckResult[] }>(
        `/api/v1/health-checks/${id}/results`,
        { token: session.access_token }
      )
      setResults(fetchedResults)

      // Fetch reasons for each result that has a status (red/amber/green)
      const reasonsMap: Record<string, SelectedReason[]> = {}
      const resultsWithId = fetchedResults.filter((r) => r.id)

      // Fetch reasons in parallel for all results
      await Promise.all(
        resultsWithId.map(async (result) => {
          try {
            const { selectedReasons } = await api<{ selectedReasons: SelectedReason[] }>(
              `/api/v1/check-results/${result.id}/reasons`,
              { token: session.access_token }
            )
            if (selectedReasons && selectedReasons.length > 0) {
              reasonsMap[result.id] = selectedReasons
            }
          } catch {
            // Silently ignore errors for individual reason fetches
          }
        })
      )

      setReasonsByResult(reasonsMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summary')
    } finally {
      setLoading(false)
    }
  }

  // Helper to get status (handles both API camelCase and offline snake_case)
  const getStatus = (r: CheckResult) => r.status || r.rag_status
  const getItemId = (r: CheckResult) => r.templateItemId || r.template_item_id

  // Count RAG statuses
  const greenCount = results.filter((r) => getStatus(r) === 'green').length
  const amberCount = results.filter((r) => getStatus(r) === 'amber').length
  const redCount = results.filter((r) => getStatus(r) === 'red').length
  const unchecked = results.filter((r) => !getStatus(r)).length

  // Get items with issues
  const redItems = getItemsWithStatus('red')
  const amberItems = getItemsWithStatus('amber')

  function getItemsWithStatus(status: 'red' | 'amber') {
    const statusResults = results.filter((r) => getStatus(r) === status)
    return statusResults.map((r) => {
      // Find the item name
      const itemId = getItemId(r)
      for (const section of sections) {
        const item = section.items?.find((i) => i.id === itemId)
        if (item) {
          return {
            result: r,
            item,
            section: section.name
          }
        }
      }
      return { result: r, item: null, section: '' }
    }).filter((x) => x.item)
  }

  // Helper to render brake measurement summary
  const renderBrakeMeasurement = (result: CheckResult, item: TemplateItem | null) => {
    if (item?.itemType !== 'brake_measurement' || !result.value) return null

    const data = result.value as {
      brake_type?: string
      nearside?: { pad: number | null; disc: number | null; disc_min: number | null }
      offside?: { pad: number | null; disc: number | null; disc_min: number | null }
    }

    if (!data.nearside && !data.offside) return null

    const minPad = thresholds.brakePadRedBelowMm
    const warnPad = thresholds.brakePadAmberBelowMm

    const getPadColor = (val: number | null) => {
      if (val === null) return 'text-gray-400'
      if (val < minPad) return 'text-rag-red font-bold'
      if (val < warnPad) return 'text-rag-amber'
      return 'text-rag-green'
    }

    const getDiscStatus = (actual: number | null, min: number | null) => {
      if (actual === null || min === null) return null
      return actual < min ? 'below' : 'ok'
    }

    const ns = data.nearside
    const os = data.offside

    return (
      <div className="mt-2 p-2 bg-white rounded border border-gray-200 text-xs">
        <div className="grid grid-cols-2 gap-2">
          {/* Nearside */}
          {ns && (
            <div>
              <div className="font-medium text-gray-600 mb-1">N/S</div>
              {ns.pad !== null && (
                <div className={getPadColor(ns.pad)}>
                  Pad: {ns.pad}mm
                </div>
              )}
              {data.brake_type === 'disc' && ns.disc !== null && (
                <div className={getDiscStatus(ns.disc, ns.disc_min) === 'below' ? 'text-rag-red font-bold' : 'text-gray-600'}>
                  Disc: {ns.disc}mm
                  {ns.disc_min !== null && ` (min: ${ns.disc_min}mm)`}
                </div>
              )}
            </div>
          )}
          {/* Offside */}
          {os && (
            <div>
              <div className="font-medium text-gray-600 mb-1">O/S</div>
              {os.pad !== null && (
                <div className={getPadColor(os.pad)}>
                  Pad: {os.pad}mm
                </div>
              )}
              {data.brake_type === 'disc' && os.disc !== null && (
                <div className={getDiscStatus(os.disc, os.disc_min) === 'below' ? 'text-rag-red font-bold' : 'text-gray-600'}>
                  Disc: {os.disc}mm
                  {os.disc_min !== null && ` (min: ${os.disc_min}mm)`}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleComplete = async () => {
    if (!session || !id) return

    // Validate signature is provided
    if (!technicianSignature) {
      setError('Please provide your signature to complete the inspection')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      // Save technician notes and signature
      await api(`/api/v1/health-checks/${id}`, {
        method: 'PATCH',
        token: session.access_token,
        body: JSON.stringify({
          technician_notes: notes,
          technician_signature: technicianSignature
        })
      })

      // Clock out
      await api(`/api/v1/health-checks/${id}/clock-out`, {
        method: 'POST',
        token: session.access_token
      })

      // Navigate back to job list
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete inspection')
      setSubmitting(false)
    }
  }

  const handleBack = () => {
    navigate(`/job/${id}/inspection`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white px-4 py-3 safe-area-inset-top">
        <div className="flex items-center">
          <button onClick={handleBack} className="mr-3 p-2 -ml-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold">Inspection Summary</h1>
            <p className="text-sm text-blue-200">
              {job?.vhc_reference && <span className="mr-2">{job.vhc_reference}</span>}
              {job?.vehicle?.registration}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 space-y-4 overflow-auto">
        {/* RAG Summary */}
        <Card>
          <CardHeader title="Results Summary" />
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              <SummaryBox count={greenCount} label="Passed" color="green" />
              <SummaryBox count={amberCount} label="Advisory" color="amber" />
              <SummaryBox count={redCount} label="Urgent" color="red" />
              <SummaryBox count={unchecked} label="N/A" color="gray" />
            </div>
          </CardContent>
        </Card>

        {/* Red items */}
        {redItems.length > 0 && (
          <Card>
            <CardHeader
              title="Urgent Items"
              subtitle={`${redItems.length} item${redItems.length > 1 ? 's' : ''} require attention`}
            />
            <CardContent>
              <div className="space-y-2">
                {redItems.map(({ item, section, result }) => {
                  const reasons = reasonsByResult[result.id] || []
                  return (
                    <div
                      key={result.id}
                      className="p-2 bg-rag-red-bg"
                    >
                      <div className="flex items-start gap-3">
                        <RAGIndicator status="red" />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item?.name}</p>
                          <p className="text-xs text-gray-500">{section}</p>
                          {/* Display selected reasons */}
                          {reasons.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {reasons.map((reason) => (
                                <div key={reason.id} className="text-sm">
                                  <span className="font-medium text-rag-red">• {reason.reasonText}</span>
                                  {reason.customerDescription && (
                                    <p className="text-gray-600 ml-3 text-xs">{reason.customerDescription}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {result.notes && (
                            <p className="text-sm text-gray-600 mt-1">{result.notes}</p>
                          )}
                        </div>
                      </div>
                      {renderBrakeMeasurement(result, item)}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Amber items */}
        {amberItems.length > 0 && (
          <Card>
            <CardHeader
              title="Advisory Items"
              subtitle={`${amberItems.length} item${amberItems.length > 1 ? 's' : ''} to monitor`}
            />
            <CardContent>
              <div className="space-y-2">
                {amberItems.map(({ item, section, result }) => {
                  const reasons = reasonsByResult[result.id] || []
                  return (
                    <div
                      key={result.id}
                      className="p-2 bg-rag-amber-bg"
                    >
                      <div className="flex items-start gap-3">
                        <RAGIndicator status="amber" />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{item?.name}</p>
                          <p className="text-xs text-gray-500">{section}</p>
                          {/* Display selected reasons */}
                          {reasons.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {reasons.map((reason) => (
                                <div key={reason.id} className="text-sm">
                                  <span className="font-medium text-rag-amber">• {reason.reasonText}</span>
                                  {reason.customerDescription && (
                                    <p className="text-gray-600 ml-3 text-xs">{reason.customerDescription}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {result.notes && (
                            <p className="text-sm text-gray-600 mt-1">{result.notes}</p>
                          )}
                        </div>
                      </div>
                      {renderBrakeMeasurement(result, item)}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Technician notes */}
        <Card>
          <CardHeader
            title="Technician Notes"
            subtitle="Add any additional notes for the service advisor"
          />
          <CardContent>
            <TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Technician signature */}
        <Card>
          <CardHeader
            title="Sign Off"
            subtitle="Confirm your inspection is complete"
          />
          <CardContent>
            <SignaturePad
              onSignatureChange={setTechnicianSignature}
              label="Technician Signature"
              required
            />
          </CardContent>
        </Card>

        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4">
            {error}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 p-4 safe-area-inset-bottom">
        <Button
          fullWidth
          size="lg"
          onClick={handleComplete}
          loading={submitting}
        >
          Complete Inspection
        </Button>
      </footer>
    </div>
  )
}

interface SummaryBoxProps {
  count: number
  label: string
  color: 'green' | 'amber' | 'red' | 'gray'
}

function SummaryBox({ count, label, color }: SummaryBoxProps) {
  const colors = {
    green: 'bg-rag-green-bg text-rag-green',
    amber: 'bg-rag-amber-bg text-rag-amber',
    red: 'bg-rag-red-bg text-rag-red',
    gray: 'bg-gray-100 text-gray-500'
  }

  return (
    <div className={`p-3 text-center ${colors[color]}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs">{label}</p>
    </div>
  )
}
