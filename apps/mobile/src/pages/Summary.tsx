import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck, CheckResult, TemplateSection } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/Card'
import { Button } from '../components/Button'
import { TextArea } from '../components/Input'
import { RAGIndicator } from '../components/RAGSelector'

export function Summary() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [results, setResults] = useState<CheckResult[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')

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
      const { results } = await api<{ results: CheckResult[] }>(
        `/api/v1/health-checks/${id}/results`,
        { token: session.access_token }
      )
      setResults(results)
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

  const handleComplete = async () => {
    if (!session || !id) return

    setSubmitting(true)
    setError(null)

    try {
      // Save technician notes
      if (notes !== job?.technician_notes) {
        await api(`/api/v1/health-checks/${id}`, {
          method: 'PATCH',
          token: session.access_token,
          body: JSON.stringify({ technician_notes: notes })
        })
      }

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
            <p className="text-sm text-blue-200">{job?.vehicle?.registration}</p>
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
                {redItems.map(({ item, section, result }) => (
                  <div
                    key={result.id}
                    className="flex items-start gap-3 p-2 bg-rag-red-bg"
                  >
                    <RAGIndicator status="red" />
                    <div>
                      <p className="font-medium text-gray-900">{item?.name}</p>
                      <p className="text-xs text-gray-500">{section}</p>
                      {result.notes && (
                        <p className="text-sm text-gray-600 mt-1">{result.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
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
                {amberItems.map(({ item, section, result }) => (
                  <div
                    key={result.id}
                    className="flex items-start gap-3 p-2 bg-rag-amber-bg"
                  >
                    <RAGIndicator status="amber" />
                    <div>
                      <p className="font-medium text-gray-900">{item?.name}</p>
                      <p className="text-xs text-gray-500">{section}</p>
                      {result.notes && (
                        <p className="text-sm text-gray-600 mt-1">{result.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
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
