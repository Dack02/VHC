import type { BoardCard } from './hooks/useBoardData'

interface CardBadgesProps {
  card: BoardCard
}

export default function CardBadges({ card }: CardBadgesProps) {
  const badges: { label: string; className: string }[] = []

  if (card.checkedInAt) {
    badges.push({ label: 'C/IN', className: 'bg-emerald-600 text-white' })
  }
  if (card.customerWaiting) {
    badges.push({ label: 'WYW', className: 'bg-rag-red text-white' })
  }
  if (card.loanCarRequired) {
    badges.push({ label: 'LOAN', className: 'bg-blue-500 text-white' })
  }
  if (card.isInternal) {
    badges.push({ label: 'INT', className: 'bg-purple-500 text-white' })
  }

  // Service type badges from booked repairs
  if (hasRepairType(card, 'mot')) {
    badges.push({ label: 'MOT', className: 'bg-rag-amber text-white' })
  }
  if (hasRepairType(card, 'service')) {
    badges.push({ label: 'SVC', className: 'bg-rag-green text-white' })
  }
  if (hasRepairType(card, 'repair')) {
    badges.push({ label: 'RPR', className: 'bg-orange-500 text-white' })
  }
  if (hasRepairType(card, 'diagnostic')) {
    badges.push({ label: 'DIAG', className: 'bg-cyan-500 text-white' })
  }

  if (badges.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.label} className={`px-1.5 py-0.5 rounded text-[10px] font-bold leading-none ${b.className}`}>
          {b.label}
        </span>
      ))}
    </div>
  )
}

function hasRepairType(card: BoardCard, type: string): boolean {
  if (!card.bookedRepairs || !Array.isArray(card.bookedRepairs)) return false
  return card.bookedRepairs.some((r: any) => {
    const desc = (r?.description || r?.name || r?.serviceType || '').toLowerCase()
    return desc.includes(type)
  })
}
