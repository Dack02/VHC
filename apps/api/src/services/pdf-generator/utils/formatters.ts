/**
 * PDF Generator Formatting Utilities
 */

/**
 * Format a number as GBP currency
 */
export function formatCurrency(amount: number | null | undefined): string {
  return `£${(amount || 0).toFixed(2)}`
}

/**
 * Format a date string to UK format (e.g., "15 Jan 2024")
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

/**
 * Format a date string with time (e.g., "15 January 2024, 14:30")
 */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Format follow-up recommendation text based on days
 */
export function formatFollowUp(days?: number | null, text?: string | null): string {
  if (text) return text
  if (!days) return ''
  if (days <= 7) return 'Recommend addressing within 1 week'
  if (days <= 30) return 'Recommend addressing within 1 month'
  if (days <= 90) return 'Recommend addressing within 3 months'
  if (days <= 180) return 'Recommend addressing within 6 months'
  return `Recommend addressing within ${Math.round(days / 30)} months`
}
