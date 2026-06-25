import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useModules } from '../../contexts/ModulesContext'
import { api } from '../../lib/api'

interface DocCard {
  key: string
  enabled: boolean
  title: string
  description: string
  listPath: string
  newPath: string
  countPath: string | null
  accent: string // tailwind text colour for the icon
  icon: JSX.Element
}

export default function DocumentsHub() {
  const { session } = useAuth()
  const { isEnabled } = useModules()
  const token = session?.accessToken
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  const cards: DocCard[] = [
    {
      key: 'jobsheets',
      enabled: isEnabled('jobsheets'),
      title: 'Jobsheets',
      description: 'Booking documents — the top-level record for upcoming and in-progress work.',
      listPath: '/jobsheets',
      newPath: '/jobsheets/new',
      countPath: '/api/v1/jobsheets?limit=1',
      accent: 'text-indigo-600',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
      )
    },
    {
      key: 'estimates',
      enabled: isEnabled('estimates'),
      title: 'Estimates',
      description: 'Pre-booking priced quotes — send to the customer, then convert to a jobsheet.',
      listPath: '/estimates',
      newPath: '/estimates/new',
      countPath: '/api/v1/estimates?limit=1',
      accent: 'text-teal-600',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /></svg>
      )
    }
  ]

  useEffect(() => {
    if (!token) return
    cards.filter(c => c.enabled && c.countPath).forEach(c => {
      api<{ total: number }>(c.countPath as string, { token })
        .then(d => setCounts(prev => ({ ...prev, [c.key]: d.total ?? null })))
        .catch(() => setCounts(prev => ({ ...prev, [c.key]: null })))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const visible = cards.filter(c => c.enabled)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-600 mt-1">Jobsheets and estimates — your workshop’s booking and quoting documents.</p>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-400">
          No document modules enabled. Ask an administrator to enable Jobsheets or Estimates.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map(card => (
            <div key={card.key} className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex flex-col">
              <div className="flex items-start justify-between">
                <Link to={card.listPath} className={`inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gray-50 ${card.accent}`}>
                  {card.icon}
                </Link>
                {counts[card.key] != null && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{counts[card.key]}</span>
                )}
              </div>
              <Link to={card.listPath} className="mt-3 text-lg font-semibold text-gray-900 hover:text-primary">{card.title}</Link>
              <p className="text-sm text-gray-500 mt-1 flex-1">{card.description}</p>
              <div className="flex items-center gap-2 mt-4">
                <Link to={card.newPath} className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-dark">+ New {card.title.replace(/s$/, '')}</Link>
                <Link to={card.listPath} className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">View all</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
