import { TemplateSection, CheckResult } from '../../../lib/api'

interface ResultsTabProps {
  sections: TemplateSection[]
  results: CheckResult[]
}

export function ResultsTab({ sections, results }: ResultsTabProps) {
  // Map results by item ID
  const resultsByItemId = new Map(results.map(r => [r.template_item_id, r]))

  if (sections.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 text-center text-gray-500">
        No inspection data available
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {sections.map(section => {
        const sectionResults = section.items.map(item => ({
          item,
          result: resultsByItemId.get(item.id)
        }))

        // Calculate section summary
        const greenCount = sectionResults.filter(r => r.result?.rag_status === 'green').length
        const amberCount = sectionResults.filter(r => r.result?.rag_status === 'amber').length
        const redCount = sectionResults.filter(r => r.result?.rag_status === 'red').length

        return (
          <div key={section.id} className="bg-white border border-gray-200 rounded-xl shadow-sm">
            {/* Section header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{section.name}</h3>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                  {greenCount}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  {amberCount}
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  {redCount}
                </span>
              </div>
            </div>

            {/* Items */}
            <div className="divide-y divide-gray-100">
              {sectionResults.map(({ item, result }) => (
                <div key={item.id} className="px-6 py-3 flex items-start gap-4">
                  {/* RAG indicator */}
                  <div className="flex-shrink-0 pt-1">
                    {result?.rag_status ? (
                      <span className={`
                        inline-block w-6 h-6 rounded-full flex items-center justify-center
                        ${result.rag_status === 'green' ? 'bg-green-500' : ''}
                        ${result.rag_status === 'amber' ? 'bg-yellow-500' : ''}
                        ${result.rag_status === 'red' ? 'bg-red-500' : ''}
                      `}>
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {result.rag_status === 'green' && (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          )}
                          {result.rag_status === 'amber' && (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                          )}
                          {result.rag_status === 'red' && (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          )}
                        </svg>
                      </span>
                    ) : (
                      <span className="inline-block w-6 h-6 rounded-full bg-gray-200" />
                    )}
                  </div>

                  {/* Item details */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.description && (
                      <div className="text-sm text-gray-500">{item.description}</div>
                    )}
                    {result?.notes && (
                      <div className="mt-1 text-sm text-gray-600 bg-gray-50 p-2">
                        {result.notes}
                      </div>
                    )}
                    {result?.value !== null && result?.value !== undefined && typeof result.value === 'object' && (
                      <div className="mt-1 text-sm text-gray-600">
                        {JSON.stringify(result.value)}
                      </div>
                    )}
                  </div>

                  {/* Photos indicator */}
                  {result?.media && result.media.length > 0 && (
                    <div className="flex-shrink-0">
                      <span className="text-sm text-gray-500">
                        {result.media.length} photo{result.media.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
