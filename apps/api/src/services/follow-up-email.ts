/**
 * Follow-Up engine — branded customer email rendering.
 *
 * Builds the HTML + plain-text email (including the deferred-items table) from a
 * body template, the per-case template vars, the item snapshots and the org's
 * branding. Extracted from follow-up-engine.ts; pure presentation, no I/O.
 */

import { gbp, fmtDate, escapeHtml, render } from './follow-up-utils.js'

export interface CaseItemSnapshot {
  name_snapshot: string | null
  value_snapshot: number | null
  due_date_snapshot: string | null
}

// Collision-proof placeholder marking where the items table is injected into the
// rendered body. Written with \0 escapes (not raw NUL bytes) so the source file
// stays plain text — a real template would never contain a NUL.
const ITEMS_MARKER = '\0ITEMS\0'

function buildItemsHtml(items: CaseItemSnapshot[], color: string): string {
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(it.name_snapshot || 'Repair')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;">${it.due_date_snapshot ? escapeHtml(fmtDate(it.due_date_snapshot)) : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${escapeHtml(gbp(it.value_snapshot))}</td>
      </tr>`
    )
    .join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px;">
    <thead><tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${color};">Work</th>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid ${color};">Due</th>
      <th style="text-align:right;padding:8px 12px;border-bottom:2px solid ${color};">Price</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

function buildItemsText(items: CaseItemSnapshot[]): string {
  return items
    .map((it) => `• ${it.name_snapshot || 'Repair'}${it.due_date_snapshot ? ` (due ${fmtDate(it.due_date_snapshot)})` : ''} — ${gbp(it.value_snapshot)}`)
    .join('\n')
}

export function buildEmail(
  bodyTemplate: string,
  vars: Record<string, string>,
  items: CaseItemSnapshot[],
  branding: { logoUrl?: string | null; primaryColor?: string; organizationName?: string; phone?: string }
): { html: string; text: string } {
  const color = branding.primaryColor || '#3B82F6'

  // Text version
  const text = render(bodyTemplate, { ...vars, deferredItemsTable: buildItemsText(items) })

  // HTML version — substitute everything except the items marker, then lay out
  const withMarker = render(bodyTemplate, { ...vars, deferredItemsTable: ITEMS_MARKER })
  const itemsHtml = buildItemsHtml(items, color)
  const bodyHtml = withMarker
    .split('\n')
    .map((line) => {
      if (line.includes(ITEMS_MARKER)) return itemsHtml
      if (!line.trim()) return ''
      return `<p style="margin:0 0 12px;line-height:1.5;">${escapeHtml(line)}</p>`
    })
    .join('')

  const header = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${escapeHtml(branding.organizationName)}" style="max-height:48px;" />`
    : `<span style="color:#fff;font-size:18px;font-weight:700;">${escapeHtml(branding.organizationName || 'Vehicle Health Check')}</span>`

  const cta = vars.followUpUrl
    ? `<div style="margin:20px 0;"><a href="${escapeHtml(vars.followUpUrl)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">View &amp; book</a></div>`
    : ''

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <div style="max-width:600px;margin:0 auto;padding:16px;">
      <div style="background:${color};padding:16px 20px;border-radius:12px 12px 0 0;">${header}</div>
      <div style="background:#fff;border-bottom:1px solid #eee;padding:12px 20px;font-size:13px;color:#374151;">
        <strong>${escapeHtml(vars.vehicleReg)}</strong> &middot; ${escapeHtml(vars.itemCount)} item(s) &middot; <strong>${escapeHtml(vars.deferredTotal)}</strong>${vars.dueDate ? ` &middot; due ${escapeHtml(vars.dueDate)}` : ''}
      </div>
      <div style="background:#fff;padding:24px 20px;border-radius:0 0 12px 12px;">
        ${bodyHtml}
        ${cta}
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">You're receiving this because you have outstanding recommended work with ${escapeHtml(branding.organizationName || 'us')}. Reply STOP to opt out.</p>
      </div>
    </div>
  </body></html>`

  return { html, text }
}
