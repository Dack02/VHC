/**
 * Booking relatedness matcher
 * --------------------------------------------------------------------------
 * Decides whether a customer's upcoming workshop booking actually INCLUDES the
 * deferred work a follow-up case is chasing (e.g. deferred "Front Brake Discs &
 * Pads" vs a booking that may or may not contain brakes).
 *
 * Two tiers:
 *   1. scoreBookingRelatednessDeterministic() — free, instant, always-runs.
 *      Normalises both sides, derives a coarse repair taxonomy from the system
 *      reason types, and scores token / taxonomy / position overlap. Resolves
 *      the clear cases (specific line matches → related; MOT/service-only or
 *      empty → unrelated) and flags the ambiguous middle.
 *   2. scoreBookingRelatednessAI() — Claude (via the shared ai-reasons harness:
 *      quota check + usage tracking + retries). Only called for the ambiguous
 *      middle. Returns a structured verdict; falls back to the deterministic
 *      result on any error / quota exhaustion.
 *
 * The verdict NEVER auto-closes or auto-cancels a chase — it only pre-selects and
 * explains a button in the Follow-Up modal. A wrong "related" would silently drop
 * a customer's deferred safety work, so the matcher biases conservative.
 */

import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { logger } from '../lib/logger.js'
import { getApiKey, getModel, generateWithTracking } from './ai-reasons.js'

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type MatchLevel = 'high' | 'medium' | 'low' | 'none'
export type Relatedness = 'related' | 'partial' | 'unrelated'
export type SuggestedAction = 'confirm' | 'review' | 'call'
export type MatchBasis = 'taxonomy' | 'keyword' | 'service_type' | 'mot_only' | 'thin' | 'ai' | 'none'

export interface BookingMatchVerdict {
  level: MatchLevel
  confidence: number          // 0..1
  relatedness: Relatedness
  message: string             // one-liner for the banner
  matchedItems: string[]      // deferred item names the booking appears to cover
  partialItems: string[]      // weak / position-conflict matches
  unmatchedItems: string[]
  suggestedAction: SuggestedAction
  basis: MatchBasis
  source: 'deterministic' | 'ai'
}

export interface DeferredItemLite {
  name: string | null
  value?: number | null
  rag?: string | null
}

export interface BookingLite {
  id: string
  due_date?: string | null
  jobsheet_number?: string | null
  booked_repairs?: unknown
  booked_service_type?: string | null
  is_mot_booking?: boolean | null
  notes?: string | null
}

interface RawLabourItem { description?: string | null; price?: number | null; units?: number | null; fitter?: string | null }
interface RawBookedRepair { code?: string | null; description?: string | null; notes?: string | null; labourItems?: RawLabourItem[] | null }

// ---------------------------------------------------------------------------
// Taxonomy + synonyms (the bridge that gives free-text both sides a shared key)
// ---------------------------------------------------------------------------

// Keyword (normalised, singular) → one or more system reason-type keys
// (seeded from supabase/migrations/20260118200001_reason_types_table.sql, plus a
// few common extras the reason types don't cover). A line can map to several.
export const WORK_TAXONOMY: Record<string, string[]> = {
  brake: ['brake_assembly', 'brake_disc', 'brake_pad'],
  disc: ['brake_disc', 'brake_assembly'],
  pad: ['brake_pad', 'brake_assembly'],
  caliper: ['brake_assembly'],
  tyre: ['tyre'],
  wiper: ['wiper'],
  blade: ['wiper'],
  shock: ['shock_absorber', 'suspension'],
  absorber: ['shock_absorber', 'suspension'],
  strut: ['shock_absorber', 'suspension'],
  spring: ['suspension'],
  coilspring: ['suspension'],
  suspension: ['suspension'],
  wishbone: ['suspension_arm', 'suspension'],
  bush: ['suspension_arm', 'suspension'],
  balljoint: ['suspension_arm', 'steering'],
  exhaust: ['exhaust'],
  catalytic: ['exhaust'],
  cat: ['exhaust'],
  dpf: ['exhaust'],
  battery: ['battery'],
  alternator: ['battery'],
  steering: ['steering'],
  trackrod: ['steering'],
  rack: ['steering'],
  alignment: ['steering', 'tyre'],
  tracking: ['steering', 'tyre'],
  clutch: ['clutch'],
  cambelt: ['drive_belt'],
  timingbelt: ['drive_belt'],
  belt: ['drive_belt'],
  auxiliary: ['drive_belt'],
  filter: ['air_filter'],
  pollen: ['air_filter'],
  cabin: ['air_filter'],
  coolant: ['fluid_level'],
  antifreeze: ['fluid_level'],
  fluid: ['fluid_level'],
  bulb: ['light_cluster'],
  headlight: ['light_cluster'],
  headlamp: ['light_cluster'],
  indicator: ['light_cluster'],
  cvboot: ['cv_boot'],
  driveshaft: ['cv_boot'],
  mirror: ['mirror'],
  horn: ['horn'],
  seatbelt: ['seat_belt'],
  wheelbearing: ['wheel'],
  bearing: ['wheel'],
}

// Per-token canonicalisation (plural → singular, abbreviation → word). Applied
// after punctuation is stripped, before taxonomy lookup.
const SYNONYM: Record<string, string> = {
  discs: 'disc', rotor: 'disc', rotors: 'disc',
  pads: 'pad',
  brakes: 'brake', braking: 'brake',
  tyres: 'tyre', tire: 'tyre', tires: 'tyre',
  blades: 'blade', wipers: 'wiper',
  shocks: 'shock', absorbers: 'absorber', struts: 'strut',
  springs: 'spring',
  bushes: 'bush', bushings: 'bush', bushing: 'bush',
  wishbones: 'wishbone',
  calipers: 'caliper', callipers: 'caliper', calliper: 'caliper',
  bearings: 'bearing',
  filters: 'filter',
  bulbs: 'bulb', headlights: 'headlight', headlamps: 'headlamp',
  exhausts: 'exhaust',
  batteries: 'battery',
  mirrors: 'mirror',
  cambelts: 'cambelt', susp: 'suspension', alt: 'alternator',
}

// Tokens dropped from the "content overlap" comparison (verbs / fillers /
// position words — position is matched separately, component is what matters).
const STOP = new Set([
  'replace', 'replacement', 'replaced', 'renew', 'renewal', 'check', 'checked', 'checking',
  'repair', 'repairs', 'repaired', 'advisory', 'advise', 'adv', 'required', 'require', 'requires',
  'due', 'soon', 'and', 'the', 'to', 'for', 'of', 'a', 'an', 'x', 'pair', 'both', 'set', 'new',
  'fit', 'fitting', 'fitted', 'remove', 'refit', 'rr', 'work', 'works', 'please', 'approx', 'est',
  'estimate', 'estimated', 'inc', 'vat', 'plus', 'parts', 'labour', 'labor', 'qty', 'each',
  'front', 'rear', 'nearside', 'offside', 'driver', 'passenger', 'side', 'ns', 'os',
])

const GENERIC_SERVICE = new Set([
  'service', 'full', 'interim', 'major', 'minor', 'oil', 'maintenance', 'routine', 'annual', 'basic',
])

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

interface Norm {
  raw: string
  content: Set<string>                  // component tokens (no positions/stopwords)
  axes: Set<'front' | 'rear'>
  taxo: Set<string>
}

function detectAxes(lower: string): Set<'front' | 'rear'> {
  const axes = new Set<'front' | 'rear'>()
  if (/\bfront\b|\bfrt\b|\bf\/|n\/s\/f|o\/s\/f|\bnsf\b|\bosf\b/.test(lower)) axes.add('front')
  if (/\brear\b|n\/s\/r|o\/s\/r|\bnsr\b|\bosr\b/.test(lower)) axes.add('rear')
  return axes
}

export function normalizeWorkText(s: string | null | undefined): Norm {
  const raw = (s || '').toString()
  const lower = raw.toLowerCase()
  const axes = detectAxes(lower)

  const rawTokens = lower
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const content = new Set<string>()
  const taxo = new Set<string>()
  for (let tok of rawTokens) {
    if (SYNONYM[tok]) tok = SYNONYM[tok]
    // crude singular fold for unmapped plurals (keep ≥4 chars to avoid mangling)
    if (!WORK_TAXONOMY[tok] && tok.length > 4 && tok.endsWith('s') && !tok.endsWith('ss')) {
      const sing = tok.slice(0, -1)
      if (WORK_TAXONOMY[sing]) tok = sing
    }
    for (const key of WORK_TAXONOMY[tok] || []) taxo.add(key)
    if (!STOP.has(tok) && tok.length > 1 && !/^\d+$/.test(tok)) content.add(tok)
  }
  return { raw, content, axes, taxo }
}

// ---------------------------------------------------------------------------
// Booking → comparable lines
// ---------------------------------------------------------------------------

interface BookingLine { norm: Norm; trust: 'full' | 'low' }

function parseRepairs(booking: BookingLite): RawBookedRepair[] {
  const r = booking.booked_repairs
  return Array.isArray(r) ? (r as RawBookedRepair[]) : []
}

function bookingLines(booking: BookingLite): BookingLine[] {
  const lines: BookingLine[] = []
  for (const rep of parseRepairs(booking)) {
    const parts = [rep.description, rep.code, rep.notes, ...((rep.labourItems || []).map((l) => l.description))]
      .filter(Boolean)
      .join(' ')
    if (parts.trim()) lines.push({ norm: normalizeWorkText(parts), trust: 'full' })
  }
  // Low-trust fallbacks — a generic service type / free-text note can hint, but
  // must never on its own confirm a specific repair.
  if (booking.booked_service_type) lines.push({ norm: normalizeWorkText(booking.booked_service_type), trust: 'low' })
  if (booking.notes) lines.push({ norm: normalizeWorkText(String(booking.notes).split('\n')[0]), trust: 'low' })
  return lines
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

function axesConflict(a: Set<'front' | 'rear'>, b: Set<'front' | 'rear'>): boolean {
  if (a.size === 0 || b.size === 0) return false
  for (const x of a) if (b.has(x)) return false
  return true // both specified, no overlap → conflict (front vs rear)
}

// Score one deferred item against one booking line (0..0.95). Higher tiers win.
function lineScore(d: Norm, line: BookingLine): number {
  const b = line.norm
  const cap = line.trust === 'low' ? 0.6 : 0.95
  const taxoOverlap = [...d.taxo].some((t) => b.taxo.has(t))
  if (taxoOverlap) {
    if (axesConflict(d.axes, b.axes)) return Math.min(0.55, cap)        // T2 — brakes booked, wrong axle
    return Math.min(cap, 0.95)                                          // T1 — taxonomy + position agree
  }
  const j = jaccard(d.content, b.content)
  if (j >= 0.5) return Math.min(line.trust === 'low' ? 0.45 : 0.7, cap) // T3 — strong keyword overlap
  // T4 — a single distinctive component noun shared
  for (const t of d.content) if (b.content.has(t) && t.length >= 4) return Math.min(0.4, cap)
  return 0
}

// ---------------------------------------------------------------------------
// Deterministic tier
// ---------------------------------------------------------------------------

function isMotOnly(booking: BookingLite, lines: BookingLine[]): boolean {
  const fullLines = lines.filter((l) => l.trust === 'full')
  const motish = (n: Norm) => /\bmot\b/.test(n.raw.toLowerCase()) || (n.content.size === 0 && n.taxo.size === 0)
  const hasReal = fullLines.some((l) => l.norm.taxo.size > 0 && !/\bmot\b/.test(l.norm.raw.toLowerCase()))
  if (hasReal) return false
  if (booking.is_mot_booking) return true
  return fullLines.length > 0 && fullLines.every((l) => motish(l.norm))
}

function isGenericServiceOnly(booking: BookingLite, lines: BookingLine[]): boolean {
  const hasSpecific = lines.some((l) => l.norm.taxo.size > 0)
  if (hasSpecific) return false
  const st = normalizeWorkText(booking.booked_service_type)
  return [...st.content].some((t) => GENERIC_SERVICE.has(t))
}

export interface DeterministicResult {
  verdict: BookingMatchVerdict
  ambiguous: boolean   // should the AI tier be consulted?
}

function names(items: DeferredItemLite[]): string[] {
  return items.map((i) => (i.name || '').trim()).filter(Boolean)
}

function levelFromConfidence(conf: number): MatchLevel {
  if (conf >= 0.8) return 'high'
  if (conf >= 0.5) return 'medium'
  if (conf > 0) return 'low'
  return 'none'
}

export function scoreBookingRelatednessDeterministic(
  items: DeferredItemLite[],
  booking: BookingLite
): DeterministicResult {
  const allNames = names(items)
  const lines = bookingLines(booking)
  const fullLines = lines.filter((l) => l.trust === 'full')

  // Pre-gate: MOT-only booking — confident negative, the highest-value catch.
  if (isMotOnly(booking, lines)) {
    return {
      ambiguous: false,
      verdict: {
        level: 'none', confidence: 0.85, relatedness: 'unrelated', basis: 'mot_only',
        message: 'This looks like an MOT-only booking — the deferred work does not appear to be included.',
        matchedItems: [], partialItems: [], unmatchedItems: allNames,
        suggestedAction: 'call', source: 'deterministic',
      },
    }
  }

  // Pre-gate: no itemised work at all (legacy / thin DMS import). Can't confirm,
  // and the AI tier has nothing to read either, so don't spend a token.
  if (fullLines.length === 0 && !booking.booked_service_type) {
    return {
      ambiguous: false,
      verdict: {
        level: 'low', confidence: 0.3, relatedness: 'unrelated', basis: 'thin',
        message: 'This booking has no itemised work, so we cannot confirm the deferred work is included.',
        matchedItems: [], partialItems: [], unmatchedItems: allNames,
        suggestedAction: 'review', source: 'deterministic',
      },
    }
  }

  // Score every item against the best-matching booking line.
  const scored = items
    .filter((i) => (i.name || '').trim())
    .map((i) => {
      const d = normalizeWorkText(i.name)
      const best = lines.reduce((mx, line) => Math.max(mx, lineScore(d, line)), 0)
      return { name: (i.name || '').trim(), score: best }
    })

  const matched = scored.filter((s) => s.score >= 0.7).map((s) => s.name)
  const partial = scored.filter((s) => s.score >= 0.4 && s.score < 0.7).map((s) => s.name)
  const unmatched = scored.filter((s) => s.score < 0.4).map((s) => s.name)
  const maxScore = scored.reduce((mx, s) => Math.max(mx, s.score), 0)
  const coverage = scored.length ? matched.length / scored.length : 0
  const confidence = Math.round((0.7 * maxScore + 0.3 * coverage) * 100) / 100

  // Generic-service-only with no specific lines → can't claim coverage.
  if (matched.length === 0 && partial.length === 0 && isGenericServiceOnly(booking, lines)) {
    return {
      ambiguous: true, // a free-text note might still hint — let AI look
      verdict: {
        level: 'low', confidence: 0.35, relatedness: 'unrelated', basis: 'service_type',
        message: 'A general service is booked — the deferred work may or may not be included.',
        matchedItems: [], partialItems: [], unmatchedItems: allNames,
        suggestedAction: 'review', source: 'deterministic',
      },
    }
  }

  const relatedness: Relatedness =
    matched.length > 0 && unmatched.length === 0 && partial.length === 0 ? 'related'
    : matched.length > 0 || partial.length > 0 ? 'partial'
    : 'unrelated'

  let message: string
  if (relatedness === 'related') {
    message = `Booking appears to include the deferred work${matched.length === 1 ? `: ${matched[0]}` : ` (${matched.length} items)`}.`
  } else if (relatedness === 'partial') {
    const covers = matched.length ? matched.join(', ') : partial.join(', ')
    message = unmatched.length
      ? `Booking appears to cover ${covers}; ${unmatched.join(', ')} not seen.`
      : `Possible match on ${covers} — please confirm.`
  } else {
    message = 'The booked work does not appear to match the deferred work.'
  }

  const suggestedAction: SuggestedAction =
    relatedness === 'related' && confidence >= 0.8 ? 'confirm'
    : relatedness === 'unrelated' ? 'call'
    : 'review'

  // Ambiguity: consult AI on partial signal, position conflicts, or all-miss
  // where the booking still has real text (paraphrase risk). Confident full
  // coverage doesn't need it.
  const allMatched = scored.length > 0 && matched.length === scored.length
  const hasRealText = fullLines.some((l) => l.norm.taxo.size > 0 || l.norm.content.size >= 3)
  const ambiguous = !allMatched && (partial.length > 0 || (matched.length > 0) || (unmatched.length > 0 && hasRealText))

  return {
    ambiguous,
    verdict: {
      level: levelFromConfidence(confidence), confidence, relatedness, basis: matched.length || partial.length ? 'taxonomy' : 'keyword',
      message, matchedItems: matched, partialItems: partial, unmatchedItems: unmatched,
      suggestedAction, source: 'deterministic',
    },
  }
}

// ---------------------------------------------------------------------------
// AI tier (Claude, via the shared ai-reasons harness)
// ---------------------------------------------------------------------------

const VERDICT_TOOL = {
  name: 'emit_verdict',
  description: 'Emit the relatedness verdict between the deferred work items and the workshop booking.',
  input_schema: {
    type: 'object' as const,
    properties: {
      relatedness: { type: 'string', enum: ['related', 'partial', 'unrelated'] },
      coveredItems: {
        type: 'array', items: { type: 'string' },
        description: 'EXACT deferred item labels (verbatim from the provided list) that the booking text evidences. Empty if none.',
      },
      missingItems: {
        type: 'array', items: { type: 'string' },
        description: 'EXACT deferred item labels NOT evidenced in the booking text.',
      },
      confidence: { type: 'number', description: 'Calibrated certainty 0..1. Use <=0.5 when booking text is thin or generic (only "Service"/"MOT").' },
      reason: { type: 'string', description: 'One short sentence an advisor reads — state the evidence or its absence.' },
    },
    required: ['relatedness', 'coveredItems', 'missingItems', 'confidence', 'reason'],
  },
}

const AI_SYSTEM = `You match deferred vehicle repair work against a workshop booking to decide whether the booking already covers that work. You only have the booking's text (descriptions and labour lines imported from a dealer DMS), which is often thin. Rules:
1. Only mark an item covered when the booking text contains specific evidence for THAT item (matching component and, where the item specifies it, the same axle/position — "Front Brake Pads" is not evidenced by a line that only says "Brake fluid").
2. Generic lines — "Service", "Interim Service", "Repair", "Investigate noise", "MOT", "MOT Labour" — are NOT evidence of specific deferred work. Treat an MOT-only or service-only booking as unrelated unless a specific matching line is also present.
3. Never infer coverage from the booking merely existing, from price, or from the customer being the same. Absence of evidence is missing, not covered.
4. If the booking text is empty or purely generic, return unrelated with confidence <= 0.4 and say the text is too thin to confirm.
5. Be conservative. A false "covered" causes a customer's deferred safety work to be silently dropped — when unsure prefer partial/missing and lower confidence.
Always call emit_verdict; coveredItems/missingItems must use the exact deferred-item labels provided.`

function buildAiUserPrompt(items: DeferredItemLite[], booking: BookingLite): string {
  const itemLines = items
    .filter((i) => (i.name || '').trim())
    .map((i, n) => `${n + 1}. "${(i.name || '').trim()}"${i.rag ? `  [rag=${i.rag}]` : ''}${i.value ? `  [~£${Math.round(Number(i.value))}]` : ''}`)
    .join('\n')

  const repairs = parseRepairs(booking)
  const repairLines = repairs.length
    ? repairs.map((r) => {
        const labour = (r.labourItems || []).map((l) => l.description).filter(Boolean).join('; ')
        const title = [r.description, r.code].filter(Boolean).join(' ') || '(no description)'
        return `  - ${title}${r.notes ? ` | notes: ${r.notes}` : ''}${labour ? ` | labour: ${labour}` : ''}`
      }).join('\n')
    : '  (none itemised)'

  return `DEFERRED WORK ITEMS (what we're chasing; labels are verbatim):
${itemLines}

WORKSHOP BOOKING (source: dealer DMS import):
service_type: ${booking.booked_service_type || '(unknown)'}
is_mot_booking: ${booking.is_mot_booking ? 'true' : 'false'}
notes(first line): ${booking.notes ? String(booking.notes).split('\n')[0] : '(none)'}
booked_repairs:
${repairLines}`
}

interface VerdictToolInput {
  relatedness: Relatedness
  coveredItems: string[]
  missingItems: string[]
  confidence: number
  reason: string
}

async function callClaudeVerdict(items: DeferredItemLite[], booking: BookingLite) {
  const apiKey = await getApiKey()
  const model = await getModel()
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: AI_SYSTEM,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'emit_verdict' },
    messages: [{ role: 'user', content: buildAiUserPrompt(items, booking) }],
  })
  const toolUse = response.content.find((b) => b.type === 'tool_use') as { input?: VerdictToolInput } | undefined
  if (!toolUse?.input) throw new Error('Claude did not return a verdict tool call')
  return {
    result: toolUse.input,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  }
}

// Map the model's tool output into a BookingMatchVerdict, hardening it so the
// arrays are a strict subset of the real deferred names (drop hallucinations,
// force omissions into "missing").
function aiToVerdict(input: VerdictToolInput, items: DeferredItemLite[]): BookingMatchVerdict {
  const allNames = names(items)
  const lc = new Map(allNames.map((n) => [n.toLowerCase(), n]))
  const covered: string[] = []
  for (const raw of input.coveredItems || []) {
    const hit = lc.get(String(raw).toLowerCase().trim())
    if (hit && !covered.includes(hit)) covered.push(hit)
  }
  const missing = allNames.filter((n) => !covered.includes(n))
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0))
  const relatedness: Relatedness =
    covered.length === 0 ? 'unrelated'
    : missing.length === 0 ? (input.relatedness === 'partial' ? 'partial' : 'related')
    : 'partial'

  const level: MatchLevel =
    relatedness === 'related' && confidence >= 0.8 ? 'high'
    : relatedness === 'unrelated' ? (confidence >= 0.7 ? 'none' : 'low')
    : confidence >= 0.6 ? 'medium' : 'low'

  const suggestedAction: SuggestedAction =
    relatedness === 'related' && confidence >= 0.7 ? 'confirm'
    : relatedness === 'unrelated' ? 'call'
    : 'review'

  return {
    level, confidence, relatedness,
    message: (input.reason || '').trim() || 'Assessed the booking against the deferred work.',
    matchedItems: covered, partialItems: [], unmatchedItems: missing,
    suggestedAction, basis: 'ai', source: 'ai',
  }
}

/**
 * Run the AI tier. Returns null on any failure (no key, quota exhausted, API
 * error) so the caller falls back to the deterministic verdict — the booking
 * panel must never block on AI availability.
 */
export async function scoreBookingRelatednessAI(
  items: DeferredItemLite[],
  booking: BookingLite,
  organizationId: string,
  userId?: string
): Promise<BookingMatchVerdict | null> {
  try {
    const input = await generateWithTracking<VerdictToolInput>(
      organizationId,
      userId,
      'booking_relatedness',
      {},
      async () => {
        const { result, inputTokens, outputTokens } = await callClaudeVerdict(items, booking)
        return { result, inputTokens, outputTokens }
      }
    )
    return aiToVerdict(input, items)
  } catch (err) {
    logger.info('Booking relatedness AI tier unavailable — using deterministic verdict', {
      organizationId, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ---------------------------------------------------------------------------
// Orchestrator + persistence
// ---------------------------------------------------------------------------

/**
 * Deterministic first; consult AI only on the ambiguous middle (and only when
 * allowAI). Returns the best verdict available.
 */
export async function computeBookingVerdict(
  items: DeferredItemLite[],
  booking: BookingLite,
  opts: { organizationId: string; userId?: string; allowAI?: boolean }
): Promise<BookingMatchVerdict> {
  const det = scoreBookingRelatednessDeterministic(items, booking)
  if (!det.ambiguous || opts.allowAI === false) return det.verdict
  const ai = await scoreBookingRelatednessAI(items, booking, opts.organizationId, opts.userId)
  return ai ?? det.verdict
}

/**
 * Is the verdict strong enough to AUTO-credit the booking to outreach? We only
 * attribute recovered £ when the matcher (deterministic OR Claude) is SURE the
 * booking includes the deferred work — a clean "related" with a "confirm"
 * recommendation (which already encodes high confidence on both tiers). Anything
 * ambiguous (partial / unrelated / thin / low confidence) stays unattributed until
 * an advisor manually confirms it via "Confirm as booked".
 */
export function isConfidentlyRelated(v: BookingMatchVerdict | null | undefined): boolean {
  return !!v && v.relatedness === 'related' && v.suggestedAction === 'confirm'
}

// Stable hash of the inputs so a cached verdict is reused until the deferred
// items or the booking content actually change.
export function bookingMatchHash(items: DeferredItemLite[], booking: BookingLite): string {
  const payload = JSON.stringify({
    names: names(items).map((n) => n.toLowerCase()).sort(),
    bookingId: booking.id,
    serviceType: booking.booked_service_type || null,
    mot: !!booking.is_mot_booking,
    notes: booking.notes ? String(booking.notes).split('\n')[0] : null,
    repairs: parseRepairs(booking).map((r) => ({
      d: r.description || null, c: r.code || null, n: r.notes || null,
      l: (r.labourItems || []).map((x) => x.description || null),
    })),
  })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

// Avoid double-firing the AI tier when the modal is opened repeatedly before the
// first compute finishes.
const inflight = new Set<string>()

/**
 * Compute the verdict (deterministic + AI) and persist it on the case, keyed by
 * the booking id + an input hash so it's reused until something changes. Safe to
 * call fire-and-forget from the read path, or awaited from the sweep.
 */
export async function persistBookingVerdict(
  caseId: string,
  organizationId: string,
  items: DeferredItemLite[],
  booking: BookingLite,
  opts: { userId?: string; allowAI?: boolean } = {}
): Promise<BookingMatchVerdict | null> {
  const hash = bookingMatchHash(items, booking)
  const key = `${caseId}:${hash}`
  if (inflight.has(key)) return null
  inflight.add(key)
  try {
    const verdict = await computeBookingVerdict(items, booking, {
      organizationId, userId: opts.userId, allowAI: opts.allowAI,
    })
    const { error } = await supabaseAdmin
      .from('follow_up_cases')
      .update({
        booking_match_verdict: verdict,
        booking_match_level: verdict.level,
        booking_match_source: verdict.source,
        booking_match_booking_id: booking.id,
        booking_match_hash: hash,
        booking_match_at: new Date().toISOString(),
      })
      .eq('id', caseId)
      .eq('organization_id', organizationId)
    if (error) logger.warn('Failed to persist booking verdict', { caseId, error: error.message })
    return verdict
  } catch (err) {
    logger.warn('Booking verdict computation failed', { caseId, error: err instanceof Error ? err.message : String(err) })
    return null
  } finally {
    inflight.delete(key)
  }
}
