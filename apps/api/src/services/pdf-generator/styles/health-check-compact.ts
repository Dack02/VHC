/**
 * Health Check Compact PDF Styles
 * Compact single-page layout styles matching the design specification
 */

export function getCompactStyles(): string {
  return `
    /* Reset & Base */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 9px;
      line-height: 1.3;
      color: #1f2937;
    }

    /* Page setup */
    @page {
      size: A4;
      margin: 10mm;
    }

    /* Colors - hardcoded for Puppeteer compatibility */
    /* Red: #DC2626, Red-light: #FEF2F2, Red-border: #FECACA */
    /* Amber: #D97706, Amber-light: #FFFBEB, Amber-border: #FDE68A */
    /* Green: #059669, Green-light: #ECFDF5, Green-border: #A7F3D0 */

    /* ===== HEADER ===== */
    .compact-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 10px;
      border-bottom: 2px solid #1f2937;
      margin-bottom: 10px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-logo {
      width: 40px;
      height: 40px;
      object-fit: contain;
      background: #f3f4f6;
      padding: 4px;
    }

    .header-logo-placeholder {
      width: 40px;
      height: 40px;
      background: #374151;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 8px;
      font-weight: 700;
      text-align: center;
      line-height: 1.1;
    }

    .header-title {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
    }

    .header-subtitle {
      font-size: 9px;
      color: #6b7280;
    }

    .header-right {
      text-align: right;
    }

    .header-ref {
      font-size: 12px;
      font-weight: 700;
      color: #1f2937;
    }

    .header-date {
      font-size: 9px;
      color: #6b7280;
    }

    /* ===== INFO BAR ===== */
    .info-bar {
      display: flex;
      align-items: center;
      gap: 24px;
      background: #f9fafb;
      padding: 10px 12px;
      margin-bottom: 10px;
      border-radius: 8px;
    }

    .reg-plate {
      background: #fef08a;
      padding: 6px 12px;
      font-size: 14px;
      font-weight: 700;
      color: #1f2937;
      letter-spacing: 1px;
      border-radius: 4px;
    }

    .info-item {
      flex: 1;
    }

    .info-label {
      font-size: 7px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .info-value {
      font-size: 10px;
      font-weight: 500;
      color: #1f2937;
    }

    /* ===== RAG SUMMARY ===== */
    .rag-summary {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .rag-block {
      flex: 1;
      padding: 10px;
      border: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 8px;
    }

    .rag-block.red {
      background: #FEF2F2;
      border-color: #FECACA;
    }

    .rag-block.amber {
      background: #FFFBEB;
      border-color: #FDE68A;
    }

    .rag-block.green {
      background: #ECFDF5;
      border-color: #A7F3D0;
    }

    .rag-block.total {
      background: #1f2937;
      border-color: #1f2937;
      flex: 0 0 140px;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .rag-count {
      font-size: 24px;
      font-weight: 700;
    }

    .rag-block.red .rag-count { color: #DC2626; }
    .rag-block.amber .rag-count { color: #D97706; }
    .rag-block.green .rag-count { color: #059669; }

    .rag-info {
      flex: 1;
    }

    .rag-label {
      font-size: 9px;
      font-weight: 500;
    }

    .rag-block.red .rag-label { color: #DC2626; }
    .rag-block.amber .rag-label { color: #D97706; }
    .rag-block.green .rag-label { color: #059669; }

    .rag-price {
      font-size: 12px;
      font-weight: 700;
      color: #1f2937;
    }

    .total-label {
      font-size: 8px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .total-value {
      font-size: 20px;
      font-weight: 700;
      color: white;
    }

    /* ===== MEASUREMENTS SECTION ===== */
    .measurements-row {
      display: flex;
      gap: 12px;
      margin-bottom: 12px;
    }

    .measurement-card {
      flex: 1;
      border: 1px solid #e5e7eb;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }

    .measurement-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      border-radius: 8px 8px 0 0;
    }

    .measurement-title {
      font-size: 10px;
      font-weight: 600;
      color: #1f2937;
    }

    .measurement-legend {
      font-size: 7px;
      color: #6b7280;
    }

    .measurement-content {
      padding: 8px;
    }

    /* Tyre Grid - 2x2 layout */
    .tyre-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .tyre-cell {
      padding: 8px;
      background: #f9fafb;
      border-radius: 6px;
    }

    .tyre-cell.urgent {
      background: #FEF2F2;
      border-left: 3px solid #DC2626;
      border-radius: 6px;
    }

    .tyre-cell.advisory {
      background: #FFFBEB;
      border-left: 3px solid #D97706;
      border-radius: 6px;
    }

    .tyre-position {
      font-size: 8px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 4px;
    }

    .tyre-readings {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .tyre-depths {
      font-size: 10px;
      font-weight: 500;
      color: #374151;
      font-family: monospace;
    }

    .tyre-depths .critical {
      color: #DC2626;
      font-weight: 700;
    }

    .tyre-status {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .tyre-status.green { background: #059669; }
    .tyre-status.amber { background: #D97706; }
    .tyre-status.red { background: #DC2626; }

    /* Brake Table */
    .brake-table-container {
      display: flex;
      gap: 8px;
    }

    .brake-axle {
      flex: 1;
    }

    .brake-axle-header {
      font-size: 9px;
      font-weight: 600;
      color: #374151;
      padding: 4px 6px;
      background: #f3f4f6;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
    }

    .brake-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8px;
    }

    .brake-table th {
      padding: 3px 4px;
      text-align: right;
      font-weight: 500;
      color: #6b7280;
      background: #f9fafb;
      font-size: 7px;
    }

    .brake-table th:first-child {
      text-align: left;
    }

    .brake-table td {
      padding: 3px 4px;
      text-align: right;
      font-family: monospace;
    }

    .brake-table td:first-child {
      text-align: left;
      color: #6b7280;
    }

    .brake-value.critical {
      color: #DC2626;
      font-weight: 600;
    }

    .brake-value.ok {
      color: #374151;
    }

    .brake-value.na {
      color: #9ca3af;
      font-style: italic;
    }

    .brake-alert {
      padding: 6px 8px;
      background: #FEF2F2;
      border-top: 1px dashed #FECACA;
      font-size: 8px;
      color: #DC2626;
      font-weight: 500;
    }

    .brake-no-data {
      padding: 16px;
      text-align: center;
      color: #9ca3af;
      font-size: 9px;
    }

    /* ===== FINDINGS SECTIONS ===== */
    .findings-section {
      border: 1px solid #e5e7eb;
      margin-bottom: 10px;
      page-break-inside: avoid;
      border-radius: 8px;
      overflow: hidden;
    }

    .findings-header {
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      border-radius: 8px 8px 0 0;
    }

    .findings-header.red {
      background: #FEF2F2;
      border-bottom: 1px solid #FECACA;
    }

    .findings-header.amber {
      background: #FFFBEB;
      border-bottom: 1px solid #FDE68A;
    }

    .findings-header.green {
      background: #ECFDF5;
      border-bottom: 1px solid #A7F3D0;
    }

    .findings-icon {
      font-size: 10px;
    }

    .findings-title {
      font-size: 10px;
      font-weight: 600;
    }

    .findings-header.red .findings-title { color: #DC2626; }
    .findings-header.amber .findings-title { color: #D97706; }
    .findings-header.green .findings-title { color: #059669; }

    .findings-content {
      padding: 8px 12px;
    }

    .finding-row {
      padding: 6px 0;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .finding-row:last-child {
      border-bottom: none;
    }

    .finding-info {
      flex: 1;
      min-width: 0;
    }

    .finding-name {
      font-size: 10px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 2px;
    }

    .finding-description {
      font-size: 8px;
      color: #6b7280;
      line-height: 1.4;
      margin-bottom: 4px;
      padding-left: 4px;
      border-left: 2px solid #d1d5db;
    }

    .finding-deferred {
      font-size: 8px;
      color: #D97706;
      margin-top: 2px;
    }

    .finding-price {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .deferred-badge {
      font-size: 7px;
      font-weight: 600;
      color: #D97706;
      background: #FFFBEB;
      padding: 2px 6px;
      text-transform: uppercase;
      border-radius: 4px;
    }

    .authorised-badge {
      font-size: 7px;
      font-weight: 600;
      color: #059669;
      background: #ECFDF5;
      padding: 2px 6px;
      text-transform: uppercase;
      border-radius: 4px;
    }

    .declined-badge {
      font-size: 7px;
      font-weight: 600;
      color: #6b7280;
      background: #f3f4f6;
      padding: 2px 6px;
      text-transform: uppercase;
      border-radius: 4px;
    }

    .finding-authorised {
      font-size: 8px;
      color: #059669;
      margin-top: 2px;
    }

    .finding-declined {
      font-size: 8px;
      color: #6b7280;
      margin-top: 2px;
    }

    .price-value {
      font-size: 10px;
      font-weight: 600;
      color: #1f2937;
      text-align: right;
      min-width: 60px;
    }

    .price-inc {
      font-size: 8px;
      color: #6b7280;
      font-weight: normal;
    }

    /* Green items summary */
    .green-summary {
      text-align: center;
      padding: 10px 12px;
      font-size: 10px;
    }

    .green-count {
      color: #059669;
      font-weight: 700;
    }

    /* Grouped items */
    .finding-group {
      background: #fafafa;
    }

    .group-badge {
      display: inline-block;
      font-size: 7px;
      font-weight: 600;
      color: #6b7280;
      background: #e5e7eb;
      padding: 2px 6px;
      margin-left: 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .finding-children {
      margin-top: 6px;
      margin-left: 12px;
      padding-left: 10px;
      border-left: 2px solid #e5e7eb;
    }

    .finding-child {
      margin-bottom: 8px;
    }

    .finding-child:last-child {
      margin-bottom: 0;
    }

    .finding-child-name {
      font-size: 9px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 3px;
    }

    /* Repair options within findings */
    .finding-options {
      margin-top: 4px;
    }

    .finding-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 8px;
      margin-bottom: 2px;
      border: 1px solid #e5e7eb;
      background: #ffffff;
      font-size: 9px;
      border-radius: 4px;
    }

    .finding-option.recommended {
      border-color: #86efac;
      background: #f0fdf4;
    }

    .finding-option-name {
      color: #374151;
    }

    .finding-option .recommended-badge {
      display: inline-block;
      font-size: 7px;
      font-weight: 600;
      color: #15803d;
      background: #dcfce7;
      padding: 1px 4px;
      margin-left: 4px;
      text-transform: uppercase;
    }

    .finding-option-price {
      font-weight: 600;
      color: #1f2937;
      flex-shrink: 0;
      margin-left: 8px;
    }

    /* ===== FOOTER ===== */
    .compact-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 8px;
    }

    .footer-signature {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }

    .signature-image {
      width: 80px;
      height: 30px;
      border-bottom: 1px solid #374151;
    }

    .signature-image img {
      max-width: 100%;
      max-height: 100%;
    }

    .signature-info {
      color: #6b7280;
    }

    .signature-info strong {
      color: #1f2937;
    }

    .footer-contact {
      text-align: center;
      color: #6b7280;
    }

    .footer-page {
      color: #6b7280;
    }

    /* ===== PAGE 2: PHOTO EVIDENCE ===== */
    .photo-page {
      page-break-before: always;
    }

    .photo-page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 12px;
    }

    .photo-page-title {
      font-size: 14px;
      font-weight: 700;
      color: #1f2937;
    }

    .photo-page-ref {
      font-size: 10px;
      color: #6b7280;
    }

    .photo-group {
      margin-bottom: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }

    .photo-group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      border-radius: 8px 8px 0 0;
    }

    .photo-group-name {
      font-size: 10px;
      font-weight: 600;
      color: #1f2937;
    }

    .photo-status-badge {
      font-size: 7px;
      font-weight: 600;
      padding: 2px 6px;
      text-transform: uppercase;
      border-radius: 4px;
    }

    .photo-status-badge.red {
      background: #DC2626;
      color: white;
    }

    .photo-status-badge.amber {
      background: #D97706;
      color: white;
    }

    .photo-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      padding: 12px;
    }

    .photo-item {
      text-align: center;
    }

    .photo-thumb {
      width: 150px;
      height: 150px;
      object-fit: cover;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }

    .photo-caption {
      font-size: 8px;
      color: #6b7280;
      text-align: center;
      margin-top: 4px;
      max-width: 150px;
    }

    /* Print utilities */
    @media print {
      .findings-section {
        page-break-inside: avoid;
      }

      .photo-group {
        page-break-inside: avoid;
      }
    }
  `
}
