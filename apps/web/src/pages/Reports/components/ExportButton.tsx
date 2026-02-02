import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'

interface ExportButtonProps {
  endpoint: string
  queryString: string
  filename: string
}

export default function ExportButton({ endpoint, queryString, filename }: ExportButtonProps) {
  const { session } = useAuth()
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!session?.accessToken) return

    try {
      setExporting(true)
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5180'
      const res = await fetch(
        `${apiUrl}${endpoint}?${queryString}&format=csv`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } }
      )

      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch {
      // Silently fail — toast would be better but keeping it simple
    } finally {
      setExporting(false)
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="px-4 py-2 bg-white border border-gray-300 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {exporting ? 'Exporting...' : 'Export CSV'}
    </button>
  )
}
