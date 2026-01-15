import { HealthCheck, RepairItem } from '../../lib/api'

interface CustomerPreviewModalProps {
  healthCheck: HealthCheck
  repairItems: RepairItem[]
  onClose: () => void
  onSend: () => void
}

export function CustomerPreviewModal({ healthCheck, repairItems, onClose, onSend }: CustomerPreviewModalProps) {
  const vehicle = healthCheck.vehicle
  const customer = healthCheck.vehicle?.customer

  // Only show visible items to customer
  const visibleItems = repairItems.filter(item => item.is_visible)
  const redItems = visibleItems.filter(item => item.rag_status === 'red')
  const amberItems = visibleItems.filter(item => item.rag_status === 'amber')

  const totalParts = visibleItems.reduce((sum, i) => sum + i.parts_cost, 0)
  const totalLabour = visibleItems.reduce((sum, i) => sum + i.labor_cost, 0)
  const totalAmount = totalParts + totalLabour

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Customer Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="text-center text-sm text-gray-500 mb-4 bg-yellow-50 p-2 border border-yellow-200">
            This is how the customer will see their health check report
          </div>

          {/* Header section */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Vehicle Health Check</h1>
            <p className="text-gray-600">
              {vehicle?.make} {vehicle?.model} - {vehicle?.registration}
            </p>
            {customer && (
              <p className="text-gray-500">
                Prepared for {customer.first_name} {customer.last_name}
              </p>
            )}
          </div>

          {/* RAG Summary */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="text-center p-4 bg-green-50 border border-green-200">
              <div className="text-3xl font-bold text-green-600">{healthCheck.green_count}</div>
              <div className="text-sm text-green-700">Passed</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 border border-yellow-200">
              <div className="text-3xl font-bold text-yellow-600">{healthCheck.amber_count}</div>
              <div className="text-sm text-yellow-700">Advisory</div>
            </div>
            <div className="text-center p-4 bg-red-50 border border-red-200">
              <div className="text-3xl font-bold text-red-600">{healthCheck.red_count}</div>
              <div className="text-sm text-red-700">Urgent</div>
            </div>
          </div>

          {/* Repair items */}
          {visibleItems.length > 0 && (
            <>
              {/* Urgent Items */}
              {redItems.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-red-700 mb-3 flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-red-500" />
                    Urgent Attention Required
                  </h3>
                  <div className="space-y-3">
                    {redItems.map(item => (
                      <div key={item.id} className="bg-red-50 border border-red-200 p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-gray-900">{item.title}</div>
                            {item.description && (
                              <div className="text-sm text-gray-600 mt-1">{item.description}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-900">£{item.total_price.toFixed(2)}</div>
                            <div className="text-xs text-gray-500">
                              Parts: £{item.parts_cost.toFixed(2)} | Labour: £{item.labor_cost.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Advisory Items */}
              {amberItems.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-yellow-700 mb-3 flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-yellow-500" />
                    Advisory Items
                  </h3>
                  <div className="space-y-3">
                    {amberItems.map(item => (
                      <div key={item.id} className="bg-yellow-50 border border-yellow-200 p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-gray-900">{item.title}</div>
                            {item.description && (
                              <div className="text-sm text-gray-600 mt-1">{item.description}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-bold text-gray-900">£{item.total_price.toFixed(2)}</div>
                            <div className="text-xs text-gray-500">
                              Parts: £{item.parts_cost.toFixed(2)} | Labour: £{item.labor_cost.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="bg-gray-100 border border-gray-300 p-4">
                <div className="flex justify-between mb-2">
                  <span className="text-gray-600">Parts Total</span>
                  <span className="font-medium">£{totalParts.toFixed(2)}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-gray-600">Labour Total</span>
                  <span className="font-medium">£{totalLabour.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xl font-bold border-t border-gray-300 pt-2 mt-2">
                  <span>Total</span>
                  <span>£{totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {visibleItems.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p className="text-lg font-medium text-green-600 mb-2">All Clear!</p>
              <p>Your vehicle has passed all inspection points.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-between flex-shrink-0 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-100"
          >
            Close Preview
          </button>
          <button
            onClick={onSend}
            className="px-4 py-2 bg-primary text-white font-medium hover:bg-primary-dark"
          >
            Send to Customer
          </button>
        </div>
      </div>
    </div>
  )
}
