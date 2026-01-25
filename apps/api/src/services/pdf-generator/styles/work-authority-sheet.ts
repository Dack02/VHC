/**
 * Work Authority Sheet PDF Styles - V2
 * Matches the mockup at docs/work-authority-mockup-v2.html
 */

export function getWorkAuthorityStyles(): string {
  return `
    /* Reset & Base */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 9pt;
      color: #1a1a2e;
    }

    /* Page setup */
    @page {
      size: A4 portrait;
      margin: 12mm;
    }

    .page {
      page-break-after: always;
    }

    .page:last-child {
      page-break-after: auto;
    }

    /* ===== HEADER ===== */
    .header {
      background: #1e293b;
      color: white;
      padding: 10px 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .header h1 {
      font-size: 14pt;
      font-weight: 600;
      letter-spacing: 1px;
      margin: 0;
    }

    .header-right {
      text-align: right;
      font-size: 8pt;
    }

    .doc-number {
      font-weight: 600;
      font-size: 9pt;
    }

    /* ===== INFO GRID ===== */
    .info-grid {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }

    .info-box {
      flex: 1;
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
    }

    .info-box-title {
      font-size: 7pt;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .info-row {
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      font-size: 8.5pt;
    }

    .info-item label {
      color: #64748b;
      font-size: 7pt;
      display: block;
    }

    .info-item span {
      font-weight: 600;
      display: block;
    }

    /* ===== REFERENCE BAR ===== */
    .reference-bar {
      display: flex;
      gap: 20px;
      font-size: 8pt;
      padding: 6px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      margin-bottom: 10px;
    }

    .reference-bar strong {
      font-weight: 600;
    }

    /* ===== SECTION HEADER ===== */
    .section-header {
      background: #1e293b;
      color: white;
      padding: 6px 10px;
      font-size: 9pt;
      font-weight: 600;
      margin-top: 10px;
      margin-bottom: 0;
    }

    /* ===== WORK TABLE ===== */
    .work-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
    }

    .work-table th {
      background: #f1f5f9;
      padding: 5px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 7pt;
      text-transform: uppercase;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
    }

    .work-table th.num {
      text-align: right;
    }

    .work-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }

    .work-table td.num {
      text-align: right;
      font-family: 'Consolas', monospace;
    }

    /* Item header row - repair title */
    .item-row td {
      background: #fafafa;
      padding: 8px;
      font-weight: 600;
    }

    .item-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Severity badges */
    .severity-badge {
      font-size: 6.5pt;
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .severity-red {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fca5a5;
    }

    .severity-amber {
      background: #fef3c7;
      color: #d97706;
      border: 1px solid #fcd34d;
    }

    .severity-green {
      background: #d1fae5;
      color: #059669;
      border: 1px solid #6ee7b7;
    }

    /* Child items (grouped repairs) */
    .child-item td:first-child {
      padding-left: 20px;
    }

    .child-item-prefix {
      color: #94a3b8;
      margin-right: 6px;
    }

    .child-item-text {
      color: #64748b;
      font-size: 7.5pt;
    }

    /* Line type indicator (LABOUR/PART) */
    .line-type {
      color: #94a3b8;
      font-size: 6.5pt;
      text-transform: uppercase;
      display: inline-block;
      width: 45px;
    }

    /* Subtotal row */
    .subtotal-row td {
      background: #f8fafc;
      font-weight: 600;
      font-size: 7.5pt;
      color: #475569;
    }

    /* ===== SUMMARY SECTION ===== */
    .summary-section {
      margin-top: 15px;
      border: 1px solid #1e293b;
    }

    .summary-header {
      background: #1e293b;
      color: white;
      padding: 5px 10px;
      font-size: 8pt;
      font-weight: 600;
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
    }

    .summary-table td {
      padding: 4px 10px;
      border-bottom: 1px solid #f1f5f9;
    }

    .summary-table td.num {
      text-align: right;
      font-family: 'Consolas', monospace;
      width: 80px;
    }

    .summary-table td.label {
      color: #64748b;
    }

    .summary-table tr.subtotal td {
      font-weight: 600;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }

    .summary-table tr.vat td {
      color: #64748b;
    }

    .summary-table tr.total td {
      font-weight: 700;
      font-size: 10pt;
      background: #1e293b;
      color: white;
      padding: 8px 10px;
    }

    /* ===== TECHNICIAN WORK SUMMARY ===== */
    .tech-summary-section {
      margin-top: 15px;
      border: 1px solid #1e293b;
    }

    .tech-summary-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
    }

    .tech-summary-table td {
      padding: 6px 10px;
      border-bottom: 1px solid #f1f5f9;
    }

    .tech-summary-table td.num {
      text-align: right;
      font-family: 'Consolas', monospace;
      font-weight: 600;
    }

    /* ===== PRINT HELPERS ===== */
    .no-break {
      page-break-inside: avoid;
    }

    .page-break {
      page-break-before: always;
    }
  `
}
