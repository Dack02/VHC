/**
 * Get the next N working days from a given date.
 * Working days = Monday-Saturday (Sunday is skipped).
 * Returns array of YYYY-MM-DD strings for the next `count` working days AFTER fromDate.
 */
export function getNextWorkingDays(fromDate: Date, count: number): string[] {
  const days: string[] = []
  const current = new Date(fromDate)
  current.setHours(12, 0, 0, 0) // Avoid DST edge cases

  while (days.length < count) {
    current.setDate(current.getDate() + 1)
    // 0 = Sunday — skip it
    if (current.getDay() !== 0) {
      const yyyy = current.getFullYear()
      const mm = String(current.getMonth() + 1).padStart(2, '0')
      const dd = String(current.getDate()).padStart(2, '0')
      days.push(`${yyyy}-${mm}-${dd}`)
    }
  }

  return days
}
