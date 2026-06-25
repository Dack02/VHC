/**
 * Tyre & brake position parsing for the PDF report components.
 *
 * Single source of truth for turning a free-text inspection item name
 * (e.g. "Front Right Tyre", "O/S Rear Brake") into a canonical position key.
 * Centralised so every report surface classifies positions identically — a
 * divergence here previously let the report's tyre grid bind the offside front
 * to the nearside front's readings (the OSF "mirrored" the NSF).
 *
 * Matching rule: require the axle word (front/rear) AND a side indicator
 * (left/right, or the UK nearside/offside abbreviations n/s / o/s). Never match
 * bare abbreviations like "fr"/"fl" — "fr" is a substring of "front", so it
 * would make every front tyre satisfy front_right.
 */

export type TyrePosition = 'front_left' | 'front_right' | 'rear_left' | 'rear_right'
export type BrakePosition = 'front' | 'rear'

/** Human-readable labels, in display order (FL, FR, RL, RR). */
export const TYRE_POSITION_LABELS: Record<TyrePosition, string> = {
  front_left: 'Front Left',
  front_right: 'Front Right',
  rear_left: 'Rear Left',
  rear_right: 'Rear Right'
}

/** All four tyre positions in display order (FL, FR, RL, RR). */
export const TYRE_POSITIONS: TyrePosition[] = ['front_left', 'front_right', 'rear_left', 'rear_right']

/**
 * Classify a tyre's position from its item name. Returns null when the name
 * lacks a side indicator (e.g. a bare "Front Tyre") rather than guessing.
 */
export function parseTyrePosition(itemName: string): TyrePosition | null {
  const lower = itemName.toLowerCase()
  if (lower.includes('front') && (lower.includes('left') || lower.includes('n/s'))) return 'front_left'
  if (lower.includes('front') && (lower.includes('right') || lower.includes('o/s'))) return 'front_right'
  if (lower.includes('rear') && (lower.includes('left') || lower.includes('n/s'))) return 'rear_left'
  if (lower.includes('rear') && (lower.includes('right') || lower.includes('o/s'))) return 'rear_right'
  return null
}

/** Classify a brake's axle from its item name. */
export function parseBrakePosition(itemName: string): BrakePosition | null {
  const lower = itemName.toLowerCase()
  if (lower.includes('front')) return 'front'
  if (lower.includes('rear')) return 'rear'
  return null
}

/**
 * Uppercase heading for a tyre measurement card. Unlike parseTyrePosition this
 * preserves the naming style used on the item (keeps "N/S FRONT" distinct from
 * "FRONT LEFT") and falls back to a generic axle or the raw name. Use this for
 * card titles only — never for keying data.
 */
export function tyrePositionHeading(itemName?: string): string {
  if (!itemName) return 'TYRE'

  const lower = itemName.toLowerCase()

  // Check for specific positions
  if (lower.includes('front') && lower.includes('left')) return 'FRONT LEFT TYRE'
  if (lower.includes('front') && lower.includes('right')) return 'FRONT RIGHT TYRE'
  if (lower.includes('rear') && lower.includes('left')) return 'REAR LEFT TYRE'
  if (lower.includes('rear') && lower.includes('right')) return 'REAR RIGHT TYRE'

  // Check for N/S O/S naming
  if (lower.includes('n/s') && lower.includes('front')) return 'N/S FRONT TYRE'
  if (lower.includes('o/s') && lower.includes('front')) return 'O/S FRONT TYRE'
  if (lower.includes('n/s') && lower.includes('rear')) return 'N/S REAR TYRE'
  if (lower.includes('o/s') && lower.includes('rear')) return 'O/S REAR TYRE'

  // Generic front/rear
  if (lower.includes('front')) return 'FRONT TYRE'
  if (lower.includes('rear')) return 'REAR TYRE'

  return itemName.toUpperCase()
}
