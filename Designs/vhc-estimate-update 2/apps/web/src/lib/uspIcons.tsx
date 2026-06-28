/**
 * Auto-matched USP icons.
 *
 * Tenants type a free-text selling point ("USP") in Estimate Settings; we map the wording
 * to a relevant icon by keyword, falling back to a tick. The same matcher backs the
 * customer-facing estimate portal trust strip and the Settings live preview, so a tenant's
 * "0% finance available…" always gets the same percent icon in both places.
 *
 * Inline SVGs (lucide geometry) — the web app has no icon dependency.
 */
import type { CSSProperties } from 'react'

export type UspIconName =
  | 'check'
  | 'shield-check'
  | 'badge-check'
  | 'percent'
  | 'car'
  | 'award'
  | 'tag'
  | 'sparkles'
  | 'calendar'
  | 'shield'
  | 'clock'
  | 'phone'
  | 'gauge'

const PATHS: Record<UspIconName, string> = {
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'shield-check':
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'badge-check':
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'percent': '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  'car':
    '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  'award':
    '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  'tag':
    '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  'sparkles':
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
  'calendar': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'shield':
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'phone':
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384z"/>',
  'gauge': '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
}

/** Map a free-text USP to an icon name by keyword (first match wins; tick is the fallback). */
export function matchUspIcon(text: string): UspIconName {
  const t = (text || '').toLowerCase()
  if (/genuine|approved|oem|manufacturer|original|quality part|quality-part/.test(t)) return 'shield-check'
  if (/warranty|guarantee|guaranteed/.test(t)) return 'badge-check'
  if (/finance|0%|0 %|interest|monthly|spread the|deposit|pay over|instal|instal?ment/.test(t)) return 'percent'
  if (/courtesy|loan car|loan vehicle|replacement (car|vehicle)|hire car|collect|deliver|pick.?up/.test(t)) return 'car'
  if (/mot/.test(t)) return 'gauge'
  if (/trained|qualified|technician|expert|experienced|master tech|skilled|\d+\s*years/.test(t)) return 'award'
  if (/price|competitive|value|cheaper|price match|affordable|no hidden|transparent/.test(t)) return 'tag'
  if (/wash|valet|clean|complimentary/.test(t)) return 'sparkles'
  if (/book online|online|24\/7|any ?time/.test(t)) return 'calendar'
  if (/safe|safety|peace of mind/.test(t)) return 'shield'
  if (/fast|same.?day|quick|while you wait/.test(t)) return 'clock'
  if (/call|phone|contact|friendly/.test(t)) return 'phone'
  return 'check'
}

/** Render a USP icon by name. Colour comes from `currentColor` unless overridden. */
export function UspIcon({
  name,
  size = 20,
  className,
  style,
}: {
  name: UspIconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  )
}

/** Convenience: match + render in one go (used by the portal trust strip). */
export function UspAutoIcon({ text, size, className, style }: { text: string; size?: number; className?: string; style?: CSSProperties }) {
  return <UspIcon name={matchUspIcon(text)} size={size} className={className} style={style} />
}
