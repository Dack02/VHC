import { supabaseAdmin } from '../lib/supabase.js'

/**
 * Banded pricing-matrix engine (GMS/PARTS.md §5.12, P3). Resolves a suggested sell price
 * from a cost using the org's cost-banded markup matrix, falling back to the flat
 * default-margin markup. Gated by organization_settings.pricing_matrix_enabled — when
 * off (the default for every existing org), this always returns the flat result, so the
 * P3 deploy changes no live pricing until an org opts in.
 *
 * Precedence (once enabled): per-category matrix → org default matrix → flat fallback.
 * The full sell-price precedence (job-line override → item sell_price_override → matrix →
 * flat) is enforced by callers; this resolves the matrix/flat tail only.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface SellPriceResult {
  costPrice: number
  sellPrice: number
  source: 'matrix' | 'flat'
  marginPercent: number
  markupPercent: number
  matrixId?: string | null
  bandId?: string | null
}

function withMetrics(costPrice: number, sellPrice: number, source: 'matrix' | 'flat', matrixId?: string | null, bandId?: string | null): SellPriceResult {
  const sp = round2(sellPrice)
  const marginPercent = sp > 0 ? round2(((sp - costPrice) / sp) * 100) : 0
  const markupPercent = costPrice > 0 ? round2(((sp - costPrice) / costPrice) * 100) : 0
  return { costPrice: round2(costPrice), sellPrice: sp, source, marginPercent, markupPercent, matrixId: matrixId ?? null, bandId: bandId ?? null }
}

function flatSell(costPrice: number, marginPercent: number): number {
  // Mirror /api/v1/pricing/calculate: sell = cost / (1 - margin/100). Margin clamped < 100.
  const m = Math.min(Math.max(marginPercent, 0), 99.99)
  return costPrice / (1 - m / 100)
}

export async function resolveSellPrice(orgId: string, costPrice: number, categoryId?: string | null): Promise<SellPriceResult> {
  const cost = Number(costPrice)
  if (!Number.isFinite(cost) || cost < 0) return withMetrics(0, 0, 'flat')

  const { data: settings } = await supabaseAdmin
    .from('organization_settings')
    .select('pricing_matrix_enabled, default_margin_percent')
    .eq('organization_id', orgId)
    .maybeSingle()
  const defaultMargin = Number(settings?.default_margin_percent ?? 40) || 40

  // Engine off → flat markup only.
  if (!settings?.pricing_matrix_enabled) {
    return withMetrics(cost, flatSell(cost, defaultMargin), 'flat')
  }

  // Find the applicable matrix: a per-category one wins over the org default.
  let matrix: { id: string } | null = null
  if (categoryId) {
    const { data } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id')
      .eq('organization_id', orgId)
      .eq('category_id', categoryId)
      .eq('is_active', true)
      .maybeSingle()
    if (data) matrix = data
  }
  if (!matrix) {
    const { data } = await supabaseAdmin
      .from('pricing_matrix')
      .select('id')
      .eq('organization_id', orgId)
      .is('category_id', null)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle()
    if (data) matrix = data
  }
  if (!matrix) {
    return withMetrics(cost, flatSell(cost, defaultMargin), 'flat')
  }

  // Pick the band whose [cost_from, cost_to) contains the cost.
  const { data: bands } = await supabaseAdmin
    .from('pricing_matrix_bands')
    .select('id, cost_from, cost_to, markup_pct, multiplier')
    .eq('pricing_matrix_id', matrix.id)
    .order('cost_from', { ascending: true })
  const band = (bands ?? []).find((bd) => {
    const from = Number(bd.cost_from) || 0
    const to = bd.cost_to == null ? null : Number(bd.cost_to)
    return cost >= from && (to == null || cost < to)
  })
  if (!band) {
    return withMetrics(cost, flatSell(cost, defaultMargin), 'flat')
  }

  let sell: number
  if (band.multiplier != null) {
    sell = cost * (Number(band.multiplier) || 0)
  } else if (band.markup_pct != null) {
    sell = cost * (1 + (Number(band.markup_pct) || 0) / 100)
  } else {
    return withMetrics(cost, flatSell(cost, defaultMargin), 'flat')
  }
  // A misconfigured band (×0 / 0%) that prices at or below cost falls back to flat so we
  // never suggest a below-cost price from the matrix.
  if (sell <= cost) {
    return withMetrics(cost, flatSell(cost, defaultMargin), 'flat')
  }
  return withMetrics(cost, sell, 'matrix', matrix.id, band.id)
}
