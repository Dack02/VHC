import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'
import { Tooltip } from '../../components/ui/Tooltip'

interface Tech { id: string; name: string }
interface RepairType { id: string; code: string; label: string; colour: string; sortOrder: number; requiredCert: string | null }
interface SkillRow {
  technicianId: string; repairTypeId: string; proficiency: number
  isPrimary: boolean; dailyJobCap: number | null; dailyJobTarget: number | null; isActive: boolean
}
interface CertRow {
  id: string; technicianId: string; certType: string
  reference: string | null; issuedDate: string | null; expiresDate: string | null
}
interface SkillsResponse {
  siteId: string | null
  technicians: Tech[]
  repairTypes: RepairType[]
  skills: SkillRow[]
  certifications: CertRow[]
}

// Editable per-repair-type cell for the selected technician.
interface EditCell { enabled: boolean; proficiency: number; isPrimary: boolean; dailyJobCap: string; dailyJobTarget: string }

const CERT_LABELS: Record<string, string> = {
  mot_tester: 'MOT tester',
  ev_hv: 'EV / hybrid',
  f_gas: 'F-Gas (air-con)'
}
const certLabel = (t: string) => CERT_LABELS[t] || t

const InfoIcon = ({ className = 'w-3.5 h-3.5 text-gray-400' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 01.99 1v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
  </svg>
)

// Compact column header with an optional info-icon tooltip, for the skills grid.
const QHead = ({ label, tip }: { label: string; tip?: string }) => (
  <span className="inline-flex items-center gap-1">
    {label}
    {tip && (
      <Tooltip content={tip} className="cursor-help inline-flex" tabIndex={0}>
        <InfoIcon className="w-3 h-3 text-gray-400" />
      </Tooltip>
    )}
  </span>
)

// Plain-English explainer for the whole Technician skills page. The grid headers
// only have room for one-line tooltips; this is the "what is this and why" pop-out.
function SkillsHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const Term = ({ name, children }: { name: string; children: React.ReactNode }) => (
    <div>
      <dt className="font-semibold text-gray-900">{name}</dt>
      <dd className="text-gray-600 mt-0.5">{children}</dd>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="How technician skills work"
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">How technician skills work</h3>
            <p className="text-sm text-gray-500 mt-0.5">Who can do what — and who to suggest for each job.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1 -mr-1 shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto text-sm leading-relaxed space-y-4">
          <p className="text-gray-600">
            This is each technician's capability matrix — what they can work on, how good they are at it,
            and how much of it they'll take in a day. It's <strong className="text-gray-900">advisory only</strong>:
            it powers the “who should take this job?” suggestion and helps size the protection in Category
            quotas. It never blocks a booking.
          </p>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-gray-600">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">How to use it</p>
            Tick a lane to say this technician can do it, then set the details on that row. A lane that needs
            a qualification (e.g. MOT, air-con) shows a small amber <span className="text-amber-600 font-medium">“needs…”</span> badge
            — record the qualification in the <strong className="text-gray-900">Certifications</strong> panel below.
          </div>

          <dl className="space-y-3">
            <Term name="Tick (the lane)">
              Whether this technician can do this type of work at all. Untick to remove the lane.
            </Term>
            <Term name="Primary (★)">
              Their main lane. Category quotas protect a primary tech's hours first, and the job suggestion
              ranks primaries highest. A technician can hold more than one.
            </Term>
            <Term name="Proficiency">
              Skill level from 1 (apprentice) to 5 (expert). Higher proficiency is suggested ahead of lower
              for the same job.
            </Term>
            <Term name="Cap/day">
              The most jobs of this type the tech will take in a single day. Leave blank for no cap (∞). Caps
              across every able tech add up to the lane's daily ceiling shown in Category quotas.
            </Term>
            <Term name="Target">
              A soft “keep them at about this many a day” aim for load-balancing — never a hard limit. Leave
              blank for none.
            </Term>
          </dl>

          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
            Nothing here blocks a booking — it shapes the technician suggestion and feeds the capacity
            figures used by Category quotas.
          </p>
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TechnicianSkills() {
  const { session, user } = useAuth()
  const toast = useToast()
  const token = session?.accessToken

  const [data, setData] = useState<SkillsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cells, setCells] = useState<Record<string, EditCell>>({})
  const [saving, setSaving] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // New-cert form
  const [newCertType, setNewCertType] = useState('mot_tester')
  const [newCertOther, setNewCertOther] = useState('')
  const [newCertExpiry, setNewCertExpiry] = useState('')

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (user?.site?.id) params.set('siteId', user.site.id)
      const res = await api<SkillsResponse>(`/api/v1/resource-manager/skills?${params}`, { token })
      setData(res)
      setSelectedId(prev => prev || res.technicians[0]?.id || null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load technician skills')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.site?.id])

  useEffect(() => { fetchData() }, [fetchData])

  // Rebuild the editable cells whenever the selected tech or data changes.
  useEffect(() => {
    if (!data || !selectedId) { setCells({}); return }
    const mine = new Map(data.skills.filter(s => s.technicianId === selectedId).map(s => [s.repairTypeId, s]))
    const next: Record<string, EditCell> = {}
    for (const rt of data.repairTypes) {
      const s = mine.get(rt.id)
      next[rt.id] = s
        ? { enabled: true, proficiency: s.proficiency, isPrimary: s.isPrimary, dailyJobCap: s.dailyJobCap?.toString() ?? '', dailyJobTarget: s.dailyJobTarget?.toString() ?? '' }
        : { enabled: false, proficiency: 3, isPrimary: false, dailyJobCap: '', dailyJobTarget: '' }
    }
    setCells(next)
  }, [data, selectedId])

  const selectedCerts = useMemo(
    () => (data?.certifications || []).filter(c => c.technicianId === selectedId),
    [data, selectedId]
  )

  const setCell = (rtId: string, patch: Partial<EditCell>) =>
    setCells(prev => ({ ...prev, [rtId]: { ...prev[rtId], ...patch } }))

  const handleSaveSkills = async () => {
    if (!token || !selectedId) return
    const skills = Object.entries(cells)
      .filter(([, c]) => c.enabled)
      .map(([repairTypeId, c]) => ({
        repairTypeId,
        proficiency: c.proficiency,
        isPrimary: c.isPrimary,
        dailyJobCap: c.dailyJobCap === '' ? null : Number(c.dailyJobCap),
        dailyJobTarget: c.dailyJobTarget === '' ? null : Number(c.dailyJobTarget)
      }))
    setSaving(true)
    try {
      await api(`/api/v1/resource-manager/technicians/${selectedId}/skills`, { method: 'PUT', token, body: { skills } })
      toast.success('Skills saved')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save skills')
    } finally {
      setSaving(false)
    }
  }

  const handleAddCert = async () => {
    if (!token || !selectedId) return
    const certType = (newCertType === 'other' ? newCertOther : newCertType).trim()
    if (!certType) { toast.error('Enter a certification type'); return }
    try {
      await api(`/api/v1/resource-manager/technicians/${selectedId}/certifications`, {
        method: 'POST', token, body: { certType, expiresDate: newCertExpiry || null }
      })
      setNewCertOther(''); setNewCertExpiry('')
      toast.success('Certification added')
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add certification')
    }
  }

  const handleRemoveCert = async (id: string) => {
    if (!token) return
    try {
      await api(`/api/v1/resource-manager/certifications/${id}`, { method: 'DELETE', token })
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove certification')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  const techs = data?.technicians || []
  const repairTypes = data?.repairTypes || []
  const selected = techs.find(t => t.id === selectedId) || null
  const inputCls = 'border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <SettingsBackLink />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Technician skills</h1>
        <p className="text-gray-600 mt-1">
          What each technician can do, their primary lane, and how many of a job type they take per day.
          Used to suggest the right technician — it doesn't block bookings.
        </p>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mt-2"
        >
          <InfoIcon className="w-4 h-4 text-primary" />
          How technician skills work
        </button>
      </div>

      {techs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-12 text-center text-sm text-gray-500">
          No technicians at {user?.site?.name || 'this site'} yet. Add technician users first.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          {/* Technician list */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-2 h-fit">
            {techs.map(t => {
              const primaryCount = (data?.skills || []).filter(s => s.technicianId === t.id && s.isPrimary).length
              const skillCount = (data?.skills || []).filter(s => s.technicianId === t.id).length
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-1 ${selectedId === t.id ? 'bg-primary/10 text-primary' : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-[11px] text-gray-400">{skillCount} skills · {primaryCount} primary</div>
                </button>
              )
            })}
          </div>

          {/* Skill matrix + certifications for the selected tech */}
          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-gray-900">{selected?.name} — skills</h2>
                <button onClick={handleSaveSkills} disabled={saving}
                  className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save skills'}
                </button>
              </div>

              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-2 items-center text-[11px] uppercase tracking-wide text-gray-400 pb-1 border-b border-gray-100">
                <QHead label="Repair type" tip="Tick a lane to say this technician can do it. The badge flags a lane that needs a certification they don't hold yet." />
                <QHead label="Primary" tip="Their main lane — protected first by Category quotas and ranked highest when suggesting who takes a job. A tech can hold more than one." />
                <QHead label="Proficiency" tip="Skill level, 1 (apprentice) to 5 (expert). Higher is suggested ahead of lower for the same job." />
                <QHead label="Cap/day" tip="Most jobs of this type the tech takes in a day. Blank = no cap (∞). These add up to the lane's daily ceiling." />
                <QHead label="Target" tip="A soft 'keep at about N a day' aim for load-balancing — not a limit. Blank = none." />
              </div>

              {repairTypes.map(rt => {
                const cell = cells[rt.id]
                if (!cell) return null
                return (
                  <div key={rt.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-2 items-center py-2 border-b border-gray-50">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={cell.enabled}
                        onChange={e => setCell(rt.id, { enabled: e.target.checked, isPrimary: e.target.checked ? cell.isPrimary : false })} />
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: `${rt.colour}22`, color: rt.colour }}>
                        {rt.label}
                      </span>
                      {rt.requiredCert && (
                        <span className="text-[10px] text-amber-600" title={`Requires ${certLabel(rt.requiredCert)}`}>
                          needs {certLabel(rt.requiredCert)}
                        </span>
                      )}
                    </label>
                    <button
                      type="button"
                      disabled={!cell.enabled}
                      onClick={() => setCell(rt.id, { isPrimary: !cell.isPrimary })}
                      className={`text-lg leading-none ${cell.isPrimary ? 'text-amber-500' : 'text-gray-300'} disabled:opacity-30`}
                      title="Primary lane"
                    >
                      {cell.isPrimary ? '★' : '☆'}
                    </button>
                    <select className={inputCls} disabled={!cell.enabled} value={cell.proficiency}
                      onChange={e => setCell(rt.id, { proficiency: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input type="number" min={1} max={100} className={`${inputCls} w-16`} disabled={!cell.enabled}
                      value={cell.dailyJobCap} placeholder="∞"
                      onChange={e => setCell(rt.id, { dailyJobCap: e.target.value })} />
                    <input type="number" min={0} max={100} className={`${inputCls} w-16`} disabled={!cell.enabled}
                      value={cell.dailyJobTarget} placeholder="—"
                      onChange={e => setCell(rt.id, { dailyJobTarget: e.target.value })} />
                  </div>
                )
              })}
              <p className="text-xs text-gray-400 mt-3">
                Primary = their main lane (protected first). Cap/day limits how many of this job type they take daily
                (e.g. 5 diagnostics). Both feed capacity in a later phase.
              </p>
            </div>

            {/* Certifications */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Certifications</h2>
              {selectedCerts.length === 0 ? (
                <p className="text-sm text-gray-400 mb-3">No certifications recorded.</p>
              ) : (
                <div className="flex flex-col gap-2 mb-3">
                  {selectedCerts.map(cert => {
                    const expired = cert.expiresDate && cert.expiresDate < new Date().toISOString().slice(0, 10)
                    return (
                      <div key={cert.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                        <div className="text-sm">
                          <span className="font-medium text-gray-900">{certLabel(cert.certType)}</span>
                          {cert.expiresDate && (
                            <span className={`ml-2 text-xs ${expired ? 'text-rag-red' : 'text-gray-500'}`}>
                              {expired ? 'expired' : 'expires'} {cert.expiresDate}
                            </span>
                          )}
                        </div>
                        <button onClick={() => handleRemoveCert(cert.id)} className="text-xs text-gray-400 hover:text-rag-red">Remove</button>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">Type</label>
                  <select className={inputCls} value={newCertType} onChange={e => setNewCertType(e.target.value)}>
                    <option value="mot_tester">MOT tester</option>
                    <option value="ev_hv">EV / hybrid</option>
                    <option value="f_gas">F-Gas (air-con)</option>
                    <option value="other">Other…</option>
                  </select>
                </div>
                {newCertType === 'other' && (
                  <div>
                    <label className="block text-[11px] text-gray-500 mb-0.5">Name</label>
                    <input className={inputCls} value={newCertOther} onChange={e => setNewCertOther(e.target.value)} placeholder="e.g. welding" />
                  </div>
                )}
                <div>
                  <label className="block text-[11px] text-gray-500 mb-0.5">Expires (optional)</label>
                  <input type="date" className={inputCls} value={newCertExpiry} onChange={e => setNewCertExpiry(e.target.value)} />
                </div>
                <button onClick={handleAddCert} className="px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHelp && <SkillsHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
