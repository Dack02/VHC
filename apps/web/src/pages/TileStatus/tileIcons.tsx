/**
 * Tile Status icons.
 *
 * The tiles API returns a per-status `icon` field (lucide-style names such as
 * `key`, `package`, `route`; occasionally Tabler `ti-*` aliases). We render those
 * inline rather than pulling in an icon dependency — same approach as
 * `lib/uspIcons.tsx`. `resolveTileIcon` maps the API value (or, failing that, the
 * status name) onto the set below, with a dashed circle as the catch-all.
 *
 * Inline SVGs (lucide geometry) — the web app has no icon dependency.
 */
import type { CSSProperties } from 'react'
import type { Tile } from './types'

export type TileIconName =
  | 'clipboard-check'
  | 'wrench'
  | 'package'
  | 'package-check'
  | 'circle-help'
  | 'route'
  | 'badge-check'
  | 'shield-check'
  | 'droplets'
  | 'external-link'
  | 'key-round'
  | 'check-circle'
  | 'clock'
  | 'circle-dashed'
  // UI chrome
  | 'refresh-cw'
  | 'arrow-left'
  | 'users'
  | 'chevron-down'

const PATHS: Record<TileIconName, string> = {
  'clipboard-check':
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  'wrench':
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'package':
    '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
  'package-check':
    '<path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0"/><path d="M16.5 9.4 7.5 4.21"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
  'circle-help':
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'route':
    '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'badge-check':
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  'shield-check':
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'droplets':
    '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 4.8 7 3.2c-.29 1.6-1.45 2.93-2.59 3.86S2.7 9.1 2.7 10.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  'external-link':
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'key-round':
    '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'check-circle':
    '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'circle-dashed':
    '<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/>',
  'refresh-cw':
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'users':
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>'
}

// Aliases for the icon names the API may emit that differ from our canonical set
// (Tabler/lucide naming drift). Anything not listed falls through to name-keyword
// matching in `resolveTileIcon`.
const ICON_ALIASES: Record<string, TileIconName> = {
  'key': 'key-round',
  'key-round': 'key-round',
  'help-circle': 'circle-help',
  'circle-help': 'circle-help',
  'check-circle': 'check-circle',
  'circle-check': 'check-circle',
  'clipboard-check': 'clipboard-check',
  'wrench': 'wrench',
  'tool': 'wrench',
  'package': 'package',
  'package-check': 'package-check',
  'route': 'route',
  'map': 'route',
  'badge-check': 'badge-check',
  'shield-check': 'shield-check',
  'shield': 'shield-check',
  'droplets': 'droplets',
  'droplet': 'droplets',
  'external-link': 'external-link',
  'clock': 'clock',
  'circle-dashed': 'circle-dashed'
}

// Resolve a tile to an icon: prefer the (tenant-set) API icon, fall back to
// keyword-matching the status name, then a neutral dashed circle.
export function resolveTileIcon(tile: Pick<Tile, 'icon' | 'name' | 'statusId'>): TileIconName {
  const raw = (tile.icon || '').toLowerCase().replace(/^ti-/, '') // strip Tabler prefix
  if (ICON_ALIASES[raw]) return ICON_ALIASES[raw]
  if (raw in PATHS) return raw as TileIconName

  if (!tile.statusId) return 'circle-dashed' // the "No job status" bucket
  const n = (tile.name || '').toLowerCase()
  if (/check.?in|arriv|booked/.test(n)) return 'clipboard-check'
  if (/part/.test(n)) return 'package'
  if (/road.?test|test.?drive/.test(n)) return 'route'
  if (/quality|qc|inspect/.test(n)) return 'badge-check'
  if (/wash|valet|clean/.test(n)) return 'droplets'
  if (/sublet|external|outwork/.test(n)) return 'external-link'
  if (/ready|collect/.test(n)) return 'key-round'
  if (/authoris|approv|sent|customer|await/.test(n)) return 'circle-help'
  if (/workshop|progress|bay|work/.test(n)) return 'wrench'
  return 'circle-dashed'
}

/** Render a tile icon by name. Colour comes from `currentColor` unless overridden. */
export function TileIcon({
  name,
  size = 18,
  className,
  style
}: {
  name: TileIconName
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
