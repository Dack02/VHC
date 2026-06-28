/**
 * Parts Gross Profit / Margin-by-Repair-Type report (GMS/PARTS.md §8).
 * Aggregates in-DB via report_parts_gross_profit (row-cap safe). Closes the
 * deferred Repair Types margin piece.
 */
import { supabaseAdmin } from '../lib/supabase.js'

export interface PartsGpRow {
  repairTypeId: string | null
  repairTypeName: string
  partCount: number
  totalSell: number
  totalCost: number
  totalMargin: number
  marginPercent: number
}

export interface PartsGpReport {
  rows: PartsGpRow[]
  totals: {
    partCount: number
    totalSell: number
    totalCost: number
    totalMargin: number
    marginPercent: number
  }
}

const pct = (margin: number, sell: number) => (sell > 0 ? Math.round((margin / sell) * 1000) / 10 : 0)

export async function buildPartsGpReport(orgId: string, from: string, to: string): Promise<PartsGpReport> {
  const { data, error } = await supabaseAdmin.rpc('report_parts_gross_profit', {
    p_org_id: orgId,
    p_from: from,
    p_to: to,
  })
  if (error) throw new Error(error.message)

  const rows: PartsGpRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const totalSell = Number(r.total_sell) || 0
    const totalCost = Number(r.total_cost) || 0
    const totalMargin = Number(r.total_margin) || 0
    return {
      repairTypeId: (r.repair_type_id as string) ?? null,
      repairTypeName: (r.repair_type_name as string) ?? 'Unassigned',
      partCount: Number(r.part_count) || 0,
      totalSell,
      totalCost,
      totalMargin,
      marginPercent: pct(totalMargin, totalSell),
    }
  })

  const totalSell = rows.reduce((s, r) => s + r.totalSell, 0)
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalMargin = rows.reduce((s, r) => s + r.totalMargin, 0)

  return {
    rows,
    totals: {
      partCount: rows.reduce((s, r) => s + r.partCount, 0),
      totalSell: Math.round(totalSell * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalMargin: Math.round(totalMargin * 100) / 100,
      marginPercent: pct(totalMargin, totalSell),
    },
  }
}
