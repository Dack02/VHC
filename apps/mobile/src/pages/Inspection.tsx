import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api, HealthCheck, TemplateSection, TemplateItem, CheckResult } from '../lib/api'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { RAGSelector, RAGIndicator } from '../components/RAGSelector'
import { TextArea } from '../components/Input'
import { PhotoCapture } from '../components/PhotoCapture'
import { TyreDepthInput } from '../components/TyreDepthInput'
import { BrakeMeasurementInput } from '../components/BrakeMeasurementInput'
import { Badge } from '../components/Badge'
import { db } from '../lib/db'

export function Inspection() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const navigate = useNavigate()

  const [job, setJob] = useState<HealthCheck | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [currentSectionIndex, setCurrentSectionIndex] = useState(0)
  const [results, setResults] = useState<Map<string, Partial<CheckResult>>>(new Map())
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [photoItemId, setPhotoItemId] = useState<string | null>(null)
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; caption?: string } | null>(null)

  useEffect(() => {
    fetchJob()
  }, [id])

  const fetchJob = async () => {
    if (!session || !id) return

    try {
      const { healthCheck } = await api<{ healthCheck: HealthCheck }>(
        `/api/v1/health-checks/${id}`,
        { token: session.access_token }
      )
      setJob(healthCheck)

      if (healthCheck.template_id) {
        const template = await api<{ sections?: TemplateSection[] }>(
          `/api/v1/templates/${healthCheck.template_id}`,
          { token: session.access_token }
        )
        setSections(template.sections || [])
      }

      const { results: apiResults } = await api<{ results: CheckResult[] }>(
        `/api/v1/health-checks/${id}/results`,
        { token: session.access_token }
      )

      const resultsMap = new Map<string, Partial<CheckResult>>()
      apiResults.forEach((r) => {
        // Handle both camelCase (API) and snake_case (offline storage) formats
        const itemId = r.templateItemId || r.template_item_id
        if (itemId) {
          resultsMap.set(itemId, {
            ...r,
            // Normalize to have both formats for compatibility
            templateItemId: itemId,
            template_item_id: itemId,
            rag_status: r.status || r.rag_status,
            status: r.status || r.rag_status
          })
        }
      })

      const offlineResults = await db.getResults(id)
      offlineResults.forEach((r) => {
        const itemId = r.templateItemId || r.template_item_id
        if (itemId) {
          const existing = resultsMap.get(itemId)
          if (!existing || (r as any).updated_at > (existing as any)?.updated_at) {
            resultsMap.set(itemId, {
              ...r,
              templateItemId: itemId,
              template_item_id: itemId,
              rag_status: r.status || r.rag_status,
              status: r.status || r.rag_status
            })
          }
        }
      })

      setResults(resultsMap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inspection')
    } finally {
      setLoading(false)
    }
  }

  const currentSection = sections[currentSectionIndex]

  // Calculate totals
  const totalItems = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0)
  const completedItems = [...results.values()].filter((r) => {
    const status = r.status || r.rag_status
    return status !== null && status !== undefined
  }).length

  const sectionCompletedCount = (section: TemplateSection) =>
    (section.items || []).filter((item) => {
      const r = results.get(item.id)
      return r?.status || r?.rag_status
    }).length

  // Save result
  const saveResult = async (itemId: string, data: Partial<CheckResult>) => {
    const existingResult = results.get(itemId)
    const newStatus = data.status || data.rag_status || existingResult?.status || existingResult?.rag_status

    const result = {
      ...existingResult,
      ...data,
      templateItemId: itemId,
      template_item_id: itemId,
      health_check_id: id!,
      status: newStatus,
      rag_status: newStatus,
      updated_at: new Date().toISOString()
    }

    setResults((prev) => {
      const newResults = new Map(prev)
      newResults.set(itemId, result)
      return newResults
    })

    await db.saveResult(id!, itemId, result)

    try {
      await api(`/api/v1/health-checks/${id}/results`, {
        method: 'POST',
        token: session?.access_token,
        body: JSON.stringify({
          templateItemId: itemId,
          status: result.rag_status,
          value: result.value,
          notes: result.notes
        })
      })
    } catch {
      await db.addToSyncQueue({
        type: 'result',
        health_check_id: id!,
        item_id: itemId,
        data: result
      })
    }
  }

  const handlePhotoCapture = async (photoData: string) => {
    if (!photoItemId || !session) return

    setPhotoItemId(null)

    try {
      const result = results.get(photoItemId)
      let resultId = result?.id

      if (!resultId) {
        const savedResult = await api<{ id: string }>(
          `/api/v1/health-checks/${id}/results`,
          {
            method: 'POST',
            token: session.access_token,
            body: JSON.stringify({
              templateItemId: photoItemId,
              status: result?.status || result?.rag_status || null
            })
          }
        )
        resultId = savedResult.id
      }

      const response = await fetch(photoData)
      const blob = await response.blob()
      const formData = new FormData()
      formData.append('file', blob, `photo_${Date.now()}.jpg`)

      await fetch(
        `${import.meta.env.VITE_API_URL}/api/v1/health-checks/${id}/results/${resultId}/media`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData
        }
      )

      fetchJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo')
    }
  }

  const handleComplete = () => {
    navigate(`/job/${id}/summary`)
  }

  const handlePause = async () => {
    if (!session || !id) return

    try {
      await api(`/api/v1/health-checks/${id}/status`, {
        method: 'POST',
        token: session.access_token,
        body: JSON.stringify({ status: 'paused' })
      })
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause inspection')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!job || sections.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <header className="bg-primary text-white px-4 py-3">
          <h1 className="text-lg font-bold">Error</h1>
        </header>
        <main className="flex-1 p-4">
          <Card padding="lg">
            <p className="text-gray-600">{error || 'Unable to load inspection'}</p>
            <Button onClick={() => navigate('/')} className="mt-4" fullWidth>
              Back to Jobs
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-primary text-white safe-area-inset-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{job.vehicle?.registration}</p>
            <p className="text-sm text-blue-200">
              {completedItems}/{totalItems} items completed
            </p>
          </div>
          <button onClick={handlePause} className="text-sm text-blue-200 underline">
            Pause
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-blue-800">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${(completedItems / totalItems) * 100}%` }}
          />
        </div>
      </header>

      {/* Section tabs */}
      <div className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="flex">
          {sections.map((section, idx) => {
            const completed = sectionCompletedCount(section)
            const total = section.items?.length || 0
            const getStatus = (itemId: string) => {
              const r = results.get(itemId)
              return r?.status || r?.rag_status
            }
            const hasRed = section.items?.some((i) => getStatus(i.id) === 'red')
            const hasAmber = section.items?.some((i) => getStatus(i.id) === 'amber')

            return (
              <button
                key={section.id}
                onClick={() => setCurrentSectionIndex(idx)}
                className={`
                  flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${idx === currentSectionIndex
                    ? 'border-primary text-primary bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  {completed === total && total > 0 ? (
                    <span className={`w-2 h-2 rounded-full ${hasRed ? 'bg-rag-red' : hasAmber ? 'bg-rag-amber' : 'bg-rag-green'}`} />
                  ) : (
                    <span className="text-xs text-gray-400">{completed}/{total}</span>
                  )}
                  <span className="whitespace-nowrap">{section.name}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Section items */}
      <main className="flex-1 p-4 space-y-3 overflow-auto pb-24">
        {error && (
          <div className="bg-rag-red-bg text-rag-red p-4 mb-4">{error}</div>
        )}

        {currentSection?.items?.map((item) => (
          <InspectionItem
            key={item.id}
            item={item}
            result={results.get(item.id)}
            expanded={expandedItem === item.id}
            onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
            onSave={(data) => saveResult(item.id, data)}
            onAddPhoto={() => setPhotoItemId(item.id)}
            onViewPhoto={(url, caption) => setViewingPhoto({ url, caption })}
          />
        ))}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-inset-bottom">
        <div className="flex gap-2 p-4">
          {currentSectionIndex > 0 && (
            <Button
              variant="secondary"
              onClick={() => setCurrentSectionIndex(currentSectionIndex - 1)}
              className="flex-1"
            >
              Previous Section
            </Button>
          )}

          {currentSectionIndex < sections.length - 1 ? (
            <Button
              onClick={() => setCurrentSectionIndex(currentSectionIndex + 1)}
              className="flex-1"
            >
              Next Section
            </Button>
          ) : (
            <Button onClick={handleComplete} className="flex-1">
              Review & Complete
            </Button>
          )}
        </div>
      </footer>

      {/* Photo capture modal */}
      {photoItemId && (
        <PhotoCapture
          onCapture={handlePhotoCapture}
          onClose={() => setPhotoItemId(null)}
        />
      )}

      {/* Photo viewer modal */}
      {viewingPhoto && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between p-4 safe-area-inset-top">
            <button
              onClick={() => setViewingPhoto(null)}
              className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {viewingPhoto.caption && (
              <span className="text-white text-sm">{viewingPhoto.caption}</span>
            )}
            <div className="w-10" /> {/* Spacer for balance */}
          </div>
          <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
            <img
              src={viewingPhoto.url}
              alt="Full size"
              className="max-w-full max-h-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Individual inspection item component
interface InspectionItemProps {
  item: TemplateItem
  result: Partial<CheckResult> | undefined
  expanded: boolean
  onToggle: () => void
  onSave: (data: Partial<CheckResult>) => void
  onAddPhoto: () => void
  onViewPhoto: (url: string, caption?: string) => void
}

function InspectionItem({ item, result, expanded, onToggle, onSave, onAddPhoto, onViewPhoto }: InspectionItemProps) {
  const handleRAGChange = (newStatus: 'green' | 'amber' | 'red' | null) => {
    if ('vibrate' in navigator) navigator.vibrate(50)
    onSave({ status: newStatus, rag_status: newStatus })
  }

  const handleNotesChange = (notes: string) => {
    onSave({ notes: notes || null })
  }

  const handleValueChange = (value: unknown) => {
    onSave({ value })
  }

  const ragStatus = result?.status || result?.rag_status

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Item header - always visible */}
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <RAGIndicator status={ragStatus || 'gray'} />
          <span className="font-medium truncate">{item.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {result?.media && result.media.length > 0 && (
            <Badge variant="gray" size="sm">{result.media.length} 📷</Badge>
          )}
          <svg
            className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Quick RAG buttons - always visible for RAG type */}
      {!expanded && item.item_type === 'rag' && (
        <div className="px-4 pb-4 flex gap-2">
          {(['green', 'amber', 'red'] as const).map((status) => (
            <button
              key={status}
              onClick={(e) => {
                e.stopPropagation()
                handleRAGChange(status)
              }}
              className={`
                flex-1 py-3 font-medium text-sm transition-colors
                ${ragStatus === status
                  ? status === 'green'
                    ? 'bg-rag-green text-white'
                    : status === 'amber'
                      ? 'bg-rag-amber text-white'
                      : 'bg-rag-red text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              {status === 'green' ? 'OK' : status === 'amber' ? 'Advise' : 'Urgent'}
            </button>
          ))}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
          {item.description && (
            <p className="text-sm text-gray-600">{item.description}</p>
          )}

          {/* Item type specific input */}
          {item.item_type === 'rag' && (
            <RAGSelector value={ragStatus || null} onChange={handleRAGChange} />
          )}

          {item.item_type === 'tyre_depth' && (
            <TyreDepthInput
              value={result?.value as any}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
              config={item.config}
            />
          )}

          {item.item_type === 'brake_measurement' && (
            <BrakeMeasurementInput
              value={result?.value as any}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
              config={item.config}
            />
          )}

          {item.item_type === 'fluid_level' && (
            <FluidLevelInput
              value={result?.value as string}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
              config={item.config as { levels?: string[] }}
            />
          )}

          {item.item_type === 'yes_no' && (
            <YesNoInput
              value={result?.value as boolean}
              onChange={handleValueChange}
              onRAGChange={handleRAGChange}
            />
          )}

          {/* Notes */}
          <TextArea
            placeholder="Add notes (optional)"
            value={result?.notes || ''}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={2}
          />

          {/* Photos */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Photos</span>
            <Button variant="secondary" size="sm" onClick={onAddPhoto}>
              + Add Photo
            </Button>
          </div>

          {result?.media && result.media.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1">
              {result.media.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onViewPhoto(m.url, m.caption || undefined)}
                  className="w-16 h-16 flex-shrink-0 rounded overflow-hidden border-2 border-gray-200 hover:border-primary focus:border-primary transition-colors"
                >
                  <img
                    src={m.thumbnail_url || m.thumbnailUrl || m.url}
                    alt="Capture"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// Fluid level input
interface FluidLevelInputProps {
  value: string | undefined
  onChange: (value: string) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
  config?: { levels?: string[] }
}

function FluidLevelInput({ value, onChange, onRAGChange, config }: FluidLevelInputProps) {
  const levels = config?.levels || ['OK', 'Low', 'Very Low', 'Overfilled']

  const getRAG = (level: string): 'green' | 'amber' | 'red' => {
    const lower = level.toLowerCase()
    if (lower === 'ok') return 'green'
    if (lower === 'very low' || lower === 'empty') return 'red'
    return 'amber'
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {levels.map((level) => {
        const rag = getRAG(level)
        const isSelected = value === level
        return (
          <button
            key={level}
            className={`
              p-3 border-2 font-medium text-sm transition-colors
              ${isSelected
                ? rag === 'green'
                  ? 'border-rag-green bg-rag-green-bg text-rag-green'
                  : rag === 'amber'
                    ? 'border-rag-amber bg-rag-amber-bg text-rag-amber'
                    : 'border-rag-red bg-rag-red-bg text-rag-red'
                : 'border-gray-200 hover:border-gray-300'
              }
            `}
            onClick={() => {
              onChange(level)
              onRAGChange(rag)
            }}
          >
            {level}
          </button>
        )
      })}
    </div>
  )
}

// Yes/No input
interface YesNoInputProps {
  value: boolean | undefined
  onChange: (value: boolean) => void
  onRAGChange: (status: 'green' | 'amber' | 'red' | null) => void
}

function YesNoInput({ value, onChange, onRAGChange }: YesNoInputProps) {
  const handleSelect = (val: boolean) => {
    onChange(val)
    onRAGChange(val ? 'green' : 'red')
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        className={`
          p-4 border-2 font-medium transition-colors
          ${value === true
            ? 'border-rag-green bg-rag-green-bg text-rag-green'
            : 'border-gray-200 hover:border-gray-300'
          }
        `}
        onClick={() => handleSelect(true)}
      >
        Yes
      </button>
      <button
        className={`
          p-4 border-2 font-medium transition-colors
          ${value === false
            ? 'border-rag-red bg-rag-red-bg text-rag-red'
            : 'border-gray-200 hover:border-gray-300'
          }
        `}
        onClick={() => handleSelect(false)}
      >
        No
      </button>
    </div>
  )
}
