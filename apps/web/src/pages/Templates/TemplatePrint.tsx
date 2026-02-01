import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'

interface TemplateItem {
  id: string
  name: string
  description?: string
  itemType: string
  config: Record<string, unknown>
  isRequired: boolean
  requiresLocation?: boolean
  sortOrder: number
}

interface TemplateSection {
  id: string
  name: string
  description?: string
  sortOrder: number
  items: TemplateItem[]
}

interface Template {
  id: string
  name: string
  description?: string
  isActive: boolean
  isDefault: boolean
  sections: TemplateSection[]
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  rag: 'RAG Status (Red/Amber/Green)',
  tyre_depth: 'Tyre Depth (mm)',
  tyre_details: 'Tyre Details',
  brake_measurement: 'Brake Pad (mm)',
  brake_fluid: 'Brake Fluid',
  fluid_level: 'Fluid Level',
  yes_no: 'Yes / No',
  measurement: 'Measurement',
  text: 'Free Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-Select',
}

function getItemTypeLabel(type: string): string {
  return ITEM_TYPE_LABELS[type] || type
}

function getConfigDetails(item: TemplateItem): string | null {
  const config = item.config
  if (!config || Object.keys(config).length === 0) return null

  const parts: string[] = []

  if (config.unit) {
    parts.push(`Unit: ${config.unit}`)
  }
  if (config.min !== undefined || config.max !== undefined) {
    const min = config.min !== undefined ? config.min : '—'
    const max = config.max !== undefined ? config.max : '—'
    parts.push(`Range: ${min} – ${max}`)
  }
  if (Array.isArray(config.options) && config.options.length > 0) {
    parts.push(`Options: ${config.options.join(', ')}`)
  }

  return parts.length > 0 ? parts.join(' | ') : null
}

export default function TemplatePrint() {
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [template, setTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        setLoading(true)
        const data = await api<Template>(`/api/v1/templates/${id}`, {
          token: session?.accessToken,
        })
        setTemplate(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load template')
      } finally {
        setLoading(false)
      }
    }
    fetchTemplate()
  }, [id, session?.accessToken])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading template...</div>
      </div>
    )
  }

  if (error || !template) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Template not found'}</p>
          <Link to="/templates" className="text-primary hover:underline">
            Back to Templates
          </Link>
        </div>
      </div>
    )
  }

  const totalItems = template.sections.reduce((sum, s) => sum + s.items.length, 0)

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-section { break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Action buttons - hidden when printing */}
        <div className="no-print flex items-center justify-between mb-8">
          <Link
            to={`/templates/${id}`}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Template
          </Link>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>

        {/* Template Header */}
        <div className="mb-8 border-b-2 border-gray-900 pb-4">
          <h1 className="text-3xl font-bold text-gray-900">{template.name}</h1>
          {template.description && (
            <p className="text-gray-600 mt-2">{template.description}</p>
          )}
          <p className="text-sm text-gray-400 mt-2">
            {template.sections.length} section{template.sections.length !== 1 ? 's' : ''} &middot; {totalItems} item{totalItems !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-8">
          {template.sections.map((section, sectionIndex) => (
            <div key={section.id} className="print-section">
              {/* Section Header */}
              <div className="flex items-baseline gap-3 mb-3 border-b border-gray-300 pb-2">
                <span className="text-sm font-bold text-gray-400">{sectionIndex + 1}</span>
                <h2 className="text-xl font-semibold text-gray-900">{section.name}</h2>
                <span className="text-sm text-gray-400">
                  ({section.items.length} item{section.items.length !== 1 ? 's' : ''})
                </span>
              </div>
              {section.description && (
                <p className="text-sm text-gray-500 mb-3">{section.description}</p>
              )}

              {/* Items Table */}
              {section.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-4 font-medium text-gray-500 w-8">#</th>
                      <th className="text-left py-2 pr-4 font-medium text-gray-500">Item</th>
                      <th className="text-left py-2 pr-4 font-medium text-gray-500 w-48">Type</th>
                      <th className="text-center py-2 font-medium text-gray-500 w-16">Req</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item, itemIndex) => {
                      const configDetails = getConfigDetails(item)
                      return (
                        <tr key={item.id} className="border-b border-gray-100">
                          <td className="py-2 pr-4 text-gray-400 align-top">{itemIndex + 1}</td>
                          <td className="py-2 pr-4 align-top">
                            <div className="font-medium text-gray-900">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
                            )}
                            {configDetails && (
                              <div className="text-xs text-gray-400 mt-0.5">{configDetails}</div>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-600 align-top">{getItemTypeLabel(item.itemType)}</td>
                          <td className="py-2 text-center align-top">
                            {item.isRequired && (
                              <span className="inline-block w-5 h-5 leading-5 text-center bg-gray-900 text-white text-xs font-bold rounded">
                                *
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400 italic">No items in this section</p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 pt-4 border-t border-gray-200 text-xs text-gray-400 text-center">
          Printed from VHC &middot; {new Date().toLocaleDateString()}
        </div>
      </div>
    </>
  )
}
