/**
 * Health Check PDF Styles
 * Styles specific to the health check report PDF
 */

export function getHealthCheckStyles(primaryColor: string): string {
  return `
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 15px;
      margin-bottom: 20px;
    }

    .header-left h1 {
      font-size: 20px;
      color: ${primaryColor};
      margin-bottom: 5px;
    }

    .header-logo {
      max-height: 48px;
      max-width: 180px;
      margin-bottom: 8px;
    }

    .header-left .vhc-ref {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 4px;
    }

    .header-left .subtitle {
      color: #6b7280;
      font-size: 12px;
    }

    .header-right {
      text-align: right;
    }

    .header-right .site-name {
      font-weight: 600;
      font-size: 14px;
      color: ${primaryColor};
    }

    .header-right .site-contact {
      color: #6b7280;
      font-size: 10px;
    }

    .info-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    .info-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      padding: 12px;
    }

    .info-box h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    .registration {
      font-size: 18px;
      font-weight: 700;
      color: ${primaryColor};
      background: #fef3c7;
      padding: 4px 8px;
      display: inline-block;
      margin-bottom: 8px;
    }

    .item-name {
      font-weight: 500;
      margin-bottom: 2px;
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-description {
      font-size: 10px;
      color: #6b7280;
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Group badge for repair item rows */
    .group-badge {
      display: inline-block;
      background: linear-gradient(to right, #7c3aed, #6d28d9);
      color: white;
      font-size: 9px;
      font-weight: 600;
      padding: 2px 6px;
      margin-left: 8px;
      text-transform: uppercase;
      vertical-align: middle;
    }

    /* Grouped items section within a table row */
    .grouped-items-section {
      margin-top: 8px;
      padding: 8px 10px;
      background: linear-gradient(to right, #f5f3ff, #ede9fe);
      border-left: 3px solid #7c3aed;
    }

    .grouped-items-header {
      font-size: 9px;
      font-weight: 600;
      color: #5b21b6;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .grouped-items-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .grouped-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
    }

    .grouped-item-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .grouped-item-name {
      color: #374151;
    }

    .group-row {
      background: #faf5ff;
    }

    .measurement-details {
      margin-top: 6px;
      padding: 6px 8px;
      background: #f9fafb;
      font-size: 10px;
    }

    .measurements {
      display: flex;
      gap: 12px;
      margin-bottom: 4px;
    }

    .remaining {
      color: #16a34a;
      font-weight: 500;
    }

    .remaining.below-legal {
      color: #dc2626;
    }

    .brake-type {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .tyre-info {
      color: #6b7280;
      font-style: italic;
    }

    .tech-notes {
      margin-top: 6px;
      font-size: 10px;
      color: #4b5563;
      font-style: italic;
      background: #fefce8;
      padding: 4px 6px;
    }

    .reasons-section {
      margin-top: 6px;
      font-size: 10px;
    }

    .reasons-intro {
      color: #374151;
      margin-bottom: 4px;
    }

    .reasons-list {
      margin: 0;
      padding-left: 16px;
    }

    .reasons-list li {
      margin-bottom: 2px;
    }

    .single-reason {
      color: #374151;
    }

    .follow-up-note {
      margin-top: 6px;
      font-weight: 500;
      font-size: 10px;
    }

    .green-reason {
      color: #16a34a;
      font-size: 10px;
      margin-left: 4px;
    }

    .mot-cell {
      width: 50px;
      text-align: center;
      vertical-align: middle;
    }

    .mot-badge {
      display: inline-block;
      background: #991b1b;
      color: white;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .price-cell {
      width: 80px;
      text-align: right;
      font-weight: 500;
    }

    .photo-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px;
    }

    .photo-item {
      border: 1px solid #e5e7eb;
      overflow: hidden;
    }

    .photo-item img {
      width: 100%;
      height: 100px;
      object-fit: cover;
    }

    .photo-caption {
      font-size: 9px;
      padding: 4px;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .photo-caption.red { background: #fef2f2; color: #dc2626; }
    .photo-caption.amber { background: #fffbeb; color: #d97706; }
    .photo-caption.green { background: #f0fdf4; color: #16a34a; }

    .more-photos {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6b7280;
      font-size: 10px;
    }

    /* New Repair Items Section (Phase 6+) */
    .repair-item-card {
      padding: 12px;
      border-bottom: 1px solid #f3f4f6;
    }

    .repair-item-card:last-child {
      border-bottom: none;
    }

    .repair-item-card.child-item {
      background: #fafafa;
      border-left: 3px solid #7c3aed;
      margin-left: 16px;
      padding: 10px 12px;
    }

    .repair-group-container {
      border-bottom: 1px solid #e5e7eb;
    }

    .repair-group-container:last-child {
      border-bottom: none;
    }

    .repair-group-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 14px 12px;
      background: linear-gradient(to right, #f5f3ff, #ede9fe);
      border-bottom: 2px solid #7c3aed;
    }

    .repair-group-header-content {
      flex: 1;
    }

    .repair-group-name {
      font-weight: 700;
      font-size: 13px;
      color: #5b21b6;
      margin-bottom: 4px;
    }

    .repair-group-description {
      font-size: 10px;
      color: #6b7280;
    }

    .repair-group-totals {
      text-align: right;
      min-width: 120px;
    }

    .repair-group-children {
      padding-left: 8px;
      background: #fefefe;
    }

    .repair-item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }

    .repair-item-name {
      font-weight: 600;
      font-size: 12px;
      color: #1f2937;
    }

    .repair-item-price {
      font-weight: 600;
      font-size: 14px;
      text-align: right;
    }

    .repair-item-price-note {
      font-size: 9px;
      color: #6b7280;
      font-weight: normal;
    }

    .repair-item-description {
      font-size: 10px;
      color: #4b5563;
      margin-bottom: 8px;
    }

    .linked-items {
      font-size: 10px;
      color: #6b7280;
      margin-bottom: 8px;
    }

    .linked-items strong {
      color: #4b5563;
    }

    .repair-options {
      margin-top: 8px;
    }

    .repair-option {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      margin-bottom: 4px;
    }

    .repair-option.selected {
      background: #eff6ff;
      border-color: #3b82f6;
    }

    .repair-option.recommended {
      border-left: 3px solid #16a34a;
    }

    .repair-option-name {
      font-weight: 500;
      font-size: 11px;
    }

    .recommended-badge {
      display: inline-block;
      background: #dcfce7;
      color: #16a34a;
      font-size: 8px;
      font-weight: 600;
      padding: 2px 6px;
      margin-left: 6px;
      text-transform: uppercase;
    }

    .selected-badge {
      display: inline-block;
      background: #dbeafe;
      color: #2563eb;
      font-size: 8px;
      font-weight: 600;
      padding: 2px 6px;
      margin-left: 6px;
      text-transform: uppercase;
    }

    .repair-option-price {
      font-weight: 500;
      font-size: 11px;
    }

    .quote-summary-box {
      margin-top: 16px;
      padding: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
    }

    .quote-summary-title {
      font-weight: 600;
      font-size: 12px;
      color: #1f2937;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }

    .quote-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      font-size: 11px;
    }

    .quote-row.subtotal {
      border-top: 1px solid #e5e7eb;
      margin-top: 8px;
      padding-top: 8px;
    }

    .quote-row.total {
      border-top: 2px solid #1f2937;
      margin-top: 4px;
      padding-top: 8px;
      font-weight: 700;
      font-size: 14px;
    }

    .quote-label {
      color: #4b5563;
    }

    .quote-value {
      font-weight: 500;
      color: #1f2937;
    }

    .vat-exempt-note {
      font-size: 9px;
      color: #6b7280;
      font-style: italic;
      margin-top: 8px;
    }

    .approval-status {
      display: inline-block;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 500;
    }

    .approval-status.approved {
      background: #dcfce7;
      color: #16a34a;
    }

    .approval-status.declined {
      background: #fee2e2;
      color: #dc2626;
    }

    .approval-status.pending {
      background: #fef9c3;
      color: #ca8a04;
    }

    .labour-parts-breakdown {
      margin-top: 12px;
      font-size: 10px;
    }

    .breakdown-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    .breakdown-table th {
      text-align: left;
      padding: 4px 6px;
      background: #f3f4f6;
      font-weight: 500;
      font-size: 9px;
      text-transform: uppercase;
      color: #6b7280;
    }

    .breakdown-table td {
      padding: 4px 6px;
      border-bottom: 1px solid #f3f4f6;
    }

    .breakdown-table .right {
      text-align: right;
    }

    .green-list {
      padding: 12px;
      columns: 2;
      column-gap: 20px;
    }

    .green-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      break-inside: avoid;
    }

    .green-check {
      color: #16a34a;
      font-weight: bold;
    }

    .summary-section {
      margin-top: 30px;
      page-break-inside: avoid;
    }

    .summary-title {
      font-size: 14px;
      font-weight: 600;
      color: ${primaryColor};
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e5e7eb;
    }

    .summary-table {
      width: 100%;
      border-collapse: collapse;
    }

    .summary-table th {
      text-align: left;
      padding: 8px 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      font-size: 10px;
      text-transform: uppercase;
    }

    .summary-table td {
      padding: 8px 12px;
      border: 1px solid #e5e7eb;
    }

    .summary-table .total-row {
      font-weight: 600;
      background: #f9fafb;
    }

    .summary-table .amount {
      text-align: right;
    }

    .signature-section {
      margin-top: 30px;
      page-break-inside: avoid;
    }

    .signature-box {
      border: 1px solid #e5e7eb;
      padding: 15px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    .signature-image {
      border: 1px solid #e5e7eb;
      padding: 10px;
      text-align: center;
    }

    .signature-image img {
      max-width: 200px;
      max-height: 80px;
    }

    .signature-details {
      font-size: 11px;
    }

    .signature-label {
      color: #6b7280;
      font-size: 10px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      color: #9ca3af;
      font-size: 9px;
    }
  `
}
