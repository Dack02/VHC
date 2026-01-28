import { ReactNode } from 'react'

type BadgeVariant = 'green' | 'amber' | 'red' | 'gray' | 'primary'

interface BadgeProps {
  variant?: BadgeVariant
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  className?: string
}

export function Badge({
  variant = 'gray',
  size = 'md',
  children,
  className = ''
}: BadgeProps) {
  const variants = {
    green: 'bg-rag-green-bg text-rag-green',
    amber: 'bg-rag-amber-bg text-rag-amber',
    red: 'bg-rag-red-bg text-rag-red',
    gray: 'bg-gray-100 text-gray-700',
    primary: 'bg-blue-100 text-primary'
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base'
  }

  return (
    <span
      className={`
        inline-flex items-center font-medium
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
    >
      {children}
    </span>
  )
}

// Status badge specifically for health check statuses
type Status =
  | 'awaiting_checkin'
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'paused'
  | 'tech_completed'
  | 'awaiting_review'
  | 'awaiting_pricing'
  | 'ready_to_send'
  | 'sent'
  | 'opened'
  | 'partial_response'
  | 'authorized'
  | 'declined'
  | 'expired'
  | 'completed'
  | 'cancelled'

const statusConfig: Record<Status, { label: string; variant: BadgeVariant }> = {
  awaiting_checkin: { label: 'Awaiting Check In', variant: 'red' },
  created: { label: 'Created', variant: 'gray' },
  assigned: { label: 'Assigned', variant: 'primary' },
  in_progress: { label: 'In Progress', variant: 'amber' },
  paused: { label: 'Paused', variant: 'gray' },
  tech_completed: { label: 'Tech Complete', variant: 'green' },
  awaiting_review: { label: 'Awaiting Review', variant: 'amber' },
  awaiting_pricing: { label: 'Awaiting Pricing', variant: 'amber' },
  ready_to_send: { label: 'Ready to Send', variant: 'primary' },
  sent: { label: 'Sent', variant: 'primary' },
  opened: { label: 'Opened', variant: 'green' },
  partial_response: { label: 'Partial Response', variant: 'amber' },
  authorized: { label: 'Authorized', variant: 'green' },
  declined: { label: 'Declined', variant: 'red' },
  expired: { label: 'Expired', variant: 'gray' },
  completed: { label: 'Completed', variant: 'green' },
  cancelled: { label: 'Cancelled', variant: 'gray' }
}

interface StatusBadgeProps {
  status: Status
  size?: 'sm' | 'md' | 'lg'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: 'gray' as BadgeVariant }

  return (
    <Badge variant={config.variant} size={size}>
      {config.label}
    </Badge>
  )
}
