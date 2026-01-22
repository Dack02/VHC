/**
 * Base CSS Styles
 * Shared CSS reset, typography, layout classes, and common colors
 */

export function getBaseStyles(): string {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #1f2937;
      padding: 20px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
    }

    .info-label {
      color: #6b7280;
      font-size: 10px;
    }

    .info-value {
      font-weight: 500;
    }

    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }

    .section-header {
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-header.red {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-bottom: none;
    }

    .section-header.amber {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-bottom: none;
    }

    .section-header.green {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-bottom: none;
    }

    .section-header.blue {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-bottom: none;
    }

    .section-header.grey {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-bottom: none;
    }

    .section-header.purple {
      background: #f5f3ff;
      border: 1px solid #ddd6fe;
      border-bottom: none;
    }

    .section-title {
      font-weight: 600;
      font-size: 12px;
    }

    .section-header.red .section-title { color: #dc2626; }
    .section-header.amber .section-title { color: #d97706; }
    .section-header.green .section-title { color: #16a34a; }
    .section-header.blue .section-title { color: #2563eb; }
    .section-header.grey .section-title { color: #6b7280; }
    .section-header.purple .section-title { color: #7c3aed; }

    .section-stats {
      font-size: 11px;
      color: #6b7280;
    }

    .section-content {
      border: 1px solid #e5e7eb;
      border-top: none;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
    }

    .items-table th {
      text-align: left;
      padding: 8px 12px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
    }

    .items-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
    }

    .items-table tbody tr:nth-child(even) {
      background: #fafafa;
    }

    .items-table tr:last-child td {
      border-bottom: none;
    }

    @media print {
      body {
        padding: 0;
      }

      .section {
        page-break-inside: avoid;
      }
    }
  `
}
